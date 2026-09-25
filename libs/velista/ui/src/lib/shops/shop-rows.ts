import {
  catalogName,
  formatDistance,
  recentShopDay,
  type BasketShop,
  type NearbyShop,
  type RecentShop,
} from '@portfolio/velista/models';
import type { ShopRow, ShopRowAside } from './shop-list';

/**
 * A named shop as a picker row, in the reader's language (velista `0103`).
 *
 * One function for the two sections that draw shops the server named rather than
 * shops of the open chain: the shops near the device and the recent ones, in both
 * sheets that draw the picker. `catalogName` rather than `inLocale`, because a
 * chain the catalog named only in Spanish would otherwise print blank for an
 * English reader.
 *
 * "Outside your areas" is drawn under a shop the server said is outside them, and
 * under nothing it said nothing about.
 */
export function shopRowOf(
  shop: BasketShop,
  locale: string,
  aside?: ShopRowAside
): ShopRow {
  const label = shop.label === null ? '' : catalogName(shop.label, locale);
  const where = [shop.address, shop.city]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(', ');
  return {
    id: shop.id,
    chain: catalogName(shop.chain, locale),
    name: label === '' ? null : label,
    where: where === '' ? null : where,
    postalCode: shop.postalCode,
    excluded: false,
    excludedChain: false,
    failed: false,
    outsideAreas: shop.inProfile === false,
    ...(aside === undefined ? {} : { aside }),
  };
}

/** A shop near the device, with its distance at the end of the row. */
export function nearbyShopRow(shop: NearbyShop, locale: string): ShopRow {
  return shopRowOf(shop, locale, {
    text: formatDistance(shop.distanceMetres, locale),
    kind: 'distance',
  });
}

/**
 * A shop this person bought at, with the day at the end of the row: "Today",
 * "Tuesday", "Sep 2".
 *
 * @param words The two days that are words rather than dates, already translated.
 * @param now Passed in, so a spec can stand on any day.
 */
export function recentShopRow(
  recent: RecentShop,
  locale: string,
  words: { readonly today: string; readonly yesterday: string },
  now: Date = new Date()
): ShopRow {
  const day = recentShopDay(recent.lastBoughtAt, locale, now);
  return shopRowOf(recent.shop, locale, {
    text:
      day.kind === 'today'
        ? words.today
        : day.kind === 'yesterday'
          ? words.yesterday
          : day.text,
    kind: 'when',
  });
}

/**
 * The shop in one string, as the pick message names it: "Mercadona, Calle Mayor 3".
 *
 * The chain, then the shop's own name, else its street, else its town, which is
 * the order anybody standing outside it reads them in.
 */
export function shopSentenceOf(shop: BasketShop, locale: string): string {
  const chain = catalogName(shop.chain, locale);
  const label = shop.label === null ? '' : catalogName(shop.label, locale);
  const place =
    label !== '' ? label : shop.address?.trim() || shop.city?.trim() || '';
  return place === '' ? chain : `${chain}, ${place}`;
}
