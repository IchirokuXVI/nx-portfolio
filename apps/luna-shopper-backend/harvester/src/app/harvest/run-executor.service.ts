import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  HarvestRunMode,
  HarvestRunStatus,
  PriceSourceKind,
  type AdapterKey,
} from '@portfolio/luna-shopper/contracts';
import { IsNull, Not, Repository } from 'typeorm';
import type { HarvesterConfig } from '../config/app-config';
import { SourceCatalogEntry, type SupermarketSource } from '../entities';
import { TokenBucket } from '../runner/token-bucket';
import { CatalogClient } from './catalog-client.service';
import { CatalogDiscoveryRunner } from './catalog-discovery.runner';
import type { BackfillEntry } from './catalog-runner';
import { DiscoveredPlaceService } from './discovered-place.service';
import { FileImportRunner } from './file-import.runner';
import { HarvestRunStore } from './harvest-run.store';
import { PriceScopeResolver } from './price-scope-resolver';
import { RunContext } from './run-context';
import { RunReportSink, type RunReportResult } from './run-report.sink';
import { SourceIngest, type SourceIngestCounters } from './source-ingest';
import { SourceLocationService } from './source-location.service';
import { StoreDiscoveryRunner } from './store-discovery.runner';
import { SupermarketSourceService } from './supermarket-source.service';

/**
 * Dispatches a run to its runner, and owns everything they have in common:
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
    @InjectRepository(SourceCatalogEntry)
    private readonly entries: Repository<SourceCatalogEntry>,
    private readonly store: HarvestRunStore,
    private readonly sources: SupermarketSourceService,
    private readonly storeDiscovery: StoreDiscoveryRunner,
    private readonly catalogDiscovery: CatalogDiscoveryRunner,
    private readonly fileImport: FileImportRunner,
    private readonly ingest: SourceIngest,
    private readonly scopes: PriceScopeResolver,
    private readonly places: DiscoveredPlaceService,
    private readonly shops: SourceLocationService,
    private readonly catalog: CatalogClient,
    private readonly config: ConfigService
  ) {}

  /**
   * The chain's own identity, for a store discovery that reports places under
   * it.
   *
   * A failure is not fatal: the places are still worth writing and group under
   * their own names rather than under the chain's key.
   */
  private async chainOf(
    supermarketId: string
  ): Promise<{ externalBrandKey: string | null; brandName: string | null }> {
    try {
      const chain = await this.catalog.getSupermarket(supermarketId);
      return {
        externalBrandKey: chain.externalBrandKey,
        brandName: chain.name.es ?? chain.name.en ?? null,
      };
    } catch (error) {
      this.logger.warn(
        `Could not read the chain ${supermarketId}: ${String(error)}`
      );
      return { externalBrandKey: null, brandName: null };
    }
  }

  /**
   * The rows a backfill reads pages for: this chain's rows that carry a product
   * page and no EAN (plan 0103, section 6.2).
   *
   * The row's own fields travel with it, because the page a backfill reads
   * answers the EAN and nothing else, and a product is reported whole.
   */
  private async backfillRows(
    supermarketId: string,
    source: SupermarketSource
  ): Promise<BackfillEntry[]> {
    const rows = await this.entries.find({
      where: {
        supermarketId,
        sourceKind: PriceSourceKind.OFFICIAL_WEB,
        ean: IsNull(),
        url: Not(IsNull()),
      },
      order: { createdAt: 'ASC' },
      take: readBackfillBudget(source.config),
    });
    return rows.map((row) => ({
      externalId: row.externalId,
      url: row.url as string,
      name: row.name,
      brand: row.brand,
      unitSize: row.unitSize === null ? null : Number(row.unitSize),
      sizeFormat: row.sizeFormat,
      categoryPath: row.categoryPath ?? [],
    }));
  }

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

      // The write half of the run, and the only thing that has one (plan 0103,
      // section 2.3). Everything a runner has to say goes into this, and
      // everything that has to be done about it is done here.
      const sink =
        run.mode === HarvestRunMode.FILE_IMPORT
          ? null
          : new RunReportSink(
              context,
              {
                supermarketId: run.supermarketId,
                defaultPriceScopeId: run.priceScopeId,
                sourceKind: sourceKindOf(source?.adapterKey),
                postalCodeDeriveMaxMetres: settings.postalCodeDeriveMaxMetres,
              },
              {
                ingest: this.ingest,
                scopes: run.supermarketId
                  ? this.scopes.forRun(run.supermarketId)
                  : null,
                places: this.places,
                shops: this.shops,
                catalog: this.catalog,
                entries: this.entries,
              }
            );

      // What a file import's ingest counted. A file import has no sink, so this
      // is the one path whose prices the report can learn about no other way.
      let imported: SourceIngestCounters | null = null;

      switch (run.mode) {
        // The source is passed and may be null: it is what the discovery
        // dispatches on (plan 0089, section 9), and a run started by the postal
        // code queue names no chain at all.
        case HarvestRunMode.STORE_DISCOVERY:
          await this.storeDiscovery.run(
            context,
            sink as RunReportSink,
            {
              postalCode: String(run.input['postalCode'] ?? ''),
              country: String(run.input['country'] ?? 'es'),
              radiusMetres: Number(run.input['radiusMetres'] ?? 3000),
              // The shops a chain's own list is filtered to (plan 0106,
              // section 4). Absent and empty are the same thing, which is every
              // shop, and the OpenStreetMap case ignores it.
              postalCodes: Array.isArray(run.input['postalCodes'])
                ? (run.input['postalCodes'] as unknown[]).map(String)
                : undefined,
              supermarketId: run.supermarketId ?? undefined,
              // The chain's own identity, read here rather than by the runner
              // (plan 0103, section 6.4).
              chain: run.supermarketId
                ? await this.chainOf(run.supermarketId)
                : undefined,
            },
            source
          );
          break;
        case HarvestRunMode.CATALOG_DISCOVERY: {
          // Plan 0090, section 12.1. The spawn already refused it for every
          // adapter that has no product page to read.
          const detailBackfill = run.input['detailBackfill'] === true;
          await this.catalogDiscovery.run(
            context,
            sink as RunReportSink,
            {
              supermarketId: run.supermarketId as string,
              priceScopeId: run.priceScopeId ?? undefined,
              detailBackfill,
              // The rows a backfill reads pages for, loaded here rather than by
              // the runner (plan 0103, section 6.2).
              backfill: detailBackfill
                ? await this.backfillRows(
                    run.supermarketId as string,
                    requireSource(source)
                  )
                : undefined,
            },
            requireSource(source)
          );
          break;
        }
        // `requireSource` is deliberately not called (plan 0081, section 1).
        // A `SupermarketSource` is fetching configuration and an upload fetches
        // nothing, so a chain with no adapter at all still gets rows that look
        // exactly like a walk's (plan 0086, D6).
        //
        // It writes through the ingest directly rather than through a report,
        // because it reads a whole document before it writes anything and turns
        // the outcomes into a warning per product, which is the one thing a
        // report cannot answer (plan 0103, D1).
        case HarvestRunMode.FILE_IMPORT:
          imported = await this.fileImport.run(context, {
            supermarketId: run.supermarketId as string,
            priceScopeId: run.priceScopeId as string,
            // What observed the price, not what uploaded it: a re-imported
            // Mercadona walk stamps OFFICIAL_API (plan 0086, section 6.2).
            sourceKind: run.input['sourceKind'] as PriceSourceKind,
          });
          break;
      }

      if (sink) {
        const written = await sink.drain();
        await this.store.setReport(runId, {
          ...(await this.store.load(runId)).report,
          ...describeWrites(written),
        });
      } else if (imported) {
        await this.store.setReport(runId, {
          ...(await this.store.load(runId)).report,
          ...describePrices(imported),
        });
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

/**
 * What observed a price, per adapter (plan 0103, section 2.3).
 *
 * It is stamped on every row and every price a run writes, and it used to be
 * stated inline by each runner at its own ingest call. The runners write
 * nothing now, so it is stated here, once, and a run of an adapter this map does
 * not know is `OFFICIAL_WEB`: a page a chain publishes is the least specific
 * honest answer, and a file import never reaches here because the operator says
 * what observed it.
 */
const SOURCE_KIND_BY_ADAPTER: Partial<Record<AdapterKey, PriceSourceKind>> = {
  'mercadona-api': PriceSourceKind.OFFICIAL_API,
  'lidl-api': PriceSourceKind.OFFICIAL_API,
  'deza-web': PriceSourceKind.OFFICIAL_WEB,
  'carrefour-web': PriceSourceKind.OFFICIAL_WEB,
};

function sourceKindOf(adapterKey: AdapterKey | undefined): PriceSourceKind {
  return (
    (adapterKey && SOURCE_KIND_BY_ADAPTER[adapterKey]) ??
    PriceSourceKind.OFFICIAL_WEB
  );
}

/**
 * How many product pages one backfill run may read, **the owner's number**.
 *
 * Unset means every row that still needs one, which is the overnight run plan
 * 0090 section 12.1 describes. A number is how an operator takes a bite instead:
 * the chain holds one run at a time, so a bounded backfill leaves room for
 * tomorrow's price crawl without anybody having to abort anything.
 */
function readBackfillBudget(
  config: Record<string, unknown>
): number | undefined {
  const budget = Number(config['detailBudget']);
  return Number.isFinite(budget) && budget > 0 ? Math.floor(budget) : undefined;
}

/**
 * What a run did with prices, in the two numbers that are not the same number.
 *
 * `pricesRecorded` is every price the chain stated, kept on the chain's own
 * source rows. `pricesPublished` is what reached catalog, which only a row bound
 * to a product earns. A LIDL walk of 188 unmatched products records thousands
 * and publishes none, and both are correct.
 *
 * They are not the run's `updated` and `unchanged` counters, which is where the
 * back office read them from before. Those two are rows the ladder changed and
 * rows it left alone, and the ingest adds its price inserts to them as well, so
 * a second run's "prices written" was two unrelated things summed.
 */
function describePrices(
  counters: Pick<
    SourceIngestCounters,
    'pricesRecorded' | 'pricesWritten' | 'pricesConfirmed'
  >
): Record<string, unknown> {
  return {
    pricesRecorded: counters.pricesRecorded,
    pricesPublished: counters.pricesWritten,
    pricesConfirmed: counters.pricesConfirmed,
  };
}

/** What the write half did, for the run's own report. */
function describeWrites(written: RunReportResult): Record<string, unknown> {
  return {
    productsWritten: written.products,
    ...describePrices({
      pricesRecorded: written.pricesRecorded,
      pricesWritten: written.pricesPublished,
      pricesConfirmed: written.pricesConfirmed,
    }),
    placesCreated: written.placesCreated,
    placesRefreshed: written.placesRefreshed,
    scopesDeclared: written.scopesDeclared,
    scopesCreated: written.scopesCreated,
    shopsWritten: written.shopsWritten,
    // Named rather than counted: an operator draining the queue wants to know
    // which shop they are looking at, and there are ten of them, not ten
    // thousand.
    shopsUnmapped: written.shopsUnmapped,
    availabilityWritten: written.availabilityWritten,
    // Plan 0084, section 3: a person always wins, and the run reports the
    // disagreement rather than applying it.
    availabilityConflicts: written.conflicts,
  };
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
