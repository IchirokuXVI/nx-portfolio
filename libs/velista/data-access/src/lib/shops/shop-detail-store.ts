import { inject, Injectable, signal } from '@angular/core';
import {
  SHOP_DETAIL_SERVICE,
  type ShopDetailRead,
  type ShopDetailServiceI,
} from './shop-detail-service';

/**
 * Shops read for their own page and for the map's head, held for the session
 * (velista `0121`).
 *
 * The plan names this `ShopStore`, and that name was taken by the store of the
 * supermarkets page (plan 0059), so it is `ShopDetailStore`.
 *
 * ## Held once answered
 *
 * `ShopSectionsStore`'s rule: a shop that answered is not asked again this
 * session, so going from the shop page to its map and back draws the head in the
 * same frame. A failed read is not held, so the next {@link ensure} tries again,
 * which is what the page's retry does. A shop the catalog does not know is held
 * as missing, because asking again will not make it exist.
 *
 * Written by hand, with no `@angular/core/rxjs-interop`: every screen that opens a
 * shop shares this.
 */
// Provided by the app layer, never root: rule D5, like `ShopSectionsStore`.
@Injectable()
export class ShopDetailStore {
  private readonly _service = inject<ShopDetailServiceI>(SHOP_DETAIL_SERVICE);

  private readonly _held = signal<ReadonlyMap<string, ShopDetailRead>>(
    new Map()
  );

  /** Reads that failed last time, so the page can say so rather than wait. */
  private readonly _failed = signal<ReadonlySet<string>>(new Set());

  private readonly _pending = new Map<string, Promise<void>>();

  /**
   * One shop: its read, `loading` while the first read is out, or `failed`
   * when the last read did not answer.
   */
  read(locationId: string): ShopDetailRead | { readonly kind: 'loading' } {
    const held = this._held().get(locationId);
    if (held !== undefined) {
      return held;
    }
    return this._failed().has(locationId)
      ? { kind: 'failed' }
      : { kind: 'loading' };
  }

  /** Read one shop, once per session. A failed read is retried by the next call. */
  ensure(locationId: string): Promise<void> {
    if (this._held().has(locationId)) {
      return Promise.resolve();
    }
    const pending = this._pending.get(locationId);
    if (pending !== undefined) {
      return pending;
    }
    const read = this._read(locationId).finally(() => {
      this._pending.delete(locationId);
    });
    this._pending.set(locationId, read);
    return read;
  }

  private async _read(locationId: string): Promise<void> {
    this._failed.update((failed) => {
      const next = new Set(failed);
      next.delete(locationId);
      return next;
    });
    let answer: ShopDetailRead;
    try {
      answer = await this._service.location(locationId);
    } catch {
      answer = { kind: 'failed' };
    }
    if (answer.kind === 'failed') {
      this._failed.update((failed) => new Set(failed).add(locationId));
      return;
    }
    this._held.update((held) => new Map(held).set(locationId, answer));
  }
}
