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
 * What a run is for (plan 0038, section 6; plan 0086, section 9). The modes have
 * very different costs: STORE_DISCOVERY is two requests, CATALOG_DISCOVERY is
 * 4,383, and FILE_IMPORT makes none at all.
 *
 * **There are three, and there used to be four.** `REFRESH` re-fetched the
 * products already linked to a catalog item, purely because a catalog discovery
 * threw away the price it had already fetched for all 4,232 of them. Plan 0086
 * (D4) makes the walk write what it saw, which leaves the refresh with nothing
 * to do that the walk did not already do. A per item refresh for a shopper is a
 * different thing and stays in backlog 0006.
 */
export enum HarvestRunMode {
  /** Geocode a postal code, then one Overpass query for the supermarkets near it. */
  STORE_DISCOVERY = 'STORE_DISCOVERY',
  /**
   * Walk a chain's whole assortment, capturing EAN, brand and, where the source
   * states one, the price. Which storefront is walked is the source's
   * `adapterKey` and not the mode (plan 0085): `mercadona-api` answers JSON and
   * prices, `deza-web` renders a page and prints none.
   */
  CATALOG_DISCOVERY = 'CATALOG_DISCOVERY',
  /**
   * Read an uploaded {@link HarvestDocument} and write what it holds (plan
   * 0086, D6). **The output is identical to the output of a crawl; only the
   * fetching differs**, which is why it is a run here rather than a write in
   * catalog: the run machinery, the per chain lock and the review queue all
   * already exist.
   *
   * It is not a leaflet tool, which is what `LEAFLET_IMPORT` was called and the
   * reason it was renamed. A file is a list of products as a source described
   * them, whoever produced it: a leaflet extractor, a person typing a chain's
   * prices, or the harvester's own export from a machine that is allowed to
   * crawl.
   *
   * A run in this mode has a `supermarketId` and `sourceId: null`. A
   * `SupermarketSource` is fetching configuration, and an upload fetches
   * nothing, so a chain that publishes only files needs no source row at all.
   */
  FILE_IMPORT = 'FILE_IMPORT',
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
 * What has become of one product a source described (plan 0086, D7).
 *
 * One status for every source kind. A Mercadona product a walk found, a DEZA
 * listing and a printed leaflet name are three observations of the same kind of
 * thing, so they are rows of one table with one status column, and the two
 * queued values are the queue an admin works through.
 *
 * The rule the whole set exists for: **only an EAN or a person ever makes a row
 * ACTIVE.** A fuzzy match proposes a CANDIDATE and writes no price, because a
 * bad match writes a wrong price onto a real product that people then shop on.
 *
 * It replaces `ItemSourceRefStatus` and `SourceAliasStatus`, and it is the alias
 * enum under a new name, because that one already had the shape a queue needs: a
 * row that matched nothing is a status rather than an absence. `MANUAL` was
 * never a status here, it said *how* a row became ACTIVE, which is
 * {@link ItemSourceMatch}.
 */
export enum SourceEntryStatus {
  /** Bound to a catalog item, by an EAN or by a person. The only status that writes a price. */
  ACTIVE = 'ACTIVE',
  /** The fuzzy rung proposed something. Waiting for a person, writing nothing. */
  CANDIDATE = 'CANDIDATE',
  /** Nothing was proposed. Waiting for a person, writing nothing. */
  UNRESOLVED = 'UNRESOLVED',
  /**
   * The owner said this is not a product he tracks. A run does not get to
   * reopen that: the next run that observes the key touches the row and asks
   * nobody.
   */
  REJECTED = 'REJECTED',
}

/**
 * How a row was tied to a catalog item (plan 0038, section 6.2's ladder, as
 * plan 0086 section 4 restated it).
 *
 * **There is no `EXTERNAL_ID`.** It meant "the row already existed and its id
 * still resolves", and nothing ever wrote it: rung 1 touches a row it already
 * holds, and touching is not a match. It left the enum with plan 0086.
 */
export enum ItemSourceMatch {
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
 * Why a file import queued a product or wrote nothing for it (plan 0081,
 * section 7; plan 0086, section 5).
 *
 * Every decision a file import makes that was not a write becomes one of these,
 * so a run page reads as a list of decisions rather than a set of counters that
 * lost their reasons. **A walk records counters and no warnings**: a file has
 * hundreds of rows and a person reads that list, a walk has 4,232 and nobody
 * does.
 *
 * `LOYALTY_REQUIRED` and `CONDITIONAL_PRICE` are gone. They were the harvester
 * deciding which of a leaflet tile's numbers a shopper pays, and plan 0086
 * section 6.1 moves that to the producer: a `HarvestDocument` states a `price`
 * only when a shopper pays it for one unit, and anything it wants to say about
 * why it did not arrives as {@link EXTRACTOR} text.
 */
export enum HarvestWarningCode {
  /** Two products in one document share the key the import computes. Neither writes. */
  DUPLICATE_KEY = 'DUPLICATE_KEY',
  /** Rung 1 onto a REJECTED row: the owner said this is not a product he tracks. */
  REJECTED_ALIAS = 'REJECTED_ALIAS',
  /** Rung 3 or 4: a fuzzy match proposed something, so a person decides. */
  CANDIDATE_MATCH = 'CANDIDATE_MATCH',
  /** Rung 5: nothing matched, so the row waits in the queue. */
  NO_MATCH = 'NO_MATCH',
  /** Rung 1 onto a queued row: this one is already waiting for a person. */
  ALREADY_QUEUED = 'ALREADY_QUEUED',
  /** A warning the document itself carried, from whatever produced it, verbatim. */
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
