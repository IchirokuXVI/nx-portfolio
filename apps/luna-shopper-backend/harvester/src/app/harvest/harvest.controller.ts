import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  DISCOVERED_PLACE_PATTERNS,
  HARVEST_PATTERNS,
  ITEM_SOURCE_REF_PATTERNS,
  POSTAL_CODE_DISCOVERY_PATTERNS,
  POSTAL_CODE_EVENTS,
  SOURCE_ALIAS_PATTERNS,
  SOURCE_ENTRY_PATTERNS,
  SOURCE_LOCATION_PATTERNS,
  SUPERMARKET_SOURCE_PATTERNS,
  type AcceptSourceAliasRequest,
  type CreateItemFromSourceAliasRequest,
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
  type ListPostalCodeDiscoveryRequestsRequest,
  type ListSourceAliasesRequest,
  type ListSourceEntriesRequest,
  type ListSourceLocationsRequest,
  type ListSupermarketSourcesRequest,
  type MapSourceLocationRequest,
  type PostalCodeDiscoveryRequestPage,
  type PostalCodesAddedEvent,
  type SetManualItemSourceRefRequest,
  type SetSupermarketSourceEnabledRequest,
  type SourceAliasAcceptResult,
  type SourceAliasIdRequest,
  type SourceAliasPage,
  type SourceAliasView,
  type SourceCatalogEntryPage,
  type SourceLocationIdRequest,
  type SourceLocationPage,
  type SourceLocationView,
  type SpawnHarvestRunRequest,
  type SupermarketSourceIdRequest,
  type SupermarketSourcePage,
  type SupermarketSourceView,
  type UpsertSupermarketSourceRequest,
} from '@portfolio/luna-shopper/contracts';
import { DiscoveredPlaceService } from './discovered-place.service';
import { HarvestRunService } from './harvest-run.service';
import { ItemSourceRefService } from './item-source-ref.service';
import { PostalCodeDiscoveryService } from './postal-code-discovery.service';
import { SourceAliasService } from './source-alias.service';
import { SourceEntryService } from './source-entry.service';
import { SourceLocationService } from './source-location.service';
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
    private readonly shops: SourceLocationService,
    private readonly aliases: SourceAliasService,
    private readonly sources: SupermarketSourceService,
    private readonly discovery: PostalCodeDiscoveryService
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

  // --- The postal code discovery queue (plan 0063) -------------------------

  /**
   * Core announced the postal codes one profile write added (plan 0062,
   * section 5). Consider each one, and queue the ones catalog holds no shops in.
   *
   * An `@EventPattern` and not a message: core emits it fire and forget after
   * the profile transaction commits, because a discovery run takes minutes and
   * may not hold up somebody saving their profile. Nothing is returned and
   * nothing may throw at the broker, so {@link
   * PostalCodeDiscoveryService.considerAnnounced} handles its own failures.
   *
   * The harvester binds its NATS connection to a queue group, so at two replicas
   * this fires once rather than twice, which for an event with no reply is the
   * difference between one enqueue and a duplicate.
   */
  @EventPattern(POSTAL_CODE_EVENTS.postalCodesAdded)
  postalCodesAdded(@Payload() event: PostalCodesAddedEvent): Promise<void> {
    return this.discovery.considerAnnounced(event);
  }

  /** The queue's rows, for backlog 0009. Platform admin gated like the rest. */
  @MessagePattern(POSTAL_CODE_DISCOVERY_PATTERNS.list)
  listDiscoveryRequests(
    @Payload() req: ListPostalCodeDiscoveryRequestsRequest
  ): Promise<PostalCodeDiscoveryRequestPage> {
    return this.discovery.list(req);
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

  // --- Source locations: which shop of theirs is which of ours (plan 0084) --

  @MessagePattern(SOURCE_LOCATION_PATTERNS.list)
  listSourceLocations(
    @Payload() req: ListSourceLocationsRequest
  ): Promise<SourceLocationPage> {
    return this.shops.list(req);
  }

  @MessagePattern(SOURCE_LOCATION_PATTERNS.map)
  mapSourceLocation(
    @Payload() req: MapSourceLocationRequest
  ): Promise<SourceLocationView> {
    return this.shops.map(req);
  }

  @MessagePattern(SOURCE_LOCATION_PATTERNS.unmap)
  unmapSourceLocation(
    @Payload() req: SourceLocationIdRequest
  ): Promise<SourceLocationView> {
    return this.shops.unmap(req);
  }

  @MessagePattern(SOURCE_LOCATION_PATTERNS.ignore)
  ignoreSourceLocation(
    @Payload() req: SourceLocationIdRequest
  ): Promise<SourceLocationView> {
    return this.shops.ignore(req);
  }

  @MessagePattern(SOURCE_LOCATION_PATTERNS.unignore)
  unignoreSourceLocation(
    @Payload() req: SourceLocationIdRequest
  ): Promise<SourceLocationView> {
    return this.shops.unignore(req);
  }

  // --- Source aliases (plan 0081) ------------------------------------------

  /**
   * The queue of printed names waiting for a person. Absent `status` lists the
   * two that are waiting, which is what the back office asks for.
   */
  @MessagePattern(SOURCE_ALIAS_PATTERNS.list)
  listAliases(
    @Payload() req: ListSourceAliasesRequest
  ): Promise<SourceAliasPage> {
    return this.aliases.list(req);
  }

  /**
   * Bind a printed name to a product, and write the price it was queued for.
   * The only thing besides {@link createItemFromAlias} that ever produces an
   * ACTIVE alias: a run proposes and never binds.
   */
  @MessagePattern(SOURCE_ALIAS_PATTERNS.accept)
  acceptAlias(
    @Payload() req: AcceptSourceAliasRequest
  ): Promise<SourceAliasAcceptResult> {
    return this.aliases.accept(req);
  }

  /** The same, for a product the catalog does not hold yet. */
  @MessagePattern(SOURCE_ALIAS_PATTERNS.createItem)
  createItemFromAlias(
    @Payload() req: CreateItemFromSourceAliasRequest
  ): Promise<SourceAliasAcceptResult> {
    return this.aliases.createItem(req);
  }

  /** Not a product he tracks. The next leaflet printing it does not ask again. */
  @MessagePattern(SOURCE_ALIAS_PATTERNS.reject)
  rejectAlias(@Payload() req: SourceAliasIdRequest): Promise<SourceAliasView> {
    return this.aliases.reject(req);
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
  rejectRef(
    @Payload() req: ItemSourceRefIdRequest
  ): Promise<ItemSourceRefView> {
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
