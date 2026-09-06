import type {
  AdapterKey,
  DiscoveredPlaceView,
  HarvestRunView,
  ItemPriceDetails,
  PostalCodeDiscoveryRequestView,
  SourceCatalogEntryView,
  SourceEntryPriceView,
  SourceLocationView,
  SupermarketSourceView,
} from '@portfolio/luna-shopper/contracts';
import type {
  DiscoveredPlace,
  HarvestRun,
  PostalCodeDiscoveryRequest,
  SourceCatalogEntry,
  SourceEntryPrice,
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
    // Plan 0082. Three fields and no status change: a reverted run is still the
    // COMPLETED or FAILED run it was, and this is drawn beside that.
    revertedAt: iso(row.revertedAt),
    revertedByUserId: row.revertedByUserId ?? null,
    revertedPriceCount: row.revertedPriceCount ?? null,
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

/**
 * One product as a source described it, and what became of it (plan 0086,
 * section 3.1), with the price each scope stated where the caller loaded them.
 *
 * `prices` defaults to empty rather than being trusted: a caller that did not
 * ask for the relation gets a row with no `prices` property at all, and an empty
 * list is what "this row is waiting on nothing" means everywhere else.
 */
export function toSourceCatalogEntryView(
  row: SourceCatalogEntry
): SourceCatalogEntryView {
  return {
    id: row.id,
    supermarketId: row.supermarketId,
    externalId: row.externalId,
    sourceKind: row.sourceKind,
    name: row.name,
    brand: row.brand,
    ean: row.ean,
    unitSize: toNumber(row.unitSize),
    sizeFormat: row.sizeFormat,
    categoryPath: row.categoryPath ?? [],
    url: row.url,
    extra: row.extra ?? null,
    timesSeen: row.timesSeen,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    firstRunId: row.firstRunId,
    lastRunId: row.lastRunId,
    itemId: row.itemId,
    candidateEntryId: row.candidateEntryId,
    status: row.status,
    matchedBy: row.matchedBy,
    confidence: Number(row.confidence),
    decidedAt: iso(row.decidedAt),
    prices: (row.prices ?? []).map(toSourceEntryPriceView),
  };
}

/** The latest price one scope stated for one row (plan 0086, section 3.2). */
export function toSourceEntryPriceView(
  row: SourceEntryPrice
): SourceEntryPriceView {
  return {
    id: row.id,
    priceScopeId: row.priceScopeId,
    price: toNumber(row.price),
    currency: row.currency,
    unitPrice: toNumber(row.unitPrice),
    unitPriceLabel: row.unitPriceLabel,
    validFrom: iso(row.validFrom),
    validUntil: iso(row.validUntil),
    details: row.details ?? null,
    observedAt: row.observedAt.toISOString(),
    runId: row.runId,
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

/**
 * The `extra` bag as catalog's price details, where the two overlap (plan 0086,
 * section 6.1; plan 0081, section 6.4).
 *
 * `extra` is free and catalog's `item_price_details` is not, so this is a
 * translation rather than a pass through: the five keys that table holds are
 * taken where the producer used those names and everything else stays on the
 * row, where the queue shows it. A bag with none of them writes no details row
 * at all, which is what a walk's price looks like.
 *
 * **Nothing reads either side to decide anything.** The rules that used to read
 * `promotion` and `loyalty` moved to the producer with plan 0086, and this is
 * carried for the admin price history alone.
 */
export function toItemPriceDetails(
  extra: Record<string, unknown> | null
): ItemPriceDetails | null {
  if (!extra) {
    return null;
  }
  const offerId = extra['offer_id'] ?? extra['offerId'];
  const page = extra['page'];
  const rawText = extra['raw_text'] ?? extra['rawText'];
  const promotion = extra['promotion'];
  const loyalty = extra['loyalty'];
  const details: ItemPriceDetails = {
    offerId: typeof offerId === 'string' ? offerId : null,
    page: typeof page === 'number' ? page : null,
    rawText: Array.isArray(rawText)
      ? rawText.filter((line): line is string => typeof line === 'string')
      : [],
    promotion: isBag(promotion) ? promotion : null,
    loyalty: isBag(loyalty) ? loyalty : null,
  };
  const empty =
    details.offerId === null &&
    details.page === null &&
    details.rawText.length === 0 &&
    details.promotion === null &&
    details.loyalty === null;
  return empty ? null : details;
}

function isBag(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
