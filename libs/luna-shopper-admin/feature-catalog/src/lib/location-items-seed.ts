import type { Wire } from '@portfolio/luna-shopper-admin/models';

/**
 * Aisle positions to show when there is no backend.
 *
 * All three states of the override, because the three are the point: a shop
 * where somebody checked and it was there, one where somebody checked and it
 * was not, and one that says nothing and defers to whatever the price scope
 * claims.
 */
export const LOCATION_ITEM_SEED: readonly Wire.CatalogSupermarketLocationItemView[] =
  [
    {
      id: 'li_1',
      itemId: 'it_milk_hacendado_1l',
      supermarketLocationId: 'loc_mercadona_cordoba_centro',
      positionInStore: 'Aisle 4, bottom shelf',
      available: true,
    },
    {
      id: 'li_2',
      itemId: 'it_oil_carbonell_1l',
      supermarketLocationId: 'loc_mercadona_cordoba_centro',
      positionInStore: 'Aisle 7',
      // Somebody checked this shop and it was not there, which is a stronger
      // claim than the scope's.
      available: false,
    },
    {
      id: 'li_3',
      itemId: 'it_milk_pascual_6x1l',
      supermarketLocationId: 'loc_mercadona_cordoba_centro',
      positionInStore: 'Aisle 4, top shelf',
      // Nobody has checked here, so the scope's answer stands.
      available: null,
    },
    {
      id: 'li_4',
      itemId: 'it_milk_hacendado_1l',
      supermarketLocationId: 'loc_mercadona_cordoba_sur',
      positionInStore: null,
      available: null,
    },
  ];
