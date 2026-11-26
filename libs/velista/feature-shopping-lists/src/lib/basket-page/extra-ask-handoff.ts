import { Injectable } from '@angular/core';
import type { AbsorbedExtra } from '@portfolio/velista/models';

/**
 * One question about the extra already bought, as the basket's "Add or find"
 * hands it to the row's "Lists and amounts" (velista `0208`, target state 19).
 */
export interface PendingExtraAsk {
  /** The row the sheet opens on. */
  readonly rowKey: string;
  /** The line the add raised. */
  readonly lineId: string;
  /** What the add took into the ask. */
  readonly extra: AbsorbedExtra;
}

/**
 * The basket's "Add or find" raised a line over extra already bought, and its
 * question is asked on the row's "Lists and amounts" (velista `0208`, target
 * state 19). The page hands one pending question over for the navigation that
 * opens the sheet, and the sheet takes it when it opens. Whatever the sheet did
 * not take is dropped once that navigation is over: a question is never asked by
 * a sheet opened later.
 *
 * **Built to be removed** (the owner: "likely to change and be removed"). This
 * file, one call in `basket-page.ts` and one read in `row-lists-sheet.ts`, each
 * marked with a comment naming this plan and target state 19, are the whole of
 * it. `extra-ask-handoff.spec.ts` names the three places.
 *
 * Provided by the basket page, so it goes with it and its sheets reach it.
 */
@Injectable()
export class ExtraAskHandoff {
  private _pending: PendingExtraAsk | null = null;

  /**
   * Hold `question` for the navigation `open` starts, and drop it once that
   * navigation is over, taken or not.
   */
  async send(
    question: PendingExtraAsk,
    open: () => Promise<boolean>
  ): Promise<void> {
    this._pending = question;
    try {
      await open();
    } catch {
      // A navigation that failed opened no sheet: the default stands.
    } finally {
      if (this._pending === question) {
        this._pending = null;
      }
    }
  }

  /** The question for this row, once: the sheet takes it as it opens. */
  take(rowKey: string): PendingExtraAsk | null {
    const pending = this._pending;
    if (pending === null || pending.rowKey !== rowKey) {
      return null;
    }
    this._pending = null;
    return pending;
  }
}
