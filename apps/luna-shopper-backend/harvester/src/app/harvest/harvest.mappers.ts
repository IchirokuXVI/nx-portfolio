import type {
  AdapterKey,
  DiscoveredPlaceView,
  HarvestRunView,
  ItemSourceRefView,
  LeafletOffer,
  PostalCodeDiscoveryRequestView,
  SourceAliasView,
  SourceCatalogEntryView,
  SourceLocationView,
  SupermarketSourceView,
} from '@portfolio/luna-shopper/contracts';
import type {
  DiscoveredPlace,
  HarvestRun,
  ItemSourceRef,
  PostalCodeDiscoveryRequest,
  SourceAlias,
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
    skipped: row.skipped,
    failed: row.failed,
    stage: row.stage,
    stageLabel: row.stageLabel,
    // Every decision the run made that was not a write (plan 0081, section 7).
    // Defaulted rather than trusted: a run created before that column existed
    // reads back as null through an older row cache.
    warnings: row.warnings ?? [],
    documentSha256: row.documentSha256 ?? null,
    abortRequestedAt: iso(row.abortRequestedAt),
    error: row.error,
    // A row inserted before the column existed reads null through TypeORM's
    // hydration of an older snapshot, and an empty bag is what "nothing to say"
    // means everywhere else in this view.
    report: row.report ?? {},
    correlationId: row.correlationId,
    requestedByUserId: row.requestedByUserId,
  };
}

/**
 * One printed name a chain used (plan 0081, section 2), with the offer it is
 * waiting on where the caller loaded it.
 *
 * The offer is **not** stored on the row. It belongs to the document the run
 * kept, and copying its price here would be a second copy to go stale the first
 * time a later leaflet prints the same string at a different number. The queue
 * reads it back from the run instead, one document per page.
 */
export function toSourceAliasView(
  row: SourceAlias,
  offer?: LeafletOffer
): SourceAliasView {
  const unitPrice = offer?.pricing?.unit_price;
  return {
    id: row.id,
    supermarketId: row.supermarketId,
    aliasKey: row.aliasKey,
    printedName: row.printedName,
    printedFormat: row.printedFormat,
    printedBrand: row.printedBrand,
    itemId: row.itemId,
    candidateItemId: row.candidateItemId,
    candidateEntryId: row.candidateEntryId,
    status: row.status,
    matchedBy: row.matchedBy,
    confidence: Number(row.confidence),
    timesSeen: row.timesSeen,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    firstRunId: row.firstRunId,
    lastRunId: row.lastRunId,
    offerPrice: offer?.pricing?.price?.amount ?? null,
    offerCurrency: offer?.pricing?.price?.currency ?? null,
    offerUnitPrice:
      typeof unitPrice?.amount === 'number' ? unitPrice.amount : null,
    offerUnitPriceLabel: unitPrice?.per ?? null,
    offerPage: offer?.page ?? null,
    offerRawText: offer?.raw_text ?? [],
    offerConfidence:
      typeof offer?.confidence === 'number' ? offer.confidence : null,
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
