import type { Wire } from '@portfolio/luna-shopper-admin/models';

/**
 * Shops to show when there is no backend.
 *
 * All four states of a postal code are here, because the list's whole job is to
 * keep them apart: one published by the shop, one a person typed, one guessed
 * from the nearest centroid, and one that has neither a code nor a source
 * because the nearest centroid was too far away to be worth believing.
 */
export const LOCATION_SEED: readonly Wire.CatalogSupermarketLocationView[] = [
  {
    id: 'loc_mercadona_cordoba_centro',
    supermarketId: 'sm_mercadona',
    priceScopeId: 'ps_mercadona_4661',
    label: null,
    address: 'Avenida del Gran Capitán 12',
    city: 'Córdoba',
    country: 'ES',
    postalCode: '14001',
    postalCodeSource: 'SOURCE',
    latitude: 37.8882,
    longitude: -4.7794,
    externalRef: 'node/1156230891',
    externalProvider: 'osm-places',
  },
  {
    id: 'loc_mercadona_cordoba_sur',
    supermarketId: 'sm_mercadona',
    // The same warehouse as the shop above: one price row serves both, which is
    // the whole reason a price is not attached to a shop.
    priceScopeId: 'ps_mercadona_4661',
    label: null,
    address: 'Calle Sevilla 3',
    city: 'Córdoba',
    country: 'ES',
    // Guessed from the nearest centroid rather than known, which is what the
    // review filter lists.
    postalCode: '14013',
    postalCodeSource: 'DERIVED',
    latitude: 37.8701,
    longitude: -4.7912,
    externalRef: 'way/442310087',
    externalProvider: 'osm-places',
  },
  {
    id: 'loc_mercadona_madrid_chamberi',
    supermarketId: 'sm_mercadona',
    priceScopeId: 'ps_mercadona_mad3',
    label: null,
    address: 'Calle de Bravo Murillo 45',
    city: 'Madrid',
    country: 'ES',
    postalCode: '28015',
    postalCodeSource: 'MANUAL',
    latitude: 40.4359,
    longitude: -3.7038,
    externalRef: null,
    externalProvider: null,
  },
  {
    id: 'loc_bonpreu_bcn_gracia',
    supermarketId: 'sm_bonpreu',
    priceScopeId: 'ps_bonpreu_bcn_gracia',
    label: { en: 'Gràcia', es: 'Gràcia' },
    address: 'Carrer Gran de Gràcia 100',
    city: 'Barcelona',
    country: 'ES',
    // Neither a code nor a source: the nearest centroid was beyond the bound, so
    // nothing was written. A wrong postcode is worse than none.
    postalCode: null,
    postalCodeSource: null,
    latitude: 41.4029,
    longitude: 2.1553,
    externalRef: 'node/3391827445',
    externalProvider: 'osm-places',
  },
];
