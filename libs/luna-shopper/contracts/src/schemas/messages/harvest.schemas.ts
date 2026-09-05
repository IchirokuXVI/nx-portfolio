import {
  DiscoveredPlaceStatus,
  HarvestRunMode,
  HarvestRunStatus,
  HarvestRunTrigger,
  HarvestWarningCode,
  ItemSourceMatch,
  PostalCodeDiscoveryStatus,
  SourceEntryStatus,
  SourceLocationStatus,
} from '../../lib/enums/harvest.enums';
import {
  ADAPTER_KEYS,
  DISCOVERED_PLACE_PATTERNS,
  HARVEST_PATTERNS,
  POSTAL_CODE_DISCOVERY_PATTERNS,
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
  sourceEntryStatus: schemaId('enums/SourceEntryStatus'),
  postalCodeDiscoveryStatus: schemaId('enums/PostalCodeDiscoveryStatus'),
  itemSourceMatch: schemaId('enums/ItemSourceMatch'),
  discoveredPlaceStatus: schemaId('enums/DiscoveredPlaceStatus'),
  sourceLocationStatus: schemaId('enums/SourceLocationStatus'),
  adapterKey: schemaId('enums/AdapterKey'),
  harvestWarningCode: schemaId('enums/HarvestWarningCode'),

  harvestRunWarning: schemaId('harvest/HarvestRunWarning'),
  harvestRunView: schemaId('harvest/HarvestRunView'),
  harvestRunExportResult: schemaId('harvest/HarvestRunExportResult'),
  discoveredPlaceView: schemaId('harvest/DiscoveredPlaceView'),
  discoveredPlaceGroup: schemaId('harvest/DiscoveredPlaceGroup'),
  discoveredPlaceGroupsResult: schemaId('harvest/DiscoveredPlaceGroupsResult'),
  sourceCatalogEntryView: schemaId('harvest/SourceCatalogEntryView'),
  sourceEntryPriceView: schemaId('harvest/SourceEntryPriceView'),
  sourceEntryAcceptResult: schemaId('harvest/SourceEntryAcceptResult'),
  sourceLocationView: schemaId('harvest/SourceLocationView'),
  supermarketSourceView: schemaId('harvest/SupermarketSourceView'),
  postalCodeDiscoveryRequestView: schemaId(
    'harvest/PostalCodeDiscoveryRequestView'
  ),

  harvestRunPage: schemaId('harvest/HarvestRunPage'),
  discoveredPlacePage: schemaId('harvest/DiscoveredPlacePage'),
  sourceCatalogEntryPage: schemaId('harvest/SourceCatalogEntryPage'),
  sourceLocationPage: schemaId('harvest/SourceLocationPage'),
  supermarketSourcePage: schemaId('harvest/SupermarketSourcePage'),
  postalCodeDiscoveryRequestPage: schemaId(
    'harvest/PostalCodeDiscoveryRequestPage'
  ),

  spawnRunRequest: schemaId('msg/harvest.spawn/request'),
  runIdRequest: schemaId('msg/harvest.run.id/request'),
  listRunsRequest: schemaId('msg/harvest.run.list/request'),
  exportRunRequest: schemaId('msg/harvest.export/request'),
  listPlacesRequest: schemaId('msg/place.list/request'),
  groupPlacesRequest: schemaId('msg/place.groups/request'),
  importPlaceRequest: schemaId('msg/place.import/request'),
  placeIdRequest: schemaId('msg/place.id/request'),
  listSourceLocationsRequest: schemaId('msg/sourceLocation.list/request'),
  mapSourceLocationRequest: schemaId('msg/sourceLocation.map/request'),
  sourceLocationIdRequest: schemaId('msg/sourceLocation.id/request'),
  listEntriesRequest: schemaId('msg/sourceEntry.list/request'),
  entryIdRequest: schemaId('msg/sourceEntry.id/request'),
  acceptEntryRequest: schemaId('msg/sourceEntry.accept/request'),
  createItemFromEntryRequest: schemaId('msg/sourceEntry.createItem/request'),
  upsertSourceRequest: schemaId('msg/supermarketSource.upsert/request'),
  sourceIdRequest: schemaId('msg/supermarketSource.id/request'),
  setSourceEnabledRequest: schemaId('msg/supermarketSource.setEnabled/request'),
  listSourcesRequest: schemaId('msg/supermarketSource.list/request'),
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
/**
 * A bag a producer filled and nothing here reads (plan 0086, section 6.1).
 * Nullable, because a source that said nothing extra says null rather than an
 * empty object it never wrote.
 */
const nullableObject = (): JsonSchema => ({
  type: ['object', 'null'],
  additionalProperties: true,
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
    // Free form on purpose: a summary for a person reading a finished run, not a
    // structure anything decides on (plan 0085, section 3).
    report: freeObject(),
    correlationId: nullableString(),
    requestedByUserId: nullableString(),
    // Plan 0082. The status is untouched by a revert: it says how the run
    // ended, and that did not change.
    revertedAt: nullableString(),
    revertedByUserId: nullableString(),
    revertedPriceCount: integerOrNull(),
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
    'report',
    'correlationId',
    'requestedByUserId',
    'revertedAt',
    'revertedByUserId',
    'revertedPriceCount',
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

/**
 * One product as a source described it, and what became of it (plan 0086,
 * sections 3.1 and 10).
 *
 * Two groups of fields on one row: the source's, which every run rewrites
 * verbatim, and a person's, which a run only reads. `sourceKind` is the
 * discriminator every code path reads; nothing parses `externalId`.
 */
const sourceCatalogEntryView = object(
  HARVEST_SCHEMA_IDS.sourceCatalogEntryView,
  {
    id: nonEmptyString(),
    supermarketId: nonEmptyString(),
    externalId: nonEmptyString(),
    sourceKind: ref(CATALOG_SCHEMA_IDS.priceSourceKind),
    name: nonEmptyString(),
    brand: nullableString(),
    ean: nullableString(),
    unitSize: numberOrNull(),
    sizeFormat: nullableString(),
    categoryPath: array(string()),
    url: nullableString(),
    // Stored, shown, and never interpreted (plan 0086, section 6.1).
    extra: nullableObject(),
    timesSeen: integer({ minimum: 0 }),
    firstSeenAt: string({ format: 'date-time' }),
    lastSeenAt: string({ format: 'date-time' }),
    firstRunId: nullableString(),
    lastRunId: nullableString(),
    itemId: nullableString(),
    candidateEntryId: nullableString(),
    status: ref(HARVEST_SCHEMA_IDS.sourceEntryStatus),
    matchedBy: {
      anyOf: [ref(HARVEST_SCHEMA_IDS.itemSourceMatch), { type: 'null' }],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    decidedAt: nullableString(),
    // Inline, because there is one per scope and a chain has a handful of
    // scopes, and the queue cannot decide a row without seeing what it holds.
    prices: array(ref(HARVEST_SCHEMA_IDS.sourceEntryPriceView)),
  },
  [
    'id',
    'supermarketId',
    'externalId',
    'sourceKind',
    'name',
    'brand',
    'ean',
    'unitSize',
    'sizeFormat',
    'categoryPath',
    'url',
    'extra',
    'timesSeen',
    'firstSeenAt',
    'lastSeenAt',
    'firstRunId',
    'lastRunId',
    'itemId',
    'candidateEntryId',
    'status',
    'matchedBy',
    'confidence',
    'decidedAt',
    'prices',
  ]
);

/**
 * The latest price one scope stated for one row (plan 0086, section 3.2).
 *
 * A chain has several leaflets at once because each is for a region, and the
 * decision about a product is one while the prices are one per scope.
 */
const sourceEntryPriceView = object(
  HARVEST_SCHEMA_IDS.sourceEntryPriceView,
  {
    id: nonEmptyString(),
    priceScopeId: nonEmptyString(),
    // Null when the source stated only a comparison figure.
    price: numberOrNull(),
    currency: nonEmptyString(),
    unitPrice: numberOrNull(),
    unitPriceLabel: nullableString(),
    validFrom: nullableString(),
    validUntil: nullableString(),
    details: nullableObject(),
    observedAt: string({ format: 'date-time' }),
    runId: nullableString(),
  },
  [
    'id',
    'priceScopeId',
    'price',
    'currency',
    'unitPrice',
    'unitPriceLabel',
    'validFrom',
    'validUntil',
    'details',
    'observedAt',
    'runId',
  ]
);

/**
 * What deciding a queued row did (plan 0086, section 7). `pricesWritten` is
 * the point of answering anything beyond the row, and zero is a normal answer
 * for a source that prints no price.
 */
const sourceEntryAcceptResult = object(
  HARVEST_SCHEMA_IDS.sourceEntryAcceptResult,
  {
    entry: ref(HARVEST_SCHEMA_IDS.sourceCatalogEntryView),
    pricesWritten: integer({ minimum: 0 }),
    createdItem: {
      anyOf: [ref(CATALOG_SCHEMA_IDS.itemView), { type: 'null' }],
    },
  },
  ['entry', 'pricesWritten', 'createdItem']
);

/**
 * A run's export (plan 0086, section 6.2). The document is a free object here
 * for the same reason the spawn's is: it has its own versioned JSON schema, and
 * restating that shape would be a second copy to drift from it.
 */
const harvestRunExportResult = object(
  HARVEST_SCHEMA_IDS.harvestRunExportResult,
  {
    supermarketId: nonEmptyString(),
    priceScopeId: nullableString(),
    document: freeObject(),
  },
  ['supermarketId', 'priceScopeId', 'document']
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
const sourceLocationPage = paginated(
  HARVEST_SCHEMA_IDS.sourceLocationPage,
  HARVEST_SCHEMA_IDS.sourceLocationView
);
const supermarketSourcePage = paginated(
  HARVEST_SCHEMA_IDS.supermarketSourcePage,
  HARVEST_SCHEMA_IDS.supermarketSourceView
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
    // What observed the products in a FILE_IMPORT's document, which is what its
    // rows and its prices are stamped with (plan 0086, section 6.2). Not what
    // the upload is: a re-imported Mercadona walk stamps OFFICIAL_API.
    sourceKind: ref(CATALOG_SCHEMA_IDS.priceSourceKind),
    // The file, for a FILE_IMPORT run. A free object here on purpose: it is
    // validated against its own versioned schema (plan 0086, section 6.1) by
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
    // Plan 0082, section 6. Absent lists both.
    reverted: boolean(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId']
);

/** A read, so it is not gated by HARVEST_ENABLED (plan 0086, section 6.2). */
const exportRunRequest = object(
  HARVEST_SCHEMA_IDS.exportRunRequest,
  { ...adminCredentialProperties, runId: nonEmptyString() },
  ['userId', 'runId']
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
    // Absent lists the two that are waiting for a person, which is the queue.
    status: ref(HARVEST_SCHEMA_IDS.sourceEntryStatus),
    sourceKind: ref(CATALOG_SCHEMA_IDS.priceSourceKind),
    query: string(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId', 'supermarketId']
);
const entryIdRequest = object(
  HARVEST_SCHEMA_IDS.entryIdRequest,
  { ...adminCredentialProperties, entryId: nonEmptyString() },
  ['userId', 'entryId']
);
const acceptEntryRequest = object(
  HARVEST_SCHEMA_IDS.acceptEntryRequest,
  {
    ...adminCredentialProperties,
    entryId: nonEmptyString(),
    itemId: nonEmptyString(),
  },
  ['userId', 'entryId', 'itemId']
);
/**
 * Every field but the row is optional: the row already holds a default for each
 * (plan 0086, section 7), so an operator sends only what he changed.
 */
const createItemFromEntryRequest = object(
  HARVEST_SCHEMA_IDS.createItemFromEntryRequest,
  {
    ...adminCredentialProperties,
    entryId: nonEmptyString(),
    // One locale is enough since plan 0079: a reader in English sees the
    // Spanish string through the fallback.
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
    HARVEST_SCHEMA_IDS.sourceEntryStatus,
    Object.values(SourceEntryStatus)
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
  harvestRunExportResult,
  discoveredPlaceView,
  discoveredPlaceGroup,
  discoveredPlaceGroupsResult,
  sourceCatalogEntryView,
  sourceEntryPriceView,
  sourceEntryAcceptResult,
  sourceLocationView,
  postalCodeDiscoveryRequestView,
  harvestRunPage,
  discoveredPlacePage,
  sourceCatalogEntryPage,
  sourceLocationPage,
  supermarketSourcePage,
  postalCodeDiscoveryRequestPage,
  spawnRunRequest,
  runIdRequest,
  listRunsRequest,
  exportRunRequest,
  listPlacesRequest,
  groupPlacesRequest,
  importPlaceRequest,
  placeIdRequest,
  listSourceLocationsRequest,
  mapSourceLocationRequest,
  sourceLocationIdRequest,
  listEntriesRequest,
  entryIdRequest,
  acceptEntryRequest,
  createItemFromEntryRequest,
  upsertSourceRequest,
  sourceIdRequest,
  setSourceEnabledRequest,
  listSourcesRequest,
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
  [HARVEST_PATTERNS.revert]: {
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
  [HARVEST_PATTERNS.export]: {
    request: HARVEST_SCHEMA_IDS.exportRunRequest,
    response: HARVEST_SCHEMA_IDS.harvestRunExportResult,
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
  [SOURCE_ENTRY_PATTERNS.accept]: {
    request: HARVEST_SCHEMA_IDS.acceptEntryRequest,
    response: HARVEST_SCHEMA_IDS.sourceEntryAcceptResult,
  },
  [SOURCE_ENTRY_PATTERNS.createItem]: {
    request: HARVEST_SCHEMA_IDS.createItemFromEntryRequest,
    response: HARVEST_SCHEMA_IDS.sourceEntryAcceptResult,
  },
  [SOURCE_ENTRY_PATTERNS.reject]: {
    request: HARVEST_SCHEMA_IDS.entryIdRequest,
    response: HARVEST_SCHEMA_IDS.sourceCatalogEntryView,
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
  [POSTAL_CODE_DISCOVERY_PATTERNS.list]: {
    request: HARVEST_SCHEMA_IDS.listDiscoveryRequestsRequest,
    response: HARVEST_SCHEMA_IDS.postalCodeDiscoveryRequestPage,
  },
};
