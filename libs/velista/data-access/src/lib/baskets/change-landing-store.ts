import { Injectable } from '@angular/core';
import type { BasketAddress } from '@portfolio/velista/models';

/** The row a sheet is pushed for, as `ChangeLandingStore.notePage` keeps it. */
export interface NotedRow {
  readonly rowKey: string;
  readonly entries: readonly { readonly lineId: string }[];
}

/** One sheet the basket page pushed: the basket, the row, and the page's depth. */
interface PageNote {
  /** `'live'`, or the basket's id. */
  readonly basket: string;
  readonly rowKey: string;
  readonly lineIds: ReadonlySet<string>;
  readonly page: number;
}

function basketOf(address: BasketAddress | null): string | null {
  return address === null
    ? null
    : address === 'live'
      ? 'live'
      : address.basketId;
}

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

  /** What the basket page noted as it pushed a sheet, by that sheet's depth. */
  private readonly _notes = new Map<number, PageNote>();

  /**
   * The basket page notes, just before it pushes a sheet of one row, the basket,
   * that row and the `AppHistory` depth it stands on; the sheet goes on the entry
   * above it (velista `0208`, target state 19).
   *
   * A note outlives the page: the page is destroyed while the catalog that
   * chooses is open, and a person who backs out of it, or walks back or forward
   * onto the sheet's entry, finds the page drawn again under a sheet it never
   * pushed. A push from the page drops every note at its own depth or above,
   * since those entries are gone from the history; the notes below it still
   * describe entries that stand.
   */
  notePage(address: BasketAddress | null, row: NotedRow, page: number): void {
    for (const sheet of [...this._notes.keys()]) {
      if (sheet >= page) {
        this._notes.delete(sheet);
      }
    }
    const basket = basketOf(address);
    if (basket === null) {
      return;
    }
    this._notes.set(page + 1, {
      basket,
      rowKey: row.rowKey,
      lineIds: new Set(row.entries.map((held) => held.lineId)),
      page,
    });
  }

  /**
   * The depth of the basket page under "Lists and amounts" of `row`, standing on
   * `sheetDepth`, or null. The page is one entry below when it pushed this view
   * itself (the basket's "Add or find"), and two when it pushed the row's sheet,
   * which pushed this view. Only a note of the same basket and the same row
   * answers (the row by its key, or by a line of it when its key moved): a note
   * of another row or basket at those depths describes another walk.
   *
   * Null when nothing matches: a document loaded on a sheet (a reload forgets
   * every note), or a page that pushed nothing since. The caller then takes the
   * row's sheet as the way in.
   */
  pageBelow(
    address: BasketAddress | null,
    row: NotedRow,
    sheetDepth: number
  ): number | null {
    const basket = basketOf(address);
    if (basket === null) {
      return null;
    }
    for (const sheet of [sheetDepth, sheetDepth - 1]) {
      const note = this._notes.get(sheet);
      if (
        note !== undefined &&
        note.basket === basket &&
        (note.rowKey === row.rowKey ||
          row.entries.some((held) => note.lineIds.has(held.lineId)))
      ) {
        return note.page;
      }
    }
    return null;
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
