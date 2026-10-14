import { Injectable, signal } from '@angular/core';
import type { BasketProduct } from '@portfolio/velista/models';

/**
 * A product chosen for one line of a shopping list, on this device only (velista
 * `0140`, section 4).
 *
 * The product is kept beside its id because the read of the basket names the
 * product of every row and nothing else (backend `0201`, section 3). A line moved
 * to a product no row draws would otherwise be drawn with no name and no price
 * until the next buy.
 */
export interface HeldProductChoice {
  readonly itemId: string;
  /** What the row draws for it, or null when the sheet had no product to hand. */
  readonly product: BasketProduct | null;
}

const NONE: ReadonlyMap<string, HeldProductChoice> = new Map();

/**
 * The products chosen "for this trip only" before the first buy (velista `0140`,
 * section 4): the checkbox was off and the line had no buy, so nothing was sent.
 *
 * **By line and not by row.** A row is a group the server makes, and a choice for
 * one line of a row takes that line out of it. `BasketStore` puts each choice on
 * its entry and groups the entries again with the shared rule
 * (`withHeldChoices`). The next buy names the product, and from then on the server
 * answers it, so a choice under an entry with a buy of its own is spent.
 *
 * **Here and not on `BasketStore`**, which the basket route provides and the page
 * clears from its own teardown: the catalog that chooses is a page of its own,
 * and the basket page is gone while it is open. Kept for each basket, in memory
 * only. A reload forgets the choice, which the owner accepted ("for now just on
 * the device is perfect").
 */
// Provided by the app layer, never root: rule D5, like `CatalogAddStore`.
@Injectable()
export class HeldProductChoices {
  private readonly _held = signal<
    ReadonlyMap<string, ReadonlyMap<string, HeldProductChoice>>
  >(new Map());

  /** The choices held on one basket, by line id. Empty for none. */
  heldOn(basketId: string | null): ReadonlyMap<string, HeldProductChoice> {
    return basketId === null ? NONE : (this._held().get(basketId) ?? NONE);
  }

  /** Hold one product for these lines, in place of whatever they held. */
  hold(
    basketId: string,
    lineIds: readonly string[],
    choice: HeldProductChoice
  ): void {
    if (lineIds.length === 0) {
      return;
    }
    this._update(basketId, (lines) => {
      for (const lineId of lineIds) {
        lines.set(lineId, choice);
      }
    });
  }

  /** Let these lines follow the server again. */
  release(basketId: string, lineIds: readonly string[]): void {
    const held = this.heldOn(basketId);
    if (!lineIds.some((lineId) => held.has(lineId))) {
      return;
    }
    this._update(basketId, (lines) => {
      for (const lineId of lineIds) {
        lines.delete(lineId);
      }
    });
  }

  private _update(
    basketId: string,
    change: (lines: Map<string, HeldProductChoice>) => void
  ): void {
    this._held.update((held) => {
      const lines = new Map(held.get(basketId) ?? NONE);
      change(lines);
      const next = new Map(held);
      if (lines.size === 0) {
        next.delete(basketId);
      } else {
        next.set(basketId, lines);
      }
      return next;
    });
  }
}
