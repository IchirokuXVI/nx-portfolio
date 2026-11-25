import { Injectable } from '@angular/core';

/**
 * Where a change of product lands, asked by "Lists and amounts" (velista `0200`,
 * amended on 2026-11-25): the `AppHistory` depth of the basket page, past the
 * change sheet, the detailed view and the row's sheet.
 */
export interface ChangeLanding {
  /** The row the change sheet is opened for, as its route names it. */
  readonly rowKey: string;
  /** The one line of "Change product", or null for "Change for all lists". */
  readonly lineId: string | null;
  /** The `AppHistory` depth the change sheet walks back to after a change. */
  readonly depth: number;
  /**
   * The `AppHistory` depth of the entry the change sheet occupies: one above the
   * view that asked. Only a sheet on that entry may take the landing.
   */
  readonly sheetDepth: number;
}

/**
 * The landing of the change sheet that "Lists and amounts" opened, while that
 * sheet is open (velista `0200`).
 *
 * **In memory, not in the history state**, as `ProductPickStore.returnDepth` is:
 * a depth is a number of `AppHistory`, which starts over on a reload, while a
 * history state survives one and would then name an entry of another count.
 * Here a reload forgets it, and the sheet closes onto the row's sheet as it does
 * when anything else opened it.
 *
 * Not the sheet's own state either: the change sheet is destroyed while the
 * catalog that chooses is open, and comes back as a new instance that must still
 * know where to land. It holds one landing, the last one asked.
 */
// Provided by the app layer, never root: rule D5, like `ProductPickStore`.
@Injectable()
export class ChangeLandingStore {
  private _held: ChangeLanding | null = null;
  private _page: number | null = null;

  /**
   * The basket page records the `AppHistory` depth it stands on each time a
   * navigation ends with nothing over it, and null when it is destroyed. A sheet
   * over it reads where the page really is, however the sheet was opened: pushed
   * by the row's sheet, or straight from the page (velista `0208`, target state
   * 19).
   */
  notePage(depth: number | null): void {
    this._page = depth;
  }

  /**
   * The depth of the basket page under a sheet standing on `sheetDepth`, or null
   * when the page did not record one below it: a sheet the document loaded on, or
   * a page drawn again under a sheet already open.
   */
  pageBelow(sheetDepth: number): number | null {
    const page = this._page;
    return page !== null && page < sheetDepth ? page : null;
  }

  /** Ask the change sheet about to open to land at a depth. Called just before it navigates. */
  hold(landing: ChangeLanding): void {
    this._held = landing;
  }

  /**
   * The landing held for the change sheet of this row and line, or null. Read,
   * not taken: the sheet reads it again when it comes back from the catalog.
   */
  landingFor(rowKey: string, lineId: string | null): ChangeLanding | null {
    const held = this._held;
    return held !== null && held.rowKey === rowKey && held.lineId === lineId
      ? held
      : null;
  }

  /**
   * The landing for the change sheet of this row and line standing on
   * `sheetDepth` (its own `AppHistory.depth()`), or null. Only the sheet that
   * was asked for may take it, and that sheet stands on the entry the landing
   * was held for: pushed there from the view, or popped back onto it from the
   * catalog.
   *
   * A sheet on any other entry finds a landing left over from a walk that ended
   * another way (a catalog left by its tab bar, a navigation that never
   * happened), and walking back to it would pop past screens the person did not
   * leave. It is let go, and the sheet closes one step as when anything else
   * opened it.
   *
   * Asked by depth alone, and only once the sheet's own navigation has ended.
   * While it is in flight `AppHistory.depth()` is still the entry a push left,
   * but a sheet whose page was drawn again (the return from the catalog
   * redraws the basket page) is constructed only after it ended, when the
   * depth is already its own and `arrivingByPop()` no longer answers.
   */
  claim(
    rowKey: string,
    lineId: string | null,
    sheetDepth: number
  ): ChangeLanding | null {
    const held = this.landingFor(rowKey, lineId);
    if (held === null) {
      return null;
    }
    if (held.sheetDepth !== sheetDepth) {
      this.release(held);
      return null;
    }
    return held;
  }

  /**
   * The landing is over: used by a change, or the sheet left without one. A
   * landing held since for another sheet is kept.
   */
  release(landing: ChangeLanding): void {
    if (this._held === landing) {
      this._held = null;
    }
  }
}
