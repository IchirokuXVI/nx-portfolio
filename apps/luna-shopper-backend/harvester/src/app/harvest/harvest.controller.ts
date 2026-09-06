import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  DISCOVERED_PLACE_PATTERNS,
  HARVEST_PATTERNS,
  POSTAL_CODE_DISCOVERY_PATTERNS,
  POSTAL_CODE_EVENTS,
  SOURCE_ENTRY_PATTERNS,
  SOURCE_LOCATION_PATTERNS,
  SUPERMARKET_SOURCE_PATTERNS,
  type AcceptSourceEntryRequest,
  type CreateItemFromSourceEntryRequest,
  type DiscoveredPlaceGroupsResult,
  type DiscoveredPlaceIdRequest,
  type DiscoveredPlacePage,
  type DiscoveredPlaceView,
  type ExportHarvestRunRequest,
  type GroupDiscoveredPlacesRequest,
  type HarvestRunExportResult,
  type HarvestRunIdRequest,
  type HarvestRunPage,
  type HarvestRunView,
  type ImportDiscoveredPlaceRequest,
  type ListDiscoveredPlacesRequest,
  type ListHarvestRunsRequest,
  type ListPostalCodeDiscoveryRequestsRequest,
  type ListSourceEntriesRequest,
  type ListSourceLocationsRequest,
  type ListSupermarketSourcesRequest,
  type MapSourceLocationRequest,
  type PostalCodeDiscoveryRequestPage,
  type PostalCodesAddedEvent,
  type SetSupermarketSourceEnabledRequest,
  type SourceCatalogEntryPage,
  type SourceCatalogEntryView,
  type SourceEntryAcceptResult,
  type SourceEntryIdRequest,
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
import { PostalCodeDiscoveryService } from './postal-code-discovery.service';
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
    private readonly shops: SourceLocationService,
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

  /**
   * Take back everything a run wrote (plan 0082), and let a corrected upload of
   * the same document through.
   *
   * Not an abort with a different name. An abort keeps what was already
   * fetched; this deletes it, which is why it is offered only on a run that has
   * finished.
   */
  @MessagePattern(HARVEST_PATTERNS.revert)
  revert(@Payload() req: HarvestRunIdRequest): Promise<HarvestRunView> {
    return this.runs.revert(req);
  }

  @MessagePattern(HARVEST_PATTERNS.runGet)
  getRun(@Payload() req: HarvestRunIdRequest): Promise<HarvestRunView> {
    return this.runs.get(req);
  }

  @MessagePattern(HARVEST_PATTERNS.runList)
  listRuns(@Payload() req: ListHarvestRunsRequest): Promise<HarvestRunPage> {
    return this.runs.list(req);
  }

  /**
   * Everything one run observed, as a file (plan 0086, section 6.2).
   *
   * The other half of a file import, and a **read**: it is not gated by
   * `HARVEST_ENABLED`, because exporting from a machine that crawled to a
   * cluster that is not allowed to crawl is the point of it.
   */
  @MessagePattern(HARVEST_PATTERNS.export)
  exportRun(
    @Payload() req: ExportHarvestRunRequest
  ): Promise<HarvestRunExportResult> {
    return this.entries.export(req);
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

  // --- The one queue (plan 0086, sections 7 and 10) ------------------------

  /**
   * The rows waiting for a person, for every chain and every source kind.
   * Absent `status` lists the two that are waiting, which is what the back
   * office asks for.
   */
  @MessagePattern(SOURCE_ENTRY_PATTERNS.list)
  listEntries(
    @Payload() req: ListSourceEntriesRequest
  ): Promise<SourceCatalogEntryPage> {
    return this.entries.list(req);
  }

  /**
   * Bind a row to a product, and write the prices it holds.
   *
   * The write is the half that is easy to miss: the run that observed those
   * prices is over, and without writing here an admin who works the queue after
   * an eighteen minute walk would have to run it again to get them.
   */
  @MessagePattern(SOURCE_ENTRY_PATTERNS.accept)
  acceptEntry(
    @Payload() req: AcceptSourceEntryRequest
  ): Promise<SourceEntryAcceptResult> {
    return this.entries.accept(req);
  }

  /** The same, for a product the catalog does not hold yet. */
  @MessagePattern(SOURCE_ENTRY_PATTERNS.createItem)
  createItemFromEntry(
    @Payload() req: CreateItemFromSourceEntryRequest
  ): Promise<SourceEntryAcceptResult> {
    return this.entries.createItem(req);
  }

  /** Not a product he tracks. The next run that observes the key asks nobody. */
  @MessagePattern(SOURCE_ENTRY_PATTERNS.reject)
  rejectEntry(
    @Payload() req: SourceEntryIdRequest
  ): Promise<SourceCatalogEntryView> {
    return this.entries.reject(req);
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
