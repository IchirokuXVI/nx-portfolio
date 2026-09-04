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
