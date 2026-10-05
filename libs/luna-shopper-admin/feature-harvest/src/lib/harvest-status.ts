import { computed, inject, Injectable } from '@angular/core';
import { DashboardStore } from '@portfolio/luna-shopper-admin/data-access';
import type { SectionCounts } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  harvestReviewPath,
  isTerminalRun,
  type HarvestRun,
} from '@portfolio/luna-shopper-admin/models';
import { harvestWaiting, type HarvestWaiting } from './harvest-waiting';

/** The Review tab, as the path its link carries. */
const REVIEW_LINK = harvestReviewPath().join('/').replace('//', '/');

/**
 * What the harvester has waiting and what it is doing, for the rail and for
 * every Harvest tab (admin plan 0044, targets 2 and 3).
 *
 * Both come from the dashboard read, which already carries the four queue
 * counts and the run in flight. So there is one read behind the count on the
 * rail, the count on the Review tab, the counts on the queue switch and the
 * run line in the header, and they cannot disagree.
 *
 * **It watches from the moment it is built**, and the frame builds it, because
 * the count on the rail is on every screen. The store counts its watchers, so
 * the overview opening and closing does not stop these reads. The store reads
 * again when the browser tab becomes visible, which is the "again when the tab
 * gains focus" of the plan.
 *
 * **It never stops watching, and the store stops reading for it.** A sign out
 * suspends the store, which drops the document and its timer, and the next
 * sign in resumes it (`dashboardFollowsSession`). So the counts are `null`
 * between two sessions, and the next admin never sees the last one's.
 *
 * Root scoped, like the store it reads.
 */
@Injectable({ providedIn: 'root' })
export class HarvestStatus implements SectionCounts {
  private readonly _store = inject(DashboardStore);

  constructor() {
    this._store.watch();
  }

  /**
   * The four counts, or `null` while nothing is known: before the first read
   * answers, and when the harvester did not answer it.
   */
  readonly waiting = computed<HarvestWaiting | null>(() => {
    const harvest = this._store.document()?.harvest ?? null;
    return harvest === null ? null : harvestWaiting(harvest);
  });

  /** The run in progress, or `null` when there is none. */
  readonly running = computed<HarvestRun | null>(() => {
    const run = this._store.document()?.harvest?.running ?? null;
    return run === null || isTerminalRun(run) ? null : run;
  });

  /**
   * Whether the harvester answered the last read. `null` before any read has.
   *
   * The Runs tab says so at its top when it did not.
   */
  readonly answered = computed<boolean | null>(() => {
    const document = this._store.document();
    return document === null ? null : document.harvest !== null;
  });

  /**
   * What waits behind one of the section's tabs, which the frame asks by the
   * path of each link.
   *
   * Only Review has a count. `null` for the two other tabs, and `null` while
   * the count is not known, so nothing is drawn where nothing is known.
   */
  countAt(path: string): number | null {
    return path === REVIEW_LINK ? (this.waiting()?.total ?? null) : null;
  }

  /**
   * Read the counts again, after a decision or a batch of them.
   *
   * A decision takes a row out of a queue, and the count on the rail is that
   * queue's length. Waiting a minute for the next read would leave the rail
   * saying more waits than the queue shows.
   */
  refresh(): void {
    void this._store.load();
  }

  /** Follow the run in flight at the faster cadence, or stop following it. */
  followRuns(following: boolean): void {
    this._store.followRuns(following);
  }
}
