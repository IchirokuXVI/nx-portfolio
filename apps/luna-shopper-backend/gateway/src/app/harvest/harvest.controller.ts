import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  DISCOVERED_PLACE_PATTERNS,
  HARVEST_PATTERNS,
  ITEM_SOURCE_REF_PATTERNS,
  SOURCE_ENTRY_PATTERNS,
  SOURCE_LOCATION_PATTERNS,
  SUPERMARKET_SOURCE_PATTERNS,
  type DiscoveredPlaceGroupsResult,
  type DiscoveredPlacePage,
  type DiscoveredPlaceView,
  type HarvestRunPage,
  type HarvestRunView,
  type ItemSourceRefPage,
  type ItemSourceRefView,
  type ItemView,
  type SourceCatalogEntryPage,
  type SourceLocationPage,
  type SourceLocationView,
  type SupermarketSourcePage,
  type SupermarketSourceView,
} from '@portfolio/luna-shopper/contracts';
import { adminCredential } from '../admin/admin-credential';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import type { CurrentAdmin } from '../admin/admin-jwt.strategy';
import { ActingAdmin } from '../admin/current-admin.decorator';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import {
  CreateItemFromEntryDto,
  DiscoveredPlaceGroupQueryDto,
  DiscoveredPlaceListQueryDto,
  HarvestRunListQueryDto,
  ImportDiscoveredPlaceDto,
  ItemSourceRefListQueryDto,
  MapSourceLocationDto,
  SetManualItemSourceRefDto,
  SetSourceEnabledDto,
  SourceEntryListQueryDto,
  SourceLocationListQueryDto,
  SpawnHarvestRunDto,
  UpsertSupermarketSourceDto,
} from './harvest.dto';

/**
 * The harvester's REST surface (plan 0038, section 7), under
 * `/v1/admin/harvest/`, proxying to the harvester over NATS.
 *
 * **Every route here is platform admin gated** inside the harvester service, and
 * the path says so. Nothing in this plan is open to ordinary users; catalog's
 * existing reads are unchanged and still open.
 *
 * Since plan 0073 the gateway says so too. These routes were already in the
 * namespace and needed only their guard swapped from `JwtAuthGuard` to
 * {@link AdminJwtGuard}, so a velista token no longer reaches a handler that the
 * harvester was always going to refuse. The harvester still verifies the
 * forwarded token for itself, which is plan 0072's property and is why the token
 * travels rather than a flag.
 *
 * There is no push channel: live progress is **polling** `GET runs/:id` (section
 * 6.6, phase one). The realtime `admin:harvest` room stays deferred, and building
 * a second push path here is the thing that plan explicitly says not to do.
 */
@ApiTags('admin-harvest')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/harvest/runs', version: '1' })
export class AdminHarvestRunsController {
  constructor(private readonly nats: NatsClient) {}

  /**
   * Start a run. Answers immediately with the PENDING run; a catalog discovery
   * takes tens of minutes, so waiting for it is not an option a request has.
   * Answers 409 carrying the active run's id when one is already in progress.
   */
  @Post()
  // 201, like every other POST in this gateway. 202 would read better for work
  // that continues in the background, but the whole surface follows Nest's
  // default statuses with no @HttpCode anywhere, and openapi-document.spec.ts
  // enforces that as a house rule. A run genuinely is created here, so 201 is
  // not a lie; the run's own `status` is what says the work is not done.
  @ApiContractResponse(HARVEST_PATTERNS.spawn, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ body: true, conflict: true })
  spawn(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: SpawnHarvestRunDto
  ): Promise<HarvestRunView> {
    return this.nats.send<HarvestRunView>(HARVEST_PATTERNS.spawn, {
      ...adminCredential(admin),
      ...dto,
    });
  }

  @Get()
  @ApiContractResponse(HARVEST_PATTERNS.runList)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: HarvestRunListQueryDto
  ): Promise<HarvestRunPage> {
    return this.nats.send<HarvestRunPage>(HARVEST_PATTERNS.runList, {
      ...adminCredential(admin),
      supermarketId: query.supermarketId,
      mode: query.mode,
      status: query.status,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  /** The progress poll. Counters, stage and heartbeat survive a page reload. */
  @Get(':id')
  @ApiContractResponse(HARVEST_PATTERNS.runGet)
  get(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<HarvestRunView> {
    return this.nats.send<HarvestRunView>(HARVEST_PATTERNS.runGet, {
      ...adminCredential(admin),
      runId: id,
    });
  }

  /**
   * Ask a run to stop. Graceful: it cancels the in flight request, stops
   * fetching, **flushes what it has**, and finalizes as ABORTED. Everything
   * observed before the abort is kept, because prices already fetched are valid.
   */
  @Post(':id/abort')
  @ApiContractResponse(HARVEST_PATTERNS.abort, { status: HttpStatus.CREATED })
  abort(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<HarvestRunView> {
    return this.nats.send<HarvestRunView>(HARVEST_PATTERNS.abort, {
      ...adminCredential(admin),
      runId: id,
    });
  }
}

/**
 * The store discovery review queue (plan 0038, section 6.1). A run creates
 * nothing in catalog: import is a second, explicit step, and it is where the
 * owner's own hand entered supermarkets already fit with no new mechanism.
 */
@ApiTags('admin-harvest')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/harvest/places', version: '1' })
export class AdminHarvestPlacesController {
  constructor(private readonly nats: NatsClient) {}

  @Get()
  @ApiContractResponse(DISCOVERED_PLACE_PATTERNS.list)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: DiscoveredPlaceListQueryDto
  ): Promise<DiscoveredPlacePage> {
    return this.nats.send<DiscoveredPlacePage>(DISCOVERED_PLACE_PATTERNS.list, {
      ...adminCredential(admin),
      runId: query.runId,
      brandKey: query.brandKey,
      status: query.status,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  /**
   * The run's places grouped by chain, with a count, a sample and whether
   * catalog already knows that chain. Grouped on `brand:wikidata` and never on
   * the name: `Dia` and `Maxi Dia` share one QID.
   */
  @Get('groups')
  @ApiContractResponse(DISCOVERED_PLACE_PATTERNS.groups)
  groups(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: DiscoveredPlaceGroupQueryDto
  ): Promise<DiscoveredPlaceGroupsResult> {
    return this.nats.send<DiscoveredPlaceGroupsResult>(
      DISCOVERED_PLACE_PATTERNS.groups,
      {
        ...adminCredential(admin),
        runId: query.runId,
        sampleSize: query.sampleSize,
      }
    );
  }

  @Post(':id/import')
  @ApiContractResponse(DISCOVERED_PLACE_PATTERNS.import, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true })
  importPlace(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Body() dto: ImportDiscoveredPlaceDto
  ): Promise<DiscoveredPlaceView> {
    return this.nats.send<DiscoveredPlaceView>(
      DISCOVERED_PLACE_PATTERNS.import,
      { ...adminCredential(admin), placeId: id, ...dto }
    );
  }

  @Post(':id/reject')
  @ApiContractResponse(DISCOVERED_PLACE_PATTERNS.reject, {
    status: HttpStatus.CREATED,
  })
  reject(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<DiscoveredPlaceView> {
    return this.nats.send<DiscoveredPlaceView>(
      DISCOVERED_PLACE_PATTERNS.reject,
      { ...adminCredential(admin), placeId: id }
    );
  }
}

/**
 * The catalog discovery snapshot, and the one action that turns it into catalog
 * rows (plan 0038, section 6.2). Deliberately a review queue rather than a bulk
 * insert of 4,232 products nobody chose.
 */
@ApiTags('admin-harvest')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/harvest/supermarkets/:supermarketId/entries', version: '1' })
export class AdminHarvestEntriesController {
  constructor(private readonly nats: NatsClient) {}

  @Get()
  @ApiContractResponse(SOURCE_ENTRY_PATTERNS.list)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('supermarketId') supermarketId: string,
    @Query() query: SourceEntryListQueryDto
  ): Promise<SourceCatalogEntryPage> {
    return this.nats.send<SourceCatalogEntryPage>(SOURCE_ENTRY_PATTERNS.list, {
      ...adminCredential(admin),
      supermarketId,
      unmatchedOnly: query.unmatchedOnly,
      query: query.query,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  /**
   * Promote one entry to a catalog `Item`. This is the path that populates the
   * database, and it is where the English name is fetched: paying for it during
   * discovery would double a 4,232 request run.
   */
  @Post(':entryId/item')
  @ApiContractResponse(SOURCE_ENTRY_PATTERNS.createItem, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true })
  createItem(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('entryId') entryId: string,
    @Body() dto: CreateItemFromEntryDto
  ): Promise<ItemView> {
    return this.nats.send<ItemView>(SOURCE_ENTRY_PATTERNS.createItem, {
      ...adminCredential(admin),
      entryId,
      ...dto,
    });
  }
}

/**
 * The links between catalog items and a chain's products (plan 0038, section
 * 6.2). `listUnresolved` is the review queue: a CANDIDATE came from a fuzzy name
 * match and **never writes a price** until it is confirmed here.
 */
@ApiTags('admin-harvest')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/harvest/item-refs', version: '1' })
export class AdminHarvestItemRefsController {
  constructor(private readonly nats: NatsClient) {}

  @Get()
  @ApiContractResponse(ITEM_SOURCE_REF_PATTERNS.list)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: ItemSourceRefListQueryDto
  ): Promise<ItemSourceRefPage> {
    return this.nats.send<ItemSourceRefPage>(ITEM_SOURCE_REF_PATTERNS.list, {
      ...adminCredential(admin),
      ...query,
    });
  }

  @Get('unresolved')
  @ApiContractResponse(ITEM_SOURCE_REF_PATTERNS.listUnresolved)
  listUnresolved(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: ItemSourceRefListQueryDto
  ): Promise<ItemSourceRefPage> {
    return this.nats.send<ItemSourceRefPage>(
      ITEM_SOURCE_REF_PATTERNS.listUnresolved,
      { ...adminCredential(admin), ...query }
    );
  }

  @Put()
  @ApiContractResponse(ITEM_SOURCE_REF_PATTERNS.setManual)
  @ApiProblemResponses({ body: true })
  setManual(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: SetManualItemSourceRefDto
  ): Promise<ItemSourceRefView> {
    return this.nats.send<ItemSourceRefView>(
      ITEM_SOURCE_REF_PATTERNS.setManual,
      { ...adminCredential(admin), ...dto }
    );
  }

  @Post(':id/confirm')
  @ApiContractResponse(ITEM_SOURCE_REF_PATTERNS.confirm, {
    status: HttpStatus.CREATED,
  })
  confirm(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<ItemSourceRefView> {
    return this.nats.send<ItemSourceRefView>(ITEM_SOURCE_REF_PATTERNS.confirm, {
      ...adminCredential(admin),
      refId: id,
    });
  }

  @Post(':id/reject')
  @ApiContractResponse(ITEM_SOURCE_REF_PATTERNS.reject, {
    status: HttpStatus.CREATED,
  })
  reject(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<ItemSourceRefView> {
    return this.nats.send<ItemSourceRefView>(ITEM_SOURCE_REF_PATTERNS.reject, {
      ...adminCredential(admin),
      refId: id,
    });
  }
}

/**
 * The shops a source names, and the mappings that let a run write availability
 * for them (plan 0084, section 7).
 *
 * The fourth review queue, beside places, entries and item refs. A row here is a
 * decision with three outcomes, one of which binds a foreign record, and none of
 * which is "edit this row's fields": `externalId` and `printedName` are the
 * source's, and no route offers to change either.
 *
 * **Mapping a shop does not backfill it.** The availability the run skipped
 * stays skipped until the next run, and the back office says so at the moment of
 * mapping. Without that line the natural reading of a green `ACTIVE` badge is
 * "the data is here now", and it is not.
 */
@ApiTags('admin-harvest')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/harvest/shops', version: '1' })
export class AdminHarvestShopsController {
  constructor(private readonly nats: NatsClient) {}

  @Get()
  @ApiContractResponse(SOURCE_LOCATION_PATTERNS.list)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: SourceLocationListQueryDto
  ): Promise<SourceLocationPage> {
    return this.nats.send<SourceLocationPage>(SOURCE_LOCATION_PATTERNS.list, {
      ...adminCredential(admin),
      supermarketId: query.supermarketId,
      status: query.status,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Put(':id/location')
  @ApiContractResponse(SOURCE_LOCATION_PATTERNS.map)
  @ApiProblemResponses({ body: true })
  map(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Body() dto: MapSourceLocationDto
  ): Promise<SourceLocationView> {
    return this.nats.send<SourceLocationView>(SOURCE_LOCATION_PATTERNS.map, {
      ...adminCredential(admin),
      sourceLocationId: id,
      supermarketLocationId: dto.supermarketLocationId,
    });
  }

  @Delete(':id/location')
  @ApiContractResponse(SOURCE_LOCATION_PATTERNS.unmap)
  unmap(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<SourceLocationView> {
    return this.nats.send<SourceLocationView>(SOURCE_LOCATION_PATTERNS.unmap, {
      ...adminCredential(admin),
      sourceLocationId: id,
    });
  }

  /** A place the source lists that we do not sell from. */
  @Post(':id/ignore')
  @ApiContractResponse(SOURCE_LOCATION_PATTERNS.ignore, {
    status: HttpStatus.CREATED,
  })
  ignore(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<SourceLocationView> {
    return this.nats.send<SourceLocationView>(SOURCE_LOCATION_PATTERNS.ignore, {
      ...adminCredential(admin),
      sourceLocationId: id,
    });
  }

  @Post(':id/unignore')
  @ApiContractResponse(SOURCE_LOCATION_PATTERNS.unignore, {
    status: HttpStatus.CREATED,
  })
  unignore(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<SourceLocationView> {
    return this.nats.send<SourceLocationView>(
      SOURCE_LOCATION_PATTERNS.unignore,
      { ...adminCredential(admin), sourceLocationId: id }
    );
  }
}

/** Per chain fetching configuration (plan 0038, sections 4.2 and 6.3). */
@ApiTags('admin-harvest')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/harvest/sources', version: '1' })
export class AdminHarvestSourcesController {
  constructor(private readonly nats: NatsClient) {}

  @Get()
  @ApiContractResponse(SUPERMARKET_SOURCE_PATTERNS.list)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: HarvestRunListQueryDto
  ): Promise<SupermarketSourcePage> {
    return this.nats.send<SupermarketSourcePage>(
      SUPERMARKET_SOURCE_PATTERNS.list,
      { ...adminCredential(admin), cursor: query.cursor, limit: query.limit }
    );
  }

  @Get(':supermarketId')
  @ApiContractResponse(SUPERMARKET_SOURCE_PATTERNS.get)
  get(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('supermarketId') supermarketId: string
  ): Promise<SupermarketSourceView> {
    return this.nats.send<SupermarketSourceView>(
      SUPERMARKET_SOURCE_PATTERNS.get,
      { ...adminCredential(admin), supermarketId }
    );
  }

  @Put(':supermarketId')
  @ApiContractResponse(SUPERMARKET_SOURCE_PATTERNS.upsert)
  @ApiProblemResponses({ body: true })
  upsert(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('supermarketId') supermarketId: string,
    @Body() dto: UpsertSupermarketSourceDto
  ): Promise<SupermarketSourceView> {
    return this.nats.send<SupermarketSourceView>(
      SUPERMARKET_SOURCE_PATTERNS.upsert,
      { ...adminCredential(admin), supermarketId, ...dto }
    );
  }

  /**
   * The switch that turns fetching on for one chain. Separate from `upsert` on
   * purpose: describing a chain and starting to fetch it are two decisions.
   */
  @Put(':supermarketId/enabled')
  @ApiContractResponse(SUPERMARKET_SOURCE_PATTERNS.setEnabled)
  @ApiProblemResponses({ body: true })
  setEnabled(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('supermarketId') supermarketId: string,
    @Body() dto: SetSourceEnabledDto
  ): Promise<SupermarketSourceView> {
    return this.nats.send<SupermarketSourceView>(
      SUPERMARKET_SOURCE_PATTERNS.setEnabled,
      { ...adminCredential(admin), supermarketId, enabled: dto.enabled }
    );
  }
}
