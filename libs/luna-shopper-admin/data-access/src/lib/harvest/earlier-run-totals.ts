import { inject, Injectable, signal } from '@angular/core';
import {
  earlierTotal,
  isNarrowedRun,
  walkedUnderSameConfigAs,
  wantsEarlierTotal,
  type HarvestRun,
} from '@portfolio/luna-shopper-admin/models';
import { HARVEST_SERVICE, type RunQuery } from './harvest-service';

/** How many completed runs one step reads to find one with a usable total. */
const REFERENCE_PAGE = 5;

/**
 * The approximate total of a run that does not know its own (decision 86 of
 * the harvester round): what the latest completed, unreverted run of the same
 * kind that gives a usable total processed.
 *
 * **The same kind is chosen the way the harvester chooses the reference of a
 * duration estimate** (backend plan 0206, section 8, `estimateRun`): the
 * preset's own runs first, then the runs of the same source and mode. A run
 * with no preset starts at its chain and mode. The run itself never counts
 * (owner decision 98b). The chain and mode answer only for a whole walk, and
 * only from an earlier whole walk (owner decision 112b, {@link isNarrowedRun}).
 * Both answer only from a run that walked under the same configuration
 * (owner decision 130b): the same `configFingerprint`. A run whose adapter's
 * walk totals cannot be compared, a DEZA walk, is read for nothing at all
 * (owner decision 127b, see `wantsEarlierTotal`).
 *
 * Two differences from the harvester's rule, both because the list route is
 * the read the app already has and no route changes in this PR. The route
 * filters by chain, not by source, which is the same thing while a chain has
 * one source row. And it orders by `requestedAt`, where the estimate orders by
 * `finishedAt`, which differs only when two runs of one kind overlapped. The
 * cost of preferring the preset is a second read when no completed run of the
 * preset gives a usable total but one of the chain does.
 *
 * A completed run is never read for one (owner decision 111c): it shows its
 * own count, see `wantsEarlierTotal`.
 *
 * **One lookup per run, until its own page opens again.** The answer is held
 * by the id of the run it was asked for, so the header, the Runs tab and the
 * run's own page share it, and the run's polls do not read it again. Opening
 * the run's own page asks again ({@link reread}, owner decision 113b), so a
 * reference run reverted since is not still quoted there. Lookups that overlap
 * for one run are one read.
 *
 * **A failed lookup is tried again once, at once** (no timer, no loop). If the
 * second try fails too, nothing new is held and the run is not asked again
 * until its page opens again. A first lookup thus leaves the screen in the form
 * it had before the estimate existed, which is true. A reread that fails keeps
 * the number an earlier read gave (owner decision 121b): the read failed, not
 * the reference, so the number shown is still the best one known.
 *
 * **Nothing outlives a sign out** (owner decision 113b). The app calls
 * {@link clear} as the session ends (`earlierRunTotalsFollowSession`), as it
 * suspends the dashboard store, and an answer on its way then is dropped.
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
  /** The runs asked for and not to be asked again until {@link reread}. */
  private readonly _asked = new Set<string>();
  /** The lookups on their way, by run id, so overlapping asks share one. */
  private readonly _inFlight = new Map<string, Promise<void>>();
  /** Grows on every {@link clear}, so an answer asked before one is dropped. */
  private _epoch = 0;

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

  /**
   * Look up the reference run for this one, once for each run until
   * {@link reread}. A second ask while the first is on its way waits for it.
   */
  resolve(run: HarvestRun | null): Promise<void> {
    if (!wantsEarlierTotal(run)) {
      return Promise.resolve();
    }
    const pending = this._inFlight.get(run.id);
    if (pending !== undefined) {
      return pending;
    }
    if (this._asked.has(run.id)) {
      return Promise.resolve();
    }
    this._asked.add(run.id);

    const lookup = this._settle(run, this._epoch);
    this._inFlight.set(run.id, lookup);
    return lookup;
  }

  /**
   * Let the next {@link resolve} for this run read again. The run's own page
   * calls it once as it opens, never on a poll. The answer held so far stays
   * drawn until the new one replaces it. A lookup already on its way is the
   * fresh read, so it is not started twice.
   */
  reread(runId: string): void {
    if (!this._inFlight.has(runId)) {
      this._asked.delete(runId);
    }
  }

  /** Forget every answer and every ask: the session ended. */
  clear(): void {
    this._epoch += 1;
    this._asked.clear();
    this._inFlight.clear();
    this._held.set(new Map());
  }

  private async _settle(run: HarvestRun, epoch: number): Promise<void> {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const total = await this._lookUp(run);
          if (epoch === this._epoch) {
            this._hold(run.id, total);
          }
          return;
        } catch {
          // Once more, then silence. Twice down holds nothing new, and an
          // answer an earlier read held stays drawn (owner decision 121b).
        }
      }
    } finally {
      if (epoch === this._epoch) {
        this._inFlight.delete(run.id);
      }
    }
  }

  /**
   * The preset first, then the chain and mode, as `estimateRun` does.
   *
   * The chain and mode stand in only for a whole walk (owner decision 112b).
   * A run whose own request is narrowed, or unknown, reads its preset and
   * nothing else: a store discovery of two postal codes is not "of about
   * 2,361" because the chain's whole discovery found that many. Its preset's
   * runs share its request, so they stay a fair reference.
   */
  private async _lookUp(run: HarvestRun): Promise<number | null> {
    const presetId = run.presetId ?? '';
    if (presetId !== '') {
      const fromPreset = await this._newest(run, { presetId });
      if (fromPreset !== null) {
        return fromPreset;
      }
    }
    const supermarketId = run.supermarketId ?? '';
    if (supermarketId === '' || isNarrowedRun(run)) {
      return null;
    }
    return this._newest(run, { supermarketId, mode: run.mode }, true);
  }

  /**
   * What the newest completed, unreverted run under this filter that gives a
   * usable total processed, leaving the run itself out. Usable means it
   * processed something and no less than this run has processed so far, the
   * same bound the progress line applies. One read of a small page, so an
   * older run still answers when the newest one does not.
   *
   * `wholeOnly` is the chain and mode read: an earlier run that was itself
   * narrowed, or whose request is unknown, is no total for a whole walk and is
   * passed over like a run that processed nothing (owner decision 112b).
   *
   * On both reads an earlier run that did not walk under this run's
   * configuration is passed over the same way (owner decision 130b,
   * `walkedUnderSameConfigAs`), and so is one stored before the fingerprint
   * existed, which carries none.
   */
  private async _newest(
    run: HarvestRun,
    filter: Pick<RunQuery, 'presetId' | 'supermarketId' | 'mode'>,
    wholeOnly = false
  ): Promise<number | null> {
    const page = await this._reader.listRuns({
      ...filter,
      status: 'COMPLETED',
      reverted: false,
      limit: REFERENCE_PAGE,
    });
    for (const item of page.items) {
      if (
        item.id === run.id ||
        !walkedUnderSameConfigAs(run, item) ||
        (wholeOnly && isNarrowedRun(item))
      ) {
        continue;
      }
      const total = earlierTotal(item);
      if (total !== null && total >= run.processed) {
        return total;
      }
    }
    return null;
  }

  private _hold(runId: string, total: number | null): void {
    this._held.update((held) => new Map(held).set(runId, total));
  }
}
