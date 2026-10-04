import {
  BrandBatchOutcome,
  BulkOperationErrorCode,
  ItemPriceWrittenBy,
  NearbyShopNoPick,
  PostalCodeSource,
  PriceScopeKind,
  PriceShownBecause,
  PriceSourceKind,
  UnitOfMeasure,
} from '../../lib/enums/catalog.enums';
import {
  ADMIN_POSTAL_CODE_PATTERNS,
  BRAND_BATCH_MAX,
  BRAND_LABEL_MAX_LENGTH,
  BRAND_MATCHES_MAX_KEYS,
  BRAND_ORDERS,
  BRAND_PATTERNS,
  BULK_DECISION_MAX_OPERATIONS,
  CATALOG_SUGGESTION_KINDS,
  CATEGORY_KINDS,
  CATEGORY_PATTERNS,
  CATEGORY_SLUG_MAX_LENGTH,
  ITEM_PATTERNS,
  ITEM_PRICE_PATTERNS,
  LOCATION_SECTIONS_SOURCES,
  PACK_COUNT_FILL_MAX,
  PACK_COUNT_MAX,
  PACK_COUNT_MIN,
  POSTAL_CODE_PATTERNS,
  PRICE_POLICY_PATTERNS,
  PRICE_SCOPE_PATTERNS,
  PRODUCT_GROUP_MEMBERS_MAX,
  PRODUCT_GROUP_PATTERNS,
  SCOPE_ORIGINS,
  SECTION_LIMITS,
  SECTION_PATTERNS,
  SECTION_RULE_STEPS,
  SECTION_SLUG_MAX_LENGTH,
  SUPERMARKET_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  SUPERMARKET_PATTERNS,
  UNIT_BASES,
} from '../../lib/messages/catalog.messages';
// The one bound a suggestion's product set has to respect, taken from the line it
// will become rather than restated here, so the two cannot drift apart.
import { LINE_ITEM_SET_MAX } from '../../lib/messages/list.messages';
import {
  array,
  boolean,
  enumOf,
  freeObject,
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
  // The registry a person fills (plan 0115).
  brandView: schemaId('catalog/BrandView'),
  brandPage: schemaId('catalog/BrandPage'),
  createBrandResult: schemaId('catalog/CreateBrandResult'),
  updateBrandResult: schemaId('catalog/UpdateBrandResult'),
  registerBrandSuggestionResult: schemaId(
    'catalog/RegisterBrandSuggestionResult'
  ),
  createBrandRequest: schemaId('msg/brand.create/request'),
  updateBrandRequest: schemaId('msg/brand.update/request'),
  registerBrandSuggestionRequest: schemaId(
    'msg/brand.registerSuggestion/request'
  ),
  deleteBrandRequest: schemaId('msg/brand.delete/request'),
  deleteBrandResult: schemaId('catalog/DeleteBrandResult'),
  brandIdRequest: schemaId('msg/brand.get/request'),
  listBrandsRequest: schemaId('msg/brand.list/request'),
  brandKeysRequest: schemaId('msg/brand.keys/request'),
  brandKeysResult: schemaId('msg/brand.keys/response'),
  // Plan 0160: many brands at once, one outcome per name.
  brandBatchOutcome: schemaId('enums/BrandBatchOutcome'),
  registerBrandsEntry: schemaId('catalog/RegisterBrandsEntry'),
  registerBrandsRequest: schemaId('msg/brand.registerMany/request'),
  registerBrandsOutcome: schemaId('catalog/RegisterBrandsOutcome'),
  registerBrandsResult: schemaId('msg/brand.registerMany/response'),
  // Plan 0178: a printed key that names more than one brand.
  brandMatchView: schemaId('catalog/BrandMatchView'),
  brandKeyMatches: schemaId('catalog/BrandKeyMatches'),
  brandHomonymsView: schemaId('catalog/BrandHomonymsView'),
  addBrandHomonymRequest: schemaId('msg/brand.addHomonym/request'),
  removeBrandHomonymRequest: schemaId('msg/brand.removeHomonym/request'),
  brandMatchesRequest: schemaId('msg/brand.matches/request'),
  brandMatchesResult: schemaId('msg/brand.matches/response'),
  catalogSuggestion: schemaId('catalog/CatalogSuggestion'),
  catalogSuggestResponse: schemaId('catalog/CatalogSuggestResponse'),
  priceScopeChainView: schemaId('catalog/PriceScopeChainView'),
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
  adminSupermarketItemView: schemaId('catalog/AdminSupermarketItemView'),
  supermarketLocationItemView: schemaId('catalog/SupermarketLocationItemView'),
  supermarketPage: schemaId('catalog/SupermarketPage'),
  supermarketLocationPage: schemaId('catalog/SupermarketLocationPage'),
  priceScopePage: schemaId('catalog/PriceScopePage'),
  itemPage: schemaId('catalog/ItemPage'),
  supermarketItemPage: schemaId('catalog/SupermarketItemPage'),
  adminSupermarketItemPage: schemaId('catalog/AdminSupermarketItemPage'),
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
  findItemsByEansRequest: schemaId('msg/item.findByEans/request'),
  findItemsByEansResult: schemaId('catalog/FindItemsByEansResult'),
  // Plan 0162: the harvester fills the pack counts a run saw.
  packCountFill: schemaId('catalog/PackCountFill'),
  fillPackCountsRequest: schemaId('msg/item.fillPackCounts/request'),
  fillPackCountsResult: schemaId('msg/item.fillPackCounts/response'),
  // Plan 0100: the two bulk replays, and the error shape they share.
  bulkOperationErrorCode: schemaId('enums/BulkOperationErrorCode'),
  bulkOperationError: schemaId('catalog/BulkOperationError'),
  createItemInput: schemaId('catalog/CreateItemInput'),
  createItemsRequest: schemaId('msg/item.createMany/request'),
  createItemsResult: schemaId('msg/item.createMany/response'),
  // Plan 0166: the update op of the items batch.
  updateItemInput: schemaId('catalog/UpdateItemInput'),
  updateItemsRequest: schemaId('msg/item.updateMany/request'),
  updateItemsResult: schemaId('msg/item.updateMany/response'),
  // Plan 0166: the category tree, and a category as a product carries it.
  categoryView: schemaId('catalog/CategoryView'),
  categoryTreeView: schemaId('catalog/CategoryTreeView'),
  categoryPage: schemaId('catalog/CategoryPage'),
  itemCategoryView: schemaId('catalog/ItemCategoryView'),
  categoryTreeRequest: schemaId('msg/category.tree/request'),
  createCategoryRequest: schemaId('msg/category.create/request'),
  updateCategoryRequest: schemaId('msg/category.update/request'),
  categoryIdRequest: schemaId('msg/category.id/request'),
  listCategoriesRequest: schemaId('msg/category.list/request'),
  // Plan 0167: shop sections, a shop's list of them, and pins.
  supermarketSectionView: schemaId('catalog/SupermarketSectionView'),
  supermarketSectionPage: schemaId('catalog/SupermarketSectionPage'),
  locationSectionsSource: schemaId('enums/LocationSectionsSource'),
  locationSectionsView: schemaId('catalog/LocationSectionsView'),
  itemSectionPinsView: schemaId('catalog/ItemSectionPinsView'),
  itemSectionPinsPage: schemaId('catalog/ItemSectionPinsPage'),
  sectionRuleStep: schemaId('enums/SectionRuleStep'),
  itemSectionsAtLocationEntry: schemaId('catalog/ItemSectionsAtLocationEntry'),
  itemSectionsAtLocationView: schemaId('catalog/ItemSectionsAtLocationView'),
  createSupermarketSectionRequest: schemaId('msg/section.create/request'),
  updateSupermarketSectionRequest: schemaId('msg/section.update/request'),
  supermarketSectionIdRequest: schemaId('msg/section.id/request'),
  listSupermarketSectionsRequest: schemaId('msg/section.list/request'),
  locationSectionsRequest: schemaId('msg/section.forLocation/request'),
  setLocationSectionsRequest: schemaId('msg/section.setForLocation/request'),
  listItemSectionPinsRequest: schemaId('msg/section.listPins/request'),
  setItemSectionPinsRequest: schemaId('msg/section.setPins/request'),
  itemSectionsAtLocationRequest: schemaId(
    'msg/section.itemsAtLocation/request'
  ),
  // Plan 0170: a shop row's section names, and several shops' in one read.
  locationSectionNameView: schemaId('catalog/LocationSectionNameView'),
  locationSectionNamesView: schemaId('catalog/LocationSectionNamesView'),
  locationSectionNamesRequest: schemaId(
    'msg/section.namesForLocations/request'
  ),
  createProductGroupOperation: schemaId('catalog/CreateProductGroupOperation'),
  assignItemToGroupOperation: schemaId('catalog/AssignItemToGroupOperation'),
  productGroupAssignmentOutcome: schemaId(
    'catalog/ProductGroupAssignmentOutcome'
  ),
  applyGroupAssignmentsRequest: schemaId(
    'msg/productGroup.applyAssignments/request'
  ),
  applyGroupAssignmentsResult: schemaId(
    'msg/productGroup.applyAssignments/response'
  ),
  // Plan 0080: every price a source gave, and the policy that picks one.
  itemPriceOverride: schemaId('catalog/ItemPriceOverride'),
  itemPriceOverrides: schemaId('catalog/ItemPriceOverrides'),
  itemPriceDetails: schemaId('catalog/ItemPriceDetails'),
  itemPriceView: schemaId('catalog/ItemPriceView'),
  itemPricePage: schemaId('catalog/ItemPricePage'),
  // Plan 0160: a run's rows, and one product at every scope.
  itemPriceWrittenBy: schemaId('enums/ItemPriceWrittenBy'),
  priceShownBecause: schemaId('enums/PriceShownBecause'),
  itemScopePricesView: schemaId('catalog/ItemScopePricesView'),
  itemScopePricesPage: schemaId('catalog/ItemScopePricesPage'),
  itemPricesByItemRequest: schemaId('msg/itemPrice.byItem/request'),
  pricePolicyView: schemaId('catalog/PricePolicyView'),
  pricePolicyListView: schemaId('catalog/PricePolicyListView'),
  addItemPriceRequest: schemaId('msg/itemPrice.add/request'),
  itemPriceBatchEntry: schemaId('catalog/ItemPriceBatchEntry'),
  addItemPriceBatchRequest: schemaId('msg/itemPrice.addBatch/request'),
  addItemPriceBatchResult: schemaId('catalog/AddItemPriceBatchResult'),
  listItemPricesRequest: schemaId('msg/itemPrice.list/request'),
  itemPriceIdRequest: schemaId('msg/itemPrice.id/request'),
  deleteItemPricesByRunRequest: schemaId('msg/itemPrice.deleteByRun/request'),
  deleteItemPricesByRunResult: schemaId('catalog/DeleteItemPricesByRunResult'),
  setSupermarketItemAvailabilityRequest: schemaId(
    'msg/supermarketItem.setAvailability/request'
  ),
  setSupermarketItemAvailabilityResult: schemaId(
    'catalog/SetSupermarketItemAvailabilityResult'
  ),
  listPricePoliciesRequest: schemaId('msg/pricePolicy.list/request'),
  updatePricePolicyRequest: schemaId('msg/pricePolicy.update/request'),
  getSupermarketItemRequest: schemaId('msg/supermarketItem.get/request'),
  listByItemRequest: schemaId('msg/supermarketItem.listByItem/request'),
  listByLocationRequest: schemaId('msg/supermarketItem.listByLocation/request'),
  listByScopeRequest: schemaId('msg/supermarketItem.listByScope/request'),
  adminListSupermarketItemsRequest: schemaId(
    'msg/supermarketItem.adminList/request'
  ),
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
  // The centroid table, read as a table (plan 0074).
  adminPostalCodeView: schemaId('catalog/AdminPostalCodeView'),
  adminPostalCodePage: schemaId('catalog/AdminPostalCodePage'),
  listAdminPostalCodesRequest: schemaId('msg/adminPostalCode.list/request'),
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
  // A shop as a basket read at it needs it (plan 0163, section 2).
  shopAvailabilityRequest: schemaId(
    'msg/supermarketLocation.shopAvailability/request'
  ),
  shopAvailabilityView: schemaId('catalog/ShopAvailabilityView'),
  shopItemAvailabilityView: schemaId('catalog/ShopItemAvailabilityView'),
  // A shop's chain and stack alone, for the read at one shop (plan 0170).
  locationPriceStackRequest: schemaId(
    'msg/supermarketLocation.priceStack/request'
  ),
  supermarketLocationPriceStackView: schemaId(
    'catalog/SupermarketLocationPriceStackView'
  ),
  // The shops near a point and the automatic pick (plan 0164).
  nearbyShopsRequest: schemaId('msg/supermarketLocation.nearby/request'),
  nearbyShopNoPick: schemaId('enums/NearbyShopNoPick'),
  nearbyShopView: schemaId('catalog/NearbyShopView'),
  nearbyShopPickView: schemaId('catalog/NearbyShopPickView'),
  nearbyShopsView: schemaId('catalog/NearbyShopsView'),
  shopsByIdRequest: schemaId('msg/supermarketLocation.shopsById/request'),
  shopsByIdView: schemaId('catalog/ShopsByIdView'),
  upsertLocationItemRequest: schemaId(
    'msg/supermarketLocationItem.upsert/request'
  ),
  getLocationItemRequest: schemaId('msg/supermarketLocationItem.get/request'),
  listLocationItemsRequest: schemaId(
    'msg/supermarketLocationItem.listByLocation/request'
  ),
  setLocationItemAvailabilityRequest: schemaId(
    'msg/supermarketLocationItem.setAvailability/request'
  ),
  locationItemAvailabilityConflict: schemaId(
    'catalog/SupermarketLocationItemAvailabilityConflict'
  ),
  setLocationItemAvailabilityResult: schemaId(
    'catalog/SetSupermarketLocationItemAvailabilityResult'
  ),
} as const;

const numberOrNull = (): JsonSchema => ({ type: ['number', 'null'] });
const integerOrNull = (): JsonSchema => ({ type: ['integer', 'null'] });
/** A pack count (plan 0162): a whole number in the bounds, or null. */
const packCountOrNull = (): JsonSchema => ({
  type: ['integer', 'null'],
  minimum: PACK_COUNT_MIN,
  maximum: PACK_COUNT_MAX,
});
/** A kind, or null for a materialized row no price row stands behind (plan 0080). */
const nullableSourceKind = (): JsonSchema => ({
  anyOf: [ref(CATALOG_SCHEMA_IDS.priceSourceKind), { type: 'null' }],
});
// Plan 0157: read from the label on every request, so it is stated and never
// required, and a reader built before it keeps validating what it holds.
const nullableUnitBasis = (): JsonSchema => ({
  anyOf: [{ type: 'string', enum: [...UNIT_BASES] }, { type: 'null' }],
});
const nullableLocalized = (): JsonSchema => ({
  anyOf: [ref(CATALOG_SCHEMA_IDS.localizedText), { type: 'null' }],
});

// Plan 0079: a name carries the languages it has. Neither key is required, a
// missing language is an absent key and never null (so a null fails the string
// branch), `minProperties` refuses `{}`, and `additionalProperties: false` keeps
// a language the catalog cannot serve out of the row.
const localizedText: JsonSchema = {
  ...object(
    CATALOG_SCHEMA_IDS.localizedText,
    { en: nonEmptyString(), es: nonEmptyString() },
    []
  ),
  minProperties: 1,
};

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
    // The whole stack, most specific first (plan 0105, section 3), of which
    // `priceScopeId` above is the first entry.
    priceScopeIds: array(nonEmptyString()),
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
    // Plan 0176: the mapped outline's area in whole square metres, or null.
    footprintM2: { type: ['integer', 'null'], minimum: 1 },
    // Plan 0170: the shop's section names in its order, always present.
    sections: array(ref(CATALOG_SCHEMA_IDS.locationSectionNameView)),
    // Plan 0168: the shop has a walk shown to shoppers, so it has a map.
    hasMap: boolean(),
  },
  [
    'id',
    'supermarketId',
    'priceScopeId',
    'priceScopeIds',
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
    'footprintM2',
    'sections',
    'hasMap',
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
    // How specific the scope is: lower is more specific (plan 0105).
    priority: integer(),
  },
  ['id', 'supermarketId', 'kind', 'externalKey', 'label', 'priority']
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
    unitBasis: nullableUnitBasis(),
    observedAt: nullableString(),
    sourceKind: nullableSourceKind(),
    // Plan 0118. Stated but not required, so a reader built before it keeps
    // validating what it holds.
    priceCopiedFromScopeId: nullableString(),
    stale: boolean(),
  },
  [
    'itemId',
    'priceScopeId',
    'price',
    'currency',
    'unitPrice',
    'unitPriceLabel',
    'observedAt',
    'sourceKind',
    'stale',
  ]
);

/**
 * One row of the category tree (plan 0166, section 3). A root has a null
 * parent; a child names its root.
 */
const categoryView = object(
  CATALOG_SCHEMA_IDS.categoryView,
  {
    id: nonEmptyString(),
    parentId: nullableString(),
    slug: nonEmptyString({ maxLength: CATEGORY_SLUG_MAX_LENGTH }),
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    position: integer({ minimum: 0 }),
    itemCount: integer({
      minimum: 0,
      description:
        'Distinct products under this row. A root counts the distinct products under its children, not the sum of the leaves.',
    }),
  },
  ['id', 'parentId', 'slug', 'name', 'position', 'itemCount']
);

/** The whole tree, roots then children, each by position. Unpaged. */
const categoryTreeView = object(
  CATALOG_SCHEMA_IDS.categoryTreeView,
  { categories: array(ref(CATALOG_SCHEMA_IDS.categoryView)) },
  ['categories']
);

const categoryPage = paginated(
  CATALOG_SCHEMA_IDS.categoryPage,
  CATALOG_SCHEMA_IDS.categoryView
);

/**
 * A category as a product carries it (plan 0166, section 3). Denormalized, so a
 * guest reading a basket has the name without a catalog route. The parent is
 * never null: a product is only ever on a leaf.
 */
const itemCategoryView = object(
  CATALOG_SCHEMA_IDS.itemCategoryView,
  {
    id: nonEmptyString(),
    parentId: nonEmptyString(),
    slug: nonEmptyString({ maxLength: CATEGORY_SLUG_MAX_LENGTH }),
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
  },
  ['id', 'parentId', 'slug', 'name']
);

/** One or more leaf ids, in the order meant (plan 0166, section 3). */
const categoryIds = (): JsonSchema => ({
  ...array(nonEmptyString()),
  minItems: 1,
});

/** One or more leaf slugs, for the harvest surfaces (plan 0166, section 3). */
export const categorySlugs = (): JsonSchema => ({
  ...array(nonEmptyString({ maxLength: CATEGORY_SLUG_MAX_LENGTH })),
  minItems: 1,
});

/**
 * A product's own fields, exported so that a view extending one (the basket's
 * product of plan 0163) lists the same fields rather than a copy of them.
 */
export const itemViewProperties: Record<string, JsonSchema> = {
  id: nonEmptyString(),
  name: ref(CATALOG_SCHEMA_IDS.localizedText),
  brand: nullableString(),
  imageUrl: nullableString(),
  sku: nullableString(),
  ean: nullableString(),
  unitSize: numberOrNull(),
  packCount: packCountOrNull(),
  // Plan 0166: position order and never empty, so a reader always has a first.
  categories: {
    ...array(ref(CATALOG_SCHEMA_IDS.itemCategoryView)),
    minItems: 1,
  },
  defaultUnit: ref(CATALOG_SCHEMA_IDS.unitOfMeasure),
  productGroupId: nullableString(),
  // Deliberately NOT required: only the reads that take price scopes fill it,
  // and absent means the same as null (plan 0048, section 3.1).
  bestOffer: {
    anyOf: [ref(CATALOG_SCHEMA_IDS.itemOfferView), { type: 'null' }],
  },
  // Also deliberately NOT required (plan 0109, section 2): only a lookup that
  // asked for `all` fills it, and absent means "this read did not list the
  // scopes", which is a different sentence from an empty array.
  offers: array(ref(CATALOG_SCHEMA_IDS.itemOfferView)),
};

export const itemViewRequired: string[] = [
  'id',
  'name',
  'brand',
  'imageUrl',
  'sku',
  'ean',
  'unitSize',
  'packCount',
  'categories',
  'defaultUnit',
  'productGroupId',
];

const itemView = object(
  CATALOG_SCHEMA_IDS.itemView,
  itemViewProperties,
  itemViewRequired
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
    // Plan 0161: the cheapest few members, only when the request asked.
    members: {
      ...array(ref(CATALOG_SCHEMA_IDS.itemView)),
      maxItems: PRODUCT_GROUP_MEMBERS_MAX,
    },
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
  {
    suggestions: array(ref(CATALOG_SCHEMA_IDS.catalogSuggestion)),
    // Plan 0161: the chain behind every scope an offer above names. Required
    // and possibly empty, like the basket's.
    scopes: array(ref(CATALOG_SCHEMA_IDS.priceScopeChainView)),
  },
  ['suggestions', 'scopes']
);

/** Which chain a scope belongs to (plan 0161, section 3). No shops. */
const priceScopeChainView = object(
  CATALOG_SCHEMA_IDS.priceScopeChainView,
  {
    priceScopeId: nonEmptyString(),
    supermarketId: nonEmptyString(),
    supermarketName: ref(CATALOG_SCHEMA_IDS.localizedText),
    // Plan 0170: the chain's logo, null until an operator sets one.
    supermarketLogoUrl: nullableString(),
  },
  ['priceScopeId', 'supermarketId', 'supermarketName', 'supermarketLogoUrl']
);

// Stated once and used by both views below, so the admin view cannot drift
// from the shopper's row by one forgotten property.
const supermarketItemProperties = () => ({
  id: nonEmptyString(),
  itemId: nonEmptyString(),
  priceScopeId: nonEmptyString(),
  price: numberOrNull(),
  currency: nullableString(),
  unitPrice: numberOrNull(),
  unitPriceLabel: nullableString(),
  unitBasis: nullableUnitBasis(),
  observedAt: nullableString(),
  sourceKind: nullableSourceKind(),
  // Plan 0118. Stated but not required, so a reader built before it keeps
  // validating what it holds.
  priceCopiedFromScopeId: nullableString(),
  stale: boolean(),
  validUntil: nullableString(),
  itemPriceId: nullableString(),
  available: boolean(),
});
const SUPERMARKET_ITEM_REQUIRED = [
  'id',
  'itemId',
  'priceScopeId',
  'price',
  'currency',
  'unitPrice',
  'unitPriceLabel',
  'observedAt',
  'sourceKind',
  'stale',
  'validUntil',
  'itemPriceId',
  'available',
];

const supermarketItemView = object(
  CATALOG_SCHEMA_IDS.supermarketItemView,
  supermarketItemProperties(),
  SUPERMARKET_ITEM_REQUIRED
);

// The back office's row (admin plan 0023, section 3): the shopper's row plus
// the product's name, joined on by `supermarketItem.adminList` and by nothing
// else. A separate view because the shopper page is velista's contract.
const adminSupermarketItemView = object(
  CATALOG_SCHEMA_IDS.adminSupermarketItemView,
  { ...supermarketItemProperties(), itemName: nullableLocalized() },
  [...SUPERMARKET_ITEM_REQUIRED, 'itemName']
);

// --- Item prices and policies (plan 0080) ----------------------------------

const itemPriceOverride = object(
  CATALOG_SCHEMA_IDS.itemPriceOverride,
  { price: numberOrNull(), unitPrice: numberOrNull() },
  ['price', 'unitPrice']
);
// Keyed by source kind. A free object rather than one property per kind, so a
// kind added to the enum later needs no schema change here.
const itemPriceOverrides: JsonSchema = {
  $id: CATALOG_SCHEMA_IDS.itemPriceOverrides,
  type: 'object',
  additionalProperties: ref(CATALOG_SCHEMA_IDS.itemPriceOverride),
};
/**
 * What a leaflet printed beside a price (plan 0081, section 6.4). Stored
 * verbatim on its own table and read by nothing but the admin price history;
 * `promotion` and `loyalty` are the extractor objects exactly as they arrived,
 * so neither is described field by field here.
 */
const itemPriceDetails = object(
  CATALOG_SCHEMA_IDS.itemPriceDetails,
  {
    offerId: nullableString(),
    page: integerOrNull(),
    rawText: array(string()),
    promotion: { anyOf: [freeObject(), { type: 'null' }] },
    loyalty: { anyOf: [freeObject(), { type: 'null' }] },
  },
  ['offerId', 'page', 'rawText', 'promotion', 'loyalty']
);
const itemPriceView = object(
  CATALOG_SCHEMA_IDS.itemPriceView,
  {
    id: nonEmptyString(),
    itemId: nonEmptyString(),
    priceScopeId: nonEmptyString(),
    sourceKind: ref(CATALOG_SCHEMA_IDS.priceSourceKind),
    price: numberOrNull(),
    currency: nullableString(),
    unitPrice: numberOrNull(),
    unitPriceLabel: nullableString(),
    unitBasis: nullableUnitBasis(),
    observedAt: nonEmptyString(),
    lastObservedAt: nonEmptyString(),
    validFrom: nullableString(),
    validUntil: nullableString(),
    sourceRunId: nullableString(),
    lastObservedRunId: nullableString(),
    // Plan 0118. Stated but not required, like the materialized one.
    copiedFromScopeId: nullableString(),
    overrides: {
      anyOf: [ref(CATALOG_SCHEMA_IDS.itemPriceOverrides), { type: 'null' }],
    },
    protectedUntil: nullableString(),
    details: {
      anyOf: [ref(CATALOG_SCHEMA_IDS.itemPriceDetails), { type: 'null' }],
    },
    // Plan 0160. On the run's read only, so stated and never required.
    writtenBy: ref(CATALOG_SCHEMA_IDS.itemPriceWrittenBy),
  },
  [
    'id',
    'itemId',
    'priceScopeId',
    'sourceKind',
    'price',
    'currency',
    'unitPrice',
    'unitPriceLabel',
    'observedAt',
    'lastObservedAt',
    'validFrom',
    'validUntil',
    'sourceRunId',
    'lastObservedRunId',
    'overrides',
    'protectedUntil',
    'details',
  ]
);
const itemPricePage = paginated(
  CATALOG_SCHEMA_IDS.itemPricePage,
  CATALOG_SCHEMA_IDS.itemPriceView
);
/**
 * One scope of one product, with the row the price decision chose there and
 * why (plan 0160). `shownBecause` comes from the decision function itself.
 */
const itemScopePricesView = object(
  CATALOG_SCHEMA_IDS.itemScopePricesView,
  {
    priceScopeId: nonEmptyString(),
    supermarketId: nonEmptyString(),
    scopeKind: ref(CATALOG_SCHEMA_IDS.priceScopeKind),
    scopeExternalKey: nullableString(),
    scopeLabel: nullableLocalized(),
    scopePriority: integer(),
    rows: array(ref(CATALOG_SCHEMA_IDS.itemPriceView)),
    shownItemPriceId: nullableString(),
    shownBecause: {
      anyOf: [ref(CATALOG_SCHEMA_IDS.priceShownBecause), { type: 'null' }],
    },
    stale: boolean(),
    protectedUntil: nullableString(),
    overrides: {
      anyOf: [ref(CATALOG_SCHEMA_IDS.itemPriceOverrides), { type: 'null' }],
    },
  },
  [
    'priceScopeId',
    'supermarketId',
    'scopeKind',
    'scopeExternalKey',
    'scopeLabel',
    'scopePriority',
    'rows',
    'shownItemPriceId',
    'shownBecause',
    'stale',
    'protectedUntil',
    'overrides',
  ]
);
const itemScopePricesPage = paginated(
  CATALOG_SCHEMA_IDS.itemScopePricesPage,
  CATALOG_SCHEMA_IDS.itemScopePricesView
);
const pricePolicyView = object(
  CATALOG_SCHEMA_IDS.pricePolicyView,
  {
    sourceKind: ref(CATALOG_SCHEMA_IDS.priceSourceKind),
    priority: integer(),
    maxAgeDays: { type: ['integer', 'null'], minimum: 1 },
    enabled: boolean(),
  },
  ['sourceKind', 'priority', 'maxAgeDays', 'enabled']
);
const pricePolicyListView = object(
  CATALOG_SCHEMA_IDS.pricePolicyListView,
  { items: array(ref(CATALOG_SCHEMA_IDS.pricePolicyView)) },
  ['items']
);

const supermarketLocationItemView = object(
  CATALOG_SCHEMA_IDS.supermarketLocationItemView,
  {
    id: nonEmptyString(),
    itemId: nonEmptyString(),
    supermarketLocationId: nonEmptyString(),
    positionInStore: nullableString(),
    available: { type: ['boolean', 'null'] },
    availabilitySourceKind: nullableSourceKind(),
    availabilityObservedAt: nullableString(),
    availabilitySourceRunId: nullableString(),
  },
  [
    'id',
    'itemId',
    'supermarketLocationId',
    'positionInStore',
    'available',
    'availabilitySourceKind',
    'availabilityObservedAt',
    'availabilitySourceRunId',
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
const adminSupermarketItemPage = paginated(
  CATALOG_SCHEMA_IDS.adminSupermarketItemPage,
  CATALOG_SCHEMA_IDS.adminSupermarketItemView
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

/**
 * What every brand shaped answer carries (plan 0115, section 5.1, and plan
 * 0124, section 6).
 *
 * Named once and spread, because the create and the update answers are the same
 * row plus one count each and the wire type generator reads `properties`: an
 * `allOf` would produce a type with none.
 */
const brandViewProperties = {
  id: nonEmptyString(),
  key: nonEmptyString({
    description:
      'Made from the label with everything but letters and digits taken out. Never sent by a client: editing the label is the only thing that changes it.',
  }),
  label: nonEmptyString({
    description: 'How the brand is written everywhere a person reads it.',
  }),
  privateLabelSupermarketId: nullableString(),
  itemCount: integer({
    description: 'Products whose `brandId` is this brand.',
  }),
  canonicalBrandId: {
    ...nullableString(),
    description:
      'The brand this one is really a spelling of, or null when it stands for itself. One level deep: a linked brand is never itself pointed at.',
  },
  canonicalLabel: {
    ...nullableString(),
    description:
      'That brand’s label, joined on the read. Null for a brand that is not linked.',
  },
  linkCount: integer({
    description: 'How many brands point at this one.',
  }),
  createdAt: nonEmptyString(),
  updatedAt: nonEmptyString(),
};

const brandViewRequired = [
  'id',
  'key',
  'label',
  'privateLabelSupermarketId',
  'itemCount',
  'canonicalBrandId',
  'canonicalLabel',
  'linkCount',
  'createdAt',
  'updatedAt',
];

/** One registered brand (plan 0115, section 5.1). */
const brandView = object(
  CATALOG_SCHEMA_IDS.brandView,
  brandViewProperties,
  brandViewRequired
);

const brandPage = paginated(
  CATALOG_SCHEMA_IDS.brandPage,
  CATALOG_SCHEMA_IDS.brandView
);

/**
 * The create answer: the brand, plus how many products it picked up.
 *
 * Spelled out rather than composed with `allOf`, because the wire type
 * generator reads `properties` and an `allOf` would produce a type with none.
 */
const createBrandResult = object(
  CATALOG_SCHEMA_IDS.createBrandResult,
  {
    ...brandViewProperties,
    linkedItems: integer({
      description:
        'How many products already carrying this key were linked by the create. Zero when none did.',
    }),
  },
  [...brandViewRequired, 'linkedItems']
);

/** The update answer: the brand, plus how many products the edit moved. */
const updateBrandResult = object(
  CATALOG_SCHEMA_IDS.updateBrandResult,
  {
    ...brandViewProperties,
    movedItems: integer({
      description:
        'How many products the changed link moved. Zero for an edit that changed no link.',
    }),
  },
  [...brandViewRequired, 'movedItems']
);

/**
 * A suggestion registered under a typed name (plan 0124, section 5).
 *
 * `brand` is the canonical brand, read again after the products moved, and
 * `linked` is the brand created for the suggestion's own spelling, null when the
 * typed name keys to that same spelling.
 */
const registerBrandSuggestionResult = object(
  CATALOG_SCHEMA_IDS.registerBrandSuggestionResult,
  {
    brand: ref(CATALOG_SCHEMA_IDS.brandView),
    linked: {
      anyOf: [ref(CATALOG_SCHEMA_IDS.brandView), { type: 'null' }],
    },
    canonicalCreated: boolean(),
    linkedItems: integer({
      description: 'Products the two keys picked up between them.',
    }),
  },
  ['brand', 'linked', 'canonicalCreated', 'linkedItems']
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
    query: string(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId']
);

const locationFields = {
  priceScopeId: string(),
  // The whole stack (plan 0105, section 3), of which `priceScopeId` is the one
  // entry shorthand. Naming both is refused rather than merged.
  priceScopeIds: array(nonEmptyString()),
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
  // Plan 0176: never null, so a place that carries no size cannot clear one.
  footprintM2: integer({ minimum: 1 }),
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
    // Admin plan 0011, section 4: free text over the label, the address and the
    // town, for the reference picker that binds a source's shop to one of ours.
    query: string(),
    // Plan 0066, section 4: only the shops that sell at this scope.
    priceScopeId: nonEmptyString(),
    // Plan 0073, section 4: the guessed postal codes, for the operator's review.
    postalCodeSource: ref(CATALOG_SCHEMA_IDS.postalCodeSource),
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
    packCount: packCountOrNull(),
    categoryIds: categoryIds(),
    defaultUnit: ref(CATALOG_SCHEMA_IDS.unitOfMeasure),
    productGroupId: nullableString(),
  },
  ['userId', 'name', 'categoryIds', 'defaultUnit']
);
/**
 * The fields one product's edit may carry, stated once and used by the single
 * update and by the update op of the items batch (plan 0166, section 3).
 */
const updateItemFields = {
  itemId: nonEmptyString(),
  name: ref(CATALOG_SCHEMA_IDS.localizedText),
  brand: nullableString(),
  imageUrl: nullableString(),
  sku: nullableString(),
  ean: nullableString(),
  unitSize: numberOrNull(),
  packCount: packCountOrNull(),
  // Replaces the whole set. Never empty, because a product always has one.
  categoryIds: categoryIds(),
  defaultUnit: ref(CATALOG_SCHEMA_IDS.unitOfMeasure),
  productGroupId: nullableString(),
};
const updateItemRequest = object(
  CATALOG_SCHEMA_IDS.updateItemRequest,
  { ...adminCredentialProperties, ...updateItemFields },
  ['userId', 'itemId']
);
/** A product of a bulk update: {@link updateItemRequest} without the credential. */
const updateItemInput = object(
  CATALOG_SCHEMA_IDS.updateItemInput,
  updateItemFields,
  ['itemId']
);
const updateItemsRequest = object(
  CATALOG_SCHEMA_IDS.updateItemsRequest,
  {
    ...adminCredentialProperties,
    items: {
      ...array(ref(CATALOG_SCHEMA_IDS.updateItemInput)),
      minItems: 1,
      maxItems: BULK_DECISION_MAX_OPERATIONS,
    },
  },
  ['userId', 'items']
);
/** One view per input, as it now stands, in the order the request named them. */
const updateItemsResult = object(
  CATALOG_SCHEMA_IDS.updateItemsResult,
  { items: array(ref(CATALOG_SCHEMA_IDS.itemView)) },
  ['items']
);

// --- The category tree (plan 0166, sections 1 to 3) -------------------------

const categoryTreeRequest = object(
  CATALOG_SCHEMA_IDS.categoryTreeRequest,
  { userId: nonEmptyString() },
  ['userId']
);
const createCategoryRequest = object(
  CATALOG_SCHEMA_IDS.createCategoryRequest,
  {
    ...adminCredentialProperties,
    // Absent or null makes a root.
    parentId: nullableString(),
    slug: nonEmptyString({ maxLength: CATEGORY_SLUG_MAX_LENGTH }),
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    position: integer({ minimum: 0 }),
  },
  ['userId', 'slug', 'name']
);
// No slug: it is an identity, written once on create.
const updateCategoryRequest = object(
  CATALOG_SCHEMA_IDS.updateCategoryRequest,
  {
    ...adminCredentialProperties,
    categoryId: nonEmptyString(),
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    position: integer({ minimum: 0 }),
    parentId: nullableString(),
  },
  ['userId', 'categoryId']
);
const categoryIdRequest = object(
  CATALOG_SCHEMA_IDS.categoryIdRequest,
  { ...adminCredentialProperties, categoryId: nonEmptyString() },
  ['userId', 'categoryId']
);
const listCategoriesRequest = object(
  CATALOG_SCHEMA_IDS.listCategoriesRequest,
  {
    userId: nonEmptyString(),
    parentId: nonEmptyString(),
    withoutParent: boolean(),
    kind: { type: 'string', enum: [...CATEGORY_KINDS] },
    query: string(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId']
);

// --- Shop sections (plan 0167, sections 1 to 4) -----------------------------

/** A list of ids with no repeats, bounded. May be empty. */
const distinctIds = (maxItems: number): JsonSchema => ({
  ...array(nonEmptyString()),
  maxItems,
  uniqueItems: true,
});

/**
 * One section of a chain. `locationCount` is deliberately NOT required: the
 * back office's reads of a section carry it, and a shop's list does not.
 */
const supermarketSectionView = object(
  CATALOG_SCHEMA_IDS.supermarketSectionView,
  {
    id: nonEmptyString(),
    supermarketId: nonEmptyString(),
    slug: nonEmptyString({ maxLength: SECTION_SLUG_MAX_LENGTH }),
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    position: integer({ minimum: 0 }),
    categoryIds: {
      ...array(nonEmptyString()),
      description:
        'Roots and leaves, as written. A root covers every one of its children.',
    },
    locationCount: integer({
      minimum: 0,
      description:
        'The shops of the chain this section is present at: the ones whose own list names it, plus the ones with no list of their own. Present on the back office reads of a section, absent inside a shop’s list.',
    }),
  },
  ['id', 'supermarketId', 'slug', 'name', 'position', 'categoryIds']
);

const supermarketSectionPage = paginated(
  CATALOG_SCHEMA_IDS.supermarketSectionPage,
  CATALOG_SCHEMA_IDS.supermarketSectionView
);

const locationSectionsView = object(
  CATALOG_SCHEMA_IDS.locationSectionsView,
  {
    sections: array(ref(CATALOG_SCHEMA_IDS.supermarketSectionView)),
    source: ref(CATALOG_SCHEMA_IDS.locationSectionsSource),
  },
  ['sections', 'source']
);

/** One section of a shop, as a shop row draws it (plan 0170). */
const locationSectionNameView = object(
  CATALOG_SCHEMA_IDS.locationSectionNameView,
  {
    id: nonEmptyString(),
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
  },
  ['id', 'name']
);

/** Each shop's section names, keyed by shop id (plan 0170). */
const locationSectionNamesView = object(
  CATALOG_SCHEMA_IDS.locationSectionNamesView,
  {
    locations: {
      type: 'object',
      additionalProperties: array(
        ref(CATALOG_SCHEMA_IDS.locationSectionNameView)
      ),
    },
  },
  ['locations']
);

const itemSectionPinsView = object(
  CATALOG_SCHEMA_IDS.itemSectionPinsView,
  {
    supermarketId: nonEmptyString(),
    itemId: nonEmptyString(),
    sectionIds: array(nonEmptyString()),
  },
  ['supermarketId', 'itemId', 'sectionIds']
);

const itemSectionPinsPage = paginated(
  CATALOG_SCHEMA_IDS.itemSectionPinsPage,
  CATALOG_SCHEMA_IDS.itemSectionPinsView
);

const itemSectionsAtLocationEntry = object(
  CATALOG_SCHEMA_IDS.itemSectionsAtLocationEntry,
  {
    itemId: nonEmptyString(),
    sectionIds: array(nonEmptyString()),
    step: ref(CATALOG_SCHEMA_IDS.sectionRuleStep),
  },
  ['itemId', 'sectionIds', 'step']
);

const itemSectionsAtLocationView = object(
  CATALOG_SCHEMA_IDS.itemSectionsAtLocationView,
  {
    source: ref(CATALOG_SCHEMA_IDS.locationSectionsSource),
    items: array(ref(CATALOG_SCHEMA_IDS.itemSectionsAtLocationEntry)),
  },
  ['source', 'items']
);

const createSupermarketSectionRequest = object(
  CATALOG_SCHEMA_IDS.createSupermarketSectionRequest,
  {
    ...adminCredentialProperties,
    supermarketId: nonEmptyString(),
    slug: nonEmptyString({ maxLength: SECTION_SLUG_MAX_LENGTH }),
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    categoryIds: distinctIds(SECTION_LIMITS.maxCategoriesPerSection),
    position: integer({ minimum: 0 }),
  },
  ['userId', 'supermarketId', 'slug', 'name', 'categoryIds']
);
// No slug: it is an identity, written once on create.
const updateSupermarketSectionRequest = object(
  CATALOG_SCHEMA_IDS.updateSupermarketSectionRequest,
  {
    ...adminCredentialProperties,
    sectionId: nonEmptyString(),
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    position: integer({ minimum: 0 }),
    categoryIds: distinctIds(SECTION_LIMITS.maxCategoriesPerSection),
  },
  ['userId', 'sectionId']
);
const supermarketSectionIdRequest = object(
  CATALOG_SCHEMA_IDS.supermarketSectionIdRequest,
  { ...adminCredentialProperties, sectionId: nonEmptyString() },
  ['userId', 'sectionId']
);
const listSupermarketSectionsRequest = object(
  CATALOG_SCHEMA_IDS.listSupermarketSectionsRequest,
  {
    userId: nonEmptyString(),
    supermarketId: nonEmptyString(),
    query: string(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId', 'supermarketId']
);
// No userId, like shopAvailability: a guest reading a shared basket asks.
const locationSectionsRequest = object(
  CATALOG_SCHEMA_IDS.locationSectionsRequest,
  { supermarketLocationId: nonEmptyString() },
  ['supermarketLocationId']
);
const setLocationSectionsRequest = object(
  CATALOG_SCHEMA_IDS.setLocationSectionsRequest,
  {
    ...adminCredentialProperties,
    supermarketLocationId: nonEmptyString(),
    // Empty returns the shop to its chain's default.
    sectionIds: distinctIds(SECTION_LIMITS.maxSectionsPerLocation),
  },
  ['userId', 'supermarketLocationId', 'sectionIds']
);
const listItemSectionPinsRequest = object(
  CATALOG_SCHEMA_IDS.listItemSectionPinsRequest,
  {
    userId: nonEmptyString(),
    supermarketId: nonEmptyString(),
    itemId: nonEmptyString(),
    sectionId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId', 'supermarketId']
);
const setItemSectionPinsRequest = object(
  CATALOG_SCHEMA_IDS.setItemSectionPinsRequest,
  {
    ...adminCredentialProperties,
    supermarketId: nonEmptyString(),
    itemId: nonEmptyString(),
    // Empty removes the pins.
    sectionIds: distinctIds(SECTION_LIMITS.maxPinsPerItem),
  },
  ['userId', 'supermarketId', 'itemId', 'sectionIds']
);
// No userId, for the reason section.forLocation gives. Capped, unlike the
// per shop read below: it is asked about a page of shops rather than a
// basket's products, and a page never holds more than
// maxLocationsPerNamesRead shops (plan 0170, section 2).
const locationSectionNamesRequest = object(
  CATALOG_SCHEMA_IDS.locationSectionNamesRequest,
  {
    supermarketLocationIds: {
      ...array(nonEmptyString()),
      maxItems: SECTION_LIMITS.maxLocationsPerNamesRead,
    },
  },
  ['supermarketLocationIds']
);
// No userId: the basket read of a guest asks it. Unbounded, like the
// shopAvailability request beside it: the basket read sends every product its
// rows name, and a cap here would drop the sections of a large basket whole.
const itemSectionsAtLocationRequest = object(
  CATALOG_SCHEMA_IDS.itemSectionsAtLocationRequest,
  {
    supermarketLocationId: nonEmptyString(),
    itemIds: array(nonEmptyString()),
  },
  ['supermarketLocationId', 'itemIds']
);

// --- The two bulk replays (plan 0100) ---------------------------------------

/**
 * One refused operation, in the shape both bulk routes answer with.
 *
 * The code is for a tool deciding what to do next, the detail for the person
 * reading the report afterwards. Neither is enough on its own: a code cannot
 * say which slug collided, and a sentence cannot be branched on.
 */
const bulkOperationError = object(
  CATALOG_SCHEMA_IDS.bulkOperationError,
  {
    code: ref(CATALOG_SCHEMA_IDS.bulkOperationErrorCode),
    detail: string(),
  },
  ['code', 'detail']
);

/** A product of a bulk create: {@link createItemRequest} without the credential. */
const createItemInput = object(
  CATALOG_SCHEMA_IDS.createItemInput,
  {
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    brand: nullableString(),
    imageUrl: nullableString(),
    sku: nullableString(),
    ean: nullableString(),
    unitSize: numberOrNull(),
    packCount: packCountOrNull(),
    categoryIds: categoryIds(),
    defaultUnit: ref(CATALOG_SCHEMA_IDS.unitOfMeasure),
    productGroupId: nullableString(),
  },
  ['name', 'categoryIds', 'defaultUnit']
);

const createItemsRequest = object(
  CATALOG_SCHEMA_IDS.createItemsRequest,
  {
    ...adminCredentialProperties,
    items: array(ref(CATALOG_SCHEMA_IDS.createItemInput)),
  },
  ['userId', 'items']
);

/** One view per input, in the order the request named them. */
const createItemsResult = object(
  CATALOG_SCHEMA_IDS.createItemsResult,
  { items: array(ref(CATALOG_SCHEMA_IDS.itemView)) },
  ['items']
);

const createProductGroupOperation = object(
  CATALOG_SCHEMA_IDS.createProductGroupOperation,
  {
    op: { const: 'createGroup' },
    ref: nonEmptyString(),
    name: ref(CATALOG_SCHEMA_IDS.localizedText),
    slug: nonEmptyString(),
    referenceUnit: ref(CATALOG_SCHEMA_IDS.unitOfMeasure),
    synonyms: ref(CATALOG_SCHEMA_IDS.localizedSynonyms),
  },
  ['op', 'ref', 'name', 'slug', 'referenceUnit']
);

const assignItemToGroupOperation = object(
  CATALOG_SCHEMA_IDS.assignItemToGroupOperation,
  {
    op: { const: 'assignItem' },
    itemId: nonEmptyString(),
    groupId: nonEmptyString(),
    groupRef: nonEmptyString(),
    expect: {
      type: 'object',
      additionalProperties: false,
      properties: { productGroupId: nullableString() },
      required: ['productGroupId'],
    },
  },
  ['op', 'itemId', 'expect']
);

const applyGroupAssignmentsRequest = object(
  CATALOG_SCHEMA_IDS.applyGroupAssignmentsRequest,
  {
    ...adminCredentialProperties,
    operations: array({
      anyOf: [
        ref(CATALOG_SCHEMA_IDS.createProductGroupOperation),
        ref(CATALOG_SCHEMA_IDS.assignItemToGroupOperation),
      ],
    }),
  },
  ['userId', 'operations']
);

const productGroupAssignmentOutcome = object(
  CATALOG_SCHEMA_IDS.productGroupAssignmentOutcome,
  {
    op: { enum: ['createGroup', 'assignItem'] },
    ref: nullableString(),
    itemId: nullableString(),
    groupId: nullableString(),
    applied: boolean(),
    error: {
      anyOf: [ref(CATALOG_SCHEMA_IDS.bulkOperationError), { type: 'null' }],
    },
  },
  ['op', 'ref', 'itemId', 'groupId', 'applied', 'error']
);

const applyGroupAssignmentsResult = object(
  CATALOG_SCHEMA_IDS.applyGroupAssignmentsResult,
  {
    applied: boolean(),
    error: nullableString(),
    results: array(ref(CATALOG_SCHEMA_IDS.productGroupAssignmentOutcome)),
    createdGroups: array({
      type: 'object',
      additionalProperties: false,
      properties: { ref: nonEmptyString(), groupId: nonEmptyString() },
      required: ['ref', 'groupId'],
    }),
  },
  ['applied', 'error', 'results', 'createdGroups']
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
const findItemsByEansRequest = object(
  CATALOG_SCHEMA_IDS.findItemsByEansRequest,
  {
    userId: nonEmptyString(),
    eans: {
      ...array(nonEmptyString()),
      maxItems: BULK_DECISION_MAX_OPERATIONS,
    },
  },
  ['userId', 'eans']
);
const findItemsByEansResult = object(
  CATALOG_SCHEMA_IDS.findItemsByEansResult,
  { items: array(ref(CATALOG_SCHEMA_IDS.itemView)) },
  ['items']
);
/** One product and the count a run read for it (plan 0162, section 3). */
const packCountFill = object(
  CATALOG_SCHEMA_IDS.packCountFill,
  {
    itemId: nonEmptyString(),
    packCount: integer({ minimum: PACK_COUNT_MIN, maximum: PACK_COUNT_MAX }),
  },
  ['itemId', 'packCount']
);
const fillPackCountsRequest = object(
  CATALOG_SCHEMA_IDS.fillPackCountsRequest,
  {
    ...adminCredentialProperties,
    entries: {
      ...array(ref(CATALOG_SCHEMA_IDS.packCountFill)),
      maxItems: PACK_COUNT_FILL_MAX,
    },
  },
  ['userId', 'entries']
);
const fillPackCountsResult = object(
  CATALOG_SCHEMA_IDS.fillPackCountsResult,
  { written: integer({ minimum: 0 }) },
  ['written']
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
    // Plan 0109: `all` adds every scope's offer beside the cheapest one. Absent
    // is `best`, which is what every caller before that plan sent.
    offers: string({ enum: ['best', 'all'] }),
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
    // Plan 0166: a leaf, or a root meaning any of its children.
    categoryId: nonEmptyString(),
    // Plan 0048: the group filter, and the scopes a price may be quoted from. No
    // default is resolved when the scopes are absent; that is plan 0049.
    productGroupId: string(),
    // Plan 0073: the back office's "what has curation not reached yet".
    withoutProductGroup: boolean(),
    priceScopeIds: array(nonEmptyString()),
    // Plan 0146: which chains sell the products, which is not what the scopes
    // above decide. Absent and empty both mean every chain.
    soldBy: array(nonEmptyString()),
    // Plan 0161: every scope's offer, read as `item.getMany` reads it.
    offers: string({ enum: ['best', 'all'] }),
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
    // Plan 0161: every scope's offer on each cheapest member, and how many
    // members to add as products. A larger count is clamped by the service.
    offers: string({ enum: ['best', 'all'] }),
    members: integer({ minimum: 1 }),
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

// --- Brands (plan 0115, section 5) ------------------------------------------

const createBrandRequest = object(
  CATALOG_SCHEMA_IDS.createBrandRequest,
  {
    ...adminCredentialProperties,
    label: nonEmptyString({ maxLength: BRAND_LABEL_MAX_LENGTH }),
    privateLabelSupermarketId: nullableString(),
    canonicalBrandId: nullableString(),
  },
  ['userId', 'label']
);
const updateBrandRequest = object(
  CATALOG_SCHEMA_IDS.updateBrandRequest,
  {
    ...adminCredentialProperties,
    brandId: nonEmptyString(),
    label: nonEmptyString({ maxLength: BRAND_LABEL_MAX_LENGTH }),
    privateLabelSupermarketId: nullableString(),
    // Null unlinks. Absent leaves the link alone, which is why the two cannot
    // be the same value here.
    canonicalBrandId: nullableString(),
  },
  ['userId', 'brandId']
);
const registerBrandSuggestionRequest = object(
  CATALOG_SCHEMA_IDS.registerBrandSuggestionRequest,
  {
    ...adminCredentialProperties,
    spelling: nonEmptyString({ maxLength: BRAND_LABEL_MAX_LENGTH }),
    label: nonEmptyString({ maxLength: BRAND_LABEL_MAX_LENGTH }),
    privateLabelSupermarketId: nullableString(),
  },
  ['userId', 'spelling', 'label']
);
const deleteBrandRequest = object(
  CATALOG_SCHEMA_IDS.deleteBrandRequest,
  { ...adminCredentialProperties, brandId: nonEmptyString() },
  ['userId', 'brandId']
);
// The `id` every other admin catalog delete answers with, plus the number of
// products the removal put back to unbranded.
const deleteBrandResult = object(
  CATALOG_SCHEMA_IDS.deleteBrandResult,
  {
    id: nonEmptyString(),
    movedItems: integer({
      description:
        'Products that went back to unbranded, keeping the text this spelling was printed as.',
    }),
  },
  ['id', 'movedItems']
);
// A read, so no admin token: the gate on the route is the guard, as every other
// admin catalog read here is.
const brandIdRequest = object(
  CATALOG_SCHEMA_IDS.brandIdRequest,
  { userId: nonEmptyString(), brandId: nonEmptyString() },
  ['userId', 'brandId']
);
const listBrandsRequest = object(
  CATALOG_SCHEMA_IDS.listBrandsRequest,
  {
    userId: nonEmptyString(),
    query: string(),
    privateLabelSupermarketId: string(),
    canonicalBrandId: string(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: { type: 'string', enum: [...BRAND_ORDERS] },
  },
  ['userId']
);
const brandKeysRequest = object(
  CATALOG_SCHEMA_IDS.brandKeysRequest,
  { userId: nonEmptyString() },
  ['userId']
);
const brandKeysResult = object(
  CATALOG_SCHEMA_IDS.brandKeysResult,
  { keys: array(nonEmptyString()) },
  ['keys']
);
// Plan 0178. One brand a printed key names, always one that stands for itself.
const brandMatchView = object(
  CATALOG_SCHEMA_IDS.brandMatchView,
  {
    brandId: nonEmptyString(),
    key: {
      ...nonEmptyString(),
      description:
        'That brand’s own key, which differs from the printed key for a homonym.',
    },
    label: { ...nonEmptyString(), description: 'The brand to write.' },
    privateLabelSupermarketId: nullableString(),
    printedAs: {
      ...nullableString(),
      description:
        'The registered spelling the printed key names, when the registry holds it as a spelling of `label`. Null when the two are the same brand, and on a homonym.',
    },
  },
  ['brandId', 'key', 'label', 'privateLabelSupermarketId', 'printedAs']
);
const brandKeyMatches = object(
  CATALOG_SCHEMA_IDS.brandKeyMatches,
  {
    printedKey: nonEmptyString(),
    brands: {
      ...array(ref(CATALOG_SCHEMA_IDS.brandMatchView)),
      description: 'Every brand the printed key names, its own brand first.',
    },
  },
  ['printedKey', 'brands']
);
const brandHomonymsView = object(
  CATALOG_SCHEMA_IDS.brandHomonymsView,
  {
    brandId: nonEmptyString(),
    printedKeys: {
      ...array(nonEmptyString()),
      description:
        'The printed keys that also name this brand, sorted. Never its own key.',
    },
  },
  ['brandId', 'printedKeys']
);
const brandHomonymRequestProperties = {
  ...adminCredentialProperties,
  brandId: nonEmptyString(),
  printedKey: nonEmptyString({ maxLength: BRAND_LABEL_MAX_LENGTH }),
};
const addBrandHomonymRequest = object(
  CATALOG_SCHEMA_IDS.addBrandHomonymRequest,
  brandHomonymRequestProperties,
  ['userId', 'brandId', 'printedKey']
);
const removeBrandHomonymRequest = object(
  CATALOG_SCHEMA_IDS.removeBrandHomonymRequest,
  brandHomonymRequestProperties,
  ['userId', 'brandId', 'printedKey']
);
const brandMatchesRequest = object(
  CATALOG_SCHEMA_IDS.brandMatchesRequest,
  {
    userId: nonEmptyString(),
    keys: { ...array(nonEmptyString()), maxItems: BRAND_MATCHES_MAX_KEYS },
  },
  ['userId', 'keys']
);
const brandMatchesResult = object(
  CATALOG_SCHEMA_IDS.brandMatchesResult,
  { matches: array(ref(CATALOG_SCHEMA_IDS.brandKeyMatches)) },
  ['matches']
);
// Plan 0160. A name is what `brand.create` takes, without a link: a batch
// registers brands, and a spelling is a decision about two of them.
const registerBrandsEntry = object(
  CATALOG_SCHEMA_IDS.registerBrandsEntry,
  {
    label: nonEmptyString({ maxLength: BRAND_LABEL_MAX_LENGTH }),
    privateLabelSupermarketId: nullableString(),
  },
  ['label']
);
const registerBrandsRequest = object(
  CATALOG_SCHEMA_IDS.registerBrandsRequest,
  {
    ...adminCredentialProperties,
    brands: {
      ...array(ref(CATALOG_SCHEMA_IDS.registerBrandsEntry)),
      minItems: 1,
      maxItems: BRAND_BATCH_MAX,
    },
  },
  ['userId', 'brands']
);
const registerBrandsOutcome = object(
  CATALOG_SCHEMA_IDS.registerBrandsOutcome,
  {
    label: string(),
    outcome: ref(CATALOG_SCHEMA_IDS.brandBatchOutcome),
    brandId: nullableString(),
    linkedItems: integerOrNull(),
    reason: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: { code: nonEmptyString(), detail: string() },
          required: ['code', 'detail'],
        },
        { type: 'null' },
      ],
    },
  },
  ['label', 'outcome', 'brandId', 'linkedItems', 'reason']
);
const registerBrandsResult = object(
  CATALOG_SCHEMA_IDS.registerBrandsResult,
  { results: array(ref(CATALOG_SCHEMA_IDS.registerBrandsOutcome)) },
  ['results']
);

// The values one price row carries (plan 0080, section 9). No `overrides` and
// no `protectedUntil`: an ADMIN add computes its snapshot server side, and a
// caller supplying one is refused by `additionalProperties: false`.
const itemPriceValues = {
  price: numberOrNull(),
  currency: nullableString(),
  unitPrice: numberOrNull(),
  unitPriceLabel: nullableString(),
  observedAt: nullableString(),
  validFrom: nullableString(),
  validUntil: nullableString(),
  // The leaflet tile behind the row, when a leaflet import is writing it (plan
  // 0081, section 6.4). Kept off `item_prices` itself: that table is read on
  // every recompute.
  details: {
    anyOf: [ref(CATALOG_SCHEMA_IDS.itemPriceDetails), { type: 'null' }],
  },
};

const addItemPriceRequest = object(
  CATALOG_SCHEMA_IDS.addItemPriceRequest,
  {
    ...adminCredentialProperties,
    itemId: nonEmptyString(),
    priceScopeId: nonEmptyString(),
    sourceKind: ref(CATALOG_SCHEMA_IDS.priceSourceKind),
    sourceRunId: nullableString(),
    ...itemPriceValues,
  },
  ['userId', 'itemId', 'priceScopeId', 'sourceKind']
);
const itemPriceBatchEntry = object(
  CATALOG_SCHEMA_IDS.itemPriceBatchEntry,
  { itemId: nonEmptyString(), ...itemPriceValues },
  ['itemId']
);
const addItemPriceBatchRequest = object(
  CATALOG_SCHEMA_IDS.addItemPriceBatchRequest,
  {
    ...adminCredentialProperties,
    priceScopeId: nonEmptyString(),
    sourceKind: ref(CATALOG_SCHEMA_IDS.priceSourceKind),
    sourceRunId: nullableString(),
    // The scope a copied batch was read at (plan 0118, section 5).
    copiedFromScopeId: nullableString(),
    entries: array(ref(CATALOG_SCHEMA_IDS.itemPriceBatchEntry)),
  },
  ['userId', 'priceScopeId', 'sourceKind', 'entries']
);
const addItemPriceBatchResult = object(
  CATALOG_SCHEMA_IDS.addItemPriceBatchResult,
  {
    inserted: integer({ minimum: 0 }),
    confirmed: integer({ minimum: 0 }),
  },
  ['inserted', 'confirmed']
);
// Either the history of one (item, scope), or one run's rows (plan 0160).
// Which pair was named is checked by catalog, where the refusal can say so.
const listItemPricesRequest = object(
  CATALOG_SCHEMA_IDS.listItemPricesRequest,
  {
    ...adminCredentialProperties,
    itemId: nonEmptyString(),
    priceScopeId: nonEmptyString(),
    runId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId']
);
const itemPricesByItemRequest = object(
  CATALOG_SCHEMA_IDS.itemPricesByItemRequest,
  {
    ...adminCredentialProperties,
    itemId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
  },
  ['userId', 'itemId']
);
const itemPriceIdRequest = object(
  CATALOG_SCHEMA_IDS.itemPriceIdRequest,
  { ...adminCredentialProperties, itemPriceId: nonEmptyString() },
  ['userId', 'itemPriceId']
);
const deleteItemPricesByRunRequest = object(
  CATALOG_SCHEMA_IDS.deleteItemPricesByRunRequest,
  { ...adminCredentialProperties, sourceRunId: nonEmptyString() },
  ['userId', 'sourceRunId']
);
const deleteItemPricesByRunResult = object(
  CATALOG_SCHEMA_IDS.deleteItemPricesByRunResult,
  {
    deleted: integer({ minimum: 0 }),
    reset: integer({ minimum: 0 }),
    recomputed: integer({ minimum: 0 }),
  },
  ['deleted', 'reset', 'recomputed']
);
const setSupermarketItemAvailabilityRequest = object(
  CATALOG_SCHEMA_IDS.setSupermarketItemAvailabilityRequest,
  {
    ...adminCredentialProperties,
    priceScopeId: nonEmptyString(),
    entries: array({
      type: 'object',
      properties: { itemId: nonEmptyString(), available: boolean() },
      required: ['itemId', 'available'],
      additionalProperties: false,
    }),
  },
  ['userId', 'priceScopeId', 'entries']
);
const setSupermarketItemAvailabilityResult = object(
  CATALOG_SCHEMA_IDS.setSupermarketItemAvailabilityResult,
  { updated: integer({ minimum: 0 }) },
  ['updated']
);
const listPricePoliciesRequest = object(
  CATALOG_SCHEMA_IDS.listPricePoliciesRequest,
  { ...adminCredentialProperties },
  ['userId']
);
const updatePricePolicyRequest = object(
  CATALOG_SCHEMA_IDS.updatePricePolicyRequest,
  {
    ...adminCredentialProperties,
    sourceKind: ref(CATALOG_SCHEMA_IDS.priceSourceKind),
    priority: integer(),
    maxAgeDays: { type: ['integer', 'null'], minimum: 1 },
    enabled: boolean(),
  },
  ['userId', 'sourceKind']
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
// Plan 0073, section 4. Every filter optional, so the empty request is the whole
// table: the three lists above each require the thing they start from, and this
// one starts from nothing on purpose.
const adminListSupermarketItemsRequest = object(
  CATALOG_SCHEMA_IDS.adminListSupermarketItemsRequest,
  {
    ...adminCredentialProperties,
    itemId: nonEmptyString(),
    priceScopeId: nonEmptyString(),
    sourceKind: ref(CATALOG_SCHEMA_IDS.priceSourceKind),
    stale: boolean(),
    available: boolean(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId']
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
    // Absent takes the default for the kind (plan 0105, section 2.2).
    priority: integer({ minimum: 0 }),
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
    priority: integer({ minimum: 0 }),
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
    kinds: array(ref(CATALOG_SCHEMA_IDS.priceScopeKind)),
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
    // The shop this scope was reached through, its priority, and whether it is
    // the tier that shop is quoted from (plan 0105, section 5).
    supermarketLocationId: nullableString(),
    priority: integer(),
    quoted: boolean(),
    // Plan 0157. Stated but not required, so a reader built before it keeps
    // validating what it holds.
    priced: boolean(),
  },
  [
    'priceScopeId',
    'supermarketId',
    'postalCode',
    'origin',
    'approximate',
    'supermarketLocationId',
    'priority',
    'quoted',
  ]
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
const setLocationItemAvailabilityRequest = object(
  CATALOG_SCHEMA_IDS.setLocationItemAvailabilityRequest,
  {
    ...adminCredentialProperties,
    supermarketLocationId: nonEmptyString(),
    sourceKind: ref(CATALOG_SCHEMA_IDS.priceSourceKind),
    sourceRunId: nullableString(),
    observedAt: string(),
    entries: array({
      type: 'object',
      properties: { itemId: nonEmptyString(), available: boolean() },
      required: ['itemId', 'available'],
      additionalProperties: false,
    }),
  },
  ['userId', 'supermarketLocationId', 'sourceKind', 'entries']
);
const locationItemAvailabilityConflict = object(
  CATALOG_SCHEMA_IDS.locationItemAvailabilityConflict,
  {
    itemId: nonEmptyString(),
    held: { type: ['boolean', 'null'] },
    offered: boolean(),
  },
  ['itemId', 'held', 'offered']
);
const setLocationItemAvailabilityResult = object(
  CATALOG_SCHEMA_IDS.setLocationItemAvailabilityResult,
  {
    written: integer({ minimum: 0 }),
    skipped: integer({ minimum: 0 }),
    conflicts: array(ref(CATALOG_SCHEMA_IDS.locationItemAvailabilityConflict)),
  },
  ['written', 'skipped', 'conflicts']
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

// --- The centroid table, for the back office (plan 0074) -------------------

const adminPostalCodeView = object(
  CATALOG_SCHEMA_IDS.adminPostalCodeView,
  {
    country: countryCode(),
    postalCode: nonEmptyString(),
    latitude: { type: 'number' },
    longitude: { type: 'number' },
    locationCount: integer({ minimum: 0 }),
  },
  ['country', 'postalCode', 'latitude', 'longitude', 'locationCount']
);

const adminPostalCodePage = paginated(
  CATALOG_SCHEMA_IDS.adminPostalCodePage,
  CATALOG_SCHEMA_IDS.adminPostalCodeView
);

// `served` absent is every code, which is the default because a listing that hid
// the unserved ones would hide the coverage gap it exists to show.
const listAdminPostalCodesRequest = object(
  CATALOG_SCHEMA_IDS.listAdminPostalCodesRequest,
  {
    ...adminCredentialProperties,
    country: string(),
    postalCode: string(),
    served: boolean(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId']
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

/**
 * A shop and the availability of some products there (plan 0163, section 2).
 *
 * No `userId`, like `item.getMany`: a shop and whether it stocks a product are
 * not private, and a guest reading a shared basket is who asks.
 */
const shopAvailabilityRequest = object(
  CATALOG_SCHEMA_IDS.shopAvailabilityRequest,
  {
    supermarketLocationId: nonEmptyString(),
    itemIds: array(nonEmptyString()),
  },
  ['supermarketLocationId']
);

const shopItemAvailabilityView = object(
  CATALOG_SCHEMA_IDS.shopItemAvailabilityView,
  {
    itemId: nonEmptyString(),
    // Null is a row that says nothing, which is not the same as no row: a
    // product with no row is absent from the answer.
    available: { type: ['boolean', 'null'] },
  },
  ['itemId', 'available']
);

const shopAvailabilityView = object(
  CATALOG_SCHEMA_IDS.shopAvailabilityView,
  {
    location: ref(CATALOG_SCHEMA_IDS.supermarketLocationView),
    supermarket: ref(CATALOG_SCHEMA_IDS.supermarketView),
    availability: array(ref(CATALOG_SCHEMA_IDS.shopItemAvailabilityView)),
  },
  ['location', 'supermarket', 'availability']
);

/**
 * A shop's chain and scope stack (plan 0170, section 4). No `userId`, like
 * `shopAvailability`: the gateway has already decided the reader may ask.
 */
const locationPriceStackRequest = object(
  CATALOG_SCHEMA_IDS.locationPriceStackRequest,
  { supermarketLocationId: nonEmptyString() },
  ['supermarketLocationId']
);

const supermarketLocationPriceStackView = object(
  CATALOG_SCHEMA_IDS.supermarketLocationPriceStackView,
  {
    id: nonEmptyString(),
    supermarketId: nonEmptyString(),
    // The whole stack, most specific first, as on the location view.
    priceScopeIds: array(nonEmptyString()),
  },
  ['id', 'supermarketId', 'priceScopeIds']
);

/**
 * The shop view of plan 0163, by id rather than by import: basket.schemas
 * imports this file, and a ref names a schema by its id alone.
 */
const BASKET_SHOP_VIEW_ID = schemaId('basket/BasketShopView');

/**
 * Where a device says it is (plan 0164, section 1). The bounds are the ones a
 * coordinate has, and the point is never stored.
 */
const nearbyShopsRequest = object(
  CATALOG_SCHEMA_IDS.nearbyShopsRequest,
  {
    latitude: { type: 'number', minimum: -90, maximum: 90 },
    longitude: { type: 'number', minimum: -180, maximum: 180 },
    accuracyMetres: { type: 'number', minimum: 0 },
    profilePostalCodes: array(nonEmptyString()),
    excludedSupermarketIds: array(nonEmptyString()),
    excludedSupermarketLocationIds: array(nonEmptyString()),
  },
  [
    'latitude',
    'longitude',
    'accuracyMetres',
    'profilePostalCodes',
    'excludedSupermarketIds',
    'excludedSupermarketLocationIds',
  ]
);

/**
 * The shop view of plan 0163 with its distance and whether the profile
 * refuses it. The shop view's fields are listed rather than extended, because a
 * contract schema is one flat object.
 */
const nearbyShopView = object(
  CATALOG_SCHEMA_IDS.nearbyShopView,
  {
    id: nonEmptyString(),
    supermarketId: nonEmptyString(),
    supermarketName: ref(CATALOG_SCHEMA_IDS.localizedText),
    supermarketLogoUrl: nullableString(),
    label: nullableLocalized(),
    address: nullableString(),
    city: nullableString(),
    postalCode: nullableString(),
    inProfile: boolean(),
    sections: array(ref(CATALOG_SCHEMA_IDS.locationSectionNameView)),
    distanceMetres: integer({ minimum: 0 }),
    excluded: boolean(),
  },
  [
    'id',
    'supermarketId',
    'supermarketName',
    'supermarketLogoUrl',
    'label',
    'address',
    'city',
    'postalCode',
    'inProfile',
    'sections',
    'distanceMetres',
    'excluded',
  ]
);

const nearbyShopPickView = object(
  CATALOG_SCHEMA_IDS.nearbyShopPickView,
  {
    locationId: nonEmptyString(),
    distanceMetres: integer({ minimum: 0 }),
  },
  ['locationId', 'distanceMetres']
);

/** Exactly one of `pick` and `noPick` is set (plan 0164, section 2). */
const nearbyShopsView = object(
  CATALOG_SCHEMA_IDS.nearbyShopsView,
  {
    candidates: array(ref(CATALOG_SCHEMA_IDS.nearbyShopView)),
    pick: {
      anyOf: [ref(CATALOG_SCHEMA_IDS.nearbyShopPickView), { type: 'null' }],
    },
    noPick: {
      anyOf: [ref(CATALOG_SCHEMA_IDS.nearbyShopNoPick), { type: 'null' }],
    },
  },
  ['candidates', 'pick', 'noPick']
);

const shopsByIdRequest = object(
  CATALOG_SCHEMA_IDS.shopsByIdRequest,
  {
    supermarketLocationIds: array(nonEmptyString()),
    profilePostalCodes: array(nonEmptyString()),
  },
  ['supermarketLocationIds', 'profilePostalCodes']
);

const shopsByIdView = object(
  CATALOG_SCHEMA_IDS.shopsByIdView,
  { shops: array(ref(BASKET_SHOP_VIEW_ID)) },
  ['shops']
);

export const catalogSchemas: JsonSchema[] = [
  enumOf(CATALOG_SCHEMA_IDS.unitOfMeasure, Object.values(UnitOfMeasure)),
  enumOf(CATALOG_SCHEMA_IDS.priceScopeKind, Object.values(PriceScopeKind)),
  enumOf(CATALOG_SCHEMA_IDS.priceSourceKind, Object.values(PriceSourceKind)),
  enumOf(CATALOG_SCHEMA_IDS.postalCodeSource, Object.values(PostalCodeSource)),
  enumOf(
    CATALOG_SCHEMA_IDS.bulkOperationErrorCode,
    Object.values(BulkOperationErrorCode)
  ),
  enumOf(
    CATALOG_SCHEMA_IDS.itemPriceWrittenBy,
    Object.values(ItemPriceWrittenBy)
  ),
  enumOf(
    CATALOG_SCHEMA_IDS.priceShownBecause,
    Object.values(PriceShownBecause)
  ),
  enumOf(
    CATALOG_SCHEMA_IDS.brandBatchOutcome,
    Object.values(BrandBatchOutcome)
  ),
  localizedText,
  localizedSynonyms,
  supermarketView,
  supermarketLocationView,
  priceScopeView,
  productGroupView,
  itemOfferView,
  categoryView,
  categoryTreeView,
  categoryPage,
  itemCategoryView,
  enumOf(CATALOG_SCHEMA_IDS.locationSectionsSource, LOCATION_SECTIONS_SOURCES),
  enumOf(CATALOG_SCHEMA_IDS.sectionRuleStep, SECTION_RULE_STEPS),
  supermarketSectionView,
  supermarketSectionPage,
  locationSectionsView,
  locationSectionNameView,
  locationSectionNamesView,
  itemSectionPinsView,
  itemSectionPinsPage,
  itemSectionsAtLocationEntry,
  itemSectionsAtLocationView,
  itemView,
  productGroupOfferView,
  catalogSuggestion,
  catalogSuggestResponse,
  priceScopeChainView,
  supermarketItemView,
  adminSupermarketItemView,
  supermarketLocationItemView,
  supermarketPage,
  supermarketLocationPage,
  priceScopePage,
  itemPage,
  productGroupPage,
  productGroupOfferPage,
  brandView,
  brandPage,
  createBrandResult,
  updateBrandResult,
  registerBrandSuggestionResult,
  createBrandRequest,
  updateBrandRequest,
  registerBrandSuggestionRequest,
  deleteBrandRequest,
  deleteBrandResult,
  brandIdRequest,
  listBrandsRequest,
  brandKeysRequest,
  brandKeysResult,
  registerBrandsEntry,
  registerBrandsRequest,
  registerBrandsOutcome,
  registerBrandsResult,
  brandMatchView,
  brandKeyMatches,
  brandHomonymsView,
  addBrandHomonymRequest,
  removeBrandHomonymRequest,
  brandMatchesRequest,
  brandMatchesResult,
  supermarketItemPage,
  adminSupermarketItemPage,
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
  bulkOperationError,
  createItemInput,
  createItemsRequest,
  createItemsResult,
  updateItemInput,
  updateItemsRequest,
  updateItemsResult,
  categoryTreeRequest,
  createCategoryRequest,
  updateCategoryRequest,
  categoryIdRequest,
  listCategoriesRequest,
  createSupermarketSectionRequest,
  updateSupermarketSectionRequest,
  supermarketSectionIdRequest,
  listSupermarketSectionsRequest,
  locationSectionsRequest,
  setLocationSectionsRequest,
  listItemSectionPinsRequest,
  setItemSectionPinsRequest,
  itemSectionsAtLocationRequest,
  locationSectionNamesRequest,
  createProductGroupOperation,
  assignItemToGroupOperation,
  productGroupAssignmentOutcome,
  applyGroupAssignmentsRequest,
  applyGroupAssignmentsResult,
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
  findItemsByEansRequest,
  findItemsByEansResult,
  packCountFill,
  fillPackCountsRequest,
  fillPackCountsResult,
  itemPriceOverride,
  itemPriceOverrides,
  itemPriceDetails,
  itemPriceView,
  itemPricePage,
  itemScopePricesView,
  itemScopePricesPage,
  itemPricesByItemRequest,
  pricePolicyView,
  pricePolicyListView,
  addItemPriceRequest,
  itemPriceBatchEntry,
  addItemPriceBatchRequest,
  addItemPriceBatchResult,
  listItemPricesRequest,
  itemPriceIdRequest,
  deleteItemPricesByRunRequest,
  deleteItemPricesByRunResult,
  setSupermarketItemAvailabilityRequest,
  setSupermarketItemAvailabilityResult,
  listPricePoliciesRequest,
  updatePricePolicyRequest,
  getSupermarketItemRequest,
  listByItemRequest,
  listByLocationRequest,
  listByScopeRequest,
  adminListSupermarketItemsRequest,
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
  setLocationItemAvailabilityRequest,
  locationItemAvailabilityConflict,
  setLocationItemAvailabilityResult,
  postalCodeDistanceView,
  resolveNearestPostalCodeRequest,
  nearestPostalCodeView,
  listNearbyPostalCodesRequest,
  nearbyPostalCodesView,
  countLocationsByPostalCodeRequest,
  postalCodeLocationCount,
  postalCodeLocationCountsView,
  adminPostalCodeView,
  adminPostalCodePage,
  listAdminPostalCodesRequest,
  summarizeLocationsByChainRequest,
  supermarketLocationChainSummaryView,
  supermarketLocationChainSummariesView,
  shopChainSummaryView,
  shopChainSummariesView,
  searchShopsRequest,
  shopView,
  shopPage,
  shopAvailabilityRequest,
  shopItemAvailabilityView,
  shopAvailabilityView,
  locationPriceStackRequest,
  supermarketLocationPriceStackView,
  enumOf(CATALOG_SCHEMA_IDS.nearbyShopNoPick, Object.values(NearbyShopNoPick)),
  nearbyShopsRequest,
  nearbyShopView,
  nearbyShopPickView,
  nearbyShopsView,
  shopsByIdRequest,
  shopsByIdView,
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
  [ITEM_PATTERNS.findByEans]: {
    request: CATALOG_SCHEMA_IDS.findItemsByEansRequest,
    response: CATALOG_SCHEMA_IDS.findItemsByEansResult,
  },
  [ITEM_PATTERNS.createMany]: {
    request: CATALOG_SCHEMA_IDS.createItemsRequest,
    response: CATALOG_SCHEMA_IDS.createItemsResult,
  },
  [ITEM_PATTERNS.updateMany]: {
    request: CATALOG_SCHEMA_IDS.updateItemsRequest,
    response: CATALOG_SCHEMA_IDS.updateItemsResult,
  },
  [ITEM_PATTERNS.fillPackCounts]: {
    request: CATALOG_SCHEMA_IDS.fillPackCountsRequest,
    response: CATALOG_SCHEMA_IDS.fillPackCountsResult,
  },
  [CATEGORY_PATTERNS.tree]: {
    request: CATALOG_SCHEMA_IDS.categoryTreeRequest,
    response: CATALOG_SCHEMA_IDS.categoryTreeView,
  },
  [CATEGORY_PATTERNS.create]: {
    request: CATALOG_SCHEMA_IDS.createCategoryRequest,
    response: CATALOG_SCHEMA_IDS.categoryView,
  },
  [CATEGORY_PATTERNS.update]: {
    request: CATALOG_SCHEMA_IDS.updateCategoryRequest,
    response: CATALOG_SCHEMA_IDS.categoryView,
  },
  [CATEGORY_PATTERNS.delete]: {
    request: CATALOG_SCHEMA_IDS.categoryIdRequest,
    response: COMMON_IDS.idResult,
  },
  [CATEGORY_PATTERNS.get]: {
    request: CATALOG_SCHEMA_IDS.categoryIdRequest,
    response: CATALOG_SCHEMA_IDS.categoryView,
  },
  [CATEGORY_PATTERNS.list]: {
    request: CATALOG_SCHEMA_IDS.listCategoriesRequest,
    response: CATALOG_SCHEMA_IDS.categoryPage,
  },
  [SECTION_PATTERNS.create]: {
    request: CATALOG_SCHEMA_IDS.createSupermarketSectionRequest,
    response: CATALOG_SCHEMA_IDS.supermarketSectionView,
  },
  [SECTION_PATTERNS.list]: {
    request: CATALOG_SCHEMA_IDS.listSupermarketSectionsRequest,
    response: CATALOG_SCHEMA_IDS.supermarketSectionPage,
  },
  [SECTION_PATTERNS.get]: {
    request: CATALOG_SCHEMA_IDS.supermarketSectionIdRequest,
    response: CATALOG_SCHEMA_IDS.supermarketSectionView,
  },
  [SECTION_PATTERNS.update]: {
    request: CATALOG_SCHEMA_IDS.updateSupermarketSectionRequest,
    response: CATALOG_SCHEMA_IDS.supermarketSectionView,
  },
  [SECTION_PATTERNS.delete]: {
    request: CATALOG_SCHEMA_IDS.supermarketSectionIdRequest,
    response: COMMON_IDS.idResult,
  },
  [SECTION_PATTERNS.forLocation]: {
    request: CATALOG_SCHEMA_IDS.locationSectionsRequest,
    response: CATALOG_SCHEMA_IDS.locationSectionsView,
  },
  [SECTION_PATTERNS.setForLocation]: {
    request: CATALOG_SCHEMA_IDS.setLocationSectionsRequest,
    response: CATALOG_SCHEMA_IDS.locationSectionsView,
  },
  [SECTION_PATTERNS.listPins]: {
    request: CATALOG_SCHEMA_IDS.listItemSectionPinsRequest,
    response: CATALOG_SCHEMA_IDS.itemSectionPinsPage,
  },
  [SECTION_PATTERNS.setPins]: {
    request: CATALOG_SCHEMA_IDS.setItemSectionPinsRequest,
    response: CATALOG_SCHEMA_IDS.itemSectionPinsView,
  },
  [SECTION_PATTERNS.itemsAtLocation]: {
    request: CATALOG_SCHEMA_IDS.itemSectionsAtLocationRequest,
    response: CATALOG_SCHEMA_IDS.itemSectionsAtLocationView,
  },
  [SECTION_PATTERNS.namesForLocations]: {
    request: CATALOG_SCHEMA_IDS.locationSectionNamesRequest,
    response: CATALOG_SCHEMA_IDS.locationSectionNamesView,
  },
  [BRAND_PATTERNS.create]: {
    request: CATALOG_SCHEMA_IDS.createBrandRequest,
    response: CATALOG_SCHEMA_IDS.createBrandResult,
  },
  [BRAND_PATTERNS.update]: {
    request: CATALOG_SCHEMA_IDS.updateBrandRequest,
    response: CATALOG_SCHEMA_IDS.updateBrandResult,
  },
  [BRAND_PATTERNS.registerSuggestion]: {
    request: CATALOG_SCHEMA_IDS.registerBrandSuggestionRequest,
    response: CATALOG_SCHEMA_IDS.registerBrandSuggestionResult,
  },
  [BRAND_PATTERNS.delete]: {
    request: CATALOG_SCHEMA_IDS.deleteBrandRequest,
    response: CATALOG_SCHEMA_IDS.deleteBrandResult,
  },
  [BRAND_PATTERNS.get]: {
    request: CATALOG_SCHEMA_IDS.brandIdRequest,
    response: CATALOG_SCHEMA_IDS.brandView,
  },
  [BRAND_PATTERNS.list]: {
    request: CATALOG_SCHEMA_IDS.listBrandsRequest,
    response: CATALOG_SCHEMA_IDS.brandPage,
  },
  [BRAND_PATTERNS.keys]: {
    request: CATALOG_SCHEMA_IDS.brandKeysRequest,
    response: CATALOG_SCHEMA_IDS.brandKeysResult,
  },
  [BRAND_PATTERNS.registerMany]: {
    request: CATALOG_SCHEMA_IDS.registerBrandsRequest,
    response: CATALOG_SCHEMA_IDS.registerBrandsResult,
  },
  [BRAND_PATTERNS.addHomonym]: {
    request: CATALOG_SCHEMA_IDS.addBrandHomonymRequest,
    response: CATALOG_SCHEMA_IDS.brandHomonymsView,
  },
  [BRAND_PATTERNS.removeHomonym]: {
    request: CATALOG_SCHEMA_IDS.removeBrandHomonymRequest,
    response: CATALOG_SCHEMA_IDS.brandHomonymsView,
  },
  [BRAND_PATTERNS.matches]: {
    request: CATALOG_SCHEMA_IDS.brandMatchesRequest,
    response: CATALOG_SCHEMA_IDS.brandMatchesResult,
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
  [PRODUCT_GROUP_PATTERNS.applyAssignments]: {
    request: CATALOG_SCHEMA_IDS.applyGroupAssignmentsRequest,
    response: CATALOG_SCHEMA_IDS.applyGroupAssignmentsResult,
  },
  [ITEM_PRICE_PATTERNS.add]: {
    request: CATALOG_SCHEMA_IDS.addItemPriceRequest,
    response: CATALOG_SCHEMA_IDS.itemPriceView,
  },
  [ITEM_PRICE_PATTERNS.addBatch]: {
    request: CATALOG_SCHEMA_IDS.addItemPriceBatchRequest,
    response: CATALOG_SCHEMA_IDS.addItemPriceBatchResult,
  },
  [ITEM_PRICE_PATTERNS.list]: {
    request: CATALOG_SCHEMA_IDS.listItemPricesRequest,
    response: CATALOG_SCHEMA_IDS.itemPricePage,
  },
  [ITEM_PRICE_PATTERNS.byItem]: {
    request: CATALOG_SCHEMA_IDS.itemPricesByItemRequest,
    response: CATALOG_SCHEMA_IDS.itemScopePricesPage,
  },
  [ITEM_PRICE_PATTERNS.delete]: {
    request: CATALOG_SCHEMA_IDS.itemPriceIdRequest,
    response: COMMON_IDS.idResult,
  },
  [ITEM_PRICE_PATTERNS.deleteByRun]: {
    request: CATALOG_SCHEMA_IDS.deleteItemPricesByRunRequest,
    response: CATALOG_SCHEMA_IDS.deleteItemPricesByRunResult,
  },
  [PRICE_POLICY_PATTERNS.list]: {
    request: CATALOG_SCHEMA_IDS.listPricePoliciesRequest,
    response: CATALOG_SCHEMA_IDS.pricePolicyListView,
  },
  [PRICE_POLICY_PATTERNS.update]: {
    request: CATALOG_SCHEMA_IDS.updatePricePolicyRequest,
    response: CATALOG_SCHEMA_IDS.pricePolicyView,
  },
  [SUPERMARKET_ITEM_PATTERNS.setAvailability]: {
    request: CATALOG_SCHEMA_IDS.setSupermarketItemAvailabilityRequest,
    response: CATALOG_SCHEMA_IDS.setSupermarketItemAvailabilityResult,
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
  [SUPERMARKET_ITEM_PATTERNS.adminList]: {
    request: CATALOG_SCHEMA_IDS.adminListSupermarketItemsRequest,
    response: CATALOG_SCHEMA_IDS.adminSupermarketItemPage,
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
  [SUPERMARKET_LOCATION_ITEM_PATTERNS.setAvailability]: {
    request: CATALOG_SCHEMA_IDS.setLocationItemAvailabilityRequest,
    response: CATALOG_SCHEMA_IDS.setLocationItemAvailabilityResult,
  },
  [POSTAL_CODE_PATTERNS.nearest]: {
    request: CATALOG_SCHEMA_IDS.resolveNearestPostalCodeRequest,
    response: CATALOG_SCHEMA_IDS.nearestPostalCodeView,
  },
  [POSTAL_CODE_PATTERNS.nearby]: {
    request: CATALOG_SCHEMA_IDS.listNearbyPostalCodesRequest,
    response: CATALOG_SCHEMA_IDS.nearbyPostalCodesView,
  },
  [ADMIN_POSTAL_CODE_PATTERNS.list]: {
    request: CATALOG_SCHEMA_IDS.listAdminPostalCodesRequest,
    response: CATALOG_SCHEMA_IDS.adminPostalCodePage,
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
  [SUPERMARKET_LOCATION_PATTERNS.shopAvailability]: {
    request: CATALOG_SCHEMA_IDS.shopAvailabilityRequest,
    response: CATALOG_SCHEMA_IDS.shopAvailabilityView,
  },
  [SUPERMARKET_LOCATION_PATTERNS.priceStack]: {
    request: CATALOG_SCHEMA_IDS.locationPriceStackRequest,
    response: CATALOG_SCHEMA_IDS.supermarketLocationPriceStackView,
  },
  [SUPERMARKET_LOCATION_PATTERNS.nearby]: {
    request: CATALOG_SCHEMA_IDS.nearbyShopsRequest,
    response: CATALOG_SCHEMA_IDS.nearbyShopsView,
  },
  [SUPERMARKET_LOCATION_PATTERNS.shopsById]: {
    request: CATALOG_SCHEMA_IDS.shopsByIdRequest,
    response: CATALOG_SCHEMA_IDS.shopsByIdView,
  },
};
