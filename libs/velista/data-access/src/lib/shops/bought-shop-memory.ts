import { inject, Injectable } from '@angular/core';
import type { BasketShop } from '@portfolio/velista/models';
import { BrowserFacade, StorageKeys } from '@portfolio/velista/platform';
import { toBasketShop } from '../mapping/basket-mappers';
import { isRecord } from '../mapping/primitives';
import { hasExpired, readRemembered, untilFor } from '../view-memory';

/**
 * How long the shop of the last "I bought this" is offered again (velista `0114`).
 *
 * Two hours, the basket's own number for its shop (`BASKET_VIEW_LIFETIME_MS`), because
 * it is the same judgement: a shop is true for the trip and not for the month, and a
 * shop preselected a week later would quietly put somebody's purchase at the wrong
 * chain.
 */
export const BOUGHT_SHOP_LIFETIME_MS = 2 * 60 * 60 * 1000;

/** The only version this build reads or writes. Anything else reads as nothing. */
const VERSION = 1;

/**
 * The stored record. The shop is kept in the wire's own shape, so reading it back is
 * `toBasketShop`, the mapper every other shop the picker draws already went through
 * (rule D4: what an older build wrote is as untrusted as a response body).
 */
interface StoredBoughtShop {
  readonly version: typeof VERSION;
  readonly shop: {
    readonly value: Record<string, unknown>;
    readonly until: string | null;
  };
}

/**
 * The remembered shop out of what storage held, or null when there is none, it cannot
 * be read, or its time has passed.
 *
 * Pure, with the moment passed in, so a spec can stand on either side of the expiry.
 */
export function parseBoughtShop(
  raw: string | null,
  now: number
): BasketShop | null {
  if (raw === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || parsed['version'] !== VERSION) {
    return null;
  }

  const remembered = readRemembered(parsed['shop'], toBasketShop);
  if (typeof remembered !== 'object' || hasExpired(remembered, now)) {
    return null;
  }
  return remembered.value;
}

/** The record that remembers one shop, dated from {@link BOUGHT_SHOP_LIFETIME_MS}. */
export function boughtShopRecord(shop: BasketShop, now: number): string {
  const record: StoredBoughtShop = {
    version: VERSION,
    shop: {
      value: {
        id: shop.id,
        supermarketId: shop.supermarketId,
        supermarketName: shop.chain,
        label: shop.label,
        address: shop.address,
        city: shop.city,
        postalCode: shop.postalCode,
        inProfile: shop.inProfile,
      },
      until: untilFor(BOUGHT_SHOP_LIFETIME_MS, now),
    },
  };
  return JSON.stringify(record);
}

/**
 * The shop the zone list's "I bought this" step starts on (velista `0114`).
 *
 * **Not the in-memory backend**, for the reason `basket-view-memory.ts` gives: it is
 * this device's own choice, in its own storage. Choosing a shop remembers it and
 * clearing the choice forgets it, so what the step preselects is always the last thing
 * the person said, and never a shop they took back.
 */
@Injectable({ providedIn: 'root' })
export class BoughtShopMemory {
  private readonly _browser = inject(BrowserFacade);

  /** The shop to start on, or null for none. */
  read(now: number = Date.now()): BasketShop | null {
    return parseBoughtShop(
      this._browser.readStorage(StorageKeys.boughtShop),
      now
    );
  }

  /** Remember a chosen shop for the next purchase. */
  remember(shop: BasketShop, now: number = Date.now()): void {
    this._browser.writeStorage(
      StorageKeys.boughtShop,
      boughtShopRecord(shop, now)
    );
  }

  /** Forget it, which is what clearing the choice means. */
  forget(): void {
    this._browser.removeStorage(StorageKeys.boughtShop);
  }
}
