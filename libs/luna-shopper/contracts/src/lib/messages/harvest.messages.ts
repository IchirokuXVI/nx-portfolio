import type {
  ItemCategory,
  PriceSourceKind,
  UnitOfMeasure,
} from '../enums/catalog.enums';
import type {
  DiscoveredPlaceStatus,
  HarvestRunMode,
  HarvestRunStatus,
  HarvestRunTrigger,
  HarvestWarningCode,
  ItemSourceMatch,
  PostalCodeDiscoveryStatus,
  SourceEntryStatus,
  SourceLocationStatus,
} from '../enums/harvest.enums';
import type { PageQuery, Paginated } from '../pagination';
import type { AdminCredential } from './admin-auth.messages';
import type { ItemView } from './catalog.messages';
// The file schema (plan 0086, section 6.1), which `schemas/index.ts` already
// puts on the package's public surface beside its JSON schema and its
// validator. It is imported here and not re-exported: two `export *` of one
// name is an ambiguity TypeScript resolves by dropping the name.
import type { HarvestDocument } from '../../schemas/harvest-document';

/**
 * Harvester message contracts (plan 0038). The gateway calls these on the
 * harvester over NATS, under `/v1/admin/harvest/`. **Every subject here is
 * platform admin gated**: nothing in this plan is open to ordinary users, and the
 * one user facing addition that was designed (a public per item refresh) went to
 * backlog 0006 with its cooldown.
 *
 * The harvester owns its own database and holds `itemId`, `supermarketId`,
 * `supermarketLocationId` and `priceScopeId` as **opaque** values: it never joins
 * across the service boundary and reaches catalog only through the catalog
 * subjects in `catalog.messages.ts`.
 *
 * Timestamps cross the wire as ISO 8601 strings, like every other view here.
 */

export const HARVEST_PATTERNS = {
  spawn: 'harvest.spawn',
  abort: 'harvest.abort',
  /**
   * Take back everything a run wrote (plan 0082). Allowed on a finished run
   * whose mode writes prices, refused on a second attempt and on a run that
   * writes none.
   *
   * Not the same act as {@link abort}. An abort stops a run and **keeps** what
   * it already fetched, because prices already fetched are valid data. A revert
   * says the data was wrong and deletes it, which is why a run has to be
   * finished before it can be reverted: abort it first, then revert what it
   * flushed.
   */
  revert: 'harvest.revert',
  runGet: 'harvest.run.get',
  runList: 'harvest.run.list',
  /**
   * Everything one run observed, as a {@link HarvestDocument} (plan 0086,
   * section 6.2).
   *
   * The other half of {@link HarvestRunMode.FILE_IMPORT}, and the reason the
   * file schema is one schema: a walk runs on the compose stack where there is
   * room for 4,383 requests, its export is uploaded to a cluster that is not
   * allowed to crawl, and that cluster's rows, ladder, queue and prices are
   * exactly what a walk there would have produced.
   *
   * A **read**, so it is not gated by `HARVEST_ENABLED`: exporting from a
   * machine that crawled to one that cannot is the point of it.
   */
  export: 'harvest.export',
} as const;

export const DISCOVERED_PLACE_PATTERNS = {
  list: 'place.list',
  /**
   * Section 6.1 step 4's report: the run's places grouped by chain, with a count,
   * a sample and whether catalog already knows that chain. A flat page cannot say
   * it, and it is what the owner reads before choosing what to import.
   */
  groups: 'place.groups',
  import: 'place.import',
  reject: 'place.reject',
} as const;

/**
 * The one queue, for every chain and every source kind (plan 0086, D7 and
 * section 10).
 *
 * These four replace `sourceAlias.accept`, `sourceAlias.createItem`,
 * `sourceAlias.reject`, `itemSourceRef.confirm`, `itemSourceRef.reject` and
 * `itemSourceRef.setManual`, which were three queues over three tables saying
 * the same three things. A Mercadona product a walk found, a DEZA listing and a
 * printed leaflet name are three observations of the same kind of thing, so
 * there is one table, one status column and one set of decisions about a row.
 *
 * **Accepting writes the prices the row holds**, one per scope, each stamped
 * with the run that observed it. That is what lets an admin who works the queue
 * after an eighteen minute walk get the prices that walk saw without running it
 * again, and what lets two regional leaflets of one chain each put their price
 * into their own scope from one decision.
 *
 * `itemSourceRef.setManual` has no replacement. It linked an item to an external
 * id by hand so that a refresh fetched it; nothing fetches by id any more, and a
 * product no run has observed has no row, no price and nothing to link.
 */
export const SOURCE_ENTRY_PATTERNS = {
  list: 'sourceEntry.list',
  accept: 'sourceEntry.accept',
  createItem: 'sourceEntry.createItem',
  reject: 'sourceEntry.reject',
} as const;

/**
 * Which shop of theirs is which of ours (plan 0084, section 7).
 *
 * A source that answers availability per shop names its shops by its own code,
 * and only a person can say which catalog location each one is. These are the
 * five acts of that queue: read it, bind a row, unbind it, and take a place we
 * do not sell from out of the queue for good.
 *
 * **Mapping a shop does not backfill it.** The availability a run skipped stays
 * skipped until the next run, which is the opposite of `sourceEntry.accept`: a
 * price the run observed sits on the row it observed it for, and a shop's
 * availability is one boolean per product across a whole assortment that no run
 * stored.
 */
export const SOURCE_LOCATION_PATTERNS = {
  list: 'sourceLocation.list',
  map: 'sourceLocation.map',
  unmap: 'sourceLocation.unmap',
  ignore: 'sourceLocation.ignore',
  unignore: 'sourceLocation.unignore',
} as const;

export const SUPERMARKET_SOURCE_PATTERNS = {
  upsert: 'supermarketSource.upsert',
  get: 'supermarketSource.get',
  list: 'supermarketSource.list',
  setEnabled: 'supermarketSource.setEnabled',
} as const;

/**
 * The adapter keys the harvester knows how to run (plan 0038, section 4.2).
 *
 * `deza-web` is the second storefront and the first whose only claim is per shop
 * availability (plan 0085). It shares `CATALOG_DISCOVERY` with `mercadona-api`,
 * because a walk of a chain's whole assortment is a catalog discovery whatever
 * the source looks like, so this field is what the runner selects its client
 * from rather than the mode.
 */
export const ADAPTER_KEYS = [
  'mercadona-api',
  'deza-web',
  'osm-places',
  'manual',
] as const;
export type AdapterKey = (typeof ADAPTER_KEYS)[number];

// --- Views -----------------------------------------------------------------

/**
 * One chain's fetching configuration. `workers` and `maxRequestsPerSecond` do two
 * different jobs and are deliberately separate knobs (plan 0038, section 6.3):
 * the first bounds how many requests are in flight, the second bounds our impact
 * on the source. A single per worker delay would be a bug at any concurrency
 * above one, so the rate limit is one shared token bucket rather than a sleep.
 */
export interface SupermarketSourceView {
  id: string;
  supermarketId: string;
  adapterKey: AdapterKey;
  enabled: boolean;
  config: Record<string, unknown>;
  workers: number;
  maxRequestsPerSecond: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
}

/**
 * A run, its counters and its progress. `supermarketId` is null for a store
 * discovery run, which belongs to a postal code and a radius rather than to a
 * chain: it finds many chains at once and several of them will not exist as
 * `Supermarket` rows until it finishes.
 *
 * The counters, `stage`, `stageLabel` and `heartbeatAt` are what survives a page
 * reload; live progress is polling `harvest.run.get` (plan 0038, section 6.6),
 * not a second push path in the gateway.
 */
export interface HarvestRunView {
  id: string;
  supermarketId: string | null;
  sourceId: string | null;
  mode: HarvestRunMode;
  trigger: HarvestRunTrigger;
  status: HarvestRunStatus;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  heartbeatAt: string | null;
  /** Null until the run knows how much work it has (after the tree walk). */
  totalPlanned: number | null;
  processed: number;
  created: number;
  updated: number;
  unchanged: number;
  /** A 404 from a detail call: "not stocked here" is a value, not a failure. */
  notFound: number;
  /**
   * Offers a rule dropped or sent to the queue (plan 0081, section 7). Backlog
   * 0001 section 7.2 listed it among the counters and plan 0038 dropped it
   * because nothing skipped anything. Now something does.
   */
  skipped: number;
  failed: number;
  stage: string | null;
  stageLabel: string | null;
  /**
   * Every decision the run made that was not a write, with the offer it was
   * about (plan 0081, section 7). The run page reads as a list of them.
   */
  warnings: HarvestRunWarning[];
  /**
   * The digest of the document a FILE_IMPORT run read, null for every other
   * mode. A second upload of the same file for the same chain is refused until
   * the first run is reverted.
   */
  documentSha256: string | null;
  abortRequestedAt: string | null;
  error: string | null;
  /**
   * What the run has to say about itself beyond its counters, empty when it has
   * nothing (plan 0085, section 3).
   *
   * It exists because **completeness cannot be proven against every source**. A
   * DEZA query returns at most 300 rows however it is filtered, so a run splits
   * a capped section by search term until a pass adds nothing new or a budget
   * runs out, and the honest artifact is then the list of sections it could not
   * finish rather than a number. The same bag carries the availability rows a
   * person had typed, which plan 0084 section 3 declines to overwrite and
   * requires the run to report instead.
   *
   * Deliberately free form. It is a summary for a person reading a finished run,
   * not a structure anything decides on, and pinning a schema to it would make
   * every new kind of remark a contract change.
   */
  report: Record<string, unknown>;
  correlationId: string | null;
  requestedByUserId: string | null;
  /**
   * When this run's writes were taken back (plan 0082), null for a run that
   * still stands.
   *
   * **The status is not changed by a revert.** The status says how the run
   * ended and that did not change, so a reverted run keeps its own and carries
   * this beside it.
   */
  revertedAt: string | null;
  /** The operator who reverted it. */
  revertedByUserId: string | null;
  /**
   * How many `item_prices` rows the revert deleted, null until one happens.
   *
   * The rows the run inserted, including those an accept in the queue wrote on
   * its behalf. Rows the run only confirmed were reset rather than deleted and
   * are not counted here.
   */
  revertedPriceCount: number | null;
}

/**
 * One thing a run decided and did not write (plan 0081, section 7).
 *
 * `offerId` is the leaflet tile id where there is one, so the admin can find the
 * tile in the document he uploaded. A warning carried through from the extractor
 * itself names a page and no offer.
 */
export interface HarvestRunWarning {
  code: HarvestWarningCode;
  /** The leaflet tile this is about, or null for an extractor warning. */
  offerId: string | null;
  /** The page it was printed on, when the document said. */
  page: number | null;
  /** The printed name, so a row reads without opening the document. */
  name: string | null;
  message: string;
}

/**
 * A supermarket a store discovery run found, as OpenStreetMap describes it. The
 * whole tag bag is kept as fetched so provenance stays intact and a mapping
 * change is visible rather than lost (plan 0038, section 8.2).
 *
 * `brandKey` is `brand:wikidata`, not the brand name: `Dia` and `Maxi Dia` share
 * one QID while name matching would split them. It is a good default identity the
 * owner can override, not an oracle.
 */
export interface DiscoveredPlaceView {
  id: string;
  runId: string | null;
  provider: string;
  externalRef: string;
  brandKey: string | null;
  brandName: string | null;
  name: string | null;
  latitude: number;
  longitude: number;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  /**
   * The country the run that found it was searching, not an OSM tag (plan 0061,
   * section 4). It reaches catalog on import, where it keys the centroid lookup
   * that fills the postcode two thirds of these places lack.
   */
  country: string | null;
  website: string | null;
  openingHours: string | null;
  tags: Record<string, string>;
  status: DiscoveredPlaceStatus;
  supermarketLocationId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

/**
 * The store discovery result, grouped by chain (plan 0038, section 6.1 step 4).
 * The run creates nothing: a radius over a city returns 75 places of which half
 * are independent corner shops, so import is a second, explicit step.
 */
export interface DiscoveredPlaceGroup {
  brandKey: string | null;
  brandName: string | null;
  count: number;
  /** Whether a `Supermarket` row already carries this `externalBrandKey`. */
  known: boolean;
  supermarketId: string | null;
  /** A handful of places, for the owner to recognise the chain by. */
  sample: DiscoveredPlaceView[];
}

/**
 * One product as a source described it, and what became of it (plan 0086,
 * sections 3.1 and 10).
 *
 * **One row for every source kind.** A Mercadona product a walk found, a DEZA
 * listing and a printed leaflet name are three observations of the same kind of
 * thing, and `sourceKind` is the discriminator every code path reads. Nothing
 * parses `externalId`: it is the chain's own product id where the source has
 * one, and a hash of the normalized name and size where it does not.
 *
 * The fields fall into two groups, and the split is the contract. The first is
 * the **source's**, and every run rewrites it verbatim: `name`, `brand`, `ean`,
 * `unitSize`, `sizeFormat`, `categoryPath`, `url`, `extra`. The second is a
 * **person's**, or the EAN rung's, and a run only reads it: `itemId`,
 * `candidateEntryId`, `status`, `matchedBy`, `confidence`, `decidedAt`.
 *
 * **A decision never rewrites the name** (D8). Accepting sets `itemId` and
 * touches none of the first group, so the item can be renamed to anything at all
 * and the next walk or file that produces the same key hits this same row.
 */
export interface SourceCatalogEntryView {
  id: string;
  supermarketId: string;
  /** The chain's id, or a hash of the normalized name and size for a source with none. */
  externalId: string;
  /** What kind of observation made this row. Not derived from the key's shape. */
  sourceKind: PriceSourceKind;
  /** Verbatim, Spanish, never rewritten by a decision. */
  name: string;
  brand: string | null;
  /** The one identifier that joins across chains. Leaflets and DEZA rarely fill it. */
  ean: string | null;
  unitSize: number | null;
  /** The source's own size text, and half of the key for a source with no id. */
  sizeFormat: string | null;
  categoryPath: string[];
  url: string | null;
  /**
   * The last observation's `extra` bag: a leaflet's page and raw text, a
   * chain's loyalty block, whatever the producer knew and the import does not
   * read (plan 0086, section 6.1).
   *
   * **Stored, shown, and never interpreted.** It is what lets a person decide a
   * row the import could not. If a rule ever wants to read something out of it,
   * that is the moment it becomes a field of the file schema, in a new version.
   */
  extra: Record<string, unknown> | null;
  /** Every observation adds one. */
  timesSeen: number;
  firstSeenAt: string;
  lastSeenAt: string;
  /** The run that created it. A revert deletes undecided rows by this and `lastRunId`. */
  firstRunId: string | null;
  /** The run that last observed it. An export is keyed on this. */
  lastRunId: string | null;
  /** Set on ACTIVE, and on CANDIDATE as the proposal. Opaque, as every catalog id is. */
  itemId: string | null;
  /**
   * A sibling row of this chain the fuzzy rung proposed, when that sibling has
   * no item yet (rung 4).
   *
   * It is how a leaflet name and a walk's product id meet: the admin creates the
   * item from whichever row carries the EAN, and both resolve.
   */
  candidateEntryId: string | null;
  status: SourceEntryStatus;
  /** Null when nothing answered, i.e. on an UNRESOLVED row. */
  matchedBy: ItemSourceMatch | null;
  /** 0..1. 1 for EAN and MANUAL, 0.6 for a fuzzy proposal, 0 for UNRESOLVED. */
  confidence: number;
  /** When the status left the queue, by a person or by the EAN rung. */
  decidedAt: string | null;
  /**
   * The latest price each scope stated for this row, one per scope (D3).
   *
   * Inline rather than a second call: there is one per scope and a chain has a
   * handful of scopes, and the queue cannot decide a row without seeing what it
   * is waiting on. An accept writes every one of these that is still valid.
   */
  prices: SourceEntryPriceView[];
}

/**
 * The latest price one scope stated for one row (plan 0086, section 3.2).
 *
 * A chain has several leaflets at once because each is for a region, that is,
 * for a price scope, and two of them print the same product. The **decision**
 * about that product is one, for the chain; the **prices** are one per scope.
 * So they are a row of their own, and accepting the entry writes every one of
 * them that is still valid, each into its own scope and stamped with the run
 * that observed it.
 */
export interface SourceEntryPriceView {
  id: string;
  /** Opaque here, as every catalog id is. */
  priceScopeId: string;
  /**
   * The till price for one unit. Null when the source stated only a comparison
   * figure, a per kilogram price with no pack price.
   */
  price: number | null;
  currency: string;
  /** The source's own normalized price, stored verbatim and never recomputed. */
  unitPrice: number | null;
  /** The source's own label for that number. Display text, never a unit. */
  unitPriceLabel: string | null;
  /** A file's window. Null for a storefront price, which has none. */
  validFrom: string | null;
  validUntil: string | null;
  /** The observation's `extra` bag at the time. Shown, never read by a rule. */
  details: Record<string, unknown> | null;
  /** When the source stated it. */
  observedAt: string;
  /** The run that observed it, and the run an accept stamps its price row with. */
  runId: string | null;
}

/**
 * One shop a source names, and the catalog location it points at once somebody
 * says which (plan 0084, section 6).
 *
 * **The key is the source's own code, not the name it prints.** DEZA labels each
 * shop `T1` to `T7`, `C1`, `C2` and `Z1` in the markup and prints "Ronda del
 * Marrubial" beside it. Only the first survives a rename, and a mapping keyed on
 * the display name detaches the day marketing retitles a shop, into `UNMAPPED`,
 * which reads as "they closed it".
 */
export interface SourceLocationView {
  id: string;
  supermarketId: string;
  /** The source's own key for the shop, e.g. `T1`. */
  externalId: string;
  /** What the source displayed, exactly. */
  printedName: string;
  /** The catalog location this is, set on `ACTIVE` only. */
  supermarketLocationId: string | null;
  status: SourceLocationStatus;
  /** `NAME_SIZE` for the default exact name match, `MANUAL` when a person bound it. */
  matchedBy: ItemSourceMatch;
  firstSeenAt: string;
  lastSeenAt: string;
  /** The run that created the row, and the run that last saw the shop. */
  firstRunId: string | null;
  lastRunId: string | null;
}

// --- Run requests ----------------------------------------------------------

/**
 * Start a run. Which fields matter depends on `mode` (plan 0086, section 9):
 * STORE_DISCOVERY takes a postal code and a radius; CATALOG_DISCOVERY takes a
 * supermarket, and a `priceScopeId` when the chain's adapter yields prices;
 * FILE_IMPORT takes a supermarket, a scope, a source kind and a document.
 * Answers a conflict carrying the active run's id when one is already in
 * progress for that supermarket.
 */
export interface SpawnHarvestRunRequest extends AdminCredential {
  mode: HarvestRunMode;
  supermarketId?: string;
  /**
   * The scope the prices are written for.
   *
   * Required for a FILE_IMPORT, and for a CATALOG_DISCOVERY of a chain whose
   * adapter yields prices (`mercadona-api`). A `deza-web` discovery accepts one
   * and ignores it, because the site prints no price and a required field that
   * does nothing is a lie in a form.
   */
  priceScopeId?: string;
  postalCode?: string;
  country?: string;
  radiusMetres?: number;
  /** Restrict a store discovery run's report to these `brand:wikidata` keys. */
  brandKeys?: string[];
  /**
   * What observed the products in a FILE_IMPORT's document, which is what its
   * rows and its prices are stamped with (plan 0086, section 6.2).
   *
   * **Not what the upload is.** A re-imported Mercadona walk stamps
   * `OFFICIAL_API`, because that is what saw the price; the upload only carried
   * it. It must be one of the three official kinds: no upload may write a user
   * kind, which is the rule `catalog.addPrices` already enforces.
   */
  sourceKind?: PriceSourceKind;
  /**
   * The file, for a FILE_IMPORT run (plan 0086, section 6). Validated against
   * its own versioned schema by the gateway before it crosses the broker, and
   * by the harvester again at run start: the harvester owns the schema version,
   * and a broker message is not a trusted input.
   */
  document?: HarvestDocument;
  /**
   * The admin validity override, as YYYY-MM-DD local days in Spain. Required
   * when the document's own bound is null, and offered always; the backend
   * turns both into Europe/Madrid instants.
   */
  validFrom?: string | null;
  validUntil?: string | null;
}

/**
 * Everything one run observed, as a file (plan 0086, section 6.2).
 *
 * Offered on a finished `CATALOG_DISCOVERY` or `FILE_IMPORT`. **A later run of
 * the same chain moves rows out of the answer as it observes them again**, since
 * the set is every row whose `lastRunId` is this run, so the newest run of a
 * chain is the one to export.
 */
export interface ExportHarvestRunRequest extends AdminCredential {
  runId: string;
}

/**
 * The document a run exported, with what a caller needs to name the file.
 *
 * The ids ride beside the document rather than being read out of its `hints`,
 * because the hints are for the upload screen and nothing may depend on them
 * being there.
 */
export interface HarvestRunExportResult {
  /** The chain the run was for. */
  supermarketId: string;
  /** The scope the run's prices were observed for, null when it had none. */
  priceScopeId: string | null;
  document: HarvestDocument;
}

export interface HarvestRunIdRequest extends AdminCredential {
  runId: string;
}

export interface ListHarvestRunsRequest extends PageQuery, AdminCredential {
  supermarketId?: string;
  mode?: HarvestRunMode;
  status?: HarvestRunStatus;
  /**
   * Reverted runs only, or unreverted runs only (plan 0082, section 6). Absent
   * lists both, which is what the runs screen asks for.
   *
   * A filter of its own rather than a status, because a revert does not change
   * how the run ended: a reverted run is still the COMPLETED or FAILED run it
   * was.
   */
  reverted?: boolean;
}

// --- Discovered place requests ---------------------------------------------

export interface ListDiscoveredPlacesRequest
  extends PageQuery, AdminCredential {
  runId?: string;
  brandKey?: string;
  status?: DiscoveredPlaceStatus;
}

/**
 * Promote one discovered place into a `Supermarket` + `SupermarketLocation`.
 * The chain is created on demand rather than up front, because one run returns 17
 * brands and the owner will never shop at most of them.
 */
export interface ImportDiscoveredPlaceRequest extends AdminCredential {
  placeId: string;
  /** Attach to an existing chain instead of resolving by `brand:wikidata`. */
  supermarketId?: string;
  /** The scope the new location prices against; resolved from its postal code
   *  when omitted, falling back to the run's centre with a review flag. */
  priceScopeId?: string;
}

export interface DiscoveredPlaceIdRequest extends AdminCredential {
  placeId: string;
}

export interface GroupDiscoveredPlacesRequest extends AdminCredential {
  runId?: string;
  /** How many places to include per group as a sample. */
  sampleSize?: number;
}

export interface DiscoveredPlaceGroupsResult {
  groups: DiscoveredPlaceGroup[];
}

// --- Source entry requests (plan 0086, sections 7 and 10) -------------------

/**
 * The queue, one chain at a time.
 *
 * The chain is required because the table is unique on (`supermarketId`,
 * `externalId`) and a row only means anything within one chain. Absent `status`
 * lists the two that are waiting for a person, which is what the back office
 * asks for; the other two are reachable so a decision can be looked up and
 * undone.
 *
 * Pages on (`lastSeenAt`, `id`) descending, which is the order a queue reads in.
 * `unmatchedOnly` is gone: it was the `NOT EXISTS` over `item_source_refs`, and
 * `status` says it now.
 */
export interface ListSourceEntriesRequest extends PageQuery, AdminCredential {
  supermarketId: string;
  status?: SourceEntryStatus;
  /**
   * Which kind of observation to show, so an operator working through a
   * leaflet's rows is not interleaved with a walk's 4,000.
   */
  sourceKind?: PriceSourceKind;
  /** Free text over the name, the brand and the EAN. */
  query?: string;
}

export interface SourceEntryIdRequest extends AdminCredential {
  entryId: string;
}

/** Bind a queued row to a product the catalog already holds. */
export interface AcceptSourceEntryRequest extends AdminCredential {
  entryId: string;
  itemId: string;
}

/**
 * Create the product a queued row is for, and bind it, in one call.
 *
 * **Every field is optional**, because the row already holds a default for each:
 * `name.es` from `name`, the brand, the EAN, the size, the category the source's
 * own tree mapped to, and the default unit its size text mapped to. An operator
 * changes what he wants to change and sends only that.
 *
 * The row keeps what the source printed whatever the item ends up called (D8),
 * and `name.en` may be absent, which plan 0079 made legal: a shopper in English
 * sees the Spanish name through the fallback.
 */
export interface CreateItemFromSourceEntryRequest extends AdminCredential {
  entryId: string;
  name?: { es?: string; en?: string };
  brand?: string | null;
  ean?: string | null;
  unitSize?: number | null;
  /** Override the category the source's own tree mapped to. */
  category?: ItemCategory;
  /** Override the unit the source's own size text mapped to. */
  defaultUnit?: UnitOfMeasure;
}

/**
 * What deciding a queued row did (plan 0086, section 7).
 *
 * `pricesWritten` is the point of answering anything beyond the row. The run
 * that observed the price is over by then, and without writing here an admin who
 * works the queue after an eighteen minute walk would have to run it again to
 * get the prices he just resolved. **Zero is a normal answer**: a DEZA row holds
 * no price because the site prints none, and the back office says so rather than
 * reading it as a failure.
 */
export interface SourceEntryAcceptResult {
  entry: SourceCatalogEntryView;
  /** How many `item_prices` rows the accept wrote, across every scope on the row. */
  pricesWritten: number;
  /** The product this call created, or null when it bound an existing one. */
  createdItem: ItemView | null;
}

// --- Source location requests (plan 0084, section 7) ------------------------

/**
 * The queue, one chain at a time. The chain is required because the table is
 * unique on (`supermarketId`, `externalId`) and a mapping only means anything
 * within one chain.
 */
export interface ListSourceLocationsRequest extends PageQuery, AdminCredential {
  supermarketId: string;
  status?: SourceLocationStatus;
}

/** Bind one row to a catalog location: `ACTIVE`, `matchedBy: MANUAL`. */
export interface MapSourceLocationRequest extends AdminCredential {
  sourceLocationId: string;
  supermarketLocationId: string;
}

export interface SourceLocationIdRequest extends AdminCredential {
  sourceLocationId: string;
}

// --- Supermarket source requests -------------------------------------------

export interface UpsertSupermarketSourceRequest extends AdminCredential {
  supermarketId: string;
  adapterKey: AdapterKey;
  enabled?: boolean;
  config?: Record<string, unknown>;
  workers?: number;
  maxRequestsPerSecond?: number;
}

export interface SupermarketSourceIdRequest extends AdminCredential {
  supermarketId: string;
}

export interface SetSupermarketSourceEnabledRequest extends AdminCredential {
  supermarketId: string;
  enabled: boolean;
}

export interface ListSupermarketSourcesRequest
  extends PageQuery, AdminCredential {}

// --- Pages -----------------------------------------------------------------

export type HarvestRunPage = Paginated<HarvestRunView>;
export type DiscoveredPlacePage = Paginated<DiscoveredPlaceView>;
export type SourceCatalogEntryPage = Paginated<SourceCatalogEntryView>;
export type SourceLocationPage = Paginated<SourceLocationView>;
export type SupermarketSourcePage = Paginated<SupermarketSourceView>;

// --- The postal code discovery queue (plan 0063) ---------------------------

/**
 * The queue's own rows, for backlog `0009` to render (plan 0063, section 8).
 *
 * A read and **nothing else**. There is deliberately no enqueue subject and no
 * gateway route: nothing user facing may start a discovery run, because exposing
 * one would let anybody spend our Nominatim budget. Enqueueing happens one way
 * only, by the harvester consuming core's `postalCode.added` event.
 *
 * Defined here with its consumer unwritten on purpose: the shape is cheaper to
 * state now, beside the queue that produces it, than to retrofit later.
 */
export const POSTAL_CODE_DISCOVERY_PATTERNS = {
  list: 'postalCodeDiscovery.list',
} as const;

/** One code the queue has been asked about, and what became of it. */
export interface PostalCodeDiscoveryRequestView {
  id: string;
  /** ISO 3166-1 alpha-2, lowercase. */
  country: string;
  postalCode: string;
  status: PostalCodeDiscoveryStatus;
  /** When the code was first announced, not when it was last asked about. */
  requestedAt: string;
  lastAttemptedAt: string | null;
  /** When a run last **completed** for it. The cooldown counts from here. */
  discoveredAt: string | null;
  /** When a backed off retry becomes eligible. Null once the row is terminal. */
  nextAttemptAt: string | null;
  attempts: number;
  /** The last run this row produced, if any. Opaque outside the harvester. */
  runId: string | null;
  /** Why the last attempt failed, kept on a FAILED row for a person to read. */
  error: string | null;
}

export interface ListPostalCodeDiscoveryRequestsRequest
  extends PageQuery, AdminCredential {
  country?: string;
  status?: PostalCodeDiscoveryStatus;
}

export type PostalCodeDiscoveryRequestPage =
  Paginated<PostalCodeDiscoveryRequestView>;
