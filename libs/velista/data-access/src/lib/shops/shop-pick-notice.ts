import { Injectable, signal } from '@angular/core';
import type { BasketShop } from '@portfolio/velista/models';

/**
 * The message after "Near me" picked a shop in a basket (velista `0103`).
 *
 * "Buying at Mercadona, Calle Mayor 3 (120 m). Change". A wrong automatic choice
 * has to be easy to see and to undo, so the choice is said out loud with the
 * distance it was made on.
 */
export interface ShopPickNotice {
  /** The basket it was picked on, by its id. */
  readonly basket: string;
  /** The shop picked, named as the answer named it. */
  readonly shop: BasketShop;
  /** How far the device was from it, as the server measured. */
  readonly distanceMetres: number;
}

/**
 * Holds the pick message between the picker, which closes on a pick, and the
 * filter sheet it lands on.
 *
 * At the root, because the picker sheet and the filter sheet are two routes and
 * neither outlives the other. It holds three facts about a shop and no point.
 *
 * **It stays until dismissed or until the shop changes.** Dismissing clears it.
 * A change of shop is read by the filter sheet, which draws the message only while
 * the basket is still bought at the shop it names; every pick made by hand clears
 * it too, so going back to the same shop later does not bring it back.
 */
@Injectable({ providedIn: 'root' })
export class ShopPickNotices {
  private readonly _notice = signal<ShopPickNotice | null>(null);

  readonly notice = this._notice.asReadonly();

  show(notice: ShopPickNotice): void {
    this._notice.set(notice);
  }

  dismiss(): void {
    this._notice.set(null);
  }
}
