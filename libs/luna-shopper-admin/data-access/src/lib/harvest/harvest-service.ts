import { inject } from '@angular/core';
import type {
  OfficialSourceKind,
  SourceEntryStatus,
  Wire,
} from '@portfolio/luna-shopper-admin/models';
import { serviceToken } from '@portfolio/shared/data-access';
import { HarvestMemory } from './harvest-memory';

/**
 * Everything the harvester screens call, in one interface (plan 0006, section 1).
 *
 * Flat and explicit rather than generic, and that is the plan's own point: a run
 * is a process you start, watch and abort, and a queue is a decision you make
 * repeatedly, so neither fits `0004`'s five function {@link ResourceGateway}. A
 * descriptor forced over these would have to describe `abort` and `confirm` as
 * an `update`, which is the sort of shape that reads fine until somebody wires a
 * delete button to it.
 *
 * The wire types are the parameters and the answers, unmapped, which is `0004`
 * section 2's recorded exception to rule D4 for this app.
 *
 * There is no push channel here and there must not be one. Progress is polling
 * `readRun` (section 2), the realtime `admin:harvest` room stays deferred, and
 * the absence of a socket client is what keeps `LUNA_REALTIME_URL` and a second
 * CORS origin out of this app entirely.
 */
export interface HarvestServiceI {
  spawnRun(input: Wire.SpawnHarvestRunDto): Promise<Wire.HarvestHarvestRunView>;
  listRuns(query: RunQuery): Promise<Wire.HarvestHarvestRunPage>;
  readRun(id: string): Promise<Wire.HarvestHarvestRunView>;
  abortRun(id: string): Promise<Wire.HarvestHarvestRunView>;
  /**
   * Take back everything a finished run wrote (backend plan 0082).
   *
   * Beside `abortRun` and not folded into it, because they are opposite acts on
   * a run at opposite ends of its life. An abort stops one that is going and
   * keeps what it already fetched; this deletes what a finished one wrote.
   */
  revertRun(id: string): Promise<Wire.HarvestHarvestRunView>;

  listPlaces(query: PlaceQuery): Promise<Wire.HarvestDiscoveredPlacePage>;
  placeGroups(
    query: PlaceGroupQuery
  ): Promise<Wire.HarvestDiscoveredPlaceGroupsResult>;
  importPlace(
    id: string,
    input: Wire.ImportDiscoveredPlaceDto
  ): Promise<Wire.HarvestDiscoveredPlaceView>;
  rejectPlace(id: string): Promise<Wire.HarvestDiscoveredPlaceView>;

  /**
   * The one queue (admin plan 0014, section 1; backend plan 0086, section 10).
   *
   * There were three of these: entries a walk found and nothing matched, refs a
   * walk proposed, and aliases a leaflet queued. `0086` folded the three tables
   * into `source_catalog_entries` with one status column, so they are one call
   * over one route, and `listItemRefs`, `listUnresolvedItemRefs`,
   * `setManualItemRef`, `confirmItemRef`, `rejectItemRef`, `listAliases`,
   * `acceptAlias`, `createItemFromAlias` and `rejectAlias` are gone with them.
   */
  listEntries(query: EntryQuery): Promise<Wire.HarvestSourceCatalogEntryPage>;

  /**
   * Bind a row to a product the catalog already holds.
   *
   * Accepting is not only a binding: every price on the row that has not expired
   * is written through catalog with its own scope and its own run, so an
   * operator who accepts a Mercadona product on Tuesday gets the price Monday's
   * walk saw, and reverting Monday's run takes it back with the rest (backend
   * plan 0086, section 7). {@link SourceEntryAcceptResult.pricesWritten} is what
   * the confirmation names.
   */
  acceptEntry(
    id: string,
    input: AcceptSourceEntryInput
  ): Promise<SourceEntryAcceptResult>;

  /**
   * The same, for a product the catalog does not hold yet.
   *
   * **One call**: it creates the item and binds the row in the harvester. Two
   * calls would leave a window where an item exists that nothing points at, and
   * the operator would have no way to tell that from a row they had not decided.
   *
   * Every field of the input is optional, because the row already holds a
   * default for each, so this sends only what the operator changed.
   */
  createItemFromEntry(
    id: string,
    input: CreateItemFromSourceEntryInput
  ): Promise<SourceEntryAcceptResult>;

  /**
   * Not a product he tracks.
   *
   * The row stays as `REJECTED` rather than being deleted, so the next run that
   * observes the key touches the row and asks nobody. The status is the owner's,
   * and a run does not get to overwrite a decision.
   */
  rejectEntry(id: string): Promise<Wire.HarvestSourceCatalogEntryView>;

  /**
   * Start a `FILE_IMPORT` run for a document the operator dropped in.
   *
   * A spawn like any other, from this app's side: it answers the `PENDING` run
   * and the run screen watches it to completion. What is different is the
   * refusals, and both are ordinary states rather than surprises. A document
   * the schema does not accept comes back 400 with one message per failure
   * keyed on its JSON path, and a document this chain has already imported
   * comes back 409 naming the earlier run.
   *
   * `importLeaflet` before backend plan `0086`, and the rename is the point of
   * that plan's section 6: the upload is not a leaflet tool, it is how the
   * result of a harvester run that happened somewhere else gets in.
   */
  importDocument(
    input: ImportHarvestDocumentInput
  ): Promise<Wire.HarvestHarvestRunView>;

  /**
   * The other direction: a finished run's rows, as a document (backend plan
   * 0086, section 6.2).
   *
   * A read, so it is not gated by `HARVEST_ENABLED`. That is the whole point of
   * it: a machine that is allowed to crawl exports, and a cluster that is not
   * imports. It answers the document itself rather than a file, because the
   * request carries a bearer token and so cannot be a plain link, and because
   * the file's name is the chain, the scope and the day, which this app resolves
   * and the run does not carry.
   */
  exportRun(id: string): Promise<Readonly<Record<string, unknown>>>;

  listShops(query: ShopQuery): Promise<Wire.HarvestSourceLocationPage>;
  mapShop(
    id: string,
    input: Wire.MapSourceLocationDto
  ): Promise<Wire.HarvestSourceLocationView>;
  unmapShop(id: string): Promise<Wire.HarvestSourceLocationView>;
  ignoreShop(id: string): Promise<Wire.HarvestSourceLocationView>;
  unignoreShop(id: string): Promise<Wire.HarvestSourceLocationView>;

  listSources(query: PageQuery): Promise<Wire.HarvestSupermarketSourcePage>;
  readSource(supermarketId: string): Promise<Wire.HarvestSupermarketSourceView>;
  upsertSource(
    supermarketId: string,
    input: Wire.UpsertSupermarketSourceDto
  ): Promise<Wire.HarvestSupermarketSourceView>;
  setSourceEnabled(
    supermarketId: string,
    enabled: boolean
  ): Promise<Wire.HarvestSupermarketSourceView>;
}

/** A cursor and a size, which every collection route here accepts. */
export interface PageQuery {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface RunQuery extends PageQuery {
  readonly supermarketId?: string;
  readonly mode?: string;
  readonly status?: string;
  /**
   * Reverted runs only, or unreverted runs only. Absent asks for both.
   *
   * Not a status. A revert does not change how the run ended, so a reverted run
   * is still the COMPLETED or FAILED run it was and the list draws both facts.
   */
  readonly reverted?: boolean;
}

export interface PlaceQuery extends PageQuery {
  readonly runId?: string;
  readonly brandKey?: string;
  readonly status?: string;
}

export interface PlaceGroupQuery {
  readonly runId?: string;
  readonly sampleSize?: number;
}

/**
 * One chain's source catalog entries (backend plan 0086, section 10).
 *
 * `supermarketId` is **required**, as the shops query's is and for the same
 * reason: a row is keyed on (`supermarketId`, `externalId`) and a chain's own
 * name for a product means nothing outside that chain, so there is no queue over
 * every chain's rows and no screen that could use one.
 *
 * `status` absent lists `CANDIDATE` and `UNRESOLVED` together, which is the
 * queue: the rows waiting for a person. That default is the route's rather than
 * a screen's, so no caller sends it to get it.
 *
 * `unmatchedOnly` is gone. It was the `NOT EXISTS` that stood in for a status
 * column, and the status says it now.
 */
export interface EntryQuery extends PageQuery {
  readonly supermarketId: string;
  readonly status?: SourceEntryStatus;
  /**
   * One kind at a time, so an operator working through a leaflet's rows is not
   * interleaved with a walk's four thousand.
   */
  readonly sourceKind?: OfficialSourceKind;
  readonly query?: string;
}

/**
 * The three shapes backend plan `0086` adds to the gateway, mirrored here.
 *
 * Written by hand rather than read out of `Wire`, and only until that plan's
 * `openapi.json` and `wire-types.ts` are regenerated. Plan 0004 section 2's
 * exception says the generated shapes are this app's parameters and answers, so
 * these are swapped for `Wire.AcceptSourceEntryDto`,
 * `Wire.CreateItemFromSourceEntryDto`, `Wire.HarvestSourceEntryAcceptResult` and
 * `Wire.ImportHarvestDocumentDto` the moment the generator has written them.
 * They are structural, so the swap is this block and nothing else.
 */
export interface AcceptSourceEntryInput {
  readonly itemId: string;
}

/**
 * What an operator changed about the product a row is about to become.
 *
 * **Every field optional**, which is the design rather than laxity: the row
 * already holds a default for each, the backend fills in what is absent, and the
 * screen sends only what was changed. An empty object is a legitimate create.
 */
export interface CreateItemFromSourceEntryInput {
  readonly name?: { readonly es?: string; readonly en?: string };
  readonly brand?: string | null;
  readonly ean?: string | null;
  readonly unitSize?: number | null;
  readonly category?: Wire.EnumsItemCategory;
  readonly defaultUnit?: Wire.EnumsUnitOfMeasure;
}

export interface SourceEntryAcceptResult {
  readonly entry: Wire.HarvestSourceCatalogEntryView;
  /** How many `item_prices` rows the accept wrote. The confirmation names it. */
  readonly pricesWritten: number;
  /** The item this created, or null when it bound one the catalog already held. */
  readonly createdItem: Wire.CatalogItemView | null;
}

/** What `POST /v1/admin/harvest/imports` takes (backend plan 0086, section 6.2). */
export interface ImportHarvestDocumentInput {
  readonly supermarketId: string;
  readonly priceScopeId: string;
  /**
   * What the rows and the prices are stamped with.
   *
   * The operator picks it consciously: a Mercadona export imported here is an
   * API price, not a leaflet price, because the upload is not what observed it.
   */
  readonly sourceKind: OfficialSourceKind;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly document: Readonly<Record<string, unknown>>;
}

/**
 * The shops one source names (backend plan 0084, section 7).
 *
 * `supermarketId` is **required** and every other collection query's is not.
 * `source_locations` is unique on (`supermarketId`, `externalId`) and the
 * mapping only means anything inside one chain, so there is no route that
 * answers "every source's shops" and no screen that could use one.
 */
export interface ShopQuery extends PageQuery {
  readonly supermarketId: string;
  readonly status?: Wire.EnumsSourceLocationStatus;
}

/**
 * Inject THIS token, never a concrete class.
 *
 * The default is the in-memory implementation, so every spec and a run with
 * nothing listening both work with no configuration. `app-providers.ts` binds
 * the HTTP one beside the `HttpClient` it depends on, exactly as the resource
 * gateways are bound.
 */
export const HARVEST_SERVICE = serviceToken<HarvestServiceI>(
  'HARVEST_SERVICE',
  () => inject(HarvestMemory)
);
