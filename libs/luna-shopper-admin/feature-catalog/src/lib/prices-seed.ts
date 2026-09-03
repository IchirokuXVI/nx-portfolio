import type { Wire } from '@portfolio/luna-shopper-admin/models';

/**
 * Prices to show when there is no backend.
 *
 * One of them is pinned, which is the state the whole screen exists for: it was
 * typed by a person, no automated run will overwrite it, and nothing anywhere
 * else says so. Another shares a scope with it, so the seed also shows that one
 * price row serves every shop that warehouse supplies.
 *
 * `unitPrice` is the source's own figure and is deliberately not
 * `price / unitSize` on every row: the two disagree on 110 of 4,232 real
 * products, and a seed where they always agreed would make the rule against
 * deriving it look like pedantry.
 */
export const PRICE_SEED: readonly Wire.CatalogSupermarketItemView[] = [
  {
    id: 'si_1',
    itemId: 'it_milk_hacendado_1l',
    priceScopeId: 'ps_mercadona_4661',
    price: 0.89,
    currency: 'EUR',
    unitPrice: 0.89,
    unitPriceLabel: '1 L',
    priceObservedAt: '2026-09-01T05:12:00.000Z',
    priceSourceKind: 'OFFICIAL_API',
    available: true,
  },
  {
    id: 'si_2',
    itemId: 'it_milk_pascual_6x1l',
    priceScopeId: 'ps_mercadona_4661',
    price: 6.54,
    currency: 'EUR',
    // Not 6.54 / 6. The source publishes its own normalized figure and it is
    // stored verbatim.
    unitPrice: 1.0899,
    unitPriceLabel: '1 L',
    priceObservedAt: '2026-09-01T05:12:00.000Z',
    priceSourceKind: 'OFFICIAL_API',
    available: true,
  },
  {
    id: 'si_3',
    itemId: 'it_oil_carbonell_1l',
    priceScopeId: 'ps_mercadona_mad3',
    price: 8.45,
    currency: 'EUR',
    unitPrice: 8.45,
    unitPriceLabel: '1 L',
    // Typed by a person, and therefore pinned: no run will write over it, and
    // this row is what the ADMIN filter is for.
    priceObservedAt: '2026-08-14T10:02:00.000Z',
    priceSourceKind: 'ADMIN',
    available: true,
  },
  {
    id: 'si_4',
    itemId: 'it_detergent_ariel_lv',
    priceScopeId: 'ps_consum_national',
    price: 11.99,
    currency: 'EUR',
    unitPrice: 0.2998,
    // Free text and not a unit: this one counts washing machine loads.
    unitPriceLabel: 'lv',
    priceObservedAt: '2026-08-31T22:40:00.000Z',
    priceSourceKind: 'OFFICIAL_WEB',
    available: false,
  },
];
