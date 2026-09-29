import {
  catalogName,
  formatDistance,
  recentShopDay,
  type BasketShop,
  type FranchiseButton,
  type NearbyShop,
  type RecentShop,
  type Shop,
  type ShopSectionName,
} from '@portfolio/velista/models';
import type { SectionChip } from './section-chips';
import type { ShopGroup, ShopRow, ShopRowAside } from './shop-list';

/** A shop's section names in the reader's language, in the shop's order. */
export function sectionChipsOf(
  sections: readonly ShopSectionName[],
  locale: string
): readonly SectionChip[] {
  return sections
    .map((section) => ({
      id: section.id,
      name: catalogName(section.name, locale),
    }))
    .filter((section) => section.name !== '');
}

/** A street or a town, or null for a blank one. */
function part(value: string | null): string | null {
  return value === null || value.trim() === '' ? null : value.trim();
}

/**
 * A pick row from the parts every shop model has (velista `0124`): the chain, the
 * shop's own name, street and town apart and joined, its logo and its sections.
 */
export function pickRowOf(
  shop: {
    readonly id: string;
    readonly chain: string;
    readonly name: string | null;
    readonly address: string | null;
    readonly city: string | null;
    readonly postalCode: string | null;
    readonly logoUrl: string | null;
    readonly sections: readonly ShopSectionName[];
  },
  locale: string
): ShopRow {
  const street = part(shop.address);
  const town = part(shop.city);
  const where = [street, town]
    .filter((one): one is string => one !== null)
    .join(', ');
  return {
    id: shop.id,
    chain: shop.chain,
    name: shop.name === null || shop.name === '' ? null : shop.name,
    where: where === '' ? null : where,
    street,
    town,
    postalCode: shop.postalCode,
    excluded: false,
    excludedChain: false,
    failed: false,
    logo: { logoUrl: shop.logoUrl, name: shop.chain, store: false },
    sections: sectionChipsOf(shop.sections, locale),
  };
}

/** A catalog shop (`ShopStore`'s) as a pick row, in the reader's language. */
export function catalogShopRow(shop: Shop, locale: string): ShopRow {
  return pickRowOf(
    {
      id: shop.id,
      chain: catalogName(shop.chainName, locale),
      name: shop.name === null ? null : catalogName(shop.name, locale),
      address: shop.address,
      city: shop.city,
      postalCode: shop.postalCode,
      logoUrl: shop.logoUrl,
      sections: shop.sections,
    },
    locale
  );
}

/**
 * Rows under their postal code, in the order the codes were first met (`0059`,
 * section 3.3). The heading is the code itself: the pickers carry no label for it.
 * A shop with no code heads an empty string rather than being dropped.
 */
export function groupByPostalCode(
  rows: readonly ShopRow[]
): readonly ShopGroup[] {
  const byCode = new Map<string, ShopRow[]>();
  for (const row of rows) {
    const code = row.postalCode ?? '';
    const held = byCode.get(code);
    if (held === undefined) {
      byCode.set(code, [row]);
    } else {
      held.push(row);
    }
  }
  return [...byCode.entries()].map(([code, shops]) => ({
    key: code,
    heading: code,
    code: null,
    shops,
  }));
}

/**
 * The chain buttons a picker over a profile offers: every chain the profile does
 * not refuse, counting the shops it does not refuse, with no exclusion drawn. A
 * picker is not a screen about preferences, and a refused shop is not offered.
 */
export function offeredChains(
  chains: readonly FranchiseButton[]
): readonly FranchiseButton[] {
  return chains
    .filter((chain) => chain.state !== 'chain')
    .map((chain) => ({
      ...chain,
      locations: chain.locations - chain.excluded,
      excluded: 0,
      state: 'none' as const,
    }))
    .filter((chain) => chain.locations > 0);
}

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
  return {
    ...pickRowOf(
      {
        id: shop.id,
        chain: catalogName(shop.chain, locale),
        name: label === '' ? null : label,
        address: shop.address,
        city: shop.city,
        postalCode: shop.postalCode,
        logoUrl: shop.logoUrl,
        sections: shop.sections,
      },
      locale
    ),
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
