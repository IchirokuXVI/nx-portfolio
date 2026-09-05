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
 * Effective prices: the row a shopper sees for each (product, scope), chosen
 * among the rows in {@link ITEM_PRICE_SEED} (backend plan 0080, section 7).
 *
 * The second row is `ADMIN` and it **won**: somebody typed 8.45 over a crawl
 * that said 8.9, and the crawl has repeated 8.9 since, which is what the
 * seven day protection is for. The first is a crawl price shown on
 * sufferance: its source has not confirmed it for a week, so it is flagged
 * stale rather than hidden. With nothing listening these are what make "what
 * have I overridden" and "what is out of date" real on the screen.
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
    observedAt: '2026-08-20T06:12:00.000Z',
    sourceKind: 'OFFICIAL_API',
    // Nothing current prices it: the crawl stopped a fortnight ago.
    stale: true,
    validUntil: null,
    itemPriceId: 'ip_milk_4661_api',
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
    observedAt: '2026-09-03T09:40:00.000Z',
    // Typed in, protected, and undisputed: the crawl still says what it said.
    sourceKind: 'ADMIN',
    stale: false,
    validUntil: null,
    itemPriceId: 'ip_oil_4661_admin',
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
    observedAt: '2026-08-28T18:05:00.000Z',
    sourceKind: 'ADMIN',
    stale: false,
    validUntil: null,
    itemPriceId: 'ip_milk_consum_admin',
    available: false,
  },
];

/**
 * Every price a source gave (backend plan 0080, section 2): the rows behind
 * {@link PRICE_SEED}, newest first within a pair.
 *
 * The olive oil pair is the case plan 0080 section 4.2 is about: a crawl said
 * 8.9, the operator typed 8.45 and the row recorded what it overrode, and the
 * crawl confirmed 8.9 twice since. The snapshot is what keeps 8.45 shown.
 */
export const ITEM_PRICE_SEED: readonly Wire.CatalogItemPriceView[] = [
  {
    id: 'ip_oil_4661_admin',
    itemId: 'it_olive_oil_1l',
    priceScopeId: 'ps_mercadona_4661',
    sourceKind: 'ADMIN',
    price: 8.45,
    currency: 'EUR',
    unitPrice: 8.45,
    unitPriceLabel: '1 L',
    observedAt: '2026-09-03T09:40:00.000Z',
    lastObservedAt: '2026-09-03T09:40:00.000Z',
    validFrom: null,
    validUntil: null,
    sourceRunId: null,
    lastObservedRunId: null,
    overrides: { OFFICIAL_API: { price: 8.9, unitPrice: 8.9 } },
    protectedUntil: '2026-09-10T09:40:00.000Z',
  },
  {
    id: 'ip_oil_4661_api',
    itemId: 'it_olive_oil_1l',
    priceScopeId: 'ps_mercadona_4661',
    sourceKind: 'OFFICIAL_API',
    price: 8.9,
    currency: 'EUR',
    unitPrice: 8.9,
    unitPriceLabel: '1 L',
    observedAt: '2026-09-01T06:12:00.000Z',
    lastObservedAt: '2026-09-05T06:12:00.000Z',
    validFrom: null,
    validUntil: null,
    sourceRunId: 'run_2026_09_01',
    lastObservedRunId: 'run_2026_09_05',
    overrides: null,
    protectedUntil: null,
  },
  {
    id: 'ip_milk_4661_api',
    itemId: 'it_milk_1l',
    priceScopeId: 'ps_mercadona_4661',
    sourceKind: 'OFFICIAL_API',
    price: 0.89,
    currency: 'EUR',
    unitPrice: 0.89,
    unitPriceLabel: '1 L',
    observedAt: '2026-08-12T06:12:00.000Z',
    lastObservedAt: '2026-08-20T06:12:00.000Z',
    validFrom: null,
    validUntil: null,
    sourceRunId: 'run_2026_08_12',
    lastObservedRunId: 'run_2026_08_20',
    overrides: null,
    protectedUntil: null,
  },
  {
    id: 'ip_milk_consum_admin',
    itemId: 'it_milk_1l',
    priceScopeId: 'ps_consum_centro',
    sourceKind: 'ADMIN',
    price: 1.05,
    currency: 'EUR',
    unitPrice: 1.05,
    unitPriceLabel: '1 L',
    observedAt: '2026-08-28T18:05:00.000Z',
    lastObservedAt: '2026-08-28T18:05:00.000Z',
    validFrom: null,
    validUntil: null,
    sourceRunId: null,
    lastObservedRunId: null,
    // Nothing automated prices Consum, so there was nothing to override.
    overrides: {},
    protectedUntil: '2026-09-04T18:05:00.000Z',
  },
];

/** The six policy rows, as the migration seeds them (backend plan 0080, section 3). */
export const PRICE_POLICY_SEED: readonly Wire.CatalogPricePolicyView[] = [
  { sourceKind: 'OFFICIAL_LEAFLET', priority: 10, maxAgeDays: null, enabled: true },
  { sourceKind: 'OFFICIAL_API', priority: 20, maxAgeDays: 7, enabled: true },
  { sourceKind: 'OFFICIAL_WEB', priority: 30, maxAgeDays: 7, enabled: true },
  { sourceKind: 'ADMIN', priority: 40, maxAgeDays: null, enabled: true },
  { sourceKind: 'USER_RECEIPT', priority: 50, maxAgeDays: null, enabled: true },
  { sourceKind: 'USER_REPORTED', priority: 60, maxAgeDays: null, enabled: false },
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
