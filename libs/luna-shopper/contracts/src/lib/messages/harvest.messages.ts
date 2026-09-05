import type {
  DiscoveredPlaceStatus,
  HarvestRunMode,
  HarvestRunStatus,
  HarvestRunTrigger,
  ItemSourceMatch,
  ItemSourceRefStatus,
  PostalCodeDiscoveryStatus,
  SourceLocationStatus,
} from '../enums/harvest.enums';
import type { PageQuery, Paginated } from '../pagination';
import type { AdminCredential } from './admin-auth.messages';

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
  runGet: 'harvest.run.get',
  runList: 'harvest.run.list',
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

export const ITEM_SOURCE_REF_PATTERNS = {
  list: 'itemSourceRef.list',
  listUnresolved: 'itemSourceRef.listUnresolved',
  confirm: 'itemSourceRef.confirm',
  reject: 'itemSourceRef.reject',
  setManual: 'itemSourceRef.setManual',
} as const;

export const SOURCE_ENTRY_PATTERNS = {
  list: 'sourceEntry.list',
  createItem: 'sourceEntry.createItem',
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
 * skipped until the next run, which is the opposite of `sourceAlias.accept`: a
 * leaflet offer sits in the run's stored document, and a shop's availability is
 * one boolean per product across a whole assortment that no run stored.
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
  failed: number;
  stage: string | null;
  stageLabel: string | null;
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

/** One product as the source last described it (plan 0038, section 4.2). */
export interface SourceCatalogEntryView {
  id: string;
  supermarketId: string;
  externalId: string;
  name: string;
  brand: string | null;
  ean: string | null;
  unitSize: number | null;
  sizeFormat: string | null;
  price: number | null;
  /** The source's own normalized price, stored verbatim and never recomputed. */
  unitPrice: number | null;
  /** The source's own label for that number. Display text, never a unit. */
  unitPriceLabel: string | null;
  categoryPath: string[];
  url: string | null;
  lastSeenAt: string;
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

/** The link between one catalog item and one chain's product. */
export interface ItemSourceRefView {
  id: string;
  itemId: string;
  supermarketId: string;
  externalId: string;
  externalUrl: string | null;
  matchedBy: ItemSourceMatch;
  status: ItemSourceRefStatus;
  /** 0..1. Only a NAME_BRAND_SIZE match carries anything below 1. */
  confidence: number;
  lastResolvedAt: string | null;
  lastSeenAt: string | null;
}

// --- Run requests ----------------------------------------------------------

/**
 * Start a run. Which fields matter depends on `mode`: STORE_DISCOVERY takes a
 * postal code and a radius, CATALOG_DISCOVERY and REFRESH take a supermarket and
 * the scope to write prices for. Answers a conflict carrying the active run's id
 * when one is already in progress for that supermarket.
 */
export interface SpawnHarvestRunRequest extends AdminCredential {
  mode: HarvestRunMode;
  supermarketId?: string;
  priceScopeId?: string;
  postalCode?: string;
  country?: string;
  radiusMetres?: number;
  /** Restrict a store discovery run's report to these `brand:wikidata` keys. */
  brandKeys?: string[];
}

export interface HarvestRunIdRequest extends AdminCredential {
  runId: string;
}

export interface ListHarvestRunsRequest extends PageQuery, AdminCredential {
  supermarketId?: string;
  mode?: HarvestRunMode;
  status?: HarvestRunStatus;
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

// --- Source entry requests -------------------------------------------------

export interface ListSourceEntriesRequest extends PageQuery, AdminCredential {
  supermarketId: string;
  /** Only entries with no `item_source_refs` row, i.e. candidate new items. */
  unmatchedOnly?: boolean;
  query?: string;
}

/**
 * Promote a discovery entry to a catalog `Item`. This is the path that populates
 * the catalog, and it is deliberately a review queue rather than a bulk insert of
 * 4,232 products nobody chose. The English name costs one extra request, made
 * here rather than during discovery (plan 0038, section 6.2).
 */
export interface CreateItemFromSourceEntryRequest extends AdminCredential {
  entryId: string;
  /** Override the category the source's own tree mapped to. */
  category?: string;
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

// --- Item source ref requests ----------------------------------------------

export interface ListItemSourceRefsRequest extends PageQuery, AdminCredential {
  supermarketId?: string;
  itemId?: string;
  status?: ItemSourceRefStatus;
}

export interface ItemSourceRefIdRequest extends AdminCredential {
  refId: string;
}

/** Link an item to an external id by hand, bypassing the matching ladder. */
export interface SetManualItemSourceRefRequest extends AdminCredential {
  itemId: string;
  supermarketId: string;
  externalId: string;
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
export type ItemSourceRefPage = Paginated<ItemSourceRefView>;
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
