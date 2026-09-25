import {
  NEARBY_NO_PICK_REASONS,
  type NearbyShop,
  type NearbyShops,
  type RecentShop,
} from '@portfolio/velista/models';
import { toBasketShop } from '../mapping/basket-mappers';
import {
  date,
  isRecord,
  mapArray,
  nullableNum,
  oneOfOrNull,
  str,
} from '../mapping/primitives';

/**
 * The shops near the device and the ones this person bought at, from the wire
 * (velista `0103`; backend `0164`). Rule D4: every value is read out of `unknown`.
 */

/**
 * From `NearbyShopView`: the shop of `0163`, with its distance and whether the
 * profile refuses it. Null without a distance, because the row prints one and a
 * candidate with no distance is not a candidate.
 */
export function toNearbyShop(raw: unknown): NearbyShop | null {
  const shop = toBasketShop(raw);
  if (shop === null || !isRecord(raw)) {
    return null;
  }

  const distanceMetres = nullableNum(raw['distanceMetres']);
  return distanceMetres === null
    ? null
    : { ...shop, distanceMetres, excluded: raw['excluded'] === true };
}

/**
 * From `NearbyShopsView`.
 *
 * **The pick is copied, never computed.** The one liberty taken is with an answer
 * this build cannot read as either: a pick with no readable id, or no pick with a
 * reason this build has never heard of. Both read as no pick, because showing the
 * candidates costs a tap and a wrong automatic choice costs a wrong shop on every
 * purchase. The reason then is the one that asks the person to choose, or none
 * nearby when there is nothing to choose from.
 */
export function toNearbyShops(raw: unknown): NearbyShops {
  const body = isRecord(raw) ? raw : {};
  const candidates = mapArray(body['candidates'], toNearbyShop);

  const pickRaw = body['pick'];
  if (isRecord(pickRaw)) {
    const locationId = str(pickRaw['locationId']);
    const distanceMetres = nullableNum(pickRaw['distanceMetres']);
    if (locationId !== null && distanceMetres !== null) {
      return { candidates, pick: { locationId, distanceMetres }, noPick: null };
    }
  }

  return {
    candidates,
    pick: null,
    noPick:
      oneOfOrNull(body['noPick'], NEARBY_NO_PICK_REASONS) ??
      (candidates.length === 0 ? 'NONE_NEARBY' : 'AMBIGUOUS'),
  };
}

/** From `RecentShopView`. Null without a shop or a date: the row draws both. */
export function toRecentShop(raw: unknown): RecentShop | null {
  if (!isRecord(raw)) {
    return null;
  }
  const shop = toBasketShop(raw['shop']);
  const lastBoughtAt = date(raw['lastBoughtAt']);
  return shop === null || lastBoughtAt === null ? null : { shop, lastBoughtAt };
}

/**
 * From `RecentShopsView`, newest first **as the server ordered them**. Nothing is
 * sorted again here: the order is the last purchase, and the server is the one
 * that knows it (velista `0103`, the boundary on ranking).
 */
export function toRecentShops(raw: unknown): readonly RecentShop[] {
  return mapArray(isRecord(raw) ? raw['shops'] : undefined, toRecentShop);
}
