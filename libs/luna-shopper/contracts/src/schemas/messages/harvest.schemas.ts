import {
  DiscoveredPlaceStatus,
  HarvestRunMode,
  HarvestRunStatus,
  HarvestRunTrigger,
  HarvestWarningCode,
  ItemSourceMatch,
  ItemSourceRefStatus,
  PostalCodeDiscoveryStatus,
  SourceAliasStatus,
  SourceLocationStatus,
} from '../../lib/enums/harvest.enums';
import {
  ADAPTER_KEYS,
  DISCOVERED_PLACE_PATTERNS,
  HARVEST_PATTERNS,
  ITEM_SOURCE_REF_PATTERNS,
  POSTAL_CODE_DISCOVERY_PATTERNS,
  SOURCE_ALIAS_PATTERNS,
  SOURCE_ENTRY_PATTERNS,
  SOURCE_LOCATION_PATTERNS,
  SUPERMARKET_SOURCE_PATTERNS,
} from '../../lib/messages/harvest.messages';
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
import { adminCredentialProperties } from '../common.schemas';
import { CATALOG_SCHEMA_IDS } from './catalog.schemas';

/**
 * Harvester schemas (plan 0038). The harvester's own surface: runs and their
 * progress, the places a store discovery run found, the per chain source
 * configuration, and the links between catalog items and a chain's products.
 *
 * Every subject here is platform admin gated. `sourceEntry.createItem` answers a
 * catalog `ItemView`, which is a deliberate cross domain `$ref`: promoting a
 * discovery entry creates a real catalog item, and describing it twice is how the
 * two drift.
 */
export const HARVEST_SCHEMA_IDS = {
  harvestRunMode: schemaId('enums/HarvestRunMode'),
  harvestRunTrigger: schemaId('enums/HarvestRunTrigger'),
  harvestRunStatus: schemaId('enums/HarvestRunStatus'),
  itemSourceRefStatus: schemaId('enums/ItemSourceRefStatus'),
  postalCodeDiscoveryStatus: schemaId('enums/PostalCodeDiscoveryStatus'),
  itemSourceMatch: schemaId('enums/ItemSourceMatch'),
  discoveredPlaceStatus: schemaId('enums/DiscoveredPlaceStatus'),
  sourceLocationStatus: schemaId('enums/SourceLocationStatus'),
  adapterKey: schemaId('enums/AdapterKey'),
  sourceAliasStatus: schemaId('enums/SourceAliasStatus'),
  harvestWarningCode: schemaId('enums/HarvestWarningCode'),

  harvestRunWarning: schemaId('harvest/HarvestRunWarning'),
  harvestRunView: schemaId('harvest/HarvestRunView'),
  sourceAliasView: schemaId('harvest/SourceAliasView'),
  sourceAliasAcceptResult: schemaId('harvest/SourceAliasAcceptResult'),
  discoveredPlaceView: schemaId('harvest/DiscoveredPlaceView'),
  discoveredPlaceGroup: schemaId('harvest/DiscoveredPlaceGroup'),
  discoveredPlaceGroupsResult: schemaId('harvest/DiscoveredPlaceGroupsResult'),
  sourceCatalogEntryView: schemaId('harvest/SourceCatalogEntryView'),
  itemSourceRefView: schemaId('harvest/ItemSourceRefView'),
  sourceLocationView: schemaId('harvest/SourceLocationView'),
  supermarketSourceView: schemaId('harvest/SupermarketSourceView'),
  postalCodeDiscoveryRequestView: schemaId(
    'harvest/PostalCodeDiscoveryRequestView'
  ),

  harvestRunPage: schemaId('harvest/HarvestRunPage'),
  discoveredPlacePage: schemaId('harvest/DiscoveredPlacePage'),
  sourceCatalogEntryPage: schemaId('harvest/SourceCatalogEntryPage'),
  itemSourceRefPage: schemaId('harvest/ItemSourceRefPage'),
  sourceLocationPage: schemaId('harvest/SourceLocationPage'),
  supermarketSourcePage: schemaId('harvest/SupermarketSourcePage'),
  sourceAliasPage: schemaId('harvest/SourceAliasPage'),
  postalCodeDiscoveryRequestPage: schemaId(
    'harvest/PostalCodeDiscoveryRequestPage'
  ),

  spawnRunRequest: schemaId('msg/harvest.spawn/request'),
  runIdRequest: schemaId('msg/harvest.run.id/request'),
  listRunsRequest: schemaId('msg/harvest.run.list/request'),
  listPlacesRequest: schemaId('msg/place.list/request'),
  groupPlacesRequest: schemaId('msg/place.groups/request'),
  importPlaceRequest: schemaId('msg/place.import/request'),
  placeIdRequest: schemaId('msg/place.id/request'),
  listRefsRequest: schemaId('msg/itemSourceRef.list/request'),
  refIdRequest: schemaId('msg/itemSourceRef.id/request'),
  setManualRefRequest: schemaId('msg/itemSourceRef.setManual/request'),
  listSourceLocationsRequest: schemaId('msg/sourceLocation.list/request'),
  mapSourceLocationRequest: schemaId('msg/sourceLocation.map/request'),
  sourceLocationIdRequest: schemaId('msg/sourceLocation.id/request'),
  listEntriesRequest: schemaId('msg/sourceEntry.list/request'),
  createItemFromEntryRequest: schemaId('msg/sourceEntry.createItem/request'),
  upsertSourceRequest: schemaId('msg/supermarketSource.upsert/request'),
  sourceIdRequest: schemaId('msg/supermarketSource.id/request'),
  setSourceEnabledRequest: schemaId('msg/supermarketSource.setEnabled/request'),
  listSourcesRequest: schemaId('msg/supermarketSource.list/request'),
  listAliasesRequest: schemaId('msg/sourceAlias.list/request'),
  aliasIdRequest: schemaId('msg/sourceAlias.id/request'),
  acceptAliasRequest: schemaId('msg/sourceAlias.accept/request'),
  createItemFromAliasRequest: schemaId('msg/sourceAlias.createItem/request'),
  listDiscoveryRequestsRequest: schemaId(
    'msg/postalCodeDiscovery.list/request'
  ),
} as const;

const numberOrNull = (): JsonSchema => ({ type: ['number', 'null'] });
const integerOrNull = (): JsonSchema => ({ type: ['integer', 'null'] });
/** A tag bag kept exactly as the provider sent it (plan 0038, section 8.2). */
const stringMap = (): JsonSchema => ({
  type: 'object',
  additionalProperties: { type: 'string' },
});

// --- Views -----------------------------------------------------------------

const supermarketSourceView = object(
  HARVEST_SCHEMA_IDS.supermarketSourceView,
  {
    id: nonEmptyString(),
    supermarketId: nonEmptyString(),
    adapterKey: ref(HARVEST_SCHEMA_IDS.adapterKey),
    enabled: boolean(),
    config: freeObject(),
    workers: integer({ minimum: 1 }),
    maxRequestsPerSecond: { type: 'number', exclusiveMinimum: 0 },
    lastRunAt: nullableString(),
    lastSuccessAt: nullableString(),
    consecutiveFailures: integer({ minimum: 0 }),
  },
  [
    'id',
    'supermarketId',
    'adapterKey',
    'enabled',
    'config',
    'workers',
    'maxRequestsPerSecond',
    'lastRunAt',
    'lastSuccessAt',
    'consecutiveFailures',
  ]
);

const harvestRunView = object(
  HARVEST_SCHEMA_IDS.harvestRunView,
  {
    id: nonEmptyString(),
    // Null for a store discovery run, which belongs to a postal code and a
    // radius rather than to one chain.
    supermarketId: nullableString(),
    sourceId: nullableString(),
    mode: ref(HARVEST_SCHEMA_IDS.harvestRunMode),
    trigger: ref(HARVEST_SCHEMA_IDS.harvestRunTrigger),
    status: ref(HARVEST_SCHEMA_IDS.harvestRunStatus),
    requestedAt: string({ format: 'date-time' }),
    startedAt: nullableString(),
    finishedAt: nullableString(),
    heartbeatAt: nullableString(),
    totalPlanned: integerOrNull(),
    processed: integer({ minimum: 0 }),
    created: integer({ minimum: 0 }),
    updated: integer({ minimum: 0 }),
    unchanged: integer({ minimum: 0 }),
    notFound: integer({ minimum: 0 }),
    // Offers a rule dropped or queued (plan 0081, section 7).
    skipped: integer({ minimum: 0 }),
    failed: integer({ minimum: 0 }),
    stage: nullableString(),
    stageLabel: nullableString(),
    warnings: array(ref(HARVEST_SCHEMA_IDS.harvestRunWarning)),
    documentSha256: nullableString(),
    abortRequestedAt: nullableString(),
    error: nullableString(),
    correlationId: nullableString(),
    requestedByUserId: nullableString(),
  },
  [
    'id',
    'supermarketId',
    'sourceId',
    'mode',
    'trigger',
    'status',
    'requestedAt',
    'startedAt',
    'finishedAt',
    'heartbeatAt',
    'totalPlanned',
    'processed',
    'created',
    'updated',
    'unchanged',
    'notFound',
    'skipped',
    'failed',
    'stage',
    'stageLabel',
    'warnings',
    'documentSha256',
    'abortRequestedAt',
    'error',
    'correlationId',
    'requestedByUserId',
  ]
);

/**
 * One decision a run made that was not a write (plan 0081, section 7). Every
 * skip and every queue entry is one, so the run page reads as a list of them.
 */
const harvestRunWarning = object(
  HARVEST_SCHEMA_IDS.harvestRunWarning,
  {
    code: ref(HARVEST_SCHEMA_IDS.harvestWarningCode),
    offerId: nullableString(),
    page: integerOrNull(),
    name: nullableString(),
    message: string(),
  },
  ['code', 'offerId', 'page', 'name', 'message']
);

/**
 * One printed name a chain used (plan 0081, section 2). Accepting sets `itemId`
 * and never touches `printedName`: the alias records what the leaflet printed,
 * whatever the item is renamed to afterwards.
 */
const sourceAliasView = object(
  HARVEST_SCHEMA_IDS.sourceAliasView,
  {
    id: nonEmptyString(),
    supermarketId: nonEmptyString(),
    aliasKey: string(),
    printedName: nonEmptyString(),
    printedFormat: nullableString(),
    printedBrand: nullableString(),
    itemId: nullableString(),
    candidateItemId: nullableString(),
    candidateEntryId: nullableString(),
    status: ref(HARVEST_SCHEMA_IDS.sourceAliasStatus),
    matchedBy: ref(HARVEST_SCHEMA_IDS.itemSourceMatch),
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    timesSeen: integer({ minimum: 0 }),
    firstSeenAt: string({ format: 'date-time' }),
    lastSeenAt: string({ format: 'date-time' }),
    firstRunId: nullableString(),
    lastRunId: nullableString(),
    offerPrice: numberOrNull(),
    offerCurrency: nullableString(),
    offerUnitPrice: numberOrNull(),
    offerUnitPriceLabel: nullableString(),
    offerPage: integerOrNull(),
    offerRawText: array(string()),
    offerConfidence: numberOrNull(),
  },
  [
    'id',
    'supermarketId',
    'aliasKey',
    'printedName',
    'printedFormat',
    'printedBrand',
    'itemId',
    'candidateItemId',
    'candidateEntryId',
    'status',
    'matchedBy',
    'confidence',
    'timesSeen',
    'firstSeenAt',
    'lastSeenAt',
    'firstRunId',
    'lastRunId',
    'offerPrice',
    'offerCurrency',
    'offerUnitPrice',
    'offerUnitPriceLabel',
    'offerPage',
    'offerRawText',
    'offerConfidence',
  ]
);

/**
 * What accepting a queued name did. `pricesWritten` is the point of answering
 * anything beyond the row: the accept writes the price the alias was queued
 * for, from every still open import that saw the string (section 3).
 */
const sourceAliasAcceptResult = object(
  HARVEST_SCHEMA_IDS.sourceAliasAcceptResult,
  {
    alias: ref(HARVEST_SCHEMA_IDS.sourceAliasView),
    pricesWritten: integer({ minimum: 0 }),
    item: { oneOf: [ref(CATALOG_SCHEMA_IDS.itemView), { type: 'null' }] },
  },
  ['alias', 'pricesWritten', 'item']
);

const discoveredPlaceView = object(
  HARVEST_SCHEMA_IDS.discoveredPlaceView,
  {
    id: nonEmptyString(),
    runId: nullableString(),
    provider: nonEmptyString(),
    externalRef: nonEmptyString(),
    brandKey: nullableString(),
    brandName: nullableString(),
    name: nullableString(),
    // Position is the one thing every OSM element has, which is why discovery is
    // geographic and never filtered on a postcode two thirds of them lack.
    latitude: { type: 'number' },
    longitude: { type: 'number' },
    street: nullableString(),
    city: nullableString(),
    postalCode: nullableString(),
    // The run's own country, not an OSM tag: it keys the centroid lookup that
    // fills the postcode on import (plan 0061, section 4).
    country: nullableString(),
    website: nullableString(),
    openingHours: nullableString(),
    tags: stringMap(),
    status: ref(HARVEST_SCHEMA_IDS.discoveredPlaceStatus),
    supermarketLocationId: nullableString(),
    firstSeenAt: string({ format: 'date-time' }),
    lastSeenAt: string({ format: 'date-time' }),
  },
  [
    'id',
    'runId',
    'provider',
    'externalRef',
    'brandKey',
    'brandName',
    'name',
    'latitude',
    'longitude',
    'street',
    'city',
    'postalCode',
    'country',
    'website',
    'openingHours',
    'tags',
    'status',
    'supermarketLocationId',
    'firstSeenAt',
    'lastSeenAt',
  ]
);

const discoveredPlaceGroup = object(
  HARVEST_SCHEMA_IDS.discoveredPlaceGroup,
  {
    brandKey: nullableString(),
    brandName: nullableString(),
    count: integer({ minimum: 0 }),
    known: boolean(),
    supermarketId: nullableString(),
    sample: array(ref(HARVEST_SCHEMA_IDS.discoveredPlaceView)),
  },
  ['brandKey', 'brandName', 'count', 'known', 'supermarketId', 'sample']
);

const discoveredPlaceGroupsResult = object(
  HARVEST_SCHEMA_IDS.discoveredPlaceGroupsResult,
  { groups: array(ref(HARVEST_SCHEMA_IDS.discoveredPlaceGroup)) },
  ['groups']
);

const sourceCatalogEntryView = object(
  HARVEST_SCHEMA_IDS.sourceCatalogEntryView,
  {
    id: nonEmptyString(),
    supermarketId: nonEmptyString(),
    externalId: nonEmptyString(),
    name: nonEmptyString(),
    brand: nullableString(),
    ean: nullableString(),
    unitSize: numberOrNull(),
    sizeFormat: nullableString(),
    price: numberOrNull(),
    unitPrice: numberOrNull(),
    unitPriceLabel: nullableString(),
    categoryPath: array(string()),
    url: nullableString(),
    lastSeenAt: string({ format: 'date-time' }),
  },
  [
    'id',
    'supermarketId',
    'externalId',
    'name',
    'brand',
    'ean',
    'unitSize',
    'sizeFormat',
    'price',
    'unitPrice',
    'unitPriceLabel',
    'categoryPath',
    'url',
    'lastSeenAt',
  ]
);

const itemSourceRefView = object(
  HARVEST_SCHEMA_IDS.itemSourceRefView,
  {
    id: nonEmptyString(),
    itemId: nonEmptyString(),
    supermarketId: nonEmptyString(),
    externalId: nonEmptyString(),
    externalUrl: nullableString(),
    matchedBy: ref(HARVEST_SCHEMA_IDS.itemSourceMatch),
    status: ref(HARVEST_SCHEMA_IDS.itemSourceRefStatus),
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    lastResolvedAt: nullableString(),
    lastSeenAt: nullableString(),
  },
  [
    'id',
    'itemId',
    'supermarketId',
    'externalId',
    'externalUrl',
    'matchedBy',
    'status',
    'confidence',
    'lastResolvedAt',
    'lastSeenAt',
  ]
);

/**
 * One shop a source names (plan 0084, section 6). Keyed on the source's own
 * code, so a shop the chain renames keeps its mapping.
 */
const sourceLocationView = object(
  HARVEST_SCHEMA_IDS.sourceLocationView,
  {
    id: nonEmptyString(),
    supermarketId: nonEmptyString(),
    externalId: nonEmptyString(),
    printedName: nonEmptyString(),
    supermarketLocationId: nullableString(),
    status: ref(HARVEST_SCHEMA_IDS.sourceLocationStatus),
    matchedBy: ref(HARVEST_SCHEMA_IDS.itemSourceMatch),
    firstSeenAt: nonEmptyString(),
    lastSeenAt: nonEmptyString(),
    firstRunId: nullableString(),
    lastRunId: nullableString(),
  },
  [
    'id',
    'supermarketId',
    'externalId',
    'printedName',
    'supermarketLocationId',
    'status',
    'matchedBy',
    'firstSeenAt',
    'lastSeenAt',
    'firstRunId',
    'lastRunId',
  ]
);

/**
 * One row of the postal code discovery queue (plan 0063, section 3).
 *
 * `discoveredAt` is the cooldown's anchor and `nextAttemptAt` the backoff's, and
 * they are separate columns because a success and a failure earn very different
 * waits: thirty days for "we looked", minutes for "try again" (section 4).
 */
const postalCodeDiscoveryRequestView = object(
  HARVEST_SCHEMA_IDS.postalCodeDiscoveryRequestView,
  {
    id: nonEmptyString(),
    country: nonEmptyString(),
    postalCode: nonEmptyString(),
    status: ref(HARVEST_SCHEMA_IDS.postalCodeDiscoveryStatus),
    requestedAt: string({ format: 'date-time' }),
    lastAttemptedAt: nullableString(),
    discoveredAt: nullableString(),
    nextAttemptAt: nullableString(),
    attempts: integer({ minimum: 0 }),
    runId: nullableString(),
    error: nullableString(),
  },
  [
    'id',
    'country',
    'postalCode',
    'status',
    'requestedAt',
    'lastAttemptedAt',
    'discoveredAt',
    'nextAttemptAt',
    'attempts',
    'runId',
    'error',
  ]
);

const harvestRunPage = paginated(
  HARVEST_SCHEMA_IDS.harvestRunPage,
  HARVEST_SCHEMA_IDS.harvestRunView
);
const discoveredPlacePage = paginated(
  HARVEST_SCHEMA_IDS.discoveredPlacePage,
  HARVEST_SCHEMA_IDS.discoveredPlaceView
);
const sourceCatalogEntryPage = paginated(
  HARVEST_SCHEMA_IDS.sourceCatalogEntryPage,
  HARVEST_SCHEMA_IDS.sourceCatalogEntryView
);
const itemSourceRefPage = paginated(
  HARVEST_SCHEMA_IDS.itemSourceRefPage,
  HARVEST_SCHEMA_IDS.itemSourceRefView
);
const sourceLocationPage = paginated(
  HARVEST_SCHEMA_IDS.sourceLocationPage,
  HARVEST_SCHEMA_IDS.sourceLocationView
);
const supermarketSourcePage = paginated(
  HARVEST_SCHEMA_IDS.supermarketSourcePage,
  HARVEST_SCHEMA_IDS.supermarketSourceView
);
const sourceAliasPage = paginated(
  HARVEST_SCHEMA_IDS.sourceAliasPage,
  HARVEST_SCHEMA_IDS.sourceAliasView
);
const postalCodeDiscoveryRequestPage = paginated(
  HARVEST_SCHEMA_IDS.postalCodeDiscoveryRequestPage,
  HARVEST_SCHEMA_IDS.postalCodeDiscoveryRequestView
);

// --- Requests --------------------------------------------------------------

const spawnRunRequest = object(
  HARVEST_SCHEMA_IDS.spawnRunRequest,
  {
    ...adminCredentialProperties,
    mode: ref(HARVEST_SCHEMA_IDS.harvestRunMode),
    supermarketId: string(),
    priceScopeId: string(),
    postalCode: string(),
    country: string(),
    radiusMetres: integer({ minimum: 1 }),
    brandKeys: array(string()),
    // The leaflet, for a LEAFLET_IMPORT run. A free object here on purpose: it
    // is validated against its own versioned schema (plan 0081, section 4) by
    // the gateway before it crosses the broker and by the harvester again at
    // run start, and restating that shape here would be a second copy to drift.
    document: freeObject(),
    validFrom: nullableString(),
    validUntil: nullableString(),
  },
  ['userId', 'mode']
);
const runIdRequest = object(
  HARVEST_SCHEMA_IDS.runIdRequest,
  { ...adminCredentialProperties, runId: nonEmptyString() },
  ['userId', 'runId']
);
const listRunsRequest = object(
  HARVEST_SCHEMA_IDS.listRunsRequest,
  {
    ...adminCredentialProperties,
    supermarketId: string(),
    mode: ref(HARVEST_SCHEMA_IDS.harvestRunMode),
    status: ref(HARVEST_SCHEMA_IDS.harvestRunStatus),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId']
);

const listPlacesRequest = object(
  HARVEST_SCHEMA_IDS.listPlacesRequest,
  {
    ...adminCredentialProperties,
    runId: string(),
    brandKey: string(),
    status: ref(HARVEST_SCHEMA_IDS.discoveredPlaceStatus),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId']
);
const groupPlacesRequest = object(
  HARVEST_SCHEMA_IDS.groupPlacesRequest,
  {
    ...adminCredentialProperties,
    runId: string(),
    sampleSize: integer({ minimum: 1 }),
  },
  ['userId']
);
const importPlaceRequest = object(
  HARVEST_SCHEMA_IDS.importPlaceRequest,
  {
    ...adminCredentialProperties,
    placeId: nonEmptyString(),
    supermarketId: string(),
    priceScopeId: string(),
  },
  ['userId', 'placeId']
);
const placeIdRequest = object(
  HARVEST_SCHEMA_IDS.placeIdRequest,
  { ...adminCredentialProperties, placeId: nonEmptyString() },
  ['userId', 'placeId']
);

const listRefsRequest = object(
  HARVEST_SCHEMA_IDS.listRefsRequest,
  {
    ...adminCredentialProperties,
    supermarketId: string(),
    itemId: string(),
    status: ref(HARVEST_SCHEMA_IDS.itemSourceRefStatus),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId']
);
const refIdRequest = object(
  HARVEST_SCHEMA_IDS.refIdRequest,
  { ...adminCredentialProperties, refId: nonEmptyString() },
  ['userId', 'refId']
);
const setManualRefRequest = object(
  HARVEST_SCHEMA_IDS.setManualRefRequest,
  {
    ...adminCredentialProperties,
    itemId: nonEmptyString(),
    supermarketId: nonEmptyString(),
    externalId: nonEmptyString(),
  },
  ['userId', 'itemId', 'supermarketId', 'externalId']
);

const listSourceLocationsRequest = object(
  HARVEST_SCHEMA_IDS.listSourceLocationsRequest,
  {
    ...adminCredentialProperties,
    supermarketId: nonEmptyString(),
    status: ref(HARVEST_SCHEMA_IDS.sourceLocationStatus),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId', 'supermarketId']
);
const mapSourceLocationRequest = object(
  HARVEST_SCHEMA_IDS.mapSourceLocationRequest,
  {
    ...adminCredentialProperties,
    sourceLocationId: nonEmptyString(),
    supermarketLocationId: nonEmptyString(),
  },
  ['userId', 'sourceLocationId', 'supermarketLocationId']
);
const sourceLocationIdRequest = object(
  HARVEST_SCHEMA_IDS.sourceLocationIdRequest,
  { ...adminCredentialProperties, sourceLocationId: nonEmptyString() },
  ['userId', 'sourceLocationId']
);

const listEntriesRequest = object(
  HARVEST_SCHEMA_IDS.listEntriesRequest,
  {
    ...adminCredentialProperties,
    supermarketId: nonEmptyString(),
    unmatchedOnly: boolean(),
    query: string(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId', 'supermarketId']
);
const createItemFromEntryRequest = object(
  HARVEST_SCHEMA_IDS.createItemFromEntryRequest,
  {
    ...adminCredentialProperties,
    entryId: nonEmptyString(),
    category: ref(CATALOG_SCHEMA_IDS.itemCategory),
  },
  ['userId', 'entryId']
);

const upsertSourceRequest = object(
  HARVEST_SCHEMA_IDS.upsertSourceRequest,
  {
    ...adminCredentialProperties,
    supermarketId: nonEmptyString(),
    adapterKey: ref(HARVEST_SCHEMA_IDS.adapterKey),
    enabled: boolean(),
    config: freeObject(),
    workers: integer({ minimum: 1 }),
    maxRequestsPerSecond: { type: 'number', exclusiveMinimum: 0 },
  },
  ['userId', 'supermarketId', 'adapterKey']
);
const sourceIdRequest = object(
  HARVEST_SCHEMA_IDS.sourceIdRequest,
  { ...adminCredentialProperties, supermarketId: nonEmptyString() },
  ['userId', 'supermarketId']
);
const setSourceEnabledRequest = object(
  HARVEST_SCHEMA_IDS.setSourceEnabledRequest,
  {
    ...adminCredentialProperties,
    supermarketId: nonEmptyString(),
    enabled: boolean(),
  },
  ['userId', 'supermarketId', 'enabled']
);
const listSourcesRequest = object(
  HARVEST_SCHEMA_IDS.listSourcesRequest,
  {
    ...adminCredentialProperties,
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId']
);

const listAliasesRequest = object(
  HARVEST_SCHEMA_IDS.listAliasesRequest,
  {
    ...adminCredentialProperties,
    supermarketId: nonEmptyString(),
    status: ref(HARVEST_SCHEMA_IDS.sourceAliasStatus),
    query: string(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId', 'supermarketId']
);
const aliasIdRequest = object(
  HARVEST_SCHEMA_IDS.aliasIdRequest,
  { ...adminCredentialProperties, aliasId: nonEmptyString() },
  ['userId', 'aliasId']
);
const acceptAliasRequest = object(
  HARVEST_SCHEMA_IDS.acceptAliasRequest,
  {
    ...adminCredentialProperties,
    aliasId: nonEmptyString(),
    itemId: nonEmptyString(),
  },
  ['userId', 'aliasId', 'itemId']
);
const createItemFromAliasRequest = object(
  HARVEST_SCHEMA_IDS.createItemFromAliasRequest,
  {
    ...adminCredentialProperties,
    aliasId: nonEmptyString(),
    // One locale is enough since plan 0079: a leaflet product is saved with its
    // Spanish name and no English one, and a reader in English sees the Spanish
    // string through the fallback.
    name: {
      type: 'object',
      additionalProperties: false,
      properties: { es: string(), en: string() },
    },
    brand: nullableString(),
    ean: nullableString(),
    unitSize: numberOrNull(),
    category: ref(CATALOG_SCHEMA_IDS.itemCategory),
    defaultUnit: ref(CATALOG_SCHEMA_IDS.unitOfMeasure),
  },
  ['userId', 'aliasId', 'name', 'category', 'defaultUnit']
);

const listDiscoveryRequestsRequest = object(
  HARVEST_SCHEMA_IDS.listDiscoveryRequestsRequest,
  {
    ...adminCredentialProperties,
    country: string(),
    status: ref(HARVEST_SCHEMA_IDS.postalCodeDiscoveryStatus),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId']
);

export const harvestSchemas: JsonSchema[] = [
  enumOf(HARVEST_SCHEMA_IDS.harvestRunMode, Object.values(HarvestRunMode)),
  enumOf(
    HARVEST_SCHEMA_IDS.harvestRunTrigger,
    Object.values(HarvestRunTrigger)
  ),
  enumOf(HARVEST_SCHEMA_IDS.harvestRunStatus, Object.values(HarvestRunStatus)),
  enumOf(
    HARVEST_SCHEMA_IDS.itemSourceRefStatus,
    Object.values(ItemSourceRefStatus)
  ),
  enumOf(HARVEST_SCHEMA_IDS.itemSourceMatch, Object.values(ItemSourceMatch)),
  enumOf(
    HARVEST_SCHEMA_IDS.discoveredPlaceStatus,
    Object.values(DiscoveredPlaceStatus)
  ),
  enumOf(
    HARVEST_SCHEMA_IDS.sourceLocationStatus,
    Object.values(SourceLocationStatus)
  ),
  enumOf(HARVEST_SCHEMA_IDS.adapterKey, ADAPTER_KEYS),
  enumOf(
    HARVEST_SCHEMA_IDS.sourceAliasStatus,
    Object.values(SourceAliasStatus)
  ),
  enumOf(
    HARVEST_SCHEMA_IDS.harvestWarningCode,
    Object.values(HarvestWarningCode)
  ),
  enumOf(
    HARVEST_SCHEMA_IDS.postalCodeDiscoveryStatus,
    Object.values(PostalCodeDiscoveryStatus)
  ),
  supermarketSourceView,
  harvestRunWarning,
  harvestRunView,
  sourceAliasView,
  sourceAliasAcceptResult,
  discoveredPlaceView,
  discoveredPlaceGroup,
  discoveredPlaceGroupsResult,
  sourceCatalogEntryView,
  itemSourceRefView,
  sourceLocationView,
  postalCodeDiscoveryRequestView,
  harvestRunPage,
  discoveredPlacePage,
  sourceCatalogEntryPage,
  itemSourceRefPage,
  sourceLocationPage,
  supermarketSourcePage,
  sourceAliasPage,
  postalCodeDiscoveryRequestPage,
  spawnRunRequest,
  runIdRequest,
  listRunsRequest,
  listPlacesRequest,
  groupPlacesRequest,
  importPlaceRequest,
  placeIdRequest,
  listRefsRequest,
  refIdRequest,
  setManualRefRequest,
  listSourceLocationsRequest,
  mapSourceLocationRequest,
  sourceLocationIdRequest,
  listEntriesRequest,
  createItemFromEntryRequest,
  upsertSourceRequest,
  sourceIdRequest,
  setSourceEnabledRequest,
  listSourcesRequest,
  listAliasesRequest,
  aliasIdRequest,
  acceptAliasRequest,
  createItemFromAliasRequest,
  listDiscoveryRequestsRequest,
];

export const harvestMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [HARVEST_PATTERNS.spawn]: {
    request: HARVEST_SCHEMA_IDS.spawnRunRequest,
    response: HARVEST_SCHEMA_IDS.harvestRunView,
  },
  [HARVEST_PATTERNS.abort]: {
    request: HARVEST_SCHEMA_IDS.runIdRequest,
    response: HARVEST_SCHEMA_IDS.harvestRunView,
  },
  [HARVEST_PATTERNS.runGet]: {
    request: HARVEST_SCHEMA_IDS.runIdRequest,
    response: HARVEST_SCHEMA_IDS.harvestRunView,
  },
  [HARVEST_PATTERNS.runList]: {
    request: HARVEST_SCHEMA_IDS.listRunsRequest,
    response: HARVEST_SCHEMA_IDS.harvestRunPage,
  },
  [DISCOVERED_PLACE_PATTERNS.list]: {
    request: HARVEST_SCHEMA_IDS.listPlacesRequest,
    response: HARVEST_SCHEMA_IDS.discoveredPlacePage,
  },
  [DISCOVERED_PLACE_PATTERNS.groups]: {
    request: HARVEST_SCHEMA_IDS.groupPlacesRequest,
    response: HARVEST_SCHEMA_IDS.discoveredPlaceGroupsResult,
  },
  [DISCOVERED_PLACE_PATTERNS.import]: {
    request: HARVEST_SCHEMA_IDS.importPlaceRequest,
    response: HARVEST_SCHEMA_IDS.discoveredPlaceView,
  },
  [DISCOVERED_PLACE_PATTERNS.reject]: {
    request: HARVEST_SCHEMA_IDS.placeIdRequest,
    response: HARVEST_SCHEMA_IDS.discoveredPlaceView,
  },
  [ITEM_SOURCE_REF_PATTERNS.list]: {
    request: HARVEST_SCHEMA_IDS.listRefsRequest,
    response: HARVEST_SCHEMA_IDS.itemSourceRefPage,
  },
  [ITEM_SOURCE_REF_PATTERNS.listUnresolved]: {
    request: HARVEST_SCHEMA_IDS.listRefsRequest,
    response: HARVEST_SCHEMA_IDS.itemSourceRefPage,
  },
  [ITEM_SOURCE_REF_PATTERNS.confirm]: {
    request: HARVEST_SCHEMA_IDS.refIdRequest,
    response: HARVEST_SCHEMA_IDS.itemSourceRefView,
  },
  [ITEM_SOURCE_REF_PATTERNS.reject]: {
    request: HARVEST_SCHEMA_IDS.refIdRequest,
    response: HARVEST_SCHEMA_IDS.itemSourceRefView,
  },
  [ITEM_SOURCE_REF_PATTERNS.setManual]: {
    request: HARVEST_SCHEMA_IDS.setManualRefRequest,
    response: HARVEST_SCHEMA_IDS.itemSourceRefView,
  },
  [SOURCE_LOCATION_PATTERNS.list]: {
    request: HARVEST_SCHEMA_IDS.listSourceLocationsRequest,
    response: HARVEST_SCHEMA_IDS.sourceLocationPage,
  },
  [SOURCE_LOCATION_PATTERNS.map]: {
    request: HARVEST_SCHEMA_IDS.mapSourceLocationRequest,
    response: HARVEST_SCHEMA_IDS.sourceLocationView,
  },
  [SOURCE_LOCATION_PATTERNS.unmap]: {
    request: HARVEST_SCHEMA_IDS.sourceLocationIdRequest,
    response: HARVEST_SCHEMA_IDS.sourceLocationView,
  },
  [SOURCE_LOCATION_PATTERNS.ignore]: {
    request: HARVEST_SCHEMA_IDS.sourceLocationIdRequest,
    response: HARVEST_SCHEMA_IDS.sourceLocationView,
  },
  [SOURCE_LOCATION_PATTERNS.unignore]: {
    request: HARVEST_SCHEMA_IDS.sourceLocationIdRequest,
    response: HARVEST_SCHEMA_IDS.sourceLocationView,
  },
  [SOURCE_ENTRY_PATTERNS.list]: {
    request: HARVEST_SCHEMA_IDS.listEntriesRequest,
    response: HARVEST_SCHEMA_IDS.sourceCatalogEntryPage,
  },
  [SOURCE_ENTRY_PATTERNS.createItem]: {
    request: HARVEST_SCHEMA_IDS.createItemFromEntryRequest,
    response: CATALOG_SCHEMA_IDS.itemView,
  },
  [SUPERMARKET_SOURCE_PATTERNS.upsert]: {
    request: HARVEST_SCHEMA_IDS.upsertSourceRequest,
    response: HARVEST_SCHEMA_IDS.supermarketSourceView,
  },
  [SUPERMARKET_SOURCE_PATTERNS.get]: {
    request: HARVEST_SCHEMA_IDS.sourceIdRequest,
    response: HARVEST_SCHEMA_IDS.supermarketSourceView,
  },
  [SUPERMARKET_SOURCE_PATTERNS.list]: {
    request: HARVEST_SCHEMA_IDS.listSourcesRequest,
    response: HARVEST_SCHEMA_IDS.supermarketSourcePage,
  },
  [SUPERMARKET_SOURCE_PATTERNS.setEnabled]: {
    request: HARVEST_SCHEMA_IDS.setSourceEnabledRequest,
    response: HARVEST_SCHEMA_IDS.supermarketSourceView,
  },
  [SOURCE_ALIAS_PATTERNS.list]: {
    request: HARVEST_SCHEMA_IDS.listAliasesRequest,
    response: HARVEST_SCHEMA_IDS.sourceAliasPage,
  },
  [SOURCE_ALIAS_PATTERNS.accept]: {
    request: HARVEST_SCHEMA_IDS.acceptAliasRequest,
    response: HARVEST_SCHEMA_IDS.sourceAliasAcceptResult,
  },
  [SOURCE_ALIAS_PATTERNS.createItem]: {
    request: HARVEST_SCHEMA_IDS.createItemFromAliasRequest,
    response: HARVEST_SCHEMA_IDS.sourceAliasAcceptResult,
  },
  [SOURCE_ALIAS_PATTERNS.reject]: {
    request: HARVEST_SCHEMA_IDS.aliasIdRequest,
    response: HARVEST_SCHEMA_IDS.sourceAliasView,
  },
  [POSTAL_CODE_DISCOVERY_PATTERNS.list]: {
    request: HARVEST_SCHEMA_IDS.listDiscoveryRequestsRequest,
    response: HARVEST_SCHEMA_IDS.postalCodeDiscoveryRequestPage,
  },
};
