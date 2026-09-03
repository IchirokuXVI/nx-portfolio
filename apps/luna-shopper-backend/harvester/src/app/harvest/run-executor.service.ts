import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HarvestRunMode,
  HarvestRunStatus,
} from '@portfolio/luna-shopper/contracts';
import type { HarvesterConfig } from '../config/app-config';
import { TokenBucket } from '../runner/token-bucket';
import { CatalogDiscoveryRunner } from './catalog-discovery.runner';
import { HarvestRunStore } from './harvest-run.store';
import { RefreshRunner } from './refresh.runner';
import { RunContext } from './run-context';
import { StoreDiscoveryRunner } from './store-discovery.runner';
import { SupermarketSourceService } from './supermarket-source.service';

/**
 * Dispatches a run to its runner, and owns everything the three have in common:
 * the shared token bucket, the abort signal, and the finalizer.
 *
 * **The finalizer is the interesting part** (plan 0038, section 6.6). Abort is
 * graceful and there is one of it: `harvest.abort` sets `abortRequestedAt`, this
 * class cancels the in flight request through the `AbortSignal`, the runner stops
 * fetching and flushes what it has, and the run finalizes as ABORTED. Everything
 * observed before the abort is **kept**, because prices already fetched are valid
 * data. `SIGTERM` runs the same path inside the shutdown drain window, which is
 * what {@link onApplicationShutdown} is for.
 */
@Injectable()
export class RunExecutor implements OnApplicationShutdown {
  private readonly logger = new Logger(RunExecutor.name);
  /** runId -> the controller whose signal every request of that run holds. */
  private readonly inFlight = new Map<string, AbortController>();

  constructor(
    private readonly store: HarvestRunStore,
    private readonly sources: SupermarketSourceService,
    private readonly storeDiscovery: StoreDiscoveryRunner,
    private readonly catalogDiscovery: CatalogDiscoveryRunner,
    private readonly refresh: RefreshRunner,
    private readonly config: ConfigService
  ) {}

  /** True while this process is actually running that run. */
  isRunning(runId: string): boolean {
    return this.inFlight.has(runId);
  }

  /** Cancel the in flight requests of a run this process is running. */
  cancel(runId: string): void {
    this.inFlight.get(runId)?.abort();
  }

  /**
   * Start a run in the background. Deliberately **not** awaited by the caller:
   * `harvest.spawn` answers with the PENDING run immediately, and progress is
   * read by polling `harvest.run.get`. A CATALOG_DISCOVERY takes tens of minutes;
   * a NATS request/reply that waited for it would time out long before.
   */
  start(runId: string): void {
    void this.execute(runId).catch((error: unknown) => {
      this.logger.error(`Harvest run ${runId} crashed: ${String(error)}`);
    });
  }

  /**
   * The same execution, awaited, answering the status it finalized with.
   *
   * The postal code discovery worker (plan 0063, section 2) is the one caller
   * that needs this: it drains its queue **one run at a time**, because the
   * active run index already forbids two, and because `OsmPlacesClient` rate
   * limits per instance so concurrent runs would be a multiple of the rate
   * Nominatim's policy allows. Waiting is how it stays serial.
   *
   * Nothing on a request path may call it. A NATS request/reply that waited for
   * a run would time out many times over, which is why {@link start} exists.
   */
  runToCompletion(runId: string): Promise<HarvestRunStatus> {
    return this.execute(runId);
  }

  private async execute(runId: string): Promise<HarvestRunStatus> {
    const settings = this.config.getOrThrow<HarvesterConfig>('harvester');
    const run = await this.store.load(runId);
    const controller = new AbortController();
    this.inFlight.set(runId, controller);

    const source = run.supermarketId
      ? await this.sources.findBySupermarket(run.supermarketId)
      : null;

    const bucket = new TokenBucket({
      ratePerSecond: source
        ? Number(source.maxRequestsPerSecond)
        : settings.defaultMaxRequestsPerSecond,
    });
    const context = new RunContext(run, controller.signal, bucket, this.store);

    // A run aborted between the insert and here never starts fetching.
    const pollAbort = setInterval(() => {
      void this.store.isAbortRequested(runId).then((requested) => {
        if (requested) {
          controller.abort();
        }
      });
    }, 2000);

    try {
      await this.store.markRunning(runId, 'START', 'Starting');
      if (source) {
        await this.sources.recordRunStarted(source);
      }

      switch (run.mode) {
        case HarvestRunMode.STORE_DISCOVERY:
          await this.storeDiscovery.run(context, {
            postalCode: String(run.input['postalCode'] ?? ''),
            country: String(run.input['country'] ?? 'es'),
            radiusMetres: Number(run.input['radiusMetres'] ?? 3000),
          });
          break;
        case HarvestRunMode.CATALOG_DISCOVERY:
          await this.catalogDiscovery.run(
            context,
            {
              supermarketId: run.supermarketId as string,
              priceScopeId: run.priceScopeId ?? undefined,
            },
            requireSource(source)
          );
          break;
        case HarvestRunMode.REFRESH:
          await this.refresh.run(
            context,
            {
              supermarketId: run.supermarketId as string,
              priceScopeId: run.priceScopeId as string,
            },
            requireSource(source)
          );
          break;
      }

      await context.flush();
      const finished = await this.store.load(runId);
      const status = controller.signal.aborted
        ? HarvestRunStatus.ABORTED
        : this.verdict(finished.failed, finished.totalPlanned, settings);
      await this.store.finish(
        runId,
        status,
        status === HarvestRunStatus.FAILED
          ? `${finished.failed} of ${finished.totalPlanned ?? '?'} items failed, ` +
              `which is over the ${settings.failureRatio} threshold.`
          : undefined
      );
      if (source) {
        await this.sources.recordRunFinished(
          source,
          status === HarvestRunStatus.COMPLETED
        );
      }
      return status;
    } catch (error) {
      // Whatever the run managed before it died is still worth keeping.
      await context.flush().catch(() => undefined);
      const status = controller.signal.aborted
        ? HarvestRunStatus.ABORTED
        : HarvestRunStatus.FAILED;
      await this.store.finish(runId, status, String(error));
      if (source) {
        await this.sources.recordRunFinished(source, false);
      }
      this.logger.error(
        `Harvest run ${runId} ended as ${status}: ${String(error)}`
      );
      return status;
    } finally {
      clearInterval(pollAbort);
      this.inFlight.delete(runId);
    }
  }

  /**
   * A run fails only when the source is unusable (which threw, and is handled
   * above) or when `failed` crosses a configured fraction of `totalPlanned`. Per
   * item failures on their own are counted and logged, not fatal.
   */
  private verdict(
    failed: number,
    totalPlanned: number | null,
    settings: HarvesterConfig
  ): HarvestRunStatus {
    if (!totalPlanned || totalPlanned === 0) {
      return HarvestRunStatus.COMPLETED;
    }
    return failed / totalPlanned > settings.failureRatio
      ? HarvestRunStatus.FAILED
      : HarvestRunStatus.COMPLETED;
  }

  /**
   * SIGTERM takes the same graceful path as an abort (section 6.6): stop
   * fetching, flush what is held, finalize as ABORTED. The pod's
   * `terminationGracePeriodSeconds` is the window this has to finish in.
   */
  onApplicationShutdown(): void {
    for (const [runId, controller] of this.inFlight) {
      this.logger.warn(`Shutting down: aborting harvest run ${runId}`);
      controller.abort();
    }
  }
}

function requireSource<T>(source: T | null): T {
  if (!source) {
    throw new Error(
      'That supermarket has no configured source, so there is no adapter, no ' +
        'worker count and no rate to run with. Create one with supermarketSource.upsert.'
    );
  }
  return source;
}
