import type {
  AdapterKey,
  DiscoveredPlaceView,
  HarvestRunView,
  ItemSourceRefView,
  PostalCodeDiscoveryRequestView,
  SourceCatalogEntryView,
  SourceLocationView,
  SupermarketSourceView,
} from '@portfolio/luna-shopper/contracts';
import type {
  DiscoveredPlace,
  HarvestRun,
  ItemSourceRef,
  PostalCodeDiscoveryRequest,
  SourceCatalogEntry,
  SourceLocation,
  SupermarketSource,
} from '../entities';

/**
 * Postgres `numeric` comes back as a **string** through node-postgres, so every
 * numeric column is normalised rather than cast. A cast would put the string on
 * the wire and produce a silent NaN the first time anything did arithmetic.
 */
function toNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function toSupermarketSourceView(
  row: SupermarketSource
): SupermarketSourceView {
  return {
    id: row.id,
    supermarketId: row.supermarketId,
    adapterKey: row.adapterKey as AdapterKey,
    enabled: row.enabled,
    config: row.config,
    workers: row.workers,
    maxRequestsPerSecond: Number(row.maxRequestsPerSecond),
    lastRunAt: iso(row.lastRunAt),
    lastSuccessAt: iso(row.lastSuccessAt),
    consecutiveFailures: row.consecutiveFailures,
  };
}

export function toHarvestRunView(row: HarvestRun): HarvestRunView {
  return {
    id: row.id,
    supermarketId: row.supermarketId,
    sourceId: row.sourceId,
    mode: row.mode,
    trigger: row.trigger,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    heartbeatAt: iso(row.heartbeatAt),
    totalPlanned: row.totalPlanned,
    processed: row.processed,
    created: row.created,
    updated: row.updated,
    unchanged: row.unchanged,
    notFound: row.notFound,
    failed: row.failed,
    stage: row.stage,
    stageLabel: row.stageLabel,
    abortRequestedAt: iso(row.abortRequestedAt),
    error: row.error,
    correlationId: row.correlationId,
    requestedByUserId: row.requestedByUserId,
  };
}

export function toDiscoveredPlaceView(
  row: DiscoveredPlace
): DiscoveredPlaceView {
  return {
    id: row.id,
    runId: row.runId,
    provider: row.provider,
    externalRef: row.externalRef,
    brandKey: row.brandKey,
    brandName: row.brandName,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    street: row.street,
    city: row.city,
    postalCode: row.postalCode,
    country: row.country,
    website: row.website,
    openingHours: row.openingHours,
    tags: row.tags,
    status: row.status,
    supermarketLocationId: row.supermarketLocationId,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

export function toSourceCatalogEntryView(
  row: SourceCatalogEntry
): SourceCatalogEntryView {
  return {
    id: row.id,
    supermarketId: row.supermarketId,
    externalId: row.externalId,
    name: row.name,
    brand: row.brand,
    ean: row.ean,
    unitSize: toNumber(row.unitSize),
    sizeFormat: row.sizeFormat,
    price: toNumber(row.price),
    unitPrice: toNumber(row.unitPrice),
    unitPriceLabel: row.unitPriceLabel,
    categoryPath: row.categoryPath ?? [],
    url: row.url,
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

export function toItemSourceRefView(row: ItemSourceRef): ItemSourceRefView {
  return {
    id: row.id,
    itemId: row.itemId,
    supermarketId: row.supermarketId,
    externalId: row.externalId,
    externalUrl: row.externalUrl,
    matchedBy: row.matchedBy,
    status: row.status,
    confidence: Number(row.confidence),
    lastResolvedAt: iso(row.lastResolvedAt),
    lastSeenAt: iso(row.lastSeenAt),
  };
}

/**
 * One shop a source names (plan 0084, section 6).
 *
 * `externalId` is the source's own code and `printedName` is what it displayed;
 * the view carries both because the queue is read by a person who recognises the
 * street and acts on the code.
 */
export function toSourceLocationView(row: SourceLocation): SourceLocationView {
  return {
    id: row.id,
    supermarketId: row.supermarketId,
    externalId: row.externalId,
    printedName: row.printedName,
    supermarketLocationId: row.supermarketLocationId,
    status: row.status,
    matchedBy: row.matchedBy,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    firstRunId: row.firstRunId,
    lastRunId: row.lastRunId,
  };
}

/**
 * One row of the postal code discovery queue (plan 0063, section 8).
 *
 * `requestedAt` is when the code was first announced and does not move when a
 * later enqueue re opens the row, so a reader can see how long a code has been
 * waiting rather than only when it was last touched.
 */
export function toPostalCodeDiscoveryRequestView(
  row: PostalCodeDiscoveryRequest
): PostalCodeDiscoveryRequestView {
  return {
    id: row.id,
    country: row.country,
    postalCode: row.postalCode,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    lastAttemptedAt: iso(row.lastAttemptedAt),
    discoveredAt: iso(row.discoveredAt),
    nextAttemptAt: iso(row.nextAttemptAt),
    attempts: row.attempts,
    runId: row.runId,
    error: row.error,
  };
}
