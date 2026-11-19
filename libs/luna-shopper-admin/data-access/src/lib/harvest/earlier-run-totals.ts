import { inject, Injectable, signal } from '@angular/core';
import {
  earlierTotal,
  wantsEarlierTotal,
  type HarvestRun,
} from '@portfolio/luna-shopper-admin/models';
import { HARVEST_SERVICE, type RunQuery } from './harvest-service';

/**
 * The approximate total of a run that does not know its own (decision 86 of
 * the harvester round): what the latest completed, unreverted run of the same
 * kind processed.
 *
 * **The same kind is chosen the way the harvester chooses the reference of a
 * duration estimate** (backend plan 0206, section 8, `estimateRun`): the
 * preset's own runs first, then the runs of the same source and mode. A run
 * with no preset starts at its chain and mode. The run itself never counts, so
 * a completed run never takes its total from itself (owner decision 98b).
 *
 * Two differences from the harvester's rule, both because the list route is
 * the read the app already has and no route changes in this PR. The route
 * filters by chain, not by source, which is the same thing while a chain has
 * one source row. And it orders by `requestedAt`, where the estimate orders by
 * `finishedAt`, which differs only when two runs of one kind overlapped. The
 * cost of preferring the preset is a second read when the preset has no
 * completed run but the chain does.
 *
 * **One lookup per run.** The answer is held by the id of the run it was asked
 * for, so the header, the Runs tab and the run's own page share it, and the
 * run's polls do not read it again.
 *
 * **A failed lookup is tried again once, at once** (no timer, no loop). If the
 * second try fails too, nothing is held and the run is not asked again: the
 * screen keeps the form it had before the estimate existed, which is true.
 *
 * Root scoped, like the dashboard store the header reads.
 */
@Injectable({ providedIn: 'root' })
export class EarlierRunTotals {
  private readonly _reader = inject(HARVEST_SERVICE);

  /** What each asked run's reference run gave, by run id. Null for nothing. */
  private readonly _held = signal<ReadonlyMap<string, number | null>>(
    new Map()
  );
  private readonly _asked = new Set<string>();

  /**
   * The approximate total for this run, or null: it needs none, the read has
   * not answered, or no other run gives one. A signal read, so a screen that
   * asks in a computed draws the estimate when it arrives.
   */
  of(run: HarvestRun | null): number | null {
    if (!wantsEarlierTotal(run)) {
      return null;
    }
    return this._held().get(run.id) ?? null;
  }

  /** Look up the reference run for this one, once for each run. */
  async resolve(run: HarvestRun | null): Promise<void> {
    if (!wantsEarlierTotal(run) || this._asked.has(run.id)) {
      return;
    }
    this._asked.add(run.id);

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        this._hold(run.id, await this._lookUp(run));
        return;
      } catch {
        // Once more, then silence.
      }
    }
  }

  /** The preset first, then the chain and mode, as `estimateRun` does. */
  private async _lookUp(run: HarvestRun): Promise<number | null> {
    const presetId = run.presetId ?? '';
    if (presetId !== '') {
      const fromPreset = await this._newest(run, { presetId });
      if (fromPreset !== null) {
        return fromPreset;
      }
    }
    const supermarketId = run.supermarketId ?? '';
    if (supermarketId === '') {
      return null;
    }
    return this._newest(run, { supermarketId, mode: run.mode });
  }

  /**
   * What the newest completed, unreverted run under this filter processed,
   * leaving the run itself out. A page of two, so the run itself can be
   * skipped when it is the newest completed one.
   */
  private async _newest(
    run: HarvestRun,
    filter: Pick<RunQuery, 'presetId' | 'supermarketId' | 'mode'>
  ): Promise<number | null> {
    const page = await this._reader.listRuns({
      ...filter,
      status: 'COMPLETED',
      reverted: false,
      limit: 2,
    });
    return earlierTotal(page.items.find((item) => item.id !== run.id));
  }

  private _hold(runId: string, total: number | null): void {
    this._held.update((held) => new Map(held).set(runId, total));
  }
}
