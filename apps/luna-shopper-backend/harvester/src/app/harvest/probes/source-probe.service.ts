import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HarvestRunTrigger,
  SourceProbeStatus,
  type ListSourceProbesRequest,
  type SourceProbeIdRequest,
  type SourceProbePage,
  type SourceProbeResult,
  type SourceProbeView,
  type StartSourceProbeRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  ConflictException,
  decodeCursor,
  describeError,
  encodeCursor,
  NotConfiguredException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type { HarvesterConfig } from '../../config/app-config';
import type { SourceProbe, SupermarketSource } from '../../entities';
import { probeAlertFor } from '../alerts/harvest-alert.rules';
import { HarvestRunStore } from '../harvest-run.store';
import { PlatformAdminService } from '../platform-admin.service';
import { HARVEST_CLOCK, type HarvestClock } from '../schedule-slot';
import { SupermarketSourceService } from '../supermarket-source.service';
import { probeSeriesAttempt } from './source-probe.due';
import { toSourceProbeView } from './source-probe.mappers';
import {
  isProbedAdapterKey,
  PROBED_ADAPTER_KEYS,
  SourceProbeDispatcher,
} from './source-probe.runner';
import { SourceProbeStore, type ClaimedProbe } from './source-probe.store';
import { judgeProbe, type SourceProbeVerdict } from './source-probe.verdict';

/** How long one probe may run before it is stopped (section 9). */
export const PROBE_DEADLINE_MS = 5 * 60_000;

/**
 * The refusals of a run, word for word, because a probe obeys the same switch
 * and the same row (plan 0219, section 6). `HarvestRunService` holds the
 * originals and their words never change.
 */
const HARVESTING_DISABLED =
  'Harvesting is disabled on this deployment (HARVEST_ENABLED is false).';
const SOURCE_DISABLED =
  'That source is disabled. Enable it with supermarketSource.setEnabled.';

interface ProbeCursor {
  startedAt: string;
  id: string;
}

/**
 * Start, classify, finish, list and read probes (plan 0219, sections 5, 6
 * and 8).
 *
 * **The start answers before the probe ends.** A Carrefour probe can take
 * about fifteen seconds with the browser launch, which is Envoy's default
 * route timeout, so the row is inserted, the probe starts without being
 * awaited, and the `RUNNING` row is the answer. The probes in flight are kept
 * in a map, as the executor keeps its runs, so a shutdown aborts them.
 *
 * **A probe writes only `source_probes`.** It never writes a price, an entry, a
 * place, availability, `consecutiveFailures`, `lastRunAt` or
 * `lastSuccessAt`, and it starts no run.
 */
@Injectable()
export class SourceProbeService implements OnApplicationShutdown {
  private readonly logger = new Logger(SourceProbeService.name);
  private readonly inFlight = new Map<string, AbortController>();
  private stopping = false;

  constructor(
    private readonly store: SourceProbeStore,
    private readonly sources: SupermarketSourceService,
    private readonly runs: HarvestRunStore,
    private readonly dispatcher: SourceProbeDispatcher,
    private readonly admin: PlatformAdminService,
    private readonly config: ConfigService,
    @Inject(HARVEST_CLOCK) private readonly clock: HarvestClock
  ) {}

  private settings(): HarvesterConfig {
    return this.config.getOrThrow<HarvesterConfig>('harvester');
  }

  /**
   * A probe by hand (section 6). Each condition a scheduled probe needs is a
   * refusal here, in the order of the table.
   */
  async start(req: StartSourceProbeRequest): Promise<SourceProbeView> {
    const userId = await this.admin.requireAdmin(req);
    if (!this.settings().harvestEnabled) {
      throw new NotConfiguredException(HARVESTING_DISABLED);
    }
    const source = await this.sources.load(req.supermarketId);
    if (!isProbedAdapterKey(source.adapterKey)) {
      throw new ValidationException(
        `The adapter "${source.adapterKey}" has no probe. A probe exists for ` +
          `${PROBED_ADAPTER_KEYS.join(', ')}.`
      );
    }
    // Option (a) of O1: a probe is a fetch, and the row says whether this
    // cluster fetches from the chain.
    if (!source.enabled) {
      throw new ValidationException(SOURCE_DISABLED);
    }
    const run = await this.runs.findActiveBySupermarket(source.supermarketId);
    if (run) {
      throw new ConflictException(
        `A run of this chain is in progress: ${run.id}. It reads the same ` +
          'pages, so it is the live check already.'
      );
    }
    const running = await this.store.findRunning(source.id);
    const probe =
      running === null
        ? await this.store.insertRunning({
            source,
            trigger: HarvestRunTrigger.MANUAL,
            startedAt: this.clock(),
            requestedByUserId: userId,
          })
        : null;
    if (!probe) {
      throw new ConflictException(
        `A probe of this chain is running: ${running?.id ?? 'started just now'}.`
      );
    }
    // Not awaited: the client reads `sourceProbe.get` until it is done.
    void this.execute(probe, source);
    return toSourceProbeView(probe);
  }

  async get(req: SourceProbeIdRequest): Promise<SourceProbeView> {
    await this.admin.requireAdmin(req);
    return toSourceProbeView(await this.store.load(req.probeId));
  }

  /** The probes of one chain, newest first, `limit` 1 to 100 and 20 by default. */
  async list(req: ListSourceProbesRequest): Promise<SourceProbePage> {
    await this.admin.requireAdmin(req);
    const source = await this.sources.load(req.supermarketId);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as ProbeCursor | undefined;
    const rows = await this.store.list(source.id, limit + 1, cursor);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toSourceProbeView),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({
              startedAt: new Date(last.startedAt).toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  /** Run a probe the worker claimed, and wait for it (section 7). */
  async runClaimed(claimed: ClaimedProbe): Promise<void> {
    await this.execute(claimed.probe, claimed.source);
  }

  /**
   * Run a probe for a schedule slot and wait for it (plan 0247, section 2,
   * step 6). Answers the finished row, or null when another probe of the
   * source was already `RUNNING`, which the caller then waits for.
   *
   * An ordinary probe row with trigger `SCHEDULED`: the partial unique index
   * keeps one `RUNNING` probe per source, the deadline and the verdict are
   * those of every probe, and the attempt is the one the due rule gives the
   * series, with the interval ignored. It thus moves the chain's next daily
   * probe as any probe does. The row names `scheduleId`, which tells it
   * apart from a daily probe that carries the same trigger (the owner,
   * 2026-11-06).
   *
   * The caller has checked the switch, the row and the run in flight, so
   * this checks only that the adapter has a probe.
   */
  async runForSchedule(
    source: SupermarketSource,
    scheduleId: string
  ): Promise<SourceProbe | null> {
    if (!isProbedAdapterKey(source.adapterKey) || this.stopping) {
      return null;
    }
    const attempt = probeSeriesAttempt(
      await this.store.newestForSeries(source.id)
    );
    const probe = await this.store.insertRunning({
      source,
      trigger: HarvestRunTrigger.SCHEDULED,
      startedAt: this.clock(),
      requestedByUserId: null,
      attempt,
      scheduleId,
    });
    if (!probe) {
      return null;
    }
    this.logger.log(
      `Probe ${probe.id} of ${source.adapterKey} (${source.supermarketId}) ` +
        `started for schedule ${scheduleId}, attempt ${attempt}`
    );
    await this.execute(probe, source);
    return this.store.load(probe.id);
  }

  /**
   * Whether the shutdown hook ran, so no probe starts here and a probe in
   * flight ends `ABORTED`. The schedule worker reads it to tell a stop from a
   * probe that did not start for another reason (plan 0247).
   */
  isStopping(): boolean {
    return this.stopping;
  }

  onApplicationShutdown(): void {
    this.stopping = true;
    for (const controller of this.inFlight.values()) {
      controller.abort();
    }
  }

  /**
   * One probe, from the read to the row. Never throws: the start has already
   * answered, and a timer has nobody to return an error to.
   */
  private async execute(
    probe: SourceProbe,
    source: SupermarketSource
  ): Promise<void> {
    const controller = new AbortController();
    this.inFlight.set(probe.id, controller);
    const deadline = setTimeout(
      () =>
        controller.abort(
          new DOMException(
            'The probe passed its deadline of five minutes.',
            'TimeoutError'
          )
        ),
      PROBE_DEADLINE_MS
    );
    deadline.unref?.();

    let result: SourceProbeResult;
    let verdict: SourceProbeVerdict;
    try {
      result = await this.dispatcher.probe(source, controller.signal);
      verdict = judgeProbe(result);
    } catch (error) {
      // The libraries never throw for a source failure, so this is ours.
      result = { steps: [], requests: 0, failure: error };
      verdict = {
        status: SourceProbeStatus.ERROR,
        error: `probe: ${describeError(error).message}`,
      };
    } finally {
      clearTimeout(deadline);
      this.inFlight.delete(probe.id);
    }

    try {
      await this.finish(probe, source, result, verdict);
    } catch (error) {
      this.logger.error(
        `Probe ${probe.id} of source ${source.id} could not record its ` +
          `result: ${describeError(error).message}`
      );
    }
  }

  private async finish(
    probe: SourceProbe,
    source: SupermarketSource,
    result: SourceProbeResult,
    verdict: SourceProbeVerdict
  ): Promise<void> {
    const status = this.stopping ? SourceProbeStatus.ABORTED : verdict.status;
    const previousStatus = await this.store.previousStatus(source.id, probe.id);
    // An abort says nothing about the chain, so it is never a change.
    const changed =
      status !== SourceProbeStatus.ABORTED &&
      previousStatus !== null &&
      previousStatus !== status;
    const write = {
      status,
      previousStatus,
      changed,
      finishedAt: this.clock(),
      requests: result.requests,
      steps: result.steps,
      error:
        status === SourceProbeStatus.ABORTED
          ? 'The harvester stopped during the probe.'
          : verdict.error,
    };
    // The probe's alert to the owner, computed after the verdict and written
    // with it (plan 0247, section 4.1).
    const alert = probeAlertFor({
      probe: { ...probe, ...write },
      at: write.finishedAt,
    });
    const written = alert
      ? await this.store.finish(probe.id, write, alert)
      : await this.store.finish(probe.id, write);
    if (!written) {
      return;
    }
    const line =
      `Probe ${probe.id} of ${source.adapterKey} (${source.supermarketId}) ` +
      `is ${status} after ${result.requests} request(s)` +
      (verdict.error && status !== SourceProbeStatus.ABORTED
        ? `: ${verdict.error}`
        : '');
    if (
      status === SourceProbeStatus.PASSED ||
      status === SourceProbeStatus.ABORTED
    ) {
      this.logger.log(
        changed ? `${line}, changed from ${previousStatus}` : line
      );
    } else {
      this.logger.warn(
        changed ? `${line}, changed from ${previousStatus}` : line
      );
    }
  }
}
