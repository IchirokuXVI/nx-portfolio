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
 * `MERCADONA_ENABLED` does not enter into it at all: a store discovery run reads
 * OpenStreetMap and never touches a storefront, so discovery with price scraping
 * off is a coherent configuration and the one `k8s/plans/0008` deploys.
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
   * One claimed code: one run, awaited, and the row updated with what happened.
   *
   * @returns false when the row was put back untouched because a run could not
   * be created at all, which is the caller's signal to stop draining.
   */
  private async discover(row: PostalCodeDiscoveryRequest): Promise<boolean> {
    const settings = this.settings();
    let runId: string | null = null;
    try {
      const run = await this.runs.create({
        mode: HarvestRunMode.STORE_DISCOVERY,
        trigger: HarvestRunTrigger.SYSTEM,
        supermarketId: null,
        sourceId: null,
        priceScopeId: null,
        // Nobody's, and deliberately: the run is the system's, and naming the
        // user whose profile mentioned the code would put an account id on a
        // run that has nothing to do with them (plan 0062, section 5).
        requestedByUserId: null,
        correlationId: null,
        payload: {
          postalCode: row.postalCode,
          country: row.country,
          // Not the profile's nearby radius (section 7). That one decides which
          // codes a person shops in; this decides how far around a code's centre
          // to look for shops, and is comfortably larger because a shop at the
          // edge of a code is still that code's shop.
          radiusMetres: settings.discoveryRadiusMetres,
        },
      });
      runId = run.id;
      await this.runs.seedHeartbeat(run.id);
      this.logger.log(
        `Discovering stores around ${row.country}/${row.postalCode} as run ` +
          `${run.id} (attempt ${row.attempts})`
      );

      const status = await this.executor.runToCompletion(run.id);
      if (status === HarvestRunStatus.COMPLETED) {
        // DONE means we looked. The run created no catalog location and never
        // will: the places it found are NEW in the review queue until an admin
        // imports one, which is plan 0038's rule and stays true here.
        await this.queue.markDone(row.id, run.id);
        return true;
      }

      const finished = await this.runs.load(run.id);
      await this.queue.markAttemptFailed(
        row,
        finished.error ?? `The run ended as ${status}.`,
        settings.discoveryMaxAttempts,
        run.id
      );
      return true;
    } catch (error) {
      if (error instanceof ActiveRunExistsError) {
        // An admin's run holds the lock. That is not this code's failure, so it
        // does not spend one of its attempts.
        await this.queue.release(row);
        this.logger.log(
          `Deferring discovery of ${row.country}/${row.postalCode}: run ` +
            `${error.activeRunId ?? 'unknown'} is already in progress`
        );
        return false;
      }
      await this.queue.markAttemptFailed(
        row,
        String(error),
        settings.discoveryMaxAttempts,
        runId
      );
      return true;
    }
  }
}
