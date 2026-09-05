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
 * What a run is for (plan 0038, section 6; plan 0081, section 1). The modes have
 * very different costs: STORE_DISCOVERY is two requests, CATALOG_DISCOVERY is
 * 4,383, REFRESH is proportional to the items the owner actually tracks, and
 * LEAFLET_IMPORT makes none at all.
 */
export enum HarvestRunMode {
  /** Geocode a postal code, then one Overpass query for the supermarkets near it. */
  STORE_DISCOVERY = 'STORE_DISCOVERY',
  /** Walk a chain's whole assortment, capturing EAN and brand per product. */
  CATALOG_DISCOVERY = 'CATALOG_DISCOVERY',
  /** Re-fetch only the products already linked to a catalog item. */
  REFRESH = 'REFRESH',
  /**
   * Read an uploaded leaflet document and write the prices printed in it (plan
   * 0081). **The output is identical to the output of a crawl; only the
   * fetching differs**, which is why it is a run here rather than a write in
   * catalog: the run machinery, the per chain lock and the review queues all
   * already exist.
   *
   * A run in this mode has a `supermarketId` and `sourceId: null`. A
   * `SupermarketSource` is fetching configuration, and an upload fetches
   * nothing, so a chain that publishes only leaflets needs no source row at all.
   */
  LEAFLET_IMPORT = 'LEAFLET_IMPORT',
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
  /**
   * Normalized name, and a size where the subject has one. Two rungs share it
   * because both compare a name with no brand beside it.
   *
   * A shop has neither a brand nor a size (plan 0084, section 6), so the rung
   * that maps one to a catalog location is a name comparison and says so rather
   * than borrowing a label that names two fields it never read. A leaflet tile
   * has a printed format and an unreliable brand (plan 0081, section 2.1): one
   * extractor read a brand on 0 of 219 offers and another on 43 of 48, so a key
   * with brand in it resolves one product two ways.
   *
   * Produces a CANDIDATE, never an ACTIVE.
   */
  NAME_SIZE = 'NAME_SIZE',
  MANUAL = 'MANUAL',
}

/**
 * What has become of one shop a source names (plan 0084, section 6).
 *
 * The row exists the moment a run first sees the shop, whatever came of it, so
 * a shop nobody has mapped is a row in a queue rather than a silence in a log.
 */
export enum SourceLocationStatus {
  /** Bound to a catalog location. The only status a run writes availability for. */
  ACTIVE = 'ACTIVE',
  /**
   * Seen, and nobody has said which of our shops it is. A run skips it, counts
   * it, and finishes: an unknown location needs no action from the run.
   */
  UNMAPPED = 'UNMAPPED',
  /**
   * A place the source lists that we do not sell from: DEZA publishes eighteen
   * centres of which ten carry products, and the rest are warehouses, a
   * cafeteria, a bakery and a beauty salon. Marking one is a person's act, and
   * a run never does it.
   */
  IGNORED = 'IGNORED',
}

/**
 * What has become of one printed name a chain used (plan 0081, section 2).
 *
 * The rule the whole set exists for: **only an admin ever creates an ACTIVE
 * alias.** A fuzzy match proposes a CANDIDATE and writes no price, because a
 * bad match writes a wrong price onto a real product that people then shop on.
 */
export enum SourceAliasStatus {
  /** Bound to an item by a person. The only status that writes a price. */
  ACTIVE = 'ACTIVE',
  /** The fuzzy rung proposed something. Waiting for a person, writing nothing. */
  CANDIDATE = 'CANDIDATE',
  /** Nothing was proposed. Waiting for a person, writing nothing. */
  UNRESOLVED = 'UNRESOLVED',
  /**
   * The owner said this string is not a product he tracks. A run does not get
   * to reopen that: the next leaflet printing it skips the offer with a
   * warning and does not ask again.
   */
  REJECTED = 'REJECTED',
}

/**
 * Why a leaflet import skipped an offer or sent it to the queue (plan 0081,
 * sections 6 and 7).
 *
 * Every skip and every queue entry becomes a warning carrying the offer's id, so
 * a run page reads as a list of decisions rather than a set of counters that
 * lost their reasons.
 */
export enum HarvestWarningCode {
  /** Section 6.3: the price needs the chain's loyalty card, so nothing is written. */
  LOYALTY_REQUIRED = 'LOYALTY_REQUIRED',
  /**
   * Section 6.2: the headline price is the price of a second unit or of a
   * required quantity, and the tile carries no `single_unit_price`. The only
   * number on it is one a shopper cannot pay for one unit.
   */
  CONDITIONAL_PRICE = 'CONDITIONAL_PRICE',
  /** Section 2.1: two offers in one document share an alias key. Neither writes. */
  DUPLICATE_KEY = 'DUPLICATE_KEY',
  /** Section 3, rung 2: the owner rejected this printed name. */
  REJECTED_ALIAS = 'REJECTED_ALIAS',
  /** Section 3, rung 4: a fuzzy match proposed something, so a person decides. */
  CANDIDATE_MATCH = 'CANDIDATE_MATCH',
  /** Section 3, rung 4: nothing matched, so the printed name waits in the queue. */
  NO_MATCH = 'NO_MATCH',
  /** Section 3, rung 3: this printed name is already waiting for a person. */
  ALREADY_QUEUED = 'ALREADY_QUEUED',
  /** A tile the extractor itself could not resolve, carried through verbatim. */
  EXTRACTOR = 'EXTRACTOR',
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

/**
 * Where one postal code stands in the discovery queue (plan 0063, section 3).
 *
 * The queue exists because a run cannot: the active run index treats PENDING and
 * RUNNING as in progress, so six codes announced by one profile write cannot be
 * six runs, and this table is the backlog of work that has not become a run yet.
 *
 * `DONE` means **we looked**, never that we found anything. A discovery run
 * creates no catalog location, only `DiscoveredPlace` rows an admin still has to
 * import, so a code stays unknown to catalog long after the queue is finished
 * with it (section 5).
 */
export enum PostalCodeDiscoveryStatus {
  /** Waiting for the worker. Also where a backed off retry sits between attempts. */
  QUEUED = 'QUEUED',
  /** A run for this code exists and is in progress. One row at a time, by design. */
  RUNNING = 'RUNNING',
  /** We looked. Not re-asked until the cooldown expires (section 4). */
  DONE = 'DONE',
  /** Out of attempts, left with its reason for backlog 0009 to show somebody. */
  FAILED = 'FAILED',
}
