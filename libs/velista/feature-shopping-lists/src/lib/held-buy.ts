import { Injectable } from '@angular/core';

/**
 * A buy that waits for the answer to "Are you buying here?" (velista `0141`,
 * section 1).
 *
 * Provided by the basket page, so the page, the settle sheet and the shop
 * question, all drawn in its outlet, reach one holder. It holds the **write**,
 * not its body: the body names the shop, and the shop is what the answer decides,
 * so each write works its body out when it is released.
 *
 * **A buy is never lost.** Every way out of the question releases what waits:
 * a shop, "No shop", "Don't ask again", the cross, the scrim, Escape and the back
 * gesture, which only destroys the sheet.
 */
@Injectable()
export class HeldBuy {
  private _writes: (() => Promise<void>)[] = [];

  /** Whether a buy is waiting for the answer. */
  get waiting(): boolean {
    return this._writes.length > 0;
  }

  /**
   * Keep a write until the answer comes. A second press while the question is
   * open waits behind the first, and both are written in order.
   */
  hold(write: () => Promise<void>): void {
    this._writes.push(write);
  }

  /** Write what waits, in the order it was pressed, once each. */
  async release(): Promise<void> {
    const writes = this._writes;
    this._writes = [];
    for (const write of writes) {
      await write();
    }
  }
}
