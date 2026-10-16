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
  private _report: ((rowKey: string) => void) | null = null;

  /**
   * Who says a refused held buy out loud: the basket page, which outlives the
   * sheet that pressed it.
   */
  reportTo(report: (rowKey: string) => void): void {
    this._report = report;
  }

  /**
   * A held buy the server refused. Its `from` and row key are the ones of the
   * press, so a patch that moved or re-keyed the row while the question was open
   * makes the server refuse it, and the row is left unbought. This says so on
   * the row, with the sentence the settle sheet drew before the hold.
   */
  refused(rowKey: string): void {
    this._report?.(rowKey);
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

  /**
   * Forget what waits, unwritten. Only for the basket being left while the
   * question is open: the page lets the basket go as it leaves, so a write
   * released then would reach a basket no longer held (velista `0141`).
   */
  drop(): void {
    this._writes = [];
  }
}
