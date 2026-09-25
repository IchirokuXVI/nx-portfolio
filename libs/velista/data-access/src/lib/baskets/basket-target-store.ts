import { computed, inject, Injectable, signal } from '@angular/core';
import type { Basket, BasketListRef } from '@portfolio/velista/models';
import { basketTargetKey, BrowserFacade } from '@portfolio/velista/platform';

/**
 * Which list the composer adds to, for one basket, on this device (velista
 * `0092`, section 7.2).
 *
 * ## Why there is a store at all
 *
 * Every line added from the basket names a list now, and the basket can cover
 * several. Somebody doing a weekly shop for two households adds six things to one
 * of them and one to the other, so the target is worth remembering and worth
 * being able to change in one tap. A picker that asked on every add would be a
 * second sheet between a person in an aisle and the thing they just remembered.
 *
 * ## Per basket, where the view memory is per device
 *
 * `BasketViewStore` remembers how a shopper likes the basket drawn, once, for
 * every basket they open: the order and the grouping are the **person's**
 * preference (velista `0091`, section 7). This is not that. A list belongs to a
 * basket's coverage, so a target remembered from last week's shared basket is
 * meaningless on this week's own one, and applying it would be the wrong list
 * silently chosen.
 *
 * ## It never expires
 *
 * Unlike the view's properties, which each carry their own lifetime because
 * "prices from Mercadona" is true for a trip and not for a month. A target is a
 * convenience rather than a belief, and the chip above the field shows its value
 * before every add: there is no moment where a stale one is acted on without
 * being read first.
 *
 * ## What {@link restore} refuses
 *
 * A remembered id that {@link Basket.lists} does not hold. The coverage changed,
 * or this reader's `WRITE` on that list went away, and either way the server
 * would refuse the add. It is dropped **silently and the record is kept**: the
 * list may come back on the next read, and forgetting it here would make a
 * momentary refusal permanent.
 */
@Injectable()
export class BasketTargetStore {
  private readonly _browser = inject(BrowserFacade);

  /** Which basket this store is about, once {@link restore} has been given one. */
  private _basketId: string | null = null;

  private readonly _target = signal<BasketListRef | null>(null);

  /**
   * The list the next add goes to, or null while none is chosen.
   *
   * The **ref** and not the id, because the chip above the field draws its name
   * and a component that held an id would have to resolve it against the basket
   * itself (rule D1).
   */
  readonly target = this._target.asReadonly();

  /** Whether a target has been settled on, which is what gates the submit. */
  readonly chosen = computed(() => this._target() !== null);

  /**
   * Take the target from the basket, and from what this device remembers.
   *
   * Called on every basket read rather than once, because the refs move: a list
   * this reader lost `WRITE` on leaves `Basket.lists` on the next read, and a
   * target pointing at it has to stop being drawn.
   *
   * **One list chooses itself.** There is nothing to pick between, so the chip
   * above the field is text rather than a button and nobody is asked a question
   * with one answer.
   */
  restore(basket: Basket): void {
    this._basketId = basket.id;

    if (basket.lists.length === 1) {
      this._target.set(basket.lists[0]);
      return;
    }

    // A target already chosen in this visit wins over the remembered one, and is
    // re-resolved against the refs that just arrived: the name on the chip has
    // to be the name the server last sent.
    const held = this._target()?.listId ?? this._read(basket.id);
    this._target.set(
      basket.lists.find((ref) => ref.listId === held) ?? null
    );
  }

  /** Say where the next add goes, and remember it for this basket. */
  choose(list: BasketListRef): void {
    this._target.set(list);
    if (this._basketId !== null) {
      this._browser.writeStorage(basketTargetKey(this._basketId), list.listId);
    }
  }

  /**
   * Let the basket go, which the page does in its teardown.
   *
   * The **record stays**: this is the page being left, not the target being
   * given up, and the whole point of writing it down is that it survives that.
   */
  leave(): void {
    this._basketId = null;
    this._target.set(null);
  }

  private _read(basketId: string): string | null {
    const held = this._browser.readStorage(basketTargetKey(basketId));
    return held === null || held === '' ? null : held;
  }
}
