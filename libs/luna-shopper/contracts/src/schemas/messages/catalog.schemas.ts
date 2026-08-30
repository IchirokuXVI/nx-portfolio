import {
  ItemCategory,
  PriceScopeKind,
  PriceSourceKind,
  UnitOfMeasure,
} from '../../lib/enums/catalog.enums';
import {
  ITEM_PATTERNS,
  PRICE_SCOPE_PATTERNS,
  SUPERMARKET_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  SUPERMARKET_PATTERNS,
} from '../../lib/messages/catalog.messages';
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
import { COMMON_IDS } from '../common.schemas';

/**
 * Catalog schemas (plan 0012): supermarkets, locations, items and per-location
 * prices. Writes are owner only; reads open. Localized text fields carry EN + ES.
 */
export const CATALOG_SCHEMA_IDS = {
  itemCategory: schemaId('enums/ItemCategory'),
  unitOfMeasure: schemaId('enums/UnitOfMeasure'),
  priceScopeKind: schemaId('enums/PriceScopeKind'),
  priceSourceKind: schemaId('enums/PriceSourceKind'),
  localizedText: schemaId('catalog/LocalizedText'),
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

// --- Views -----------------------------------------------------------------

const supermarketView = object(
  CATALOG_SCHEMA_IDS.supermarketView,
  {
    id: nonEmptyString(),
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    logoUrl: nullableString(),
    websiteUrl: nullableString(),
    externalBrandKey: nullableString(),
  },
  ['id', 'name', 'logoUrl', 'websiteUrl', 'externalBrandKey']
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
  ]
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

// --- Requests --------------------------------------------------------------

const createSupermarketRequest = object(
  CATALOG_SCHEMA_IDS.createSupermarketRequest,
  {
    userId: nonEmptyString(),
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
    userId: nonEmptyString(),
    supermarketId: nonEmptyString(),
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    logoUrl: nullableString(),
    websiteUrl: nullableString(),
    externalBrandKey: nullableString(),
  },
  ['userId', 'supermarketId']
);
const supermarketIdRequest = object(
  CATALOG_SCHEMA_IDS.supermarketIdRequest,
  { userId: nonEmptyString(), supermarketId: nonEmptyString() },
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
  latitude: numberOrNull(),
  longitude: numberOrNull(),
  externalRef: nullableString(),
  externalProvider: nullableString(),
};
const createLocationRequest = object(
  CATALOG_SCHEMA_IDS.createLocationRequest,
  {
    userId: nonEmptyString(),
    supermarketId: nonEmptyString(),
    ...locationFields,
  },
  ['userId', 'supermarketId']
);
const updateLocationRequest = object(
  CATALOG_SCHEMA_IDS.updateLocationRequest,
  {
    userId: nonEmptyString(),
    supermarketLocationId: nonEmptyString(),
    ...locationFields,
  },
  ['userId', 'supermarketLocationId']
);
const locationIdRequest = object(
  CATALOG_SCHEMA_IDS.locationIdRequest,
  { userId: nonEmptyString(), supermarketLocationId: nonEmptyString() },
  ['userId', 'supermarketLocationId']
);
const listLocationsRequest = object(
  CATALOG_SCHEMA_IDS.listLocationsRequest,
  {
    userId: nonEmptyString(),
    supermarketId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId', 'supermarketId']
);

const createItemRequest = object(
  CATALOG_SCHEMA_IDS.createItemRequest,
  {
    userId: nonEmptyString(),
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    brand: nullableString(),
    imageUrl: nullableString(),
    sku: nullableString(),
    ean: nullableString(),
    unitSize: numberOrNull(),
    category: ref(CATALOG_SCHEMA_IDS.itemCategory),
    defaultUnit: ref(CATALOG_SCHEMA_IDS.unitOfMeasure),
  },
  ['userId', 'name', 'category', 'defaultUnit']
);
const updateItemRequest = object(
  CATALOG_SCHEMA_IDS.updateItemRequest,
  {
    userId: nonEmptyString(),
    itemId: nonEmptyString(),
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    brand: nullableString(),
    imageUrl: nullableString(),
    sku: nullableString(),
    ean: nullableString(),
    unitSize: numberOrNull(),
    category: ref(CATALOG_SCHEMA_IDS.itemCategory),
    defaultUnit: ref(CATALOG_SCHEMA_IDS.unitOfMeasure),
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
  { userId: nonEmptyString(), itemId: nonEmptyString() },
  ['userId', 'itemId']
);
const searchItemsRequest = object(
  CATALOG_SCHEMA_IDS.searchItemsRequest,
  {
    userId: nonEmptyString(),
    query: string(),
    category: ref(CATALOG_SCHEMA_IDS.itemCategory),
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
    userId: nonEmptyString(),
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
    userId: nonEmptyString(),
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
  { userId: nonEmptyString(), supermarketItemId: nonEmptyString() },
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
    userId: nonEmptyString(),
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
    userId: nonEmptyString(),
    priceScopeId: nonEmptyString(),
    kind: ref(CATALOG_SCHEMA_IDS.priceScopeKind),
    externalKey: nullableString(),
    label: nullableLocalized(),
  },
  ['userId', 'priceScopeId']
);
const priceScopeIdRequest = object(
  CATALOG_SCHEMA_IDS.priceScopeIdRequest,
  { userId: nonEmptyString(), priceScopeId: nonEmptyString() },
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

const upsertLocationItemRequest = object(
  CATALOG_SCHEMA_IDS.upsertLocationItemRequest,
  {
    userId: nonEmptyString(),
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

export const catalogSchemas: JsonSchema[] = [
  enumOf(CATALOG_SCHEMA_IDS.itemCategory, Object.values(ItemCategory)),
  enumOf(CATALOG_SCHEMA_IDS.unitOfMeasure, Object.values(UnitOfMeasure)),
  enumOf(CATALOG_SCHEMA_IDS.priceScopeKind, Object.values(PriceScopeKind)),
  enumOf(CATALOG_SCHEMA_IDS.priceSourceKind, Object.values(PriceSourceKind)),
  localizedText,
  supermarketView,
  supermarketLocationView,
  priceScopeView,
  itemView,
  supermarketItemView,
  supermarketLocationItemView,
  supermarketPage,
  supermarketLocationPage,
  priceScopePage,
  itemPage,
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
  searchItemsRequest,
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
  upsertLocationItemRequest,
  getLocationItemRequest,
  listLocationItemsRequest,
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
  [ITEM_PATTERNS.search]: {
    request: CATALOG_SCHEMA_IDS.searchItemsRequest,
    response: CATALOG_SCHEMA_IDS.itemPage,
  },
  [ITEM_PATTERNS.findByEan]: {
    request: CATALOG_SCHEMA_IDS.findItemByEanRequest,
    response: CATALOG_SCHEMA_IDS.findItemByEanResult,
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
};
