import { Injectable, signal, type Signal } from '@angular/core';

/**
 * How many lines the basket being shopped still needs, for the third tab's badge
 * (velista 0097, section 7).
 *
 * A signal in `platform` that this library does not compute, which is
 * `ConnectionState`'s arrangement exactly: `ui` may not import `data-access` (rule D1),
 * and the number is a fact about the caller's baskets, so the layer that already knows
 * it writes here and the bar reads it.
 *
 * `BasketListStore` is that writer. It holds every summary the account has and
 * filters the live ones for the dashboard card already, so the count costs nothing and
 * cannot disagree with the card above it.
 */
@Injectable({ providedIn: 'root' })
export class LiveBasketBadge {
  private readonly _pending = signal<number | null>(null);

  /** The number over the glyph, or null for no badge at all. */
  readonly pending: Signal<number | null> = this._pending.asReadonly();

  /**
   * Say how many lines are still to get, or that there is nothing to say.
   *
   * **Nothing left to get is null rather than zero**, and that is a decision rather
   * than a tidy-up: a badge exists to say there is something waiting, so a zero in it
   * would be a mark that means the opposite of every other mark on the row. A basket
   * that is fully settled draws no badge, exactly as no basket does.
   */
  set(pending: number | null): void {
    this._pending.set(pending !== null && pending > 0 ? pending : null);
  }
}
