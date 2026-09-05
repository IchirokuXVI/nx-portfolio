import { inject } from '@angular/core';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
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

  listPlaces(query: PlaceQuery): Promise<Wire.HarvestDiscoveredPlacePage>;
  placeGroups(
    query: PlaceGroupQuery
  ): Promise<Wire.HarvestDiscoveredPlaceGroupsResult>;
  importPlace(
    id: string,
    input: Wire.ImportDiscoveredPlaceDto
  ): Promise<Wire.HarvestDiscoveredPlaceView>;
  rejectPlace(id: string): Promise<Wire.HarvestDiscoveredPlaceView>;

  listEntries(query: EntryQuery): Promise<Wire.HarvestSourceCatalogEntryPage>;
  createItemFromEntry(
    supermarketId: string,
    entryId: string,
    input: Wire.CreateItemFromEntryDto
  ): Promise<Wire.CatalogItemView>;

  listItemRefs(query: ItemRefQuery): Promise<Wire.HarvestItemSourceRefPage>;
  listUnresolvedItemRefs(
    query: ItemRefQuery
  ): Promise<Wire.HarvestItemSourceRefPage>;
  setManualItemRef(
    input: Wire.SetManualItemSourceRefDto
  ): Promise<Wire.HarvestItemSourceRefView>;
  confirmItemRef(id: string): Promise<Wire.HarvestItemSourceRefView>;
  rejectItemRef(id: string): Promise<Wire.HarvestItemSourceRefView>;

  /**
   * Start a `LEAFLET_IMPORT` run for a document the operator dropped in.
   *
   * A spawn like any other, from this app's side: it answers the `PENDING` run
   * and the run screen watches it to completion. What is different is the
   * refusals, and both are ordinary states rather than surprises. A document
   * the schema does not accept comes back 400 with one message per failure
   * keyed on its JSON path, and a document this chain has already imported
   * comes back 409 naming the earlier run.
   */
  importLeaflet(
    input: Wire.ImportLeafletDto
  ): Promise<Wire.HarvestHarvestRunView>;

  listAliases(query: AliasQuery): Promise<Wire.HarvestSourceAliasPage>;
  acceptAlias(
    id: string,
    input: Wire.AcceptSourceAliasDto
  ): Promise<Wire.HarvestSourceAliasAcceptResult>;
  createItemFromAlias(
    id: string,
    input: Wire.CreateItemFromAliasDto
  ): Promise<Wire.HarvestSourceAliasAcceptResult>;
  rejectAlias(id: string): Promise<Wire.HarvestSourceAliasView>;

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

export interface EntryQuery extends PageQuery {
  readonly supermarketId: string;
  readonly unmatchedOnly?: boolean;
  readonly query?: string;
}

export interface ItemRefQuery extends PageQuery {
  readonly itemId?: string;
  readonly supermarketId?: string;
  readonly status?: string;
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
 * The printed names one chain's leaflets could not resolve (backend plan 0081,
 * section 2).
 *
 * `supermarketId` is **required**, like the shops query and for the same
 * reason: an alias is keyed on (`supermarketId`, `aliasKey`) and a printed name
 * only means anything inside the chain that printed it, so the route addresses
 * the collection under the chain and there is no queue over every chain's.
 *
 * `status` absent lists `CANDIDATE` and `UNRESOLVED` together, which is the
 * queue: the rows waiting for a person. The other two are asked for by name, to
 * find a rejection somebody wants back or an alias somebody wants unbound.
 */
export interface AliasQuery extends PageQuery {
  readonly supermarketId: string;
  readonly status?: Wire.EnumsSourceAliasStatus;
  readonly query?: string;
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
