/**
 * Harvester enums (plan 0038). The harvester fetches prices and store locations
 * from third party sources and writes what it finds into catalog. These constant
 * sets are enums per the project rule; their string values are the wire format
 * and must stay stable.
 *
 * They live beside the other domains' enum files rather than inside
 * `catalog.enums.ts`, which is where plan 0038 section 5.8 lists them: the two
 * price enums did belong to catalog and are there, but a run's mode and status
 * describe the harvester's own database, and every other domain in this library
 * already owns a file.
 */

/**
 * What a run is for (plan 0038, section 6). The three modes have very different
 * costs: STORE_DISCOVERY is two requests, CATALOG_DISCOVERY is 4,383, and REFRESH
 * is proportional to the items the owner actually tracks.
 */
export enum HarvestRunMode {
  /** Geocode a postal code, then one Overpass query for the supermarkets near it. */
  STORE_DISCOVERY = 'STORE_DISCOVERY',
  /** Walk a chain's whole assortment, capturing EAN and brand per product. */
  CATALOG_DISCOVERY = 'CATALOG_DISCOVERY',
  /** Re-fetch only the products already linked to a catalog item. */
  REFRESH = 'REFRESH',
}

/**
 * Who asked for a run. Every run in plan 0038 is MANUAL: the scheduler is
 * deferred to backlog 0001 section 7.6, and section 8.1 leans on "a person asked
 * for this" as the reason the fetching is defensible at all. SCHEDULED and SYSTEM
 * exist so the column does not need a migration when that changes.
 */
export enum HarvestRunTrigger {
  MANUAL = 'MANUAL',
  SCHEDULED = 'SCHEDULED',
  SYSTEM = 'SYSTEM',
}

/**
 * A run's lifecycle (plan 0038, section 6.6). PENDING and RUNNING are the two
 * states the active-run unique index treats as "in progress"; the rest are
 * terminal. STALE is what the reaper writes over a run whose heartbeat stopped,
 * which is the only recovery path for a force killed harvester.
 */
export enum HarvestRunStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  ABORTED = 'ABORTED',
  STALE = 'STALE',
}

/**
 * The state of the link between one catalog item and one source's product
 * (plan 0038, section 6.2). Only ACTIVE refs are refreshed and only ACTIVE refs
 * may write a price: a CANDIDATE came from a fuzzy name match and stays inert
 * until the owner confirms it, because a bad match writes a wrong price onto a
 * real product that users then shop on.
 */
export enum ItemSourceRefStatus {
  ACTIVE = 'ACTIVE',
  CANDIDATE = 'CANDIDATE',
  REJECTED = 'REJECTED',
  /** Linked by hand by the owner; never re-derived by a discovery run. */
  MANUAL = 'MANUAL',
}

/** How a ref was established (plan 0038, section 6.2's matching ladder). */
export enum ItemSourceMatch {
  /** The ref already existed and the external id still resolves. */
  EXTERNAL_ID = 'EXTERNAL_ID',
  /** The source's EAN equals a catalog item's. The only cross chain identifier. */
  EAN = 'EAN',
  /** Normalized name plus brand plus size. Produces a CANDIDATE, never an ACTIVE. */
  NAME_BRAND_SIZE = 'NAME_BRAND_SIZE',
  MANUAL = 'MANUAL',
}

/**
 * What has become of a place a store discovery run found (plan 0038, section 6.1).
 * A run creates nothing in catalog, so every place starts NEW and stays there
 * until the owner imports or rejects it.
 */
export enum DiscoveredPlaceStatus {
  NEW = 'NEW',
  IMPORTED = 'IMPORTED',
  REJECTED = 'REJECTED',
}
