import { ItemCategory, UnitOfMeasure } from '../../lib/enums/catalog.enums';
import {
  ITEM_PATTERNS,
  SUPERMARKET_ITEM_PATTERNS,
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
  localizedText: schemaId('catalog/LocalizedText'),
  supermarketView: schemaId('catalog/SupermarketView'),
  supermarketLocationView: schemaId('catalog/SupermarketLocationView'),
  itemView: schemaId('catalog/ItemView'),
  supermarketItemView: schemaId('catalog/SupermarketItemView'),
  supermarketPage: schemaId('catalog/SupermarketPage'),
  supermarketLocationPage: schemaId('catalog/SupermarketLocationPage'),
  itemPage: schemaId('catalog/ItemPage'),
  supermarketItemPage: schemaId('catalog/SupermarketItemPage'),
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
  upsertSupermarketItemRequest: schemaId('msg/supermarketItem.upsert/request'),
  supermarketItemIdRequest: schemaId('msg/supermarketItem.id/request'),
  getSupermarketItemRequest: schemaId('msg/supermarketItem.get/request'),
  listByItemRequest: schemaId('msg/supermarketItem.listByItem/request'),
  listByLocationRequest: schemaId('msg/supermarketItem.listByLocation/request'),
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
  },
  ['id', 'name', 'logoUrl', 'websiteUrl']
);

const supermarketLocationView = object(
  CATALOG_SCHEMA_IDS.supermarketLocationView,
  {
    id: nonEmptyString(),
    supermarketId: nonEmptyString(),
    label: nullableLocalized(),
    address: nullableString(),
    city: nullableString(),
    country: nullableString(),
    latitude: numberOrNull(),
    longitude: numberOrNull(),
  },
  [
    'id',
    'supermarketId',
    'label',
    'address',
    'city',
    'country',
    'latitude',
    'longitude',
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
    category: ref(CATALOG_SCHEMA_IDS.itemCategory),
    defaultUnit: ref(CATALOG_SCHEMA_IDS.unitOfMeasure),
  },
  ['id', 'name', 'brand', 'imageUrl', 'sku', 'category', 'defaultUnit']
);

const supermarketItemView = object(
  CATALOG_SCHEMA_IDS.supermarketItemView,
  {
    id: nonEmptyString(),
    itemId: nonEmptyString(),
    supermarketLocationId: nonEmptyString(),
    price: numberOrNull(),
    currency: nullableString(),
    positionInStore: nullableString(),
    available: boolean(),
  },
  [
    'id',
    'itemId',
    'supermarketLocationId',
    'price',
    'currency',
    'positionInStore',
    'available',
  ]
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

// --- Requests --------------------------------------------------------------

const createSupermarketRequest = object(
  CATALOG_SCHEMA_IDS.createSupermarketRequest,
  {
    userId: nonEmptyString(),
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    logoUrl: nullableString(),
    websiteUrl: nullableString(),
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
  label: nullableLocalized(),
  address: nullableString(),
  city: nullableString(),
  country: nullableString(),
  latitude: numberOrNull(),
  longitude: numberOrNull(),
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
    category: ref(CATALOG_SCHEMA_IDS.itemCategory),
    defaultUnit: ref(CATALOG_SCHEMA_IDS.unitOfMeasure),
  },
  ['userId', 'itemId']
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

const upsertSupermarketItemRequest = object(
  CATALOG_SCHEMA_IDS.upsertSupermarketItemRequest,
  {
    userId: nonEmptyString(),
    itemId: nonEmptyString(),
    supermarketLocationId: nonEmptyString(),
    price: numberOrNull(),
    currency: nullableString(),
    positionInStore: nullableString(),
    available: boolean(),
  },
  ['userId', 'itemId', 'supermarketLocationId']
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
    supermarketLocationId: nonEmptyString(),
  },
  ['userId', 'itemId', 'supermarketLocationId']
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

export const catalogSchemas: JsonSchema[] = [
  enumOf(CATALOG_SCHEMA_IDS.itemCategory, Object.values(ItemCategory)),
  enumOf(CATALOG_SCHEMA_IDS.unitOfMeasure, Object.values(UnitOfMeasure)),
  localizedText,
  supermarketView,
  supermarketLocationView,
  itemView,
  supermarketItemView,
  supermarketPage,
  supermarketLocationPage,
  itemPage,
  supermarketItemPage,
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
  upsertSupermarketItemRequest,
  supermarketItemIdRequest,
  getSupermarketItemRequest,
  listByItemRequest,
  listByLocationRequest,
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
  [SUPERMARKET_ITEM_PATTERNS.upsert]: {
    request: CATALOG_SCHEMA_IDS.upsertSupermarketItemRequest,
    response: CATALOG_SCHEMA_IDS.supermarketItemView,
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
};
