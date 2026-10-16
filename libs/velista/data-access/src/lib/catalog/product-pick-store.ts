import { Injectable, signal } from '@angular/core';

/**
 * How many products the catalog chooses: one, with a radio on each card, or the
 * whole set of a line, with a tick on each card (velista `0146`, section 1).
 */
export type ProductPickKind = 'one' | 'set';

/**
 * What the screen that opens the catalog to choose hands it (velista `0140`,
 * section 3; `0146`, section 1).
 *
 * The first search text and the first supermarket are not here: they are the
 * catalog's own state, which is its URL, so the caller puts them in the URL it
 * navigates to (`q`, `chain`).
 */
export interface ProductPickRequest {
  readonly kind: ProductPickKind;
  /** The line the route of the page names. The page answers for this one only. */
  readonly lineId: string;
  /** The two lines of the bar at the foot: what the choice is for. */
  readonly forLabel: string;
  readonly forDetail: string;
  /** The product the page opens with chosen, or null for none. The kind `one`. */
  readonly chosenId: string | null;
  /**
   * The products the page opens with ticked: the products of the line, its own
   * and those its group put there, which are one set (`itemIds`, review point 3).
   * The kind `set`. Absent is none.
   */
  readonly chosenIds?: readonly string[];
  /**
   * Where the close control goes, and the answer. The URL is the fallback used
   * when the history cannot be walked back; the depth is the `AppHistory` depth
   * of the screen that opened the page, which the page walks back to past every
   * entry its pickers added.
   */
  readonly returnUrl: string;
  readonly returnDepth: number;
  /**
   * What the caller needs again when it comes back, kept and handed back as it
   * was given. The change sheet keeps its checkbox here.
   */
  readonly callerState: unknown;
}

/**
 * How the page ended, for the screen that opened it: the product chosen, or null
 * for a close that changed nothing.
 */
export interface ProductPickAnswer {
  readonly lineId: string;
  readonly itemId: string | null;
  readonly callerState: unknown;
}

/**
 * The catalog opened to choose, while it is open (velista `0140`, section 3).
 *
 * **Not the page's state**, because the supermarket and the category pickers are
 * pages of their own: the catalog page is destroyed while one is open, and the
 * product chosen so far must be there when it comes back. Not the basket's either:
 * the basket page is gone while the catalog is open. So it is held here, in memory,
 * for the session. A reload of the page forgets it, and the page then has no
 * caller to answer.
 */
// Provided by the app layer, never root: rule D5, like `CatalogAddStore`.
@Injectable()
export class ProductPickStore {
  private readonly _request = signal<ProductPickRequest | null>(null);
  private readonly _chosen = signal<string | null>(null);
  private readonly _ticked = signal<readonly string[]>([]);
  private readonly _base = signal<readonly string[]>([]);
  private readonly _answer = signal<ProductPickAnswer | null>(null);

  /** The open request, or null when nothing opened the catalog to choose. */
  readonly request = this._request.asReadonly();

  /** The product chosen on the page so far, or null for none yet. */
  readonly chosen = this._chosen.asReadonly();

  /**
   * The set ticked on the page so far, in the kind `set`: the products the page
   * opened with, then each one ticked since, in the order they were ticked. Here
   * and not in the page for the reason the request is: the pickers are pages, and
   * the page is gone while one is open.
   */
  readonly ticked = this._ticked.asReadonly();

  /**
   * The products of the line the ticks are counted against, in the kind `set`:
   * what it arrived with, then what it holds after another device changed it
   * while the page was open ({@link rebase}).
   */
  readonly base = this._base.asReadonly();

  /**
   * The answer not taken yet, or null. A caller that is a page of its own is a new
   * instance when it comes back, and finds its answer by its caller state here
   * before it takes it with {@link takeAnswer} (velista `0145`, section 5).
   */
  readonly answer = this._answer.asReadonly();

  /** Open the catalog to choose. Called by the caller just before it navigates. */
  open(request: ProductPickRequest): void {
    this._request.set(request);
    this._chosen.set(request.chosenId);
    this._ticked.set(request.chosenIds ?? []);
    this._base.set(request.chosenIds ?? []);
    this._answer.set(null);
  }

  /** A press on a card: that product is the choice now. */
  choose(itemId: string): void {
    this._chosen.set(itemId);
  }

  /** A tick on a card in the kind `set`: the whole set as it now stands. */
  tick(itemIds: readonly string[]): void {
    this._ticked.set(itemIds);
  }

  /**
   * The line moved while the page was open: the set is counted against what it
   * holds now, with the person's own ticks carried over by the page.
   */
  rebase(base: readonly string[], ticked: readonly string[]): void {
    this._base.set(base);
    this._ticked.set(ticked);
  }

  /**
   * The kind `set` is over: saved by the page, or left. The page writes the set
   * itself, so a failed save keeps it open (velista `0146`, section 3), and there
   * is no answer for the caller to take.
   */
  end(): void {
    this._request.set(null);
    this._chosen.set(null);
    this._ticked.set([]);
    this._base.set([]);
    this._answer.set(null);
  }

  /**
   * "Use this product": the answer is kept for the caller, and the request ends.
   * False when there is no request or nothing is chosen.
   */
  use(): boolean {
    const itemId = this._chosen();
    return itemId !== null && this._finish(itemId);
  }

  /** Close: the request ends with no product, and the caller state goes back. */
  cancel(): void {
    this._finish(null);
  }

  /**
   * The answer for this line, taken once. A second call answers null, so a sheet
   * opened again later does not find an old choice in it.
   */
  takeAnswer(lineId: string): ProductPickAnswer | null {
    const answer = this._answer();
    if (answer === null || answer.lineId !== lineId) {
      return null;
    }
    this._answer.set(null);
    return answer;
  }

  private _finish(itemId: string | null): boolean {
    const request = this._request();
    if (request === null) {
      return false;
    }
    this._answer.set({
      lineId: request.lineId,
      itemId,
      callerState: request.callerState,
    });
    this._request.set(null);
    this._chosen.set(null);
    this._ticked.set([]);
    this._base.set([]);
    return true;
  }
}
