import type { HarvestDocument } from '../../schemas/harvest-document';
import type {
  ItemCategory,
  PostalCodeSource,
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
import type {
  BulkOperationError,
  ContentLocale,
  ItemView,
} from './catalog.messages';

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
  /**
   * A whole decisions file, in one call, all or nothing (plan 0100).
   *
   * The curation toolchain decides a queue offline and applies the file
   * afterwards. Replaying it through {@link SOURCE_ENTRY_PATTERNS.accept} and
   * {@link SOURCE_ENTRY_PATTERNS.createItem} is one request per row, so a file
   * that goes wrong at row 300 leaves the queue half worked and the operator
   * with no way to say which half. This subject takes the whole file, checks
   * every row before it writes anything, and refuses the file rather than
   * landing part of it.
   *
   * `reject` has no bulk twin on purpose. Junk is a person's call, and a wrong
   * reject hides a row from the queue that nobody will look at again.
   */
  applyDecisions: 'sourceEntry.applyDecisions',
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
  // A rendered page again, and behind Cloudflare (plan 0090). It writes prices,
  // which `deza-web` does not, and it is the only adapter that needs a browser.
  'carrefour-web',
  // The one source that publishes an EAN, a price and the window the price is
  // valid for in the same read (plan 0089). It is also the only one whose
  // assortment is **not a catalog**: the site publishes the week's offers, so a
  // run is a snapshot and the catalog is built by running every week. It names
  // its own shops too, which is why `STORE_DISCOVERY` dispatches on this field
  // as well.
  'lidl-api',
  'osm-places',
  'manual',
] as const;
export type AdapterKey = (typeof ADAPTER_KEYS)[number];

/**
 * What a source is able to tell us, stated once for every adapter (plan 0103,
 * section 4).
 *
 * Each field is a fact about the storefront rather than a switch somebody sets.
 * The spawn turns them into the fields a run requires, and the back office turns
 * the same facts into the fields a form offers, so the two cannot
 * disagree about what a chain needs. Three arrays in `harvest-run.service.ts`
 * and one constant in `runs-page.ts` said this before, and they already
 * disagreed: the backend required a price scope for `carrefour-web` and the form
 * never offered one, so a Carrefour walk was refused for a field nobody was
 * shown.
 */
export interface AdapterCapabilities {
  /** The source states a price, so a run of it has somewhere to write prices. */
  writesPrices: boolean;
  /** The source names the scope of each price, so it needs no default. */
  scopesItsOwn: boolean;
  /** The source publishes its own shop list, so a store discovery takes no radius. */
  listsItsOwnStores: boolean;
  /** The source has a product page, so an EAN backfill has something to read. */
  hasProductPages: boolean;
  /**
   * The language this source's own text is written in, or null when nothing is
   * known (plan 0111, section 7).
   *
   * A printed name belongs to the language the chain prints in, so accepting a
   * queued row files it under that key rather than under a constant. A null
   * means the string belongs to no language this build can name, and the accept
   * then requires the operator to say which rather than guessing.
   */
  printedLocale: ContentLocale | null;
}

/**
 * The facts, per adapter.
 *
 * **A reader that does not know an adapter must answer no to everything.** A
 * back office one release behind a backend that added an adapter then draws a
 * plain form rather than a broken one, and the spawn is still the thing that
 * refuses a bad request.
 */
export const ADAPTER_CAPABILITIES: Record<AdapterKey, AdapterCapabilities> = {
  // The store finder publishes all 1,675 shops in one static document, with a
  // postal code and coordinates on every one of them (plan 0106). Plan 0038
  // said this chain named none and had to be found through OpenStreetMap; that
  // was a finding about OpenStreetMap's data and was never true of Mercadona's.
  'mercadona-api': {
    writesPrices: true,
    scopesItsOwn: false,
    listsItsOwnStores: true,
    hasProductPages: false,
    printedLocale: 'es',
  },
  // The site prints no price at all, so a scope would be a required field that
  // does nothing (plan 0085).
  'deza-web': {
    writesPrices: false,
    scopesItsOwn: false,
    listsItsOwnStores: false,
    hasProductPages: false,
    printedLocale: 'es',
  },
  'carrefour-web': {
    writesPrices: true,
    scopesItsOwn: false,
    listsItsOwnStores: false,
    hasProductPages: true,
    printedLocale: 'es',
  },
  // The one source that states the region of every price it publishes and names
  // its own 730 shops (plan 0089).
  'lidl-api': {
    writesPrices: true,
    scopesItsOwn: true,
    listsItsOwnStores: true,
    hasProductPages: true,
    printedLocale: 'es',
  },
  // OpenStreetMap carries a place's name and never a language for it, and a
  // shop name is a proper noun in any case, so there is nothing to claim here.
  'osm-places': {
    writesPrices: false,
    scopesItsOwn: false,
    listsItsOwnStores: false,
    hasProductPages: false,
    printedLocale: null,
  },
  // Nothing is printed: whatever a manual row holds, an operator typed, and the
  // operator says which language they typed it in.
  manual: {
    writesPrices: false,
    scopesItsOwn: false,
    listsItsOwnStores: false,
    hasProductPages: false,
    printedLocale: null,
  },
};

/**
 * The capabilities of an adapter this build knows, and "I know nothing"
 * otherwise: every boolean false, and no printed language.
 *
 * The lookup is a function rather than an index so the "answers no to
 * everything" rule is written once. A caller reading the record directly gets
 * `undefined` for an adapter added after it shipped, and every call site would
 * have to remember to handle it.
 *
 * A null `printedLocale` is that rule for the language too, and it is the safe
 * direction for the same reason: an unknown adapter's printed string gets filed
 * under no language rather than guessed into one, so the accept asks the
 * operator instead of writing a name in a language nobody checked.
 */
export function adapterCapabilities(
  adapterKey: string | null | undefined
): AdapterCapabilities {
  return (
    ADAPTER_CAPABILITIES[adapterKey as AdapterKey] ?? {
      writesPrices: false,
      scopesItsOwn: false,
      listsItsOwnStores: false,
      hasProductPages: false,
      printedLocale: null,
    }
  );
}

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
  /**
   * The shops this chain names may enter the catalog without a person looking
   * first (plan 0107, section 3.1).
   *
   * Off by default, and a separate decision from {@link enabled} for the reason
   * `HARVEST_ENABLED` is separate from the Helm switch: reading a chain's shops
   * and letting them into the catalog unreviewed are two things an operator
   * decides at two different times.
   *
   * **A place still has to pass the completeness check**, and one that fails it
   * becomes an ordinary `NEW` row in the review queue. The flag is a fast lane
   * and not a replacement for the queue.
   */
  autoImportPlaces: boolean;
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
   * Where {@link postalCode} came from (plan 0097, section 3), mirroring the
   * column `SupermarketLocation` already carries.
   *
   * `SOURCE` is the `addr:postcode` tag, which about a third of places have.
   * `DERIVED` is the nearest centroid within the bound, asked of catalog during
   * the run. Null alongside a null code, so "we have no idea" stays expressible:
   * a place whose nearest centroid is beyond the bound takes neither.
   *
   * A guessed code has to say it was guessed wherever it is shown, because the
   * counts of section 2 are counted on it.
   */
  postalCodeSource: PostalCodeSource | null;
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
   * Restrict a store discovery run to the shops in these postal codes, for a
   * chain that publishes its own shop list (plan 0106, section 4).
   *
   * The match is on the shop's **own** postal code, exactly. A radius here
   * would rebuild the ambiguity plan 0038 section 2.8 found in OpenStreetMap,
   * where the twelve Mercadonas inside 14013's bounding box sit in four other
   * codes; the chain states each shop's code itself, so an exact match is a
   * well posed question.
   *
   * **An empty array and an absent field are the same thing**, which is every
   * shop. What the filter saves is not the one request for the document, which
   * is read whole either way: it is the second request kind, because a run
   * filtered to four codes resolves four warehouses instead of 1,213.
   */
  postalCodes?: string[];
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
  /**
   * Read product pages for the EAN instead of crawling the assortment (plan
   * 0090, section 12.1). `carrefour-web` only.
   *
   * **It is a switch and not a mode**, because it is the same run against the
   * same chain asking a second question of the same pages. A price crawl reads
   * 851 listing pages in about an hour and is complete on its own terms; a
   * backfill reads one product page per product that has no EAN yet, which is
   * of the order of 18,000 loads the first time and almost none after it.
   *
   * **The two never happen in one run.** A price crawl that waited for the
   * backfill is a price crawl that never finishes, so a backfill is started
   * on its own, can be aborted at any point, and loses nothing when it is: an
   * EAN is written as it is read, and a product that already has one is never
   * fetched again.
   */
  detailBackfill?: boolean;
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
  /**
   * ISO 3166-1 alpha-2, lowercase. Paired with {@link postalCode}, which is only
   * unique within a country.
   */
  country?: string;
  /**
   * The places **located in** this code, whichever run found them (plan 0097,
   * section 9). It reads the place's own postal code and never the run's, so it
   * answers the question a postal code detail screen asks: what would somebody
   * living here be shown.
   */
  postalCode?: string;
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
 * The queue, of one chain or of every chain.
 *
 * **The chain narrows the read, it does not address it.** The table is unique on
 * (`supermarketId`, `externalId`), so a row's key means nothing outside its
 * chain, but the row itself names its chain and the queue is one queue: an
 * operator working it through has no reason to be asked which chain's rows are
 * waiting before he can see that any are. Absent `supermarketId` lists every
 * chain's, newest first, which is the order the queue reads in anyway.
 *
 * Absent `status` lists the two that are waiting for a person, which is what the
 * back office asks for; the other two are reachable so a decision can be looked
 * up and undone.
 *
 * Pages on (`lastSeenAt`, `id`) descending, which is the order a queue reads in.
 * `unmatchedOnly` is gone: it was the `NOT EXISTS` over `item_source_refs`, and
 * `status` says it now.
 */
export interface ListSourceEntriesRequest extends PageQuery, AdminCredential {
  /** One chain's rows. Absent lists every chain's. */
  supermarketId?: string;
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

// --- Bulk entry decisions (plan 0100) ---------------------------------------

/**
 * The row as the decisions file saw it, and the check that it still says so.
 *
 * Two fields, because two are enough: a row whose status has moved was decided
 * by somebody else, and a row whose `lastSeenAt` has moved was observed again
 * by a later run and may now say something different from what was decided
 * about. Either one makes the recorded judgment a judgment about a different
 * row.
 */
export interface SourceEntryExpectation {
  status: SourceEntryStatus;
  /** ISO 8601, exactly as `SourceCatalogEntryView.lastSeenAt` printed it. */
  lastSeenAt: string;
}

/** Bind a queued row to a product, named directly or by a `ref` of this request. */
export interface AcceptSourceEntryOperation {
  op: 'accept';
  entryId: string;
  /** A product catalog already holds. Exactly one of this and `itemRef`. */
  itemId?: string;
  /** A product a `createItem` operation of this same request creates. */
  itemRef?: string;
  expect: SourceEntryExpectation;
}

/**
 * Create the product a queued row is for, and bind the row to it.
 *
 * `ref` names the product inside this request so a second row of the same
 * product can be bound to it by `itemRef` before the database has issued an id.
 *
 * **No English name is fetched here**, which is the one way this differs from
 * the per row route. That route pays one extra request to the chain for the one
 * product an operator is looking at; a thousand of them would be a thousand
 * requests inside one call, and the file already carries the name it decided on.
 * Every field the item omits falls back to what the row itself holds.
 */
export interface CreateItemFromSourceEntryOperation {
  op: 'createItem';
  entryId: string;
  ref: string;
  item: {
    name?: { es?: string; en?: string };
    brand?: string | null;
    ean?: string | null;
    unitSize?: number | null;
    category?: ItemCategory;
    defaultUnit?: UnitOfMeasure;
  };
  expect: SourceEntryExpectation;
}

export type SourceEntryDecisionOperation =
  | AcceptSourceEntryOperation
  | CreateItemFromSourceEntryOperation;

/**
 * A whole decisions file, applied in one call (plan 0100).
 *
 * Capped at `BULK_DECISION_MAX_OPERATIONS`, and a longer file is refused rather
 * than split: two chunks are two transactions, so the first can land and the
 * second fail, which is the half worked queue this route exists to prevent.
 */
export interface ApplySourceEntryDecisionsRequest extends AdminCredential {
  /**
   * The curation session this file came out of, echoed back in the answer.
   *
   * Provenance and nothing else: the harvester stores no run of its own for a
   * decisions file, so this is what lets an operator reading a report tie the
   * writes back to the session that decided them.
   */
  runId?: string;
  operations: SourceEntryDecisionOperation[];
}

/** Which step of the four refused the file, when one did. */
export type SourceEntryDecisionStep = 'VALIDATE' | 'CREATE_ITEMS' | 'BIND';

export interface SourceEntryDecisionOutcome {
  op: SourceEntryDecisionOperation['op'];
  entryId: string;
  /** The `ref` a `createItem` named, or null for an `accept`. */
  ref: string | null;
  applied: boolean;
  /** The product the row is bound to now, when the operation applied. */
  itemId: string | null;
  /** How many `item_prices` rows this row's prices wrote. Zero is normal. */
  pricesWritten: number;
  /** Why nothing was written for this operation. */
  error: BulkOperationError | null;
}

/**
 * Step four could not write one row's prices, and why.
 *
 * **The bind still stands**, which is why this is a list of its own rather than
 * a failure. Prices are the one part of this route that is not all or nothing:
 * they cross into catalog one scope at a time, and a cross service rollback to
 * undo a price is not worth the saga it would take. A skipped row is named here
 * so the operator can write its prices again without replaying a decision that
 * already landed.
 */
export interface SourceEntryPriceSkip {
  entryId: string;
  /** The product the row was bound to, which the prices were meant for. */
  itemId: string;
  reason: string;
}

/**
 * What the file did (plan 0100).
 *
 * `applied` is the whole answer for the binds: either every operation bound or
 * none did. `results` says which check refused which row when it did not, and
 * `priceSkips` carries the rows step four could not price when it did.
 */
export interface ApplySourceEntryDecisionsResult {
  /** The `runId` the request named, echoed so a report can be filed under it. */
  runId: string | null;
  applied: boolean;
  /** The step that refused the file, or null when the file landed. */
  failedStep: SourceEntryDecisionStep | null;
  /** Why the file was refused as a whole, when no single operation was at fault. */
  error: string | null;
  /** One per operation, in the order the file named them. */
  results: SourceEntryDecisionOutcome[];
  priceSkips: SourceEntryPriceSkip[];
  /**
   * Products step two created that a step three failure could not delete.
   *
   * Unbound and nobody's, and named here rather than swallowed: a best effort
   * cleanup that quietly fails leaves the catalog holding products no row
   * points at and no record that it happened.
   */
  orphanedItemIds: string[];
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
  /** Trust this chain's own shop list, per plan 0107, section 3.1. */
  autoImportPlaces?: boolean;
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
  /** Counts by status, the oldest waiting row, and whether anything drains. */
  summary: 'postalCodeDiscovery.summary',
  /** An operator adds a code, queued now or parked (plan 0097, section 6.1). */
  add: 'postalCodeDiscovery.add',
  /** Discover it again, ignoring the cooldown (section 6.2). */
  requeue: 'postalCodeDiscovery.requeue',
  /** Hide a code nobody can geocode from the working set (section 6.3). */
  dismiss: 'postalCodeDiscovery.dismiss',
} as const;

/**
 * How many places one postal code has to show for itself, split by what became
 * of each (plan 0097, section 2).
 *
 * `total` is every row counted, and the three below it are the three
 * `DiscoveredPlaceStatus` values, so they add up to it. One grouped query
 * answers all four.
 */
export interface DiscoveredPlaceCounts {
  total: number;
  /** `IMPORTED`: an operator promoted it into a catalog location. */
  imported: number;
  /** `REJECTED`: an operator decided it is not a shop we want. */
  rejected: number;
  /** `NEW`: still waiting for somebody to decide. */
  undecided: number;
}

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
  /**
   * What Nominatim calls this code, kept at the `GEOCODE` stage of the first run
   * (plan 0097, section 4).
   *
   * Null until a run has geocoded it. Nothing else in the system stores a name
   * for a postal code, and an operator reading a list of bare numbers cannot
   * tell Córdoba from Cáceres.
   */
  placeName: string | null;
  /** Hidden from the working set by an operator (section 6.3). A requeue clears it. */
  dismissed: boolean;
  /** Places this code's own runs wrote, wherever they turned out to be. */
  foundByItsRuns: DiscoveredPlaceCounts;
  /** Places whose own postal code is this one, whichever run found them. */
  locatedInIt: DiscoveredPlaceCounts;
}

export interface ListPostalCodeDiscoveryRequestsRequest
  extends PageQuery, AdminCredential {
  country?: string;
  status?: PostalCodeDiscoveryStatus;
  /** Prefix match, which is how a person narrows a numeric code. */
  postalCode?: string;
  /**
   * Absent means **not dismissed**, which is the working set (plan 0097,
   * section 7). True lists the dismissed rows alone.
   */
  dismissed?: boolean;
}

export type PostalCodeDiscoveryRequestPage =
  Paginated<PostalCodeDiscoveryRequestView>;

/**
 * An operator adds a code by hand (plan 0097, section 6.1).
 *
 * One code per call. Adding twenty is twenty calls, under the partial failure
 * rules `apps/luna-shopper-admin/plans/0020` already wrote for bulk work: a bulk
 * endpoint is a transaction boundary and a timeout budget this service does not
 * have and this screen does not need.
 */
export interface AddPostalCodeDiscoveryRequest extends AdminCredential {
  /** ISO 3166-1 alpha-2, lowercase. */
  country: string;
  postalCode: string;
  /**
   * True inserts a `QUEUED` row, which is what an announcement already writes.
   * False inserts a `PARKED` one, which the worker never claims.
   */
  discoverNow: boolean;
}

/** One queue row, by its id. */
export interface PostalCodeDiscoveryIdRequest extends AdminCredential {
  requestId: string;
}

/**
 * The queue at a glance, for the listing's header and for the dashboard card of
 * `apps/luna-shopper-admin/plans/0021` (plan 0097, section 7.1).
 *
 * `draining` is why this exists rather than being three counts on a screen. A
 * queue that fills and never empties is the designed behaviour of a cluster with
 * `HARVEST_ENABLED` false, and an operator pressing "discover again" there
 * deserves to be told so instead of watching a row sit at `QUEUED` for a week.
 */
export interface PostalCodeDiscoverySummaryView {
  queued: number;
  running: number;
  done: number;
  failed: number;
  parked: number;
  /** The oldest QUEUED row's `requestedAt`, or null when nothing waits. */
  oldestQueuedAt: string | null;
  /** `HARVEST_ENABLED` in this deployment. False means nothing drains. */
  draining: boolean;
}
