import type { Shop, ShopChainSummary } from '@portfolio/velista/models';
import { toLocalizedName } from './mappers';
import { isRecord, nullableStr, numOr, str } from './primitives';

/**
 * The supermarkets screen's two reads, mapped (plan 0059; backend plan 0068).
 *
 * Their own file rather than more of `mappers.ts`, matching `basket-mappers.ts`: these
 * are one screen's shapes, they are the only readers of `postalCodeSource`, and the
 * general file is long enough that a subject with a boundary of its own is easier to
 * find on its own.
 *
 * Rule D4 throughout. Nothing here throws, and a row that cannot be read is dropped by
 * `mapArray` rather than costing the caller the page it came in.
 */

/**
 * From `ShopView` (`GET /v1/catalog/shops`).
 *
 * The wire nests the chain inside the shop and this flattens the pair, because nothing
 * in the app holds a shop without the chain it belongs to and a template reaching through
 * `shop.supermarket.name` would be reaching through a shape the backend chose.
 *
 * `id` and `supermarketId` are the two required fields, and neither is defaulted: an
 * exclusion names a location id, so a row without one is a row whose only control cannot
 * be wired up, and a row without a chain cannot be bucketed into a franchise button.
 */
export function toShop(raw: unknown): Shop | null {
  if (!isRecord(raw)) {
    return null;
  }

  const location = isRecord(raw['location']) ? raw['location'] : null;
  const supermarket = isRecord(raw['supermarket']) ? raw['supermarket'] : null;
  if (location === null || supermarket === null) {
    return null;
  }

  const id = str(location['id']);
  const supermarketId =
    str(supermarket['id']) ?? str(location['supermarketId']);
  if (id === null || supermarketId === null) {
    return null;
  }

  return {
    id,
    supermarketId,
    chainName: toLocalizedName(supermarket['name']),
    // Null rather than an empty pair when the shop has no name of its own, which most
    // shops of a chain do not: the row then draws its address under the chain's name,
    // and an empty pair would draw a blank line above it.
    name: isRecord(location['label'])
      ? toLocalizedName(location['label'])
      : null,
    address: nullableStr(location['address']),
    city: nullableStr(location['city']),
    postalCode: nullableStr(location['postalCode']),
    // Only `DERIVED` is the centroid, and only the centroid owes GeoNames its credit.
    // `SOURCE` and `MANUAL` are both codes somebody stated, and an unknown value reads
    // as one of those rather than as derived: claiming credit is due where it is not
    // would put a sentence about GeoNames under data GeoNames had nothing to do with.
    postalCodeDerived: location['postalCodeSource'] === 'DERIVED',
    provider: nullableStr(location['externalProvider']),
    // Both default to false, which is what an offering read answers: it filters the
    // refused out rather than flagging them, so their absence is the honest reading.
    excluded: raw['excluded'] === true,
    excludedChain: raw['excludedChain'] === true,
  };
}

/**
 * From `ShopChainSummaryView` (`GET /v1/catalog/shops/summary`).
 *
 * `locations` defaults to zero and the row is still kept, even though the server says a
 * chain with no shops in the codes is absent. A count this client could not read is a
 * button that draws "0 shops" rather than a franchise that silently disappears from a
 * screen whose whole job is to list them.
 */
export function toShopChainSummary(raw: unknown): ShopChainSummary | null {
  if (!isRecord(raw)) {
    return null;
  }

  const supermarketId = str(raw['supermarketId']);
  if (supermarketId === null) {
    return null;
  }

  return {
    supermarketId,
    name: toLocalizedName(raw['name']),
    externalBrandKey: nullableStr(raw['externalBrandKey']),
    locations: numOr(raw['locations'], 0),
    excluded: numOr(raw['excluded'], 0),
    excludedChain: raw['excludedChain'] === true,
  };
}
