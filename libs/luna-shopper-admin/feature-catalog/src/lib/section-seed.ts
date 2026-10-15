import { seededCategoryId } from '@portfolio/luna-shopper-admin/data-access';
import type { Wire } from '@portfolio/luna-shopper-admin/models';

/**
 * The sections of shops, as they look with no backend listening (backend plan
 * 0200; admin plan 0063, section 1).
 *
 * A section belongs to one shop. Two shops of one chain hold different
 * sections, and a shop with none has none: nothing is inherited from the
 * chain. That is the least that reaches every branch of the screens:
 *
 * - **Córdoba Centro** has Chilled, which covers the root
 *   `eggs-milk-and-butter` and so every category inside it, then Offers,
 *   which covers no category and so holds no product.
 * - **Córdoba Oeste** has Pantry, which covers the leaf `oils`, then a
 *   Chilled of its own that covers only `milk`. Its slug is the slug of
 *   Centro's Chilled, which two shops may share.
 * - **Sierra**, a third Mercadona shop, and the Consum shop have none.
 */

/** The seeded sections' ids, for the specs that name them. */
export const SEEDED_SECTION = {
  centroChilled: 'sec_centro_chilled',
  centroOffers: 'sec_centro_offers',
  oestePantry: 'sec_oeste_pantry',
  oesteChilled: 'sec_oeste_chilled',
} as const;

export const SECTION_SEED: readonly Wire.CatalogShopSectionView[] = [
  {
    id: SEEDED_SECTION.centroChilled,
    supermarketLocationId: 'loc_cordoba_centro',
    slug: 'chilled',
    name: { en: 'Chilled', es: 'Refrigerados' },
    position: 0,
    categoryIds: [seededCategoryId('eggs-milk-and-butter')],
  },
  {
    id: SEEDED_SECTION.centroOffers,
    supermarketLocationId: 'loc_cordoba_centro',
    slug: 'offers',
    name: { en: 'Offers', es: 'Ofertas' },
    position: 1,
    categoryIds: [],
  },
  {
    id: SEEDED_SECTION.oestePantry,
    supermarketLocationId: 'loc_cordoba_oeste',
    slug: 'pantry',
    name: { en: 'Pantry', es: 'Despensa' },
    position: 0,
    categoryIds: [seededCategoryId('oils')],
  },
  {
    id: SEEDED_SECTION.oesteChilled,
    supermarketLocationId: 'loc_cordoba_oeste',
    slug: 'chilled',
    name: { en: 'Chilled', es: 'Refrigerados' },
    position: 1,
    categoryIds: [seededCategoryId('milk')],
  },
];
