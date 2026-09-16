import type { Wire } from '@portfolio/luna-shopper-admin/models';

/**
 * One chain's spelling of a brand, carrying the brand it belongs to.
 *
 * `brandId` is not part of `BrandSpellingView`: the route answers the spellings
 * of the brand named in its path, so the wire does not repeat it. The gateway
 * puts it back on every row (see `brandSpellingsSource`), which is what lets the
 * memory table hold every brand's spellings in one list and still answer for one
 * brand.
 */
export type SeededSpelling = Wire.HarvestBrandSpellingView & {
  readonly brandId: string;
};

/**
 * Brands to show when there is no backend.
 *
 * Four, one of them a private label, because the private label column is the
 * one an operator is most likely to get wrong and a seed that never exercised it
 * would demonstrate nothing. Real Spanish brands, for the reason
 * `SUPERMARKET_SEED` gives: `elpozo` and `El Pozo` meeting on one key is the
 * whole point of the registry, and `brand-1` would show none of it.
 */
export const BRAND_SEED: readonly Wire.CatalogBrandView[] = [
  {
    id: 'br_hacendado',
    key: 'hacendado',
    label: 'Hacendado',
    // Mercadona's own label, which is what this column is for.
    privateLabelSupermarketId: 'sm_mercadona',
    itemCount: 1284,
    createdAt: '2026-02-11T09:14:00.000Z',
    updatedAt: '2026-08-30T17:02:00.000Z',
  },
  {
    id: 'br_elpozo',
    key: 'elpozo',
    label: 'El Pozo',
    privateLabelSupermarketId: null,
    itemCount: 212,
    createdAt: '2026-02-11T09:14:00.000Z',
    updatedAt: '2026-07-04T11:41:00.000Z',
  },
  {
    id: 'br_cocacola',
    key: 'cocacola',
    label: 'Coca-Cola',
    privateLabelSupermarketId: null,
    itemCount: 96,
    createdAt: '2026-03-02T15:30:00.000Z',
    updatedAt: '2026-03-02T15:30:00.000Z',
  },
  {
    id: 'br_campofrio',
    key: 'campofrio',
    label: 'Campofrío',
    privateLabelSupermarketId: null,
    // Registered by hand and carrying nothing yet, which is an ordinary state
    // and the one the detail page has a sentence for.
    itemCount: 0,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
  },
];

/**
 * How the chains spell those brands, when there is no backend.
 *
 * `MAHOU` beside `Mahou` is the case the panel exists for, so the seed has the
 * same shape: one brand spelled two ways by two chains, and one brand nothing
 * has ever harvested.
 */
export const BRAND_SPELLING_SEED: readonly SeededSpelling[] = [
  {
    brandId: 'br_hacendado',
    supermarketId: 'sm_mercadona',
    spelling: 'Hacendado',
    productCount: 1284,
    queuedCount: 37,
  },
  {
    brandId: 'br_elpozo',
    supermarketId: 'sm_carrefour',
    spelling: 'ELPOZO',
    productCount: 141,
    queuedCount: 12,
  },
  {
    brandId: 'br_elpozo',
    supermarketId: 'sm_carrefour',
    spelling: 'El Pozo',
    productCount: 9,
    queuedCount: 0,
  },
  {
    brandId: 'br_elpozo',
    supermarketId: 'sm_mercadona',
    spelling: 'El Pozo',
    productCount: 62,
    queuedCount: 0,
  },
  {
    brandId: 'br_cocacola',
    supermarketId: 'sm_consum',
    spelling: 'Coca-Cola',
    productCount: 96,
    queuedCount: 4,
  },
];

/**
 * Keys the queue carries that nothing has registered, when there is no backend.
 *
 * Six across three chains, most products first, which is the order the route
 * answers in and the only order the screen offers.
 */
export const BRAND_SUGGESTION_SEED: readonly Wire.HarvestBrandSuggestionView[] =
  [
    {
      key: 'mahou',
      spelling: 'MAHOU',
      productCount: 58,
      firstSeenAt: '2026-05-14T07:22:00.000Z',
      chains: [
        { supermarketId: 'sm_carrefour', productCount: 41 },
        { supermarketId: 'sm_mercadona', productCount: 17 },
      ],
    },
    {
      key: 'gallo',
      spelling: 'Gallo',
      productCount: 43,
      firstSeenAt: '2026-04-02T12:05:00.000Z',
      chains: [
        { supermarketId: 'sm_mercadona', productCount: 25 },
        { supermarketId: 'sm_consum', productCount: 18 },
      ],
    },
    {
      key: 'pascual',
      spelling: 'Pascual',
      productCount: 31,
      firstSeenAt: '2026-06-19T16:48:00.000Z',
      chains: [{ supermarketId: 'sm_carrefour', productCount: 31 }],
    },
    {
      key: 'danone',
      spelling: 'Danone',
      productCount: 27,
      firstSeenAt: '2026-01-28T10:10:00.000Z',
      chains: [
        { supermarketId: 'sm_consum', productCount: 14 },
        { supermarketId: 'sm_carrefour', productCount: 9 },
        { supermarketId: 'sm_mercadona', productCount: 4 },
      ],
    },
    {
      key: 'borges',
      spelling: 'BORGES',
      productCount: 12,
      firstSeenAt: '2026-07-30T09:33:00.000Z',
      chains: [{ supermarketId: 'sm_mercadona', productCount: 12 }],
    },
    {
      key: 'proteinas',
      // A range rather than a brand, which is the row an operator is meant to
      // look at twice before registering it (backend plan 0115, section 1).
      spelling: '+Proteínas',
      productCount: 5,
      firstSeenAt: '2026-08-21T14:57:00.000Z',
      chains: [{ supermarketId: 'sm_mercadona', productCount: 5 }],
    },
  ];
