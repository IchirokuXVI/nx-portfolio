import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  DISCOVERED_PLACE_PATTERNS,
  HARVEST_PATTERNS,
  ITEM_SOURCE_REF_PATTERNS,
  SOURCE_ENTRY_PATTERNS,
  SUPERMARKET_SOURCE_PATTERNS,
  type CreateItemFromSourceEntryRequest,
  type DiscoveredPlaceGroupsResult,
  type DiscoveredPlaceIdRequest,
  type DiscoveredPlacePage,
  type DiscoveredPlaceView,
  type GroupDiscoveredPlacesRequest,
  type HarvestRunIdRequest,
  type HarvestRunPage,
  type HarvestRunView,
  type ImportDiscoveredPlaceRequest,
  type ItemSourceRefIdRequest,
  type ItemSourceRefPage,
  type ItemSourceRefView,
  type ItemView,
  type ListDiscoveredPlacesRequest,
  type ListHarvestRunsRequest,
  type ListItemSourceRefsRequest,
  type ListSourceEntriesRequest,
  type ListSupermarketSourcesRequest,
  type SetManualItemSourceRefRequest,
  type SetSupermarketSourceEnabledRequest,
  type SourceCatalogEntryPage,
  type SpawnHarvestRunRequest,
  type SupermarketSourceIdRequest,
  type SupermarketSourcePage,
  type SupermarketSourceView,
  type UpsertSupermarketSourceRequest,
} from '@portfolio/luna-shopper/contracts';
import { DiscoveredPlaceService } from './discovered-place.service';
import { HarvestRunService } from './harvest-run.service';
import { ItemSourceRefService } from './item-source-ref.service';
import { SourceEntryService } from './source-entry.service';
import { SupermarketSourceService } from './supermarket-source.service';

/**
 * The harvester's NATS surface (plan 0038, section 7), reached through the
 * gateway under `/v1/admin/harvest/`.
 *
 * **Nothing here is open to ordinary users.** Every subject carries the resolved
 * `userId` and every service checks it against the platform admin allowlist. The
 * only user facing addition that was designed, a public per item refresh, went to
 * backlog 0006 with its cooldown; catalog's existing reads are unchanged and
 * still open.
 *
 * There is no HTTP surface here (the gateway owns REST); the harvester is a pure
 * NATS microservice like auth, core and catalog, with only a small health port.
 */
@Controller()
export class HarvestController {
  constructor(
    private readonly runs: HarvestRunService,
    private readonly places: DiscoveredPlaceService,
    private readonly entries: SourceEntryService,
    private readonly refs: ItemSourceRefService,
    private readonly sources: SupermarketSourceService
  ) {}

  // --- Runs ----------------------------------------------------------------

  @MessagePattern(HARVEST_PATTERNS.spawn)
  spawn(@Payload() req: SpawnHarvestRunRequest): Promise<HarvestRunView> {
    return this.runs.spawn(req);
  }

  @MessagePattern(HARVEST_PATTERNS.abort)
  abort(@Payload() req: HarvestRunIdRequest): Promise<HarvestRunView> {
    return this.runs.abort(req);
  }

  @MessagePattern(HARVEST_PATTERNS.runGet)
  getRun(@Payload() req: HarvestRunIdRequest): Promise<HarvestRunView> {
    return this.runs.get(req);
  }

  @MessagePattern(HARVEST_PATTERNS.runList)
  listRuns(@Payload() req: ListHarvestRunsRequest): Promise<HarvestRunPage> {
    return this.runs.list(req);
  }

  // --- Discovered places ---------------------------------------------------

  @MessagePattern(DISCOVERED_PLACE_PATTERNS.list)
  listPlaces(
    @Payload() req: ListDiscoveredPlacesRequest
  ): Promise<DiscoveredPlacePage> {
    return this.places.list(req);
  }

  @MessagePattern(DISCOVERED_PLACE_PATTERNS.groups)
  groupPlaces(
    @Payload() req: GroupDiscoveredPlacesRequest
  ): Promise<DiscoveredPlaceGroupsResult> {
    return this.places.groups(req);
  }

  @MessagePattern(DISCOVERED_PLACE_PATTERNS.import)
  importPlace(
    @Payload() req: ImportDiscoveredPlaceRequest
  ): Promise<DiscoveredPlaceView> {
    return this.places.import(req);
  }

  @MessagePattern(DISCOVERED_PLACE_PATTERNS.reject)
  rejectPlace(
    @Payload() req: DiscoveredPlaceIdRequest
  ): Promise<DiscoveredPlaceView> {
    return this.places.reject(req);
  }

  // --- Source entries ------------------------------------------------------

  @MessagePattern(SOURCE_ENTRY_PATTERNS.list)
  listEntries(
    @Payload() req: ListSourceEntriesRequest
  ): Promise<SourceCatalogEntryPage> {
    return this.entries.list(req);
  }

  @MessagePattern(SOURCE_ENTRY_PATTERNS.createItem)
  createItemFromEntry(
    @Payload() req: CreateItemFromSourceEntryRequest
  ): Promise<ItemView> {
    return this.entries.createItem(req);
  }

  // --- Item source refs ----------------------------------------------------

  @MessagePattern(ITEM_SOURCE_REF_PATTERNS.list)
  listRefs(
    @Payload() req: ListItemSourceRefsRequest
  ): Promise<ItemSourceRefPage> {
    return this.refs.list(req);
  }

  @MessagePattern(ITEM_SOURCE_REF_PATTERNS.listUnresolved)
  listUnresolvedRefs(
    @Payload() req: ListItemSourceRefsRequest
  ): Promise<ItemSourceRefPage> {
    return this.refs.listUnresolved(req);
  }

  @MessagePattern(ITEM_SOURCE_REF_PATTERNS.confirm)
  confirmRef(
    @Payload() req: ItemSourceRefIdRequest
  ): Promise<ItemSourceRefView> {
    return this.refs.confirm(req);
  }

  @MessagePattern(ITEM_SOURCE_REF_PATTERNS.reject)
  rejectRef(@Payload() req: ItemSourceRefIdRequest): Promise<ItemSourceRefView> {
    return this.refs.reject(req);
  }

  @MessagePattern(ITEM_SOURCE_REF_PATTERNS.setManual)
  setManualRef(
    @Payload() req: SetManualItemSourceRefRequest
  ): Promise<ItemSourceRefView> {
    return this.refs.setManual(req);
  }

  // --- Source configuration ------------------------------------------------

  @MessagePattern(SUPERMARKET_SOURCE_PATTERNS.upsert)
  upsertSource(
    @Payload() req: UpsertSupermarketSourceRequest
  ): Promise<SupermarketSourceView> {
    return this.sources.upsert(req);
  }

  @MessagePattern(SUPERMARKET_SOURCE_PATTERNS.get)
  getSource(
    @Payload() req: SupermarketSourceIdRequest
  ): Promise<SupermarketSourceView> {
    return this.sources.get(req);
  }

  @MessagePattern(SUPERMARKET_SOURCE_PATTERNS.list)
  listSources(
    @Payload() req: ListSupermarketSourcesRequest
  ): Promise<SupermarketSourcePage> {
    return this.sources.list(req);
  }

  @MessagePattern(SUPERMARKET_SOURCE_PATTERNS.setEnabled)
  setSourceEnabled(
    @Payload() req: SetSupermarketSourceEnabledRequest
  ): Promise<SupermarketSourceView> {
    return this.sources.setEnabled(req);
  }
}
