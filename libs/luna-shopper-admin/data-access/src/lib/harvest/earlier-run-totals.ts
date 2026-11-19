import { inject, Injectable, signal } from '@angular/core';
import {
  earlierTotal,
  wantsEarlierTotal,
  type HarvestRun,
} from '@portfolio/luna-shopper-admin/models';
import { HARVEST_SERVICE } from './harvest-service';

/**
 * The approximate total of a run that does not know its own (decision 86 of
 * the harvester round): what the last completed run of the same chain and mode
 * processed, when it still stands.
 *
 * **One read per run, through the runs list the app already reads.** The list
 * route filters by chain, mode, status and revert, and answers the newest
 * first, so a page of one is the run asked for. No contract changes. The
 * answer is held by the id of the run it was asked for, so the header, the
 * Runs tab and the run's own page share it, and the run's polls do not read it
 * again. Held by run and not by chain and mode, so a walk that completes later
 * gives the next run of that chain its own count and not the one before it.
 *
 * A failed read holds nothing and is not asked again for that run: the screen
 * keeps today's unknown form, which is true, rather than polling the list.
 *
 * Root scoped, like the dashboard store the header reads.
 */
@Injectable({ providedIn: 'root' })
export class EarlierRunTotals {
  private readonly _reader = inject(HARVEST_SERVICE);

  /** What each asked run's earlier run gave, by run id. Null for nothing. */
  private readonly _held = signal<ReadonlyMap<string, number | null>>(
    new Map()
  );
  private readonly _asked = new Set<string>();

  /**
   * The approximate total for this run, or null: it needs none, the read has
   * not answered, or no earlier run gives one. A signal read, so a screen that
   * asks in a computed draws the estimate when it arrives.
   */
  of(run: HarvestRun | null): number | null {
    if (!wantsEarlierTotal(run)) {
      return null;
    }
    return this._held().get(run.id) ?? null;
  }

  /** Read the earlier run for this one, once for each run. */
  async resolve(run: HarvestRun | null): Promise<void> {
    if (!wantsEarlierTotal(run) || this._asked.has(run.id)) {
      return;
    }
    this._asked.add(run.id);

    try {
      const page = await this._reader.listRuns({
        supermarketId: run.supermarketId ?? '',
        mode: run.mode,
        status: 'COMPLETED',
        reverted: false,
        limit: 1,
      });
      this._hold(run.id, earlierTotal(page.items[0]));
    } catch {
      this._hold(run.id, null);
    }
  }

  private _hold(runId: string, total: number | null): void {
    this._held.update((held) => new Map(held).set(runId, total));
  }
}
