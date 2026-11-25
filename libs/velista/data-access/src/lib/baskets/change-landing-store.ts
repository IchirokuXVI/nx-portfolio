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
   * The landing is over: used by a change, or the sheet left without one. A
   * landing held since for another sheet is kept.
   */
  release(landing: ChangeLanding): void {
    if (this._held === landing) {
      this._held = null;
    }
  }
}
