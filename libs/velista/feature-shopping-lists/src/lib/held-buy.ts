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
 * **A buy is never lost while the basket stays.** Every way out of the question
 * back to the basket releases what waits: a shop, "No shop", "Don't ask again",
 * the cross, the scrim, Escape and the back gesture, which only destroys the
 * sheet. Leaving the basket itself is not an answer, and drops it.
 */
@Injectable()
export class HeldBuy {
  private _writes: (() => Promise<void>)[] = [];

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

  /**
   * Forget what waits, unwritten. Only for the basket being left while the
   * question is open: the page lets the basket go as it leaves, so a write
   * released then would reach a basket no longer held (velista `0141`).
   */
  drop(): void {
    this._writes = [];
  }
}
