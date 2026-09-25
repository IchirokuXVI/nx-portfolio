import {
  DestroyRef,
  effect,
  inject,
  Injectable,
  signal,
  untracked,
} from '@angular/core';
import { BasketChangeStore, BasketStore } from '@portfolio/velista/data-access';
import { BrowserFacade } from '@portfolio/velista/platform';

/**
 * How long a change has to stay in front of somebody before it counts as read.
 *
 * A **display debounce** and not a rule about what is new, which is why a timer
 * is allowed here and nowhere else in velista `0093`: what is new is the
 * server's answer on the server's clock, and this only decides whether a screen
 * that drew it was looked at or scrolled past.
 *
 * A second and a half. Shorter, and a flick through the basket acknowledges
 * everything it passes; longer, and somebody who read the row and locked their
 * phone is told about it again tomorrow.
 */
export const CHANGE_SEEN_DWELL_MS = 1500;

/**
 * Decides when this viewer has really seen a change, and tells the server once
 * (velista `0093`, section 7).
 *
 * ## Provided by the page, not by the route
 *
 * A route's injector is never destroyed, so an acknowledger on the route would
 * outlive the basket page with a timer running and an observer's worth of state
 * about rows that are not on screen any more. This is in `BasketPage.providers`,
 * so it dies with the page and its `DestroyRef` really fires.
 *
 * ## Three conditions, and all three at once
 *
 * The document is visible, **and** either a marked row is on screen or the
 * changes sheet is drawing entries, **and** both have been true for
 * {@link CHANGE_SEEN_DWELL_MS}. Anything less sends nothing, which is the safe
 * way to be wrong in every case: a mark that stays is a tag somebody reads
 * twice, and a mark cleared too early is the one thing they opened the screen
 * to find out about, gone.
 *
 * ## It never runs from a refetch
 *
 * A read caused by the socket, by a reconnect or by the app resuming changes
 * what is drawn and nothing else. It is the intersection and the visibility
 * that decide, afterwards, whether a person saw it. Nothing here subscribes to
 * a read.
 *
 * ## What it sends is an id, never a time
 *
 * `through` is the newest change that was **rendered** when the dwell ended, so
 * a change that arrives between the render and the request stays unseen. A
 * cursor in this product never carries a timestamp (backend `0130`, section
 * 13).
 */
@Injectable()
export class ChangeAcknowledger {
  private readonly _browser = inject(BrowserFacade);
  private readonly _basket = inject(BasketStore);
  private readonly _changes = inject(BasketChangeStore);

  /**
   * The marked rows currently on screen, by element.
   *
   * Keyed rather than counted, because two rows reporting independently cannot
   * keep a bare counter honest: a row destroyed by a refetch reports itself
   * gone after its replacement has reported itself here, and a counter would
   * drift negative or stick above zero.
   */
  private readonly _rowsOnScreen = new Set<object>();

  /** {@link _rowsOnScreen}'s size, as the effect below reads it. */
  private readonly _rowCount = signal(0);

  /** How many entries the changes sheet has drawn, or zero when it is shut. */
  private readonly _sheetEntries = signal(0);

  private _timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const seen =
        this._browser.visible() &&
        (this._rowCount() > 0 || this._sheetEntries() > 0);

      untracked(() => {
        if (!seen) {
          this._cancel();
          return;
        }
        // Already counting down. Restarting on every row that scrolls into
        // view would mean a slow scroll down a changed basket never reaches
        // the end of one dwell.
        if (this._timer === null) {
          this._timer = setTimeout(() => {
            this._timer = null;
            void this._send();
          }, CHANGE_SEEN_DWELL_MS);
        }
      });
    });

    inject(DestroyRef).onDestroy(() => this._cancel());
  }

  /** A marked row came into view, or left it. */
  reportRowSeen(key: object, onScreen: boolean): void {
    if (onScreen) {
      this._rowsOnScreen.add(key);
    } else {
      this._rowsOnScreen.delete(key);
    }
    this._rowCount.set(this._rowsOnScreen.size);
  }

  /**
   * The changes sheet said how many entries it is drawing. Zero when it shuts.
   *
   * The sheet reports rather than being asked, because "is the sheet open" is a
   * router fact this class has no business reading, and "has it drawn anything"
   * is not a router fact at all: a sheet loading or showing its empty state has
   * put no change in front of anybody.
   */
  reportSheetEntries(count: number): void {
    this._sheetEntries.set(count);
  }

  /**
   * Name the newest change that was on screen, and tell the server once.
   *
   * The sheet's own first entry wins when the sheet is drawing, because that is
   * the newest thing the reader is actually looking at; otherwise it is the
   * basket read's own `newestUnseenChangeId`, which is the id that goes with
   * the marks the rows are wearing.
   *
   * Nothing goes out when the server says nothing is unseen. There is no cursor
   * to move and the request would cost a basket read for no change.
   */
  private async _send(): Promise<void> {
    const basket = this._basket.basket();
    if (basket === null || basket.unseenChangeCount === 0) {
      return;
    }

    const through =
      (this._sheetEntries() > 0 ? this._changes.changes()[0]?.id : undefined) ??
      basket.newestUnseenChangeId;
    if (through === null || through === undefined) {
      return;
    }

    // The store refuses a `through` it has already sent and asks for the basket
    // again on success, so the marks and the count that come back are the
    // server's new answer rather than anything decided here.
    await this._changes.acknowledge(through);
  }

  private _cancel(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}
