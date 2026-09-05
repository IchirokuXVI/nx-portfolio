import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  DISCOVERED_PLACE_PATTERNS,
  HARVEST_PATTERNS,
  HARVEST_SCHEMA_IDS,
  HarvestRunMode,
  SOURCE_ENTRY_PATTERNS,
  SOURCE_LOCATION_PATTERNS,
  SUPERMARKET_SOURCE_PATTERNS,
  validateHarvestDocument,
  type DiscoveredPlaceGroupsResult,
  type DiscoveredPlacePage,
  type DiscoveredPlaceView,
  type HarvestRunExportResult,
  type HarvestRunPage,
  type HarvestRunView,
  type SourceCatalogEntryPage,
  type SourceCatalogEntryView,
  type SourceEntryAcceptResult,
  type SourceLocationPage,
  type SourceLocationView,
  type SupermarketSourcePage,
  type SupermarketSourceView,
} from '@portfolio/luna-shopper/contracts';
import type { Response } from 'express';
import { adminCredential } from '../admin/admin-credential';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import type { CurrentAdmin } from '../admin/admin-jwt.strategy';
import { ActingAdmin } from '../admin/current-admin.decorator';
import {
  ApiComposedResponse,
  ApiContractResponse,
  ApiProblemResponses,
} from '../docs';
import { NatsClient } from '../messaging/nats-client';
import {
  AcceptSourceEntryDto,
  CreateItemFromEntryDto,
  DiscoveredPlaceGroupQueryDto,
  DiscoveredPlaceListQueryDto,
  HarvestRunListQueryDto,
  ImportDiscoveredPlaceDto,
  ImportHarvestDocumentDto,
  MapSourceLocationDto,
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
      reverted: query.reverted,
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

  /**
   * Take back everything the run wrote (plan 0082).
   *
   * The opposite of the route above it, and the pairing is the point: an abort
   * stops a run and **keeps** what it already fetched, this deletes what it
   * wrote. So a run has to have finished before this is allowed: abort it
   * first, then revert what it flushed.
   *
   * Answers the run with `revertedAt` and the counts the operation produced,
   * 409 for a run that was already reverted or is still going, and 400 for a
   * mode that writes no price.
   */
  @Post(':id/revert')
  @ApiContractResponse(HARVEST_PATTERNS.revert, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ body: true, conflict: true })
  revert(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<HarvestRunView> {
    return this.nats.send<HarvestRunView>(HARVEST_PATTERNS.revert, {
      ...adminCredential(admin),
      runId: id,
    });
  }

  /**
   * Everything this run observed, as a file (plan 0086, section 6.2).
   *
   * The other half of a file import, and the reason the schema is one schema: a
   * walk runs where there is room for 4,383 requests, its export is uploaded to
   * a cluster that is not allowed to crawl, and that cluster's rows, ladder,
   * queue and prices are exactly what a walk there would have produced. So it is
   * offered whether or not this deployment may start runs.
   *
   * A **download** rather than a JSON response body, because what an operator
   * does with it is put it in a file and upload it somewhere else. The name is
   * the chain, the scope and the day, so a directory of them is readable.
   *
   * The set is every row whose `lastRunId` is this run, so a chain walked again
   * since answers fewer rows and the newest run of a chain is the one to export.
   */
  @Get(':id/export')
  @Header('content-type', 'application/json; charset=utf-8')
  @ApiComposedResponse(HARVEST_SCHEMA_IDS.harvestDocument, {
    description:
      'The run as a HarvestDocument, offered as a download. Every row the run was the last to observe, with that run’s price for that run’s scope and none of the decisions a person made, which mean nothing on another cluster.',
  })
  @ApiProblemResponses({ body: true })
  async exportRun(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response
  ): Promise<unknown> {
    const result = await this.nats.send<HarvestRunExportResult>(
      HARVEST_PATTERNS.export,
      { ...adminCredential(admin), runId: id }
    );
    response.setHeader(
      'content-disposition',
      `attachment; filename="${exportFilename(result)}"`
    );
    return result.document;
  }
}

/**
 * What a downloaded export is called: the chain, the scope and the day.
 *
 * Ids rather than names, because the gateway proxies and holds neither. They
 * are what tells two exports of one chain for two regions apart, which is the
 * only thing the name has to do; the operator uploading it picks the chain from
 * a directory anyway.
 */
export function exportFilename(result: HarvestRunExportResult): string {
  const day = new Date().toISOString().slice(0, 10);
  const scope = result.priceScopeId ? `-${result.priceScopeId}` : '';
  return `harvest-${result.supermarketId}${scope}-${day}.json`;
}

/**
 * The file import (plan 0086, section 6; plan 0081, section 7).
 *
 * **This is the only route in the gateway with its own body limit.** Nest's JSON
 * parser defaults to 100 KB and this gateway configured none, so every real
 * leaflet (337 KB and 349 KB for the two committed extractions) was refused with
 * a bare 413 before the route existed. `main.ts` creates the app with
 * `bodyParser: false` and mounts this path's parser at the configured cap ahead
 * of the default one.
 *
 * It is `imports` and not `leaflets` because the upload is not a leaflet tool.
 * A file is a list of products as a source described them, whoever produced it:
 * a leaflet extractor, a person typing a chain's prices, or the harvester's own
 * export from a machine that is allowed to crawl.
 *
 * Multipart is deliberately not used: the producer writes JSON, the schema
 * validates JSON, and a form part around it adds a parse step for nothing.
 */
@ApiTags('admin-harvest')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/harvest/imports', version: '1' })
export class AdminHarvestImportsController {
  constructor(private readonly nats: NatsClient) {}

  /**
   * Validate the document, then start a `FILE_IMPORT` run for it.
   *
   * The validation here is the first of two. It happens **before** the document
   * crosses the broker, so a malformed file is answered in milliseconds with
   * every failure named by its JSON path and its product id rather than after a
   * run has been inserted. The harvester validates again at spawn, because it
   * owns the schema version and a broker message is not a trusted input.
   *
   * Answers the PENDING run, like the spawn route beside it, and 409 with the
   * earlier run's id when this chain has already imported this exact file.
   */
  @Post()
  @ApiContractResponse(HARVEST_PATTERNS.spawn, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ body: true, conflict: true })
  importDocument(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: ImportHarvestDocumentDto
  ): Promise<HarvestRunView> {
    const { valid, failures } = validateHarvestDocument(dto.document);
    if (!valid) {
      // One line per failure, each starting with the JSON path, because the
      // house filter keys the envelope's `errors` map on the first word. The
      // product id rides in the text so the upload screen can name the product
      // rather than an array index nobody can find in the file.
      throw new BadRequestException({
        error: 'The file does not match the import schema',
        message: failures.map(
          (failure) =>
            `${failure.path || '/'} ${failure.message}` +
            (failure.productId ? ` (product ${failure.productId})` : '')
        ),
      });
    }

    return this.nats.send<HarvestRunView>(HARVEST_PATTERNS.spawn, {
      ...adminCredential(admin),
      mode: HarvestRunMode.FILE_IMPORT,
      supermarketId: dto.supermarketId,
      priceScopeId: dto.priceScopeId,
      sourceKind: dto.sourceKind,
      validFrom: dto.validFrom ?? null,
      validUntil: dto.validUntil ?? null,
      document: dto.document,
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
 * The one queue (plan 0086, D7 and section 10).
 *
 * One row per product a source described, for every chain and every source
 * kind, and three decisions about one: accept it onto a product the catalog
 * holds, accept it as a new product, or reject it. **All three are a person's**,
 * because a bad fuzzy match writes a wrong price onto a real product that people
 * then shop on.
 *
 * It replaces three screens over three tables: `entries` for the products a walk
 * found and nothing matched, `item-refs` for the fuzzy matches a walk proposed,
 * and `aliases` for the printed names a leaflet queued. Those two controllers
 * are deleted.
 */
@ApiTags('admin-harvest')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/harvest/entries', version: '1' })
export class AdminHarvestEntriesController {
  constructor(private readonly nats: NatsClient) {}

  @Get()
  @ApiContractResponse(SOURCE_ENTRY_PATTERNS.list)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: SourceEntryListQueryDto
  ): Promise<SourceCatalogEntryPage> {
    return this.nats.send<SourceCatalogEntryPage>(SOURCE_ENTRY_PATTERNS.list, {
      ...adminCredential(admin),
      supermarketId: query.supermarketId,
      status: query.status,
      sourceKind: query.sourceKind,
      query: query.query,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  /**
   * Bind a row to a product, and write the prices the row holds.
   *
   * The write is the half that is easy to miss: the run that observed those
   * prices is over, and without writing here an admin who works the queue after
   * an eighteen minute walk would have to run it again to get them. The answer
   * says how many went, and zero is a normal answer for a source that prints
   * none.
   */
  @Post(':id/accept')
  @ApiContractResponse(SOURCE_ENTRY_PATTERNS.accept, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true })
  accept(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Body() dto: AcceptSourceEntryDto
  ): Promise<SourceEntryAcceptResult> {
    return this.nats.send<SourceEntryAcceptResult>(
      SOURCE_ENTRY_PATTERNS.accept,
      { ...adminCredential(admin), entryId: id, itemId: dto.itemId }
    );
  }

  /**
   * The same, for a product the catalog does not hold yet: one call that creates
   * the item and binds the row. Every field of the body is optional, because the
   * row already holds a default for each, and `name.en` may be left out (plan
   * 0079).
   *
   * The English name is fetched here, and only for a row whose id the source can
   * be asked about: paying for it during a walk would double a 4,232 request
   * run, and a leaflet row's key is not an id anything can fetch.
   */
  @Post(':id/item')
  @ApiContractResponse(SOURCE_ENTRY_PATTERNS.createItem, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true })
  createItem(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Body() dto: CreateItemFromEntryDto
  ): Promise<SourceEntryAcceptResult> {
    return this.nats.send<SourceEntryAcceptResult>(
      SOURCE_ENTRY_PATTERNS.createItem,
      { ...adminCredential(admin), entryId: id, ...dto }
    );
  }

  /**
   * Not a product he tracks. The row stays as REJECTED rather than being
   * deleted, so the next run that observes the key touches it and asks nobody.
   */
  @Post(':id/reject')
  @ApiContractResponse(SOURCE_ENTRY_PATTERNS.reject, {
    status: HttpStatus.CREATED,
  })
  reject(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<SourceCatalogEntryView> {
    return this.nats.send<SourceCatalogEntryView>(
      SOURCE_ENTRY_PATTERNS.reject,
      { ...adminCredential(admin), entryId: id }
    );
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
