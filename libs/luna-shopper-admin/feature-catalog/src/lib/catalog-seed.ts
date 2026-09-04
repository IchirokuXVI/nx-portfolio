import type { Wire } from '@portfolio/luna-shopper-admin/models';

/**
 * The catalog, as it looks with no backend listening.
 *
 * Every data domain in this workspace ships an in-memory implementation, and
 * this is the catalog's share of it: six resources whose lists, forms,
 * pagination, filters and delete confirmations can all be driven from a
 * checkout with nothing on the gateway port.
 *
 * One file for the six, the way `people-seed.ts` holds four, because the rows
 * **refer to each other**. A price points at a product and a scope, a shop
 * points at a chain and a scope, and a seed split six ways would be six files
 * quoting each other's identifiers with nothing to keep them agreeing.
 *
 * The ids are readable rather than uuids, and the data is real: Mercadona really
 * does price per warehouse, which is the fact the price screen is shaped around,
 * so a seed of `scope-1` and `scope-2` would demonstrate nothing about the thing
 * an operator most needs to understand.
 */

/** Chains, matching the identifiers in `supermarkets-seed.ts`. */
const MERCADONA = 'sm_mercadona';
const CONSUM = 'sm_consum';

/**
 * Scopes.
 *
 * Mercadona is a warehouse chain: one scope, several shops, one price for all
 * of them. Consum has no automated source here, so it gets a `STORE` scope of
 * its own per shop, which is exactly how a hand typed price is made to work with
 * no special case.
 */
export const PRICE_SCOPE_SEED: readonly Wire.CatalogPriceScopeView[] = [
  {
    id: 'ps_mercadona_4661',
    supermarketId: MERCADONA,
    kind: 'WAREHOUSE',
    externalKey: '4661',
    label: { en: 'Córdoba warehouse', es: 'Almacén de Córdoba' },
  },
  {
    id: 'ps_mercadona_3421',
    supermarketId: MERCADONA,
    kind: 'WAREHOUSE',
    externalKey: '3421',
    label: null,
  },
  {
    id: 'ps_consum_centro',
    supermarketId: CONSUM,
    kind: 'STORE',
    externalKey: null,
    label: null,
  },
];

/**
 * Shops, and the three postal code states of section 3.
 *
 * The first is known, the second was guessed from the nearest centroid, and the
 * third has none at all because the nearest centroid was beyond the bound. The
 * third is a deliberate state and not an error, and a screen that collapsed it
 * into the second would be telling an operator to go and check something that
 * has already been decided.
 */
export const LOCATION_SEED: readonly Wire.CatalogSupermarketLocationView[] = [
  {
    id: 'loc_cordoba_centro',
    supermarketId: MERCADONA,
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
    externalProvider: 'osm',
  },
  {
    id: 'loc_cordoba_oeste',
    supermarketId: MERCADONA,
    priceScopeId: 'ps_mercadona_4661',
    label: null,
    address: 'Calle Historiador Domínguez Ortiz 4',
    city: 'Córdoba',
    country: 'ES',
    // Guessed from the nearest centroid, which is what the filter looks for.
    postalCode: '14005',
    postalCodeSource: 'DERIVED',
    latitude: 37.8759,
    longitude: -4.8012,
    externalRef: 'way/48821004',
    externalProvider: 'osm',
  },
  {
    id: 'loc_sierra',
    supermarketId: MERCADONA,
    priceScopeId: 'ps_mercadona_3421',
    label: null,
    address: 'Carretera de Trassierra km 8',
    city: null,
    country: 'ES',
    // Neither known nor guessed. The nearest centroid was too far away, and a
    // wrong postcode is worse than none.
    postalCode: null,
    postalCodeSource: null,
    latitude: 37.9312,
    longitude: -4.8871,
    externalRef: 'node/9920011234',
    externalProvider: 'osm',
  },
  {
    id: 'loc_consum_centro',
    supermarketId: CONSUM,
    priceScopeId: 'ps_consum_centro',
    label: { en: 'Consum Centro', es: 'Consum Centro' },
    address: 'Calle Cruz Conde 20',
    city: 'Córdoba',
    country: 'ES',
    postalCode: '14003',
    postalCodeSource: 'MANUAL',
    latitude: 37.8867,
    longitude: -4.7823,
    externalRef: null,
    externalProvider: null,
  },
];

/** Groups: what makes two products comparable. */
export const PRODUCT_GROUP_SEED: readonly Wire.CatalogProductGroupView[] = [
  {
    id: 'pg_whole_milk',
    name: { en: 'Whole milk', es: 'Leche entera' },
    slug: 'whole-milk',
    referenceUnit: 'LITER',
    synonyms: {
      en: ['full fat milk', 'whole fat milk'],
      es: ['leche entera', 'leche completa'],
    },
  },
  {
    id: 'pg_olive_oil',
    name: { en: 'Olive oil', es: 'Aceite de oliva' },
    slug: 'olive-oil',
    referenceUnit: 'LITER',
    synonyms: { en: ['virgin olive oil'], es: ['aceite de oliva virgen'] },
  },
];

/**
 * Products.
 *
 * The last one belongs to no group on purpose. That is the resting state of a
 * freshly harvested product rather than a fault, and it is what the item list's
 * "belonging to no group" filter is for.
 */
export const ITEM_SEED: readonly Wire.CatalogItemView[] = [
  {
    id: 'it_milk_1l',
    name: { en: 'Whole milk 1 L', es: 'Leche entera 1 L' },
    brand: 'Hacendado',
    imageUrl: null,
    sku: '12345',
    ean: '8480000123459',
    unitSize: 1,
    category: 'DAIRY',
    defaultUnit: 'LITER',
    productGroupId: 'pg_whole_milk',
  },
  {
    id: 'it_milk_6pack',
    name: { en: 'Whole milk 6 × 1 L', es: 'Leche entera 6 × 1 L' },
    brand: 'Hacendado',
    imageUrl: null,
    sku: '12346',
    ean: '8480000123466',
    unitSize: 6,
    category: 'DAIRY',
    defaultUnit: 'LITER',
    productGroupId: 'pg_whole_milk',
  },
  {
    id: 'it_olive_oil_1l',
    name: {
      en: 'Extra virgin olive oil 1 L',
      es: 'Aceite de oliva virgen extra 1 L',
    },
    brand: 'Hacendado',
    imageUrl: null,
    sku: '22001',
    ean: '8480000220011',
    unitSize: 1,
    category: 'PANTRY',
    defaultUnit: 'LITER',
    productGroupId: 'pg_olive_oil',
  },
  {
    id: 'it_dish_soap',
    name: { en: 'Dishwashing liquid 750 ml', es: 'Lavavajillas 750 ml' },
    brand: 'Bosque Verde',
    imageUrl: null,
    sku: '31007',
    ean: '8480000310071',
    unitSize: 750,
    category: 'HOUSEHOLD',
    defaultUnit: 'MILLILITER',
    // Curation has not reached it. Nothing is wrong with this row.
    productGroupId: null,
  },
];

/**
 * Prices, and the pin that plan 0005 section 4 exists for.
 *
 * The second row is `ADMIN`: somebody typed it, and no automated fetch will
 * overwrite it until the price is cleared again. With nothing listening it is
 * what makes "list everything I have pinned" and "revert this one" real on the
 * screen rather than only in the gateway.
 *
 * `unitPrice` is the source's own number and is **not** `price / unitSize`. The
 * obvious derivation disagrees with the source on 110 of 4,232 products, so the
 * seed does not derive it either.
 */
export const PRICE_SEED: readonly Wire.CatalogSupermarketItemView[] = [
  {
    id: 'si_milk_4661',
    itemId: 'it_milk_1l',
    priceScopeId: 'ps_mercadona_4661',
    price: 0.89,
    currency: 'EUR',
    unitPrice: 0.89,
    unitPriceLabel: '1 L',
    priceObservedAt: '2026-08-30T06:12:00.000Z',
    priceSourceKind: 'OFFICIAL_API',
    available: true,
  },
  {
    id: 'si_oil_4661',
    itemId: 'it_olive_oil_1l',
    priceScopeId: 'ps_mercadona_4661',
    price: 8.45,
    currency: 'EUR',
    unitPrice: 8.45,
    unitPriceLabel: '1 L',
    priceObservedAt: '2026-07-14T09:40:00.000Z',
    // Typed in, and therefore permanent until somebody clears it.
    priceSourceKind: 'ADMIN',
    available: true,
  },
  {
    id: 'si_milk_consum',
    itemId: 'it_milk_1l',
    priceScopeId: 'ps_consum_centro',
    price: 1.05,
    currency: 'EUR',
    unitPrice: 1.05,
    unitPriceLabel: '1 L',
    priceObservedAt: '2026-08-28T18:05:00.000Z',
    priceSourceKind: 'ADMIN',
    available: false,
  },
];

/**
 * Where a product sits in one shop, and the per shop override.
 *
 * The three rows are the three answers `available` has here: yes, no, and null
 * meaning nobody has checked this shop and the scope's answer stands. The third
 * is the ordinary one.
 */
export const LOCATION_ITEM_SEED: readonly Wire.CatalogSupermarketLocationItemView[] =
  [
    {
      id: 'sli_milk_centro',
      itemId: 'it_milk_1l',
      supermarketLocationId: 'loc_cordoba_centro',
      positionInStore: 'Aisle 4, cold shelf',
      available: true,
    },
    {
      id: 'sli_oil_centro',
      itemId: 'it_olive_oil_1l',
      supermarketLocationId: 'loc_cordoba_centro',
      positionInStore: 'Aisle 7',
      available: false,
    },
    {
      id: 'sli_milk_oeste',
      itemId: 'it_milk_1l',
      supermarketLocationId: 'loc_cordoba_oeste',
      positionInStore: null,
      // Nobody has checked this shop. Not the same as "not available here".
      available: null,
    },
  ];
