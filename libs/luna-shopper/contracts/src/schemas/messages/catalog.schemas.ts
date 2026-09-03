import {
  ItemCategory,
  PostalCodeSource,
  PriceScopeKind,
  PriceSourceKind,
  UnitOfMeasure,
} from '../../lib/enums/catalog.enums';
import {
  CATALOG_SUGGESTION_KINDS,
  ITEM_PATTERNS,
  POSTAL_CODE_PATTERNS,
  PRICE_SCOPE_PATTERNS,
  PRODUCT_GROUP_PATTERNS,
  SCOPE_ORIGINS,
  SUPERMARKET_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  SUPERMARKET_PATTERNS,
} from '../../lib/messages/catalog.messages';
// The one bound a suggestion's product set has to respect, taken from the line it
// will become rather than restated here, so the two cannot drift apart.
import { LINE_ITEM_SET_MAX } from '../../lib/messages/list.messages';
import {
  array,
  boolean,
  enumOf,
  integer,
  JsonSchema,
  nonEmptyString,
  nullableString,
  object,
  paginated,
  ref,
  schemaId,
  string,
} from '../builders';
import { adminCredentialProperties, COMMON_IDS } from '../common.schemas';

/**
 * Catalog schemas (plan 0012): supermarkets, locations, items and per-location
 * prices. Writes are owner only; reads open. Localized text fields carry EN + ES.
 */
export const CATALOG_SCHEMA_IDS = {
  itemCategory: schemaId('enums/ItemCategory'),
  unitOfMeasure: schemaId('enums/UnitOfMeasure'),
  priceScopeKind: schemaId('enums/PriceScopeKind'),
  priceSourceKind: schemaId('enums/PriceSourceKind'),
  postalCodeSource: schemaId('enums/PostalCodeSource'),
  localizedText: schemaId('catalog/LocalizedText'),
  localizedSynonyms: schemaId('catalog/LocalizedSynonyms'),
  productGroupView: schemaId('catalog/ProductGroupView'),
  itemOfferView: schemaId('catalog/ItemOfferView'),
  productGroupOfferView: schemaId('catalog/ProductGroupOfferView'),
  productGroupPage: schemaId('catalog/ProductGroupPage'),
  productGroupOfferPage: schemaId('catalog/ProductGroupOfferPage'),
  catalogSuggestion: schemaId('catalog/CatalogSuggestion'),
  catalogSuggestResponse: schemaId('catalog/CatalogSuggestResponse'),
  createProductGroupRequest: schemaId('msg/productGroup.create/request'),
  updateProductGroupRequest: schemaId('msg/productGroup.update/request'),
  productGroupIdRequest: schemaId('msg/productGroup.id/request'),
  listProductGroupsRequest: schemaId('msg/productGroup.list/request'),
  searchOffersRequest: schemaId('msg/item.searchOffers/request'),
  supermarketView: schemaId('catalog/SupermarketView'),
  supermarketLocationView: schemaId('catalog/SupermarketLocationView'),
  priceScopeView: schemaId('catalog/PriceScopeView'),
  itemView: schemaId('catalog/ItemView'),
  supermarketItemView: schemaId('catalog/SupermarketItemView'),
  supermarketLocationItemView: schemaId('catalog/SupermarketLocationItemView'),
  supermarketPage: schemaId('catalog/SupermarketPage'),
  supermarketLocationPage: schemaId('catalog/SupermarketLocationPage'),
  priceScopePage: schemaId('catalog/PriceScopePage'),
  itemPage: schemaId('catalog/ItemPage'),
  supermarketItemPage: schemaId('catalog/SupermarketItemPage'),
  supermarketLocationItemPage: schemaId('catalog/SupermarketLocationItemPage'),
  createSupermarketRequest: schemaId('msg/supermarket.create/request'),
  updateSupermarketRequest: schemaId('msg/supermarket.update/request'),
  supermarketIdRequest: schemaId('msg/supermarket.id/request'),
  listSupermarketsRequest: schemaId('msg/supermarket.list/request'),
  createLocationRequest: schemaId('msg/supermarketLocation.create/request'),
  updateLocationRequest: schemaId('msg/supermarketLocation.update/request'),
  locationIdRequest: schemaId('msg/supermarketLocation.id/request'),
  listLocationsRequest: schemaId('msg/supermarketLocation.list/request'),
  createItemRequest: schemaId('msg/item.create/request'),
  updateItemRequest: schemaId('msg/item.update/request'),
  itemIdRequest: schemaId('msg/item.id/request'),
  /** Several products by id, for the basket screen (plan 0051, section 6.1). */
  getItemsRequest: schemaId('msg/item.getMany/request'),
  getItemsResult: schemaId('msg/item.getMany/response'),
  searchItemsRequest: schemaId('msg/item.search/request'),
  findItemByEanRequest: schemaId('msg/item.findByEan/request'),
  findItemByEanResult: schemaId('catalog/FindItemByEanResult'),
  upsertSupermarketItemRequest: schemaId('msg/supermarketItem.upsert/request'),
  upsertSupermarketItemBatchRequest: schemaId(
    'msg/supermarketItem.upsertBatch/request'
  ),
  supermarketItemBatchEntry: schemaId('catalog/SupermarketItemBatchEntry'),
  supermarketItemPriceDisagreement: schemaId(
    'catalog/SupermarketItemPriceDisagreement'
  ),
  upsertSupermarketItemBatchResult: schemaId(
    'catalog/UpsertSupermarketItemBatchResult'
  ),
  supermarketItemIdRequest: schemaId('msg/supermarketItem.id/request'),
  getSupermarketItemRequest: schemaId('msg/supermarketItem.get/request'),
  listByItemRequest: schemaId('msg/supermarketItem.listByItem/request'),
  listByLocationRequest: schemaId('msg/supermarketItem.listByLocation/request'),
  listByScopeRequest: schemaId('msg/supermarketItem.listByScope/request'),
  createPriceScopeRequest: schemaId('msg/priceScope.create/request'),
  updatePriceScopeRequest: schemaId('msg/priceScope.update/request'),
  priceScopeIdRequest: schemaId('msg/priceScope.id/request'),
  listPriceScopesRequest: schemaId('msg/priceScope.list/request'),
  resolvePriceScopesRequest: schemaId('msg/priceScope.resolve/request'),
  resolvedScopeView: schemaId('catalog/ResolvedScopeView'),
  postalCodeCoverageView: schemaId('catalog/PostalCodeCoverageView'),
  resolvedScopesView: schemaId('catalog/ResolvedScopesView'),
  catalogScopeView: schemaId('catalog/CatalogScopeView'),
  postalCodeDistanceView: schemaId('catalog/PostalCodeDistanceView'),
  resolveNearestPostalCodeRequest: schemaId('msg/postalCode.nearest/request'),
  nearestPostalCodeView: schemaId('catalog/NearestPostalCodeView'),
  listNearbyPostalCodesRequest: schemaId('msg/postalCode.nearby/request'),
  nearbyPostalCodesView: schemaId('catalog/NearbyPostalCodesView'),
  countLocationsByPostalCodeRequest: schemaId(
    'msg/supermarketLocation.countByPostalCode/request'
  ),
  postalCodeLocationCount: schemaId('catalog/PostalCodeLocationCount'),
  postalCodeLocationCountsView: schemaId(
    'catalog/PostalCodeLocationCountsView'
  ),
  // The shops in your postal codes (plan 0068).
  summarizeLocationsByChainRequest: schemaId(
    'msg/supermarketLocation.summarizeByChain/request'
  ),
  supermarketLocationChainSummaryView: schemaId(
    'catalog/SupermarketLocationChainSummaryView'
  ),
  supermarketLocationChainSummariesView: schemaId(
    'catalog/SupermarketLocationChainSummariesView'
  ),
  shopChainSummaryView: schemaId('catalog/ShopChainSummaryView'),
  shopChainSummariesView: schemaId('catalog/ShopChainSummariesView'),
  searchShopsRequest: schemaId('msg/supermarketLocation.search/request'),
  shopView: schemaId('catalog/ShopView'),
  shopPage: schemaId('catalog/ShopPage'),
  upsertLocationItemRequest: schemaId(
    'msg/supermarketLocationItem.upsert/request'
  ),
  getLocationItemRequest: schemaId('msg/supermarketLocationItem.get/request'),
  listLocationItemsRequest: schemaId(
    'msg/supermarketLocationItem.listByLocation/request'
  ),
} as const;

const numberOrNull = (): JsonSchema => ({ type: ['number', 'null'] });
const nullableLocalized = (): JsonSchema => ({
  anyOf: [ref(CATALOG_SCHEMA_IDS.localizedText), { type: 'null' }],
});

const localizedText = object(
  CATALOG_SCHEMA_IDS.localizedText,
  { en: nonEmptyString(), es: nonEmptyString() },
  ['en', 'es']
);

/** Per locale alternative words, so `leche` and `milk` reach one group (0048). */
const localizedSynonyms = object(
  CATALOG_SCHEMA_IDS.localizedSynonyms,
  { en: array(string()), es: array(string()) },
  ['en', 'es']
);

// --- Views -----------------------------------------------------------------

const supermarketView = object(
  CATALOG_SCHEMA_IDS.supermarketView,
  {
    id: nonEmptyString(),
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    logoUrl: nullableString(),
    websiteUrl: nullableString(),
    externalBrandKey: nullableString(),
    // The last rung of the scope ladder (plan 0049, section 3.1).
    defaultPriceScopeId: nullableString(),
  },
  [
    'id',
    'name',
    'logoUrl',
    'websiteUrl',
    'externalBrandKey',
    'defaultPriceScopeId',
  ]
);

const supermarketLocationView = object(
  CATALOG_SCHEMA_IDS.supermarketLocationView,
  {
    id: nonEmptyString(),
    supermarketId: nonEmptyString(),
    priceScopeId: nonEmptyString(),
    label: nullableLocalized(),
    address: nullableString(),
    city: nullableString(),
    country: nullableString(),
    postalCode: nullableString(),
    // Plan 0061, section 5: null wherever the code is, DERIVED where catalog
    // took the nearest centroid rather than being told.
    postalCodeSource: {
      anyOf: [ref(CATALOG_SCHEMA_IDS.postalCodeSource), { type: 'null' }],
    },
    latitude: numberOrNull(),
    longitude: numberOrNull(),
    externalRef: nullableString(),
    externalProvider: nullableString(),
  },
  [
    'id',
    'supermarketId',
    'priceScopeId',
    'label',
    'address',
    'city',
    'country',
    'postalCode',
    'postalCodeSource',
    'latitude',
    'longitude',
    'externalRef',
    'externalProvider',
  ]
);

const priceScopeView = object(
  CATALOG_SCHEMA_IDS.priceScopeView,
  {
    id: nonEmptyString(),
    supermarketId: nonEmptyString(),
    kind: ref(CATALOG_SCHEMA_IDS.priceScopeKind),
    externalKey: nullableString(),
    label: nullableLocalized(),
  },
  ['id', 'supermarketId', 'kind', 'externalKey', 'label']
);

const productGroupView = object(
  CATALOG_SCHEMA_IDS.productGroupView,
  {
    id: nonEmptyString(),
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    slug: nonEmptyString(),
    referenceUnit: ref(CATALOG_SCHEMA_IDS.unitOfMeasure),
    synonyms: ref(CATALOG_SCHEMA_IDS.localizedSynonyms),
  },
  ['id', 'name', 'slug', 'referenceUnit', 'synonyms']
);

/** A price a search result quotes, with the provenance that lets it be labelled. */
const itemOfferView = object(
  CATALOG_SCHEMA_IDS.itemOfferView,
  {
    itemId: nonEmptyString(),
    priceScopeId: nonEmptyString(),
    price: numberOrNull(),
    currency: nullableString(),
    unitPrice: numberOrNull(),
    unitPriceLabel: nullableString(),
    priceObservedAt: nullableString(),
    priceSourceKind: ref(CATALOG_SCHEMA_IDS.priceSourceKind),
  },
  [
    'itemId',
    'priceScopeId',
    'price',
    'currency',
    'unitPrice',
    'unitPriceLabel',
    'priceObservedAt',
    'priceSourceKind',
  ]
);

const itemView = object(
  CATALOG_SCHEMA_IDS.itemView,
  {
    id: nonEmptyString(),
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    brand: nullableString(),
    imageUrl: nullableString(),
    sku: nullableString(),
    ean: nullableString(),
    unitSize: numberOrNull(),
    category: ref(CATALOG_SCHEMA_IDS.itemCategory),
    defaultUnit: ref(CATALOG_SCHEMA_IDS.unitOfMeasure),
    productGroupId: nullableString(),
    // Deliberately NOT required: only the reads that take price scopes fill it,
    // and absent means the same as null (plan 0048, section 3.1).
    bestOffer: {
      anyOf: [ref(CATALOG_SCHEMA_IDS.itemOfferView), { type: 'null' }],
    },
  },
  [
    'id',
    'name',
    'brand',
    'imageUrl',
    'sku',
    'ean',
    'unitSize',
    'category',
    'defaultUnit',
    'productGroupId',
  ]
);

const productGroupOfferView = object(
  CATALOG_SCHEMA_IDS.productGroupOfferView,
  {
    group: ref(CATALOG_SCHEMA_IDS.productGroupView),
    cheapestItem: {
      anyOf: [ref(CATALOG_SCHEMA_IDS.itemView), { type: 'null' }],
    },
    offer: {
      anyOf: [ref(CATALOG_SCHEMA_IDS.itemOfferView), { type: 'null' }],
    },
    itemIds: { ...array(nonEmptyString()), maxItems: LINE_ITEM_SET_MAX },
  },
  ['group', 'cheapestItem', 'offer', 'itemIds']
);

const catalogSuggestion = object(
  CATALOG_SCHEMA_IDS.catalogSuggestion,
  {
    kind: { type: 'string', enum: [...CATALOG_SUGGESTION_KINDS] },
    group: {
      anyOf: [ref(CATALOG_SCHEMA_IDS.productGroupOfferView), { type: 'null' }],
    },
    item: { anyOf: [ref(CATALOG_SCHEMA_IDS.itemView), { type: 'null' }] },
  },
  ['kind', 'group', 'item']
);

const catalogSuggestResponse = object(
  CATALOG_SCHEMA_IDS.catalogSuggestResponse,
  { suggestions: array(ref(CATALOG_SCHEMA_IDS.catalogSuggestion)) },
  ['suggestions']
);

const supermarketItemView = object(
  CATALOG_SCHEMA_IDS.supermarketItemView,
  {
    id: nonEmptyString(),
    itemId: nonEmptyString(),
    priceScopeId: nonEmptyString(),
    price: numberOrNull(),
    currency: nullableString(),
    unitPrice: numberOrNull(),
    unitPriceLabel: nullableString(),
    priceObservedAt: nullableString(),
    priceSourceKind: ref(CATALOG_SCHEMA_IDS.priceSourceKind),
    available: boolean(),
  },
  [
    'id',
    'itemId',
    'priceScopeId',
    'price',
    'currency',
    'unitPrice',
    'unitPriceLabel',
    'priceObservedAt',
    'priceSourceKind',
    'available',
  ]
);

const supermarketLocationItemView = object(
  CATALOG_SCHEMA_IDS.supermarketLocationItemView,
  {
    id: nonEmptyString(),
    itemId: nonEmptyString(),
    supermarketLocationId: nonEmptyString(),
    positionInStore: nullableString(),
    available: { type: ['boolean', 'null'] },
  },
  ['id', 'itemId', 'supermarketLocationId', 'positionInStore', 'available']
);

const supermarketPage = paginated(
  CATALOG_SCHEMA_IDS.supermarketPage,
  CATALOG_SCHEMA_IDS.supermarketView
);
const supermarketLocationPage = paginated(
  CATALOG_SCHEMA_IDS.supermarketLocationPage,
  CATALOG_SCHEMA_IDS.supermarketLocationView
);
const itemPage = paginated(
  CATALOG_SCHEMA_IDS.itemPage,
  CATALOG_SCHEMA_IDS.itemView
);
const supermarketItemPage = paginated(
  CATALOG_SCHEMA_IDS.supermarketItemPage,
  CATALOG_SCHEMA_IDS.supermarketItemView
);
const priceScopePage = paginated(
  CATALOG_SCHEMA_IDS.priceScopePage,
  CATALOG_SCHEMA_IDS.priceScopeView
);
const supermarketLocationItemPage = paginated(
  CATALOG_SCHEMA_IDS.supermarketLocationItemPage,
  CATALOG_SCHEMA_IDS.supermarketLocationItemView
);
const productGroupPage = paginated(
  CATALOG_SCHEMA_IDS.productGroupPage,
  CATALOG_SCHEMA_IDS.productGroupView
);
const productGroupOfferPage = paginated(
  CATALOG_SCHEMA_IDS.productGroupOfferPage,
  CATALOG_SCHEMA_IDS.productGroupOfferView
);

// --- Requests --------------------------------------------------------------

const createSupermarketRequest = object(
  CATALOG_SCHEMA_IDS.createSupermarketRequest,
  {
    ...adminCredentialProperties,
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    logoUrl: nullableString(),
    websiteUrl: nullableString(),
    externalBrandKey: nullableString(),
  },
  ['userId', 'name']
);
const updateSupermarketRequest = object(
  CATALOG_SCHEMA_IDS.updateSupermarketRequest,
  {
    ...adminCredentialProperties,
    supermarketId: nonEmptyString(),
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    logoUrl: nullableString(),
    websiteUrl: nullableString(),
    externalBrandKey: nullableString(),
    defaultPriceScopeId: nullableString(),
  },
  ['userId', 'supermarketId']
);
const supermarketIdRequest = object(
  CATALOG_SCHEMA_IDS.supermarketIdRequest,
  { ...adminCredentialProperties, supermarketId: nonEmptyString() },
  ['userId', 'supermarketId']
);
const listSupermarketsRequest = object(
  CATALOG_SCHEMA_IDS.listSupermarketsRequest,
  {
    userId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId']
);

const locationFields = {
  priceScopeId: string(),
  label: nullableLocalized(),
  address: nullableString(),
  city: nullableString(),
  country: nullableString(),
  postalCode: nullableString(),
  // Plan 0061, section 5: what the caller is claiming about the code it sent.
  // Absent means MANUAL, and a request that sends no code at all gets DERIVED
  // or nothing, neither of which a caller may claim.
  postalCodeSource: ref(CATALOG_SCHEMA_IDS.postalCodeSource),
  latitude: numberOrNull(),
  longitude: numberOrNull(),
  externalRef: nullableString(),
  externalProvider: nullableString(),
};
const createLocationRequest = object(
  CATALOG_SCHEMA_IDS.createLocationRequest,
  {
    ...adminCredentialProperties,
    supermarketId: nonEmptyString(),
    ...locationFields,
  },
  ['userId', 'supermarketId']
);
const updateLocationRequest = object(
  CATALOG_SCHEMA_IDS.updateLocationRequest,
  {
    ...adminCredentialProperties,
    supermarketLocationId: nonEmptyString(),
    ...locationFields,
  },
  ['userId', 'supermarketLocationId']
);
const locationIdRequest = object(
  CATALOG_SCHEMA_IDS.locationIdRequest,
  { ...adminCredentialProperties, supermarketLocationId: nonEmptyString() },
  ['userId', 'supermarketLocationId']
);
const listLocationsRequest = object(
  CATALOG_SCHEMA_IDS.listLocationsRequest,
  {
    userId: nonEmptyString(),
    supermarketId: nonEmptyString(),
    // Plan 0066, section 4: only the shops that sell at this scope.
    priceScopeId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId', 'supermarketId']
);

const createItemRequest = object(
  CATALOG_SCHEMA_IDS.createItemRequest,
  {
    ...adminCredentialProperties,
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    brand: nullableString(),
    imageUrl: nullableString(),
    sku: nullableString(),
    ean: nullableString(),
    unitSize: numberOrNull(),
    category: ref(CATALOG_SCHEMA_IDS.itemCategory),
    defaultUnit: ref(CATALOG_SCHEMA_IDS.unitOfMeasure),
    productGroupId: nullableString(),
  },
  ['userId', 'name', 'category', 'defaultUnit']
);
const updateItemRequest = object(
  CATALOG_SCHEMA_IDS.updateItemRequest,
  {
    ...adminCredentialProperties,
    itemId: nonEmptyString(),
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    brand: nullableString(),
    imageUrl: nullableString(),
    sku: nullableString(),
    ean: nullableString(),
    unitSize: numberOrNull(),
    category: ref(CATALOG_SCHEMA_IDS.itemCategory),
    defaultUnit: ref(CATALOG_SCHEMA_IDS.unitOfMeasure),
    productGroupId: nullableString(),
  },
  ['userId', 'itemId']
);
const findItemByEanRequest = object(
  CATALOG_SCHEMA_IDS.findItemByEanRequest,
  { userId: nonEmptyString(), ean: nonEmptyString() },
  ['userId', 'ean']
);
const findItemByEanResult = object(
  CATALOG_SCHEMA_IDS.findItemByEanResult,
  {
    item: {
      anyOf: [ref(CATALOG_SCHEMA_IDS.itemView), { type: 'null' }],
    },
  },
  ['item']
);
const itemIdRequest = object(
  CATALOG_SCHEMA_IDS.itemIdRequest,
  { ...adminCredentialProperties, itemId: nonEmptyString() },
  ['userId', 'itemId']
);
/**
 * Several products by id (plan 0051, section 6.1).
 *
 * **No `userId`**, unlike every other catalog request, and the omission is the
 * point: a product's name is not private, and this exists so a guest holding a
 * shared basket can read the name of the thing they are being asked to buy.
 */
const getItemsRequest = object(
  CATALOG_SCHEMA_IDS.getItemsRequest,
  {
    ids: array(nonEmptyString()),
    // Plan 0066: price the lookup at these scopes. Absent and empty both mean
    // "do not price", unlike search, because a lookup by id answers the same
    // items either way.
    priceScopeIds: array(nonEmptyString()),
  },
  ['ids']
);

/** Ids that name nothing are absent rather than null: a basket outlives a product. */
const getItemsResult = object(
  CATALOG_SCHEMA_IDS.getItemsResult,
  { items: array(ref(CATALOG_SCHEMA_IDS.itemView)) },
  ['items']
);

const searchItemsRequest = object(
  CATALOG_SCHEMA_IDS.searchItemsRequest,
  {
    userId: nonEmptyString(),
    query: string(),
    category: ref(CATALOG_SCHEMA_IDS.itemCategory),
    // Plan 0048: the group filter, and the scopes a price may be quoted from. No
    // default is resolved when the scopes are absent; that is plan 0049.
    productGroupId: string(),
    priceScopeIds: array(nonEmptyString()),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId']
);
const searchOffersRequest = object(
  CATALOG_SCHEMA_IDS.searchOffersRequest,
  {
    userId: nonEmptyString(),
    query: string(),
    priceScopeIds: array(nonEmptyString()),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId']
);

// --- Product groups (plan 0048, section 1) ---------------------------------

const createProductGroupRequest = object(
  CATALOG_SCHEMA_IDS.createProductGroupRequest,
  {
    ...adminCredentialProperties,
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    slug: nonEmptyString(),
    referenceUnit: ref(CATALOG_SCHEMA_IDS.unitOfMeasure),
    synonyms: ref(CATALOG_SCHEMA_IDS.localizedSynonyms),
  },
  ['userId', 'name', 'slug', 'referenceUnit']
);
const updateProductGroupRequest = object(
  CATALOG_SCHEMA_IDS.updateProductGroupRequest,
  {
    ...adminCredentialProperties,
    productGroupId: nonEmptyString(),
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    slug: nonEmptyString(),
    referenceUnit: ref(CATALOG_SCHEMA_IDS.unitOfMeasure),
    synonyms: ref(CATALOG_SCHEMA_IDS.localizedSynonyms),
  },
  ['userId', 'productGroupId']
);
const productGroupIdRequest = object(
  CATALOG_SCHEMA_IDS.productGroupIdRequest,
  { ...adminCredentialProperties, productGroupId: nonEmptyString() },
  ['userId', 'productGroupId']
);
const listProductGroupsRequest = object(
  CATALOG_SCHEMA_IDS.listProductGroupsRequest,
  {
    userId: nonEmptyString(),
    query: string(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId']
);

const priceFields = {
  price: numberOrNull(),
  currency: nullableString(),
  unitPrice: numberOrNull(),
  unitPriceLabel: nullableString(),
  available: boolean(),
  priceObservedAt: nullableString(),
};

const upsertSupermarketItemRequest = object(
  CATALOG_SCHEMA_IDS.upsertSupermarketItemRequest,
  {
    ...adminCredentialProperties,
    itemId: nonEmptyString(),
    priceScopeId: nonEmptyString(),
    priceSourceKind: ref(CATALOG_SCHEMA_IDS.priceSourceKind),
    ...priceFields,
  },
  ['userId', 'itemId', 'priceScopeId']
);
const supermarketItemBatchEntry = object(
  CATALOG_SCHEMA_IDS.supermarketItemBatchEntry,
  { itemId: nonEmptyString(), ...priceFields },
  ['itemId']
);
const upsertSupermarketItemBatchRequest = object(
  CATALOG_SCHEMA_IDS.upsertSupermarketItemBatchRequest,
  {
    ...adminCredentialProperties,
    priceScopeId: nonEmptyString(),
    priceSourceKind: ref(CATALOG_SCHEMA_IDS.priceSourceKind),
    entries: array(ref(CATALOG_SCHEMA_IDS.supermarketItemBatchEntry)),
  },
  ['userId', 'priceScopeId', 'priceSourceKind', 'entries']
);
const supermarketItemPriceDisagreement = object(
  CATALOG_SCHEMA_IDS.supermarketItemPriceDisagreement,
  {
    itemId: nonEmptyString(),
    storedPrice: numberOrNull(),
    storedSourceKind: ref(CATALOG_SCHEMA_IDS.priceSourceKind),
    fetchedPrice: numberOrNull(),
  },
  ['itemId', 'storedPrice', 'storedSourceKind', 'fetchedPrice']
);
const upsertSupermarketItemBatchResult = object(
  CATALOG_SCHEMA_IDS.upsertSupermarketItemBatchResult,
  {
    created: integer({ minimum: 0 }),
    updated: integer({ minimum: 0 }),
    unchanged: integer({ minimum: 0 }),
    skipped: array(ref(CATALOG_SCHEMA_IDS.supermarketItemPriceDisagreement)),
  },
  ['created', 'updated', 'unchanged', 'skipped']
);
const supermarketItemIdRequest = object(
  CATALOG_SCHEMA_IDS.supermarketItemIdRequest,
  { ...adminCredentialProperties, supermarketItemId: nonEmptyString() },
  ['userId', 'supermarketItemId']
);
const getSupermarketItemRequest = object(
  CATALOG_SCHEMA_IDS.getSupermarketItemRequest,
  {
    userId: nonEmptyString(),
    itemId: nonEmptyString(),
    priceScopeId: nonEmptyString(),
  },
  ['userId', 'itemId', 'priceScopeId']
);
const listByItemRequest = object(
  CATALOG_SCHEMA_IDS.listByItemRequest,
  {
    userId: nonEmptyString(),
    itemId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId', 'itemId']
);
const listByLocationRequest = object(
  CATALOG_SCHEMA_IDS.listByLocationRequest,
  {
    userId: nonEmptyString(),
    supermarketLocationId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId', 'supermarketLocationId']
);
const listByScopeRequest = object(
  CATALOG_SCHEMA_IDS.listByScopeRequest,
  {
    userId: nonEmptyString(),
    priceScopeId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId', 'priceScopeId']
);

// --- Price scopes and per store rows (plan 0038) ---------------------------

const createPriceScopeRequest = object(
  CATALOG_SCHEMA_IDS.createPriceScopeRequest,
  {
    ...adminCredentialProperties,
    supermarketId: nonEmptyString(),
    kind: ref(CATALOG_SCHEMA_IDS.priceScopeKind),
    externalKey: nullableString(),
    label: nullableLocalized(),
  },
  ['userId', 'supermarketId', 'kind']
);
const updatePriceScopeRequest = object(
  CATALOG_SCHEMA_IDS.updatePriceScopeRequest,
  {
    ...adminCredentialProperties,
    priceScopeId: nonEmptyString(),
    kind: ref(CATALOG_SCHEMA_IDS.priceScopeKind),
    externalKey: nullableString(),
    label: nullableLocalized(),
  },
  ['userId', 'priceScopeId']
);
const priceScopeIdRequest = object(
  CATALOG_SCHEMA_IDS.priceScopeIdRequest,
  { ...adminCredentialProperties, priceScopeId: nonEmptyString() },
  ['userId', 'priceScopeId']
);
const listPriceScopesRequest = object(
  CATALOG_SCHEMA_IDS.listPriceScopesRequest,
  {
    userId: nonEmptyString(),
    supermarketId: string(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId']
);

// --- Resolving a place into scopes (plan 0049, sections 1.1 and 3.1) --------

const resolvePriceScopesRequest = object(
  CATALOG_SCHEMA_IDS.resolvePriceScopesRequest,
  {
    userId: nonEmptyString(),
    postalCodes: array(nonEmptyString()),
    supermarketIds: array(nonEmptyString()),
    excludedSupermarketIds: array(nonEmptyString()),
    excludedSupermarketLocationIds: array(nonEmptyString()),
  },
  ['userId']
);

const resolvedScopeView = object(
  CATALOG_SCHEMA_IDS.resolvedScopeView,
  {
    priceScopeId: nonEmptyString(),
    supermarketId: nonEmptyString(),
    postalCode: nullableString(),
    origin: { type: 'string', enum: [...SCOPE_ORIGINS] },
    approximate: boolean(),
  },
  ['priceScopeId', 'supermarketId', 'postalCode', 'origin', 'approximate']
);

const postalCodeCoverageView = object(
  CATALOG_SCHEMA_IDS.postalCodeCoverageView,
  { postalCode: nonEmptyString(), served: boolean() },
  ['postalCode', 'served']
);

const resolvedScopesFields = {
  priceScopeIds: array(nonEmptyString()),
  scopes: array(ref(CATALOG_SCHEMA_IDS.resolvedScopeView)),
  coverage: array(ref(CATALOG_SCHEMA_IDS.postalCodeCoverageView)),
  approximate: boolean(),
};
const resolvedScopesRequired = [
  'priceScopeIds',
  'scopes',
  'coverage',
  'approximate',
];

const resolvedScopesView = object(
  CATALOG_SCHEMA_IDS.resolvedScopesView,
  resolvedScopesFields,
  resolvedScopesRequired
);

/**
 * The gateway's answer, which is the catalog's plus who supplied the selector.
 * Written out rather than composed with `allOf`: the OpenAPI document renders a
 * flat object beside the search it explains, and one indirection there costs a
 * reader more than the four repeated field names cost here.
 */
const catalogScopeView = object(
  CATALOG_SCHEMA_IDS.catalogScopeView,
  {
    ...resolvedScopesFields,
    profileId: nullableString(),
    explicit: boolean(),
  },
  [...resolvedScopesRequired, 'profileId', 'explicit']
);

const upsertLocationItemRequest = object(
  CATALOG_SCHEMA_IDS.upsertLocationItemRequest,
  {
    ...adminCredentialProperties,
    itemId: nonEmptyString(),
    supermarketLocationId: nonEmptyString(),
    positionInStore: nullableString(),
    available: { type: ['boolean', 'null'] },
  },
  ['userId', 'itemId', 'supermarketLocationId']
);
const getLocationItemRequest = object(
  CATALOG_SCHEMA_IDS.getLocationItemRequest,
  {
    userId: nonEmptyString(),
    itemId: nonEmptyString(),
    supermarketLocationId: nonEmptyString(),
  },
  ['userId', 'itemId', 'supermarketLocationId']
);
const listLocationItemsRequest = object(
  CATALOG_SCHEMA_IDS.listLocationItemsRequest,
  {
    userId: nonEmptyString(),
    supermarketLocationId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId', 'supermarketLocationId']
);

// --- Postal code geography (plan 0060, sections 5 and 7) --------------------

/**
 * ISO 3166-1 alpha-2. Not constrained to two lowercase letters here, although
 * the table stores exactly that, for two reasons: the service normalizes case
 * and whitespace before it looks, and no contract schema carries a `pattern`
 * because the gateway's OpenAPI bridge samples every string as `sample` and
 * would reject its own document.
 */
const countryCode = (): JsonSchema => nonEmptyString();
/** A radius or a cut off in metres. Zero is allowed and answers nothing. */
const metres = (): JsonSchema => ({ type: 'number', minimum: 0 });

const postalCodeDistanceView = object(
  CATALOG_SCHEMA_IDS.postalCodeDistanceView,
  {
    postalCode: nonEmptyString(),
    distanceMetres: metres(),
  },
  ['postalCode', 'distanceMetres']
);

const resolveNearestPostalCodeRequest = object(
  CATALOG_SCHEMA_IDS.resolveNearestPostalCodeRequest,
  {
    country: countryCode(),
    latitude: { type: 'number', minimum: -90, maximum: 90 },
    longitude: { type: 'number', minimum: -180, maximum: 180 },
    maxDistanceMetres: metres(),
  },
  ['country', 'latitude', 'longitude', 'maxDistanceMetres']
);

const nearestPostalCodeView = object(
  CATALOG_SCHEMA_IDS.nearestPostalCodeView,
  {
    country: countryCode(),
    // Null beyond `maxDistanceMetres`: "we don't know" rather than a confident
    // wrong code (plan 0060, section 6).
    nearest: {
      anyOf: [ref(CATALOG_SCHEMA_IDS.postalCodeDistanceView), { type: 'null' }],
    },
  },
  ['country', 'nearest']
);

const listNearbyPostalCodesRequest = object(
  CATALOG_SCHEMA_IDS.listNearbyPostalCodesRequest,
  {
    country: countryCode(),
    postalCode: nonEmptyString(),
    radiusMetres: metres(),
  },
  ['country', 'postalCode', 'radiusMetres']
);

const nearbyPostalCodesView = object(
  CATALOG_SCHEMA_IDS.nearbyPostalCodesView,
  {
    country: countryCode(),
    postalCode: nonEmptyString(),
    known: boolean(),
    postalCodes: array(ref(CATALOG_SCHEMA_IDS.postalCodeDistanceView)),
  },
  ['country', 'postalCode', 'known', 'postalCodes']
);

// --- Do we have shops there (plan 0063, section 5) -------------------------

const countLocationsByPostalCodeRequest = object(
  CATALOG_SCHEMA_IDS.countLocationsByPostalCodeRequest,
  {
    country: countryCode(),
    postalCodes: array(nonEmptyString()),
  },
  ['country', 'postalCodes']
);

const postalCodeLocationCount = object(
  CATALOG_SCHEMA_IDS.postalCodeLocationCount,
  {
    postalCode: nonEmptyString(),
    locations: integer({ minimum: 0 }),
  },
  ['postalCode', 'locations']
);

const postalCodeLocationCountsView = object(
  CATALOG_SCHEMA_IDS.postalCodeLocationCountsView,
  {
    country: countryCode(),
    // One entry per code asked about, zeros included: a caller deciding what is
    // unknown needs the zeros, which is why it asked.
    counts: array(ref(CATALOG_SCHEMA_IDS.postalCodeLocationCount)),
  },
  ['country', 'counts']
);

// --- The shops in your postal codes (plan 0068) ----------------------------

/** Both shop reads take the same refusals, so they are written once. */
const shopRefusalFields = {
  excludedSupermarketLocationIds: array(nonEmptyString()),
  excludedSupermarketIds: array(nonEmptyString()),
};

const summarizeLocationsByChainRequest = object(
  CATALOG_SCHEMA_IDS.summarizeLocationsByChainRequest,
  {
    userId: nonEmptyString(),
    // Required and the whole filter: this read is keyed by place, and no code
    // answers no chains rather than the country.
    postalCodes: array(nonEmptyString()),
    ...shopRefusalFields,
    // Governs the rows, never the counts (plan 0068, section 3.1).
    includeExcluded: boolean(),
  },
  ['userId', 'postalCodes']
);

const supermarketLocationChainSummaryView = object(
  CATALOG_SCHEMA_IDS.supermarketLocationChainSummaryView,
  {
    supermarketId: nonEmptyString(),
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    logoUrl: nullableString(),
    // Null for an independent shop, which is what a client buckets as OTHER
    // (plan 0068, section 4). Catalog does not use that word.
    externalBrandKey: nullableString(),
    locations: integer({ minimum: 1 }),
    excluded: integer({ minimum: 0 }),
  },
  [
    'supermarketId',
    'name',
    'logoUrl',
    'externalBrandKey',
    'locations',
    'excluded',
  ]
);

const supermarketLocationChainSummariesView = object(
  CATALOG_SCHEMA_IDS.supermarketLocationChainSummariesView,
  {
    chains: array(ref(CATALOG_SCHEMA_IDS.supermarketLocationChainSummaryView)),
  },
  ['chains']
);

/**
 * The gateway's row: catalog's counts plus the chain's own refusal, which comes
 * from core (plan 0068, section 3.1). Restated rather than composed with
 * `allOf`, because the OpenAPI bridge samples these schemas and a composed one
 * documents as an empty object.
 */
const shopChainSummaryView = object(
  CATALOG_SCHEMA_IDS.shopChainSummaryView,
  {
    supermarketId: nonEmptyString(),
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    logoUrl: nullableString(),
    externalBrandKey: nullableString(),
    locations: integer({ minimum: 1 }),
    excluded: integer({ minimum: 0 }),
    excludedChain: boolean(),
  },
  [
    'supermarketId',
    'name',
    'logoUrl',
    'externalBrandKey',
    'locations',
    'excluded',
    'excludedChain',
  ]
);

const shopChainSummariesView = object(
  CATALOG_SCHEMA_IDS.shopChainSummariesView,
  { chains: array(ref(CATALOG_SCHEMA_IDS.shopChainSummaryView)) },
  ['chains']
);

const searchShopsRequest = object(
  CATALOG_SCHEMA_IDS.searchShopsRequest,
  {
    userId: nonEmptyString(),
    postalCodes: array(nonEmptyString()),
    supermarketId: nonEmptyString(),
    query: string(),
    includeExcluded: boolean(),
    ...shopRefusalFields,
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId', 'postalCodes']
);

const shopView = object(
  CATALOG_SCHEMA_IDS.shopView,
  {
    location: ref(CATALOG_SCHEMA_IDS.supermarketLocationView),
    // The chain itself and not only its id: an address does not identify a shop
    // (plan 0068, section 5).
    supermarket: ref(CATALOG_SCHEMA_IDS.supermarketView),
    excluded: boolean(),
    excludedChain: boolean(),
  },
  ['location', 'supermarket', 'excluded', 'excludedChain']
);

const shopPage = paginated(
  CATALOG_SCHEMA_IDS.shopPage,
  CATALOG_SCHEMA_IDS.shopView
);

export const catalogSchemas: JsonSchema[] = [
  enumOf(CATALOG_SCHEMA_IDS.itemCategory, Object.values(ItemCategory)),
  enumOf(CATALOG_SCHEMA_IDS.unitOfMeasure, Object.values(UnitOfMeasure)),
  enumOf(CATALOG_SCHEMA_IDS.priceScopeKind, Object.values(PriceScopeKind)),
  enumOf(CATALOG_SCHEMA_IDS.priceSourceKind, Object.values(PriceSourceKind)),
  enumOf(CATALOG_SCHEMA_IDS.postalCodeSource, Object.values(PostalCodeSource)),
  localizedText,
  localizedSynonyms,
  supermarketView,
  supermarketLocationView,
  priceScopeView,
  productGroupView,
  itemOfferView,
  itemView,
  productGroupOfferView,
  catalogSuggestion,
  catalogSuggestResponse,
  supermarketItemView,
  supermarketLocationItemView,
  supermarketPage,
  supermarketLocationPage,
  priceScopePage,
  itemPage,
  productGroupPage,
  productGroupOfferPage,
  supermarketItemPage,
  supermarketLocationItemPage,
  createSupermarketRequest,
  updateSupermarketRequest,
  supermarketIdRequest,
  listSupermarketsRequest,
  createLocationRequest,
  updateLocationRequest,
  locationIdRequest,
  listLocationsRequest,
  createItemRequest,
  updateItemRequest,
  itemIdRequest,
  getItemsRequest,
  getItemsResult,
  searchItemsRequest,
  searchOffersRequest,
  createProductGroupRequest,
  updateProductGroupRequest,
  productGroupIdRequest,
  listProductGroupsRequest,
  findItemByEanRequest,
  findItemByEanResult,
  upsertSupermarketItemRequest,
  supermarketItemBatchEntry,
  upsertSupermarketItemBatchRequest,
  supermarketItemPriceDisagreement,
  upsertSupermarketItemBatchResult,
  supermarketItemIdRequest,
  getSupermarketItemRequest,
  listByItemRequest,
  listByLocationRequest,
  listByScopeRequest,
  createPriceScopeRequest,
  updatePriceScopeRequest,
  priceScopeIdRequest,
  listPriceScopesRequest,
  resolvePriceScopesRequest,
  resolvedScopeView,
  postalCodeCoverageView,
  resolvedScopesView,
  catalogScopeView,
  upsertLocationItemRequest,
  getLocationItemRequest,
  listLocationItemsRequest,
  postalCodeDistanceView,
  resolveNearestPostalCodeRequest,
  nearestPostalCodeView,
  listNearbyPostalCodesRequest,
  nearbyPostalCodesView,
  countLocationsByPostalCodeRequest,
  postalCodeLocationCount,
  postalCodeLocationCountsView,
  summarizeLocationsByChainRequest,
  supermarketLocationChainSummaryView,
  supermarketLocationChainSummariesView,
  shopChainSummaryView,
  shopChainSummariesView,
  searchShopsRequest,
  shopView,
  shopPage,
];

export const catalogMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [SUPERMARKET_PATTERNS.create]: {
    request: CATALOG_SCHEMA_IDS.createSupermarketRequest,
    response: CATALOG_SCHEMA_IDS.supermarketView,
  },
  [SUPERMARKET_PATTERNS.update]: {
    request: CATALOG_SCHEMA_IDS.updateSupermarketRequest,
    response: CATALOG_SCHEMA_IDS.supermarketView,
  },
  [SUPERMARKET_PATTERNS.delete]: {
    request: CATALOG_SCHEMA_IDS.supermarketIdRequest,
    response: COMMON_IDS.idResult,
  },
  [SUPERMARKET_PATTERNS.get]: {
    request: CATALOG_SCHEMA_IDS.supermarketIdRequest,
    response: CATALOG_SCHEMA_IDS.supermarketView,
  },
  [SUPERMARKET_PATTERNS.list]: {
    request: CATALOG_SCHEMA_IDS.listSupermarketsRequest,
    response: CATALOG_SCHEMA_IDS.supermarketPage,
  },
  [SUPERMARKET_LOCATION_PATTERNS.create]: {
    request: CATALOG_SCHEMA_IDS.createLocationRequest,
    response: CATALOG_SCHEMA_IDS.supermarketLocationView,
  },
  [SUPERMARKET_LOCATION_PATTERNS.update]: {
    request: CATALOG_SCHEMA_IDS.updateLocationRequest,
    response: CATALOG_SCHEMA_IDS.supermarketLocationView,
  },
  [SUPERMARKET_LOCATION_PATTERNS.delete]: {
    request: CATALOG_SCHEMA_IDS.locationIdRequest,
    response: COMMON_IDS.idResult,
  },
  [SUPERMARKET_LOCATION_PATTERNS.get]: {
    request: CATALOG_SCHEMA_IDS.locationIdRequest,
    response: CATALOG_SCHEMA_IDS.supermarketLocationView,
  },
  [SUPERMARKET_LOCATION_PATTERNS.list]: {
    request: CATALOG_SCHEMA_IDS.listLocationsRequest,
    response: CATALOG_SCHEMA_IDS.supermarketLocationPage,
  },
  [ITEM_PATTERNS.create]: {
    request: CATALOG_SCHEMA_IDS.createItemRequest,
    response: CATALOG_SCHEMA_IDS.itemView,
  },
  [ITEM_PATTERNS.update]: {
    request: CATALOG_SCHEMA_IDS.updateItemRequest,
    response: CATALOG_SCHEMA_IDS.itemView,
  },
  [ITEM_PATTERNS.delete]: {
    request: CATALOG_SCHEMA_IDS.itemIdRequest,
    response: COMMON_IDS.idResult,
  },
  [ITEM_PATTERNS.get]: {
    request: CATALOG_SCHEMA_IDS.itemIdRequest,
    response: CATALOG_SCHEMA_IDS.itemView,
  },
  [ITEM_PATTERNS.getMany]: {
    request: CATALOG_SCHEMA_IDS.getItemsRequest,
    response: CATALOG_SCHEMA_IDS.getItemsResult,
  },
  [ITEM_PATTERNS.search]: {
    request: CATALOG_SCHEMA_IDS.searchItemsRequest,
    response: CATALOG_SCHEMA_IDS.itemPage,
  },
  [ITEM_PATTERNS.searchOffers]: {
    request: CATALOG_SCHEMA_IDS.searchOffersRequest,
    response: CATALOG_SCHEMA_IDS.productGroupOfferPage,
  },
  [ITEM_PATTERNS.findByEan]: {
    request: CATALOG_SCHEMA_IDS.findItemByEanRequest,
    response: CATALOG_SCHEMA_IDS.findItemByEanResult,
  },
  [PRODUCT_GROUP_PATTERNS.create]: {
    request: CATALOG_SCHEMA_IDS.createProductGroupRequest,
    response: CATALOG_SCHEMA_IDS.productGroupView,
  },
  [PRODUCT_GROUP_PATTERNS.update]: {
    request: CATALOG_SCHEMA_IDS.updateProductGroupRequest,
    response: CATALOG_SCHEMA_IDS.productGroupView,
  },
  [PRODUCT_GROUP_PATTERNS.delete]: {
    request: CATALOG_SCHEMA_IDS.productGroupIdRequest,
    response: COMMON_IDS.idResult,
  },
  [PRODUCT_GROUP_PATTERNS.get]: {
    request: CATALOG_SCHEMA_IDS.productGroupIdRequest,
    response: CATALOG_SCHEMA_IDS.productGroupView,
  },
  [PRODUCT_GROUP_PATTERNS.list]: {
    request: CATALOG_SCHEMA_IDS.listProductGroupsRequest,
    response: CATALOG_SCHEMA_IDS.productGroupPage,
  },
  [SUPERMARKET_ITEM_PATTERNS.upsert]: {
    request: CATALOG_SCHEMA_IDS.upsertSupermarketItemRequest,
    response: CATALOG_SCHEMA_IDS.supermarketItemView,
  },
  [SUPERMARKET_ITEM_PATTERNS.upsertBatch]: {
    request: CATALOG_SCHEMA_IDS.upsertSupermarketItemBatchRequest,
    response: CATALOG_SCHEMA_IDS.upsertSupermarketItemBatchResult,
  },
  [SUPERMARKET_ITEM_PATTERNS.delete]: {
    request: CATALOG_SCHEMA_IDS.supermarketItemIdRequest,
    response: COMMON_IDS.idResult,
  },
  [SUPERMARKET_ITEM_PATTERNS.get]: {
    request: CATALOG_SCHEMA_IDS.getSupermarketItemRequest,
    response: CATALOG_SCHEMA_IDS.supermarketItemView,
  },
  [SUPERMARKET_ITEM_PATTERNS.listByItem]: {
    request: CATALOG_SCHEMA_IDS.listByItemRequest,
    response: CATALOG_SCHEMA_IDS.supermarketItemPage,
  },
  [SUPERMARKET_ITEM_PATTERNS.listByLocation]: {
    request: CATALOG_SCHEMA_IDS.listByLocationRequest,
    response: CATALOG_SCHEMA_IDS.supermarketItemPage,
  },
  [SUPERMARKET_ITEM_PATTERNS.listByScope]: {
    request: CATALOG_SCHEMA_IDS.listByScopeRequest,
    response: CATALOG_SCHEMA_IDS.supermarketItemPage,
  },
  [PRICE_SCOPE_PATTERNS.create]: {
    request: CATALOG_SCHEMA_IDS.createPriceScopeRequest,
    response: CATALOG_SCHEMA_IDS.priceScopeView,
  },
  [PRICE_SCOPE_PATTERNS.update]: {
    request: CATALOG_SCHEMA_IDS.updatePriceScopeRequest,
    response: CATALOG_SCHEMA_IDS.priceScopeView,
  },
  [PRICE_SCOPE_PATTERNS.delete]: {
    request: CATALOG_SCHEMA_IDS.priceScopeIdRequest,
    response: COMMON_IDS.idResult,
  },
  [PRICE_SCOPE_PATTERNS.list]: {
    request: CATALOG_SCHEMA_IDS.listPriceScopesRequest,
    response: CATALOG_SCHEMA_IDS.priceScopePage,
  },
  [PRICE_SCOPE_PATTERNS.resolve]: {
    request: CATALOG_SCHEMA_IDS.resolvePriceScopesRequest,
    response: CATALOG_SCHEMA_IDS.resolvedScopesView,
  },
  [SUPERMARKET_LOCATION_ITEM_PATTERNS.upsert]: {
    request: CATALOG_SCHEMA_IDS.upsertLocationItemRequest,
    response: CATALOG_SCHEMA_IDS.supermarketLocationItemView,
  },
  [SUPERMARKET_LOCATION_ITEM_PATTERNS.get]: {
    request: CATALOG_SCHEMA_IDS.getLocationItemRequest,
    response: CATALOG_SCHEMA_IDS.supermarketLocationItemView,
  },
  [SUPERMARKET_LOCATION_ITEM_PATTERNS.listByLocation]: {
    request: CATALOG_SCHEMA_IDS.listLocationItemsRequest,
    response: CATALOG_SCHEMA_IDS.supermarketLocationItemPage,
  },
  [POSTAL_CODE_PATTERNS.nearest]: {
    request: CATALOG_SCHEMA_IDS.resolveNearestPostalCodeRequest,
    response: CATALOG_SCHEMA_IDS.nearestPostalCodeView,
  },
  [POSTAL_CODE_PATTERNS.nearby]: {
    request: CATALOG_SCHEMA_IDS.listNearbyPostalCodesRequest,
    response: CATALOG_SCHEMA_IDS.nearbyPostalCodesView,
  },
  [SUPERMARKET_LOCATION_PATTERNS.countByPostalCode]: {
    request: CATALOG_SCHEMA_IDS.countLocationsByPostalCodeRequest,
    response: CATALOG_SCHEMA_IDS.postalCodeLocationCountsView,
  },
  [SUPERMARKET_LOCATION_PATTERNS.summarizeByChain]: {
    request: CATALOG_SCHEMA_IDS.summarizeLocationsByChainRequest,
    response: CATALOG_SCHEMA_IDS.supermarketLocationChainSummariesView,
  },
  [SUPERMARKET_LOCATION_PATTERNS.search]: {
    request: CATALOG_SCHEMA_IDS.searchShopsRequest,
    response: CATALOG_SCHEMA_IDS.shopPage,
  },
};
