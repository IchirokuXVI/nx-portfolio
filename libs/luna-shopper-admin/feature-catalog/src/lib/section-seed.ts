import { seededCategoryId } from '@portfolio/luna-shopper-admin/data-access';
import type { Wire } from '@portfolio/luna-shopper-admin/models';

/**
 * Shop sections, as they look with no backend listening (admin plan 0037,
 * target 6; backend plan 0167).
 *
 * Two sections of Mercadona, one shop with an order of its own, and one pin,
 * which is the least that reaches every branch of the rule:
 *
 * - **Offers** covers no category at all. It is the aisle by the entrance that
 *   holds whatever is on offer, so a product is only ever in it by a pin.
 * - **Chilled** covers the root `eggs-milk-and-butter`, which means every category
 *   inside it: the milk is there by its leaf `milk`, with nothing configured.
 * - **The olive oil is pinned to Offers** in Mercadona, so at any Mercadona
 *   shop it is in Offers and nowhere else.
 * - **Córdoba Centro walks them the other way round.** The other two Mercadona
 *   shops have no list of their own and inherit the chain's order.
 *
 * Consum has no sections, so anything asked about at its shop is shown under
 * its own categories.
 */

const MERCADONA = 'sm_mercadona';

/** The seeded sections' ids, for the specs that name them. */
export const SEEDED_SECTION = {
  offers: 'sec_mercadona_offers',
  chilled: 'sec_mercadona_chilled',
} as const;

export const SECTION_SEED: readonly Wire.CatalogSupermarketSectionView[] = [
  {
    id: SEEDED_SECTION.offers,
    supermarketId: MERCADONA,
    slug: 'offers',
    name: { en: 'Offers', es: 'Ofertas' },
    position: 0,
    categoryIds: [],
    // All three Mercadona shops: Centro names it, the other two inherit it.
    locationCount: 3,
  },
  {
    id: SEEDED_SECTION.chilled,
    supermarketId: MERCADONA,
    slug: 'chilled',
    name: { en: 'Chilled', es: 'Refrigerados' },
    position: 1,
    categoryIds: [seededCategoryId('eggs-milk-and-butter')],
    locationCount: 3,
  },
];

/**
 * One shop's own ordered list, keyed on the shop. A shop with no row here
 * inherits its chain's sections in the chain's order.
 */
export type LocationSectionList = {
  readonly id: string;
  readonly sectionIds: readonly string[];
};

export const LOCATION_SECTION_LIST_SEED: readonly LocationSectionList[] = [
  {
    id: 'loc_cordoba_centro',
    sectionIds: [SEEDED_SECTION.chilled, SEEDED_SECTION.offers],
  },
];

/** One product's pins in one chain. */
export type ItemSectionPin = {
  readonly supermarketId: string;
  readonly itemId: string;
  readonly sectionIds: readonly string[];
};

export const ITEM_SECTION_PIN_SEED: readonly ItemSectionPin[] = [
  {
    supermarketId: MERCADONA,
    itemId: 'it_olive_oil_1l',
    sectionIds: [SEEDED_SECTION.offers],
  },
];
