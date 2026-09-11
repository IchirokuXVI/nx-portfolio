import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HarvestRunMode,
  HarvestRunStatus,
  HarvestRunTrigger,
} from '@portfolio/luna-shopper/contracts';
import type { HarvesterConfig } from '../config/app-config';
import type { PostalCodeDiscoveryRequest } from '../entities';
import { ActiveRunExistsError, HarvestRunStore } from './harvest-run.store';
import {
  PostalCodeDiscoveryService,
  type PlaceSourceRef,
} from './postal-code-discovery.service';
import { PostalCodeDiscoveryStore } from './postal-code-discovery.store';
import { RunExecutor } from './run-executor.service';

/**
 * The queue's drain (plan 0063, sections 2 and 6). **Serial by construction.**
 *
 * One profile write with `expandNearby` set can produce six unknown postal codes
 * at once, and six `runService.spawn()` calls would be one success and five
 * unique index violations that nobody ever sees, because the announcement is
 * fire and forget. Politeness points the same way: `OsmPlacesClient` gates
 * itself to one request per second **per instance**, so six concurrent clients
 * are six times the rate Nominatim's policy allows, and that policy is the
 * reason the source is usable at all. So the trigger enqueues and this drains,
 * one run at a time, which is also exactly what the active run index demands.
 *
 * Runs it starts carry {@link HarvestRunTrigger.SYSTEM}. This is the plan where
 * that value starts being written: every run before it was asked for by a
 * person, and section 8.1 of plan 0038 leaned on that as the reason the fetching
 * was defensible. It stays defensible here because a person did ask, indirectly:
 * they put the postal code on their profile, and the run is two requests.
 *
 * **`HARVEST_ENABLED` gates only this half.** With it false the queue still
 * fills and nothing drains, so turning the switch on later drains a real backlog
 * of the codes users actually asked about rather than starting from nothing.
 * A chain's own switch does not enter into it at all: OpenStreetMap is always in
 * the set of sources and touches no storefront, so discovery with every chain's
 * row off is a coherent configuration and the one `k8s/plans/0008` deploys.
 *
 * **One code is one run per source, not one run** (plan 0107). It used to start
 * exactly one, with `supermarketId: null`, which is the OpenStreetMap case, so a
 * code that reached the queue was asked of OpenStreetMap and of nothing else
 * even though LIDL and Mercadona publish their own shop lists. The runs are
 * still serial, for both the reasons above and because the active run index
 * allows one store discovery at a time.
 */
@Injectable()
export class PostalCodeDiscoveryWorker
  implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown
{
  private readonly logger = new Logger(PostalCodeDiscoveryWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  /** One drain at a time in this process, whatever the timer thinks. */
  private draining = false;
  private stopping = false;

  constructor(
    private readonly queue: PostalCodeDiscoveryStore,
    private readonly runs: HarvestRunStore,
    private readonly executor: RunExecutor,
    private readonly discovery: PostalCodeDiscoveryService,
    private readonly config: ConfigService
  ) {}

  private settings(): HarvesterConfig {
    return this.config.getOrThrow<HarvesterConfig>('harvester');
  }

  onModuleInit(): void {
    const settings = this.settings();
    if (!settings.harvestEnabled) {
      this.logger.log(
        'HARVEST_ENABLED is false: postal codes will still be queued for ' +
          'discovery and nothing will drain them. Turning it on later drains ' +
          'the backlog.'
      );
    }
    // A plain timer, like the stale reaper next door: one interval does not earn
    // a scheduler dependency. `unref` so a pending tick never keeps the process
    // alive during a shutdown drain.
    this.timer = setInterval(
      () => void this.drain(),
      settings.discoveryPollSeconds * 1000
    );
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  onApplicationShutdown(): void {
    // The run in flight is aborted by the executor's own shutdown hook. This
    // just stops the loop from claiming the next row on the way out.
    this.stopping = true;
  }

  /**
   * Take due rows one at a time until there are none left.
   *
   * Reentrancy is guarded rather than tolerated: a run takes minutes and the
   * timer fires every minute, so without the flag a slow run would be joined by
   * a second drain that immediately loses the active run lock.
   */
  async drain(): Promise<void> {
    if (this.draining || this.stopping || !this.settings().harvestEnabled) {
      return;
    }
    this.draining = true;
    try {
      // Release the rows of a worker that died mid run before claiming, so a
      // force killed harvester does not leave a code claimed forever.
      await this.queue.reapStale(this.settings().staleAfterSeconds);
      while (!this.stopping) {
        const next = await this.queue.claimNext();
        if (!next) {
          return;
        }
        const kept = await this.discover(next);
        if (!kept) {
          // Something else holds the run lock. Stop rather than spin: the next
          // tick finds the same row, by which time the other run may be done.
          return;
        }
      }
    } catch (error) {
      // The drain runs on a timer with no caller to return an error to, so it
      // must never take the process down.
      this.logger.error(`Discovery queue drain failed: ${String(error)}`);
    } finally {
      this.draining = false;
    }
  }

  /**
   * One claimed code: one run per source that owes it an answer, awaited in
   * turn, and the row updated with what happened (plan 0107, section 2.2).
   *
   * **A source that failed does not hold the code hostage.** The row records
   * which source failed and goes back to QUEUED with its backoff, and the next
   * pass asks that source alone: the ones that answered are inside their
   * cooldown by then and are no longer due.
   *
   * A code every source has already answered recently starts nothing and is
   * done, which is what happens when the announcement half queued a code the
   * runs had covered from another code's radius.
   *
   * @returns false when the row was put back untouched because a run could not
   * be created at all, which is the caller's signal to stop draining.
   */
  private async discover(row: PostalCodeDiscoveryRequest): Promise<boolean> {
    const settings = this.settings();
    let due: PlaceSourceRef[];
    try {
      due = await this.discovery.dueSourcesFor(
        row.country,
        row.postalCode,
        row.requeuedAt
      );
    } catch (error) {
      // Reading the configuration failed, which says nothing about the code.
      // It still costs the attempt this claim already counted, because the
      // alternative is a row that spins on every tick.
      await this.queue.markAttemptFailed(
        row,
        String(error),
        settings.discoveryMaxAttempts,
        null
      );
      return true;
    }

    if (due.length === 0) {
      this.logger.log(
        `Every source has answered ${row.country}/${row.postalCode} recently, ` +
          'so nothing was fetched'
      );
      await this.queue.markDone(row.id, null);
      return true;
    }

    /** The last run that completed, which is what the row points at. */
    let answeredBy: string | null = null;
    /** One line per source that did not answer, kept for the row's error. */
    const failures: string[] = [];
    let asked = 0;

    for (const source of due) {
      if (this.stopping) {
        break;
      }
      asked += 1;
      const outcome = await this.runOne(row, source);
      if (outcome === null) {
        // The lock is held by somebody else's run. Put the row back whole: the
        // sources that already answered are recorded on their own runs, so the
        // next pass asks only for what is still missing.
        await this.queue.release(row);
        return false;
      }
      if (outcome.failure) {
        failures.push(`${source.label}: ${outcome.failure}`);
      } else {
        answeredBy = outcome.runId ?? answeredBy;
      }
    }

    if (asked < due.length) {
      // The process is going down with sources still unasked. Marking the row
      // DONE here would say every source answered and hide the rest behind the
      // thirty day cooldown, so the row goes back instead, unspent: the sources
      // that did answer are recorded on their own runs and are no longer due.
      await this.queue.release(row);
      return false;
    }

    if (failures.length === 0) {
      // DONE means we looked. A run creates no catalog location unless the
      // chain's row says it may (plan 0107, section 3): everything else is NEW
      // in the review queue until an admin imports it.
      await this.queue.markDone(row.id, answeredBy);
      return true;
    }
    await this.queue.markAttemptFailed(
      row,
      failures.join(' '),
      settings.discoveryMaxAttempts,
      answeredBy
    );
    return true;
  }

  /**
   * One code against one source.
   *
   * @returns null when the active run index refused the run, which is not this
   * code's failure and must not spend one of its attempts. Otherwise the run's
   * id and, when it did not complete, why.
   */
  private async runOne(
    row: PostalCodeDiscoveryRequest,
    source: PlaceSourceRef
  ): Promise<{ runId: string | null; failure: string | null } | null> {
    const settings = this.settings();
    let runId: string | null = null;
    try {
      const run = await this.runs.create({
        mode: HarvestRunMode.STORE_DISCOVERY,
        trigger: HarvestRunTrigger.SYSTEM,
        // Null for OpenStreetMap, which belongs to no chain and finds many at
        // once, and the chain's own for a source that names its own shops.
        supermarketId: source.supermarketId,
        sourceId: source.sourceId,
        priceScopeId: null,
        // Nobody's, and deliberately: the run is the system's, and naming the
        // user whose profile mentioned the code would put an account id on a
        // run that has nothing to do with them (plan 0062, section 5).
        requestedByUserId: null,
        correlationId: null,
        payload: {
          postalCode: row.postalCode,
          country: row.country,
          // Not the profile's nearby radius (plan 0063, section 7). That one
          // decides which codes a person shops in; this decides how far around
          // a code's centre to look for shops, and is comfortably larger
          // because a shop at the edge of a code is still that code's shop.
          radiusMetres: settings.discoveryRadiusMetres,
          // What stops a chain wide document being re-read in full for every
          // code in the queue (plan 0106, section 4). The OpenStreetMap case
          // ignores it: its query is already centred on the code.
          ...(source.sourceId ? { postalCodes: [row.postalCode] } : {}),
        },
      });
      runId = run.id;
      await this.runs.seedHeartbeat(run.id);
      this.logger.log(
        `Discovering stores in ${row.country}/${row.postalCode} from ` +
          `${source.label} as run ${run.id} (attempt ${row.attempts})`
      );

      const status = await this.executor.runToCompletion(run.id);
      if (status === HarvestRunStatus.COMPLETED) {
        return { runId: run.id, failure: null };
      }
      const finished = await this.runs.load(run.id);
      return {
        runId: run.id,
        failure: finished.error ?? `The run ended as ${status}.`,
      };
    } catch (error) {
      if (error instanceof ActiveRunExistsError) {
        this.logger.log(
          `Deferring discovery of ${row.country}/${row.postalCode}: run ` +
            `${error.activeRunId ?? 'unknown'} is already in progress`
        );
        return null;
      }
      return { runId, failure: String(error) };
    }
  }
}
