import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpStatus,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  BRAND_MATCHES_MAX_KEYS,
  BRAND_PATTERNS,
  brandKey,
  DISCOVERED_PLACE_PATTERNS,
  HARVEST_PATTERNS,
  HARVEST_PRESET_PATTERNS,
  HARVEST_SCHEMA_IDS,
  HarvestRunMode,
  POSTAL_CODE_DISCOVERY_PATTERNS,
  SOURCE_ENTRY_PATTERNS,
  SOURCE_LOCATION_PATTERNS,
  SUPERMARKET_SOURCE_PATTERNS,
  validateHarvestDocument,
  type ApplySourceEntryDecisionsResult,
  type BrandMatchesResult,
  type BrandMatchView,
  type DiscoveredPlaceGroupsResult,
  type DiscoveredPlacePage,
  type DiscoveredPlaceView,
  type HarvestRunExportResult,
  type HarvestRunPage,
  type HarvestRunPresetPage,
  type HarvestRunPresetView,
  type HarvestRunView,
  type ItemSourceEntryPage,
  type LinkPlacesByRefResult,
  type PlaceLinkResult,
  type PostalCodeDiscoveryRequestPage,
  type PostalCodeDiscoveryRequestView,
  type PostalCodeDiscoverySummaryView,
  type QueuedSourceEntryPage,
  type SettleItemAtChainResult,
  type SourceCatalogEntryPage,
  type SourceCatalogEntryView,
  type SourceEntryAcceptResult,
  type SourceLocationPage,
  type SourceLocationView,
  type SupermarketSourcePage,
  type SupermarketSourceView,
} from '@portfolio/luna-shopper/contracts';
import { PageQueryDto, UuidParam } from '@portfolio/luna-shopper/platform';
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
  AddPostalCodeDiscoveryDto,
  ApplySourceEntryDecisionsDto,
  CreateHarvestRunPresetDto,
  CreateItemFromEntryDto,
  DiscoveredPlaceGroupQueryDto,
  DiscoveredPlaceListQueryDto,
  HarvestRunListQueryDto,
  HarvestRunPresetListQueryDto,
  ImportDiscoveredPlaceDto,
  ImportHarvestDocumentDto,
  LinkDiscoveredPlaceDto,
  LinkPlacesByRefDto,
  MapSourceLocationDto,
  PostalCodeDiscoveryListQueryDto,
  SetSourceEnabledDto,
  SettleItemAtChainDto,
  SourceEntryListQueryDto,
  SourceLocationListQueryDto,
  SpawnHarvestRunDto,
  UpdateHarvestRunPresetDto,
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
      presetId: query.presetId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  /** The progress poll. Counters, stage and heartbeat survive a page reload. */
  @Get(':id')
  @ApiContractResponse(HARVEST_PATTERNS.runGet)
  get(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string
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
    @UuidParam('id') id: string
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
    @UuidParam('id') id: string
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
    @UuidParam('id') id: string,
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
      // Both were declared on the query and never sent (plan 0193), so the
      // places queue of a postal code listed the places of every code.
      country: query.country,
      postalCode: query.postalCode,
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

  /**
   * Create a shop from the place (plan 0152). The scope is the one named, or
   * the chain's scope the run declared for the place; a declared key the chain
   * does not hold answers 409 `scope_not_found` with `details.scopeKey`.
   *
   * A shop the catalog may already hold answers 409 `place_matches_location`
   * with `details.candidates`, each naming the rung that found it, and writes
   * nothing. Link one of them, or send `force` to create a new shop anyway. An
   * imported place answers 409 `place_already_imported`.
   */
  @Post(':id/import')
  @ApiContractResponse(DISCOVERED_PLACE_PATTERNS.import, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true })
  importPlace(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string,
    @Body() dto: ImportDiscoveredPlaceDto
  ): Promise<DiscoveredPlaceView> {
    return this.nats.send<DiscoveredPlaceView>(
      DISCOVERED_PLACE_PATTERNS.import,
      { ...adminCredential(admin), placeId: id, ...dto }
    );
  }

  /**
   * Link every undecided place to the shop that was made from it (plan 0193).
   *
   * A place is linked when exactly one catalog shop carries its `externalRef`
   * and that shop names the same `externalProvider`. Nothing links on a
   * distance. Without `apply` it writes nothing and answers what it would do:
   * `linked` with what each link would fill, and `skipped` with the reason
   * (`SEVERAL_SHOPS` or `PROVIDER_NOT_NAMED`) and the shops. A second call with
   * `apply` finds nothing to link.
   *
   * Declared before the `:id` routes for the reader. Its path has one segment
   * after `places` and theirs have two, so the order decides nothing.
   */
  @Post('link-by-ref')
  @ApiContractResponse(DISCOVERED_PLACE_PATTERNS.linkByRef, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true })
  linkPlacesByRef(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: LinkPlacesByRefDto
  ): Promise<LinkPlacesByRefResult> {
    return this.nats.send<LinkPlacesByRefResult>(
      DISCOVERED_PLACE_PATTERNS.linkByRef,
      { ...adminCredential(admin), apply: dto.apply }
    );
  }

  /**
   * Bind the place to a shop that the catalog already holds (plan 0152,
   * section 3, and plan 0193). It fills only the fields the shop lacks:
   * coordinates, the provider's ref, a postal code, the size, the address,
   * the city and the country. A postal code that catalog derived counts as
   * lacking against one the source stated. It never creates a shop and never
   * writes a label. The answer is the place and the list of what was filled.
   *
   * The shop named decides the chain. A place that resolves to another chain
   * answers 409 `place_names_another_chain` with `details.chain` (`id` and
   * `name`) and writes nothing; send `acrossChains` to link anyway. An
   * imported place answers 409 `place_already_imported`.
   */
  @Post(':id/link')
  @ApiContractResponse(DISCOVERED_PLACE_PATTERNS.link, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true, notFound: true })
  linkPlace(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string,
    @Body() dto: LinkDiscoveredPlaceDto
  ): Promise<PlaceLinkResult> {
    return this.nats.send<PlaceLinkResult>(DISCOVERED_PLACE_PATTERNS.link, {
      ...adminCredential(admin),
      placeId: id,
      supermarketLocationId: dto.supermarketLocationId,
      acrossChains: dto.acrossChains,
    });
  }

  /**
   * An imported place answers 409 `place_already_imported`: removing its shop
   * is a catalog act on the location (plan 0152, section 5).
   */
  @Post(':id/reject')
  @ApiContractResponse(DISCOVERED_PLACE_PATTERNS.reject, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ conflict: true })
  reject(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string
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

  /**
   * The queue, each row with the brands its printed brand names (plan 0178).
   *
   * **Composed, and in this order.** The harvester answers the rows, and
   * catalog answers which registered brands each printed key names: the
   * registry lives in catalog and the harvester holds no copy of it, the rule
   * the brand suggestions already follow. One catalog read per page, for the
   * distinct keys the page prints, and none at all for a page that prints no
   * brand.
   *
   * `brandMatches` can hold several brands. The key's own brand is first, and
   * a brand a homonym points that key at follows.
   */
  @Get()
  @ApiComposedResponse(HARVEST_SCHEMA_IDS.queuedSourceEntryPage, {
    description:
      'The queue, newest observation first, each row with every registered brand its printed brand names. Composed: the rows are the harvester’s, and the brands are read from catalog’s registry for the keys the page prints.',
  })
  async list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: SourceEntryListQueryDto
  ): Promise<QueuedSourceEntryPage> {
    const page = await this.nats.send<SourceCatalogEntryPage>(
      SOURCE_ENTRY_PATTERNS.list,
      {
        ...adminCredential(admin),
        supermarketId: query.supermarketId,
        status: query.status,
        sourceKind: query.sourceKind,
        query: query.query,
        brandKey: query.brandKey,
        cursor: query.cursor,
        limit: query.limit,
      }
    );

    const keys = [
      ...new Set(
        page.items
          .map((entry) => brandKey(entry.brand))
          .filter((key): key is string => key !== null)
      ),
    ];
    const byKey = new Map<string, BrandMatchView[]>();
    // A page holds at most a hundred rows, so one request carries its keys
    // with room to spare. The slices are there so that a larger page, the day
    // one exists, costs a second request instead of a refused one.
    for (let i = 0; i < keys.length; i += BRAND_MATCHES_MAX_KEYS) {
      const { matches } = await this.nats.send<BrandMatchesResult>(
        BRAND_PATTERNS.matches,
        {
          userId: admin.adminId,
          keys: keys.slice(i, i + BRAND_MATCHES_MAX_KEYS),
        }
      );
      for (const match of matches) {
        byKey.set(match.printedKey, match.brands);
      }
    }

    return {
      items: page.items.map((entry) => ({
        ...entry,
        brandMatches: byKey.get(brandKey(entry.brand) ?? '') ?? [],
      })),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Bind a row to a product, and write the prices the row holds.
   *
   * The write is the half that is easy to miss: the run that observed those
   * prices is over, and without writing here an admin who works the queue after
   * an eighteen minute walk would have to run it again to get them. The answer
   * says how many went, and zero is a normal answer for a source that prints
   * none.
   *
   * **Accepting a row teaches its barcode** (plan 0185). A row whose real EAN
   * no product holds gives that EAN to the product it is accepted onto, as one
   * more of its barcodes. When another product holds it, the accept answers
   * 409 `item_ean_held` and names that product in `details`. The check runs
   * before the bind, and a refusal there writes nothing. If another write
   * takes the barcode between that check and the teach, the answer is the
   * same 409, and the bind and its prices stand. A row whose EAN another row
   * of its chain prints teaches nothing and is never refused for it.
   *
   * **A second article of the chain on the product writes no price where the
   * two disagree** (plan 0191). When another bound row of the same chain and
   * source kind holds an open price of another amount at a scope, the row is
   * bound and no price is written for that scope. `pricesWithheld` names the
   * other row, and `pricesWritten` counts what was written. The price that
   * was current stays until a person makes a second product or removes a row.
   *
   * **A row that is already bound can be accepted onto another product**
   * (plan 0191). That moves it, and it takes with it what it wrote on the
   * product it leaves. Its barcode is taken off the old product and given to
   * the new one, unless another row still bound to the old product prints it
   * too: then the answer is 409 `item_ean_held`, naming the old product, and
   * nothing is written. Right after the bind the old product is settled at
   * the row's chain, as `POST items/:itemId/settle` does, and `settled`
   * answers what that removed. It is settled before the prices of the new
   * product are written, because a second accept cannot do it: the saved row
   * no longer names the product it left. The barcode moves next, and the
   * prices are written last, so a price write that fails leaves nothing a
   * second accept is refused for. Each step runs whatever happened to the
   * one before it. Any error after the bind names the old product and the
   * chain, and says whether the product was settled. If it was not, the
   * settle route finishes the job.
   */
  @Post(':id/accept')
  @ApiContractResponse(SOURCE_ENTRY_PATTERNS.accept, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, eanHeld: true })
  accept(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string,
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
   *
   * **A row that is already bound can be made a product of its own** (plan
   * 0191). That moves it off the product it was bound to, under the rules the
   * accept route states for a move: the barcode goes with the row, the old
   * product is settled at the row's chain, and `settled` answers what that
   * removed. `pricesWithheld` is always empty here, because a new product has
   * no other row.
   */
  @Post(':id/item')
  @ApiContractResponse(SOURCE_ENTRY_PATTERNS.createItem, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true, eanHeld: true })
  createItem(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string,
    @Body() dto: CreateItemFromEntryDto
  ): Promise<SourceEntryAcceptResult> {
    return this.nats.send<SourceEntryAcceptResult>(
      SOURCE_ENTRY_PATTERNS.createItem,
      { ...adminCredential(admin), entryId: id, ...dto }
    );
  }

  /**
   * A whole decisions file, in one call, all or nothing (plan 0100).
   *
   * The route the curation toolchain applies with, after a session decided the
   * queue offline. Replaying that file through the two routes above is one
   * request per row, so a file that goes wrong at row 300 leaves the queue half
   * worked and the operator with no way to say which half.
   *
   * **A refused file answers 201 with `applied: false`**, not an error status.
   * The caller needs to know which row failed which check, and a problem
   * document carries one message for a thousand rows. What does answer 400 is
   * what the request got wrong before any row was looked at: an empty file, or
   * one over the cap.
   *
   * An `accept` of a row whose real EAN another product holds is refused on its
   * own operation with `EAN_HELD` (plan 0185), at `VALIDATE`, so nothing of the
   * file lands. An accepted row whose EAN no product holds gives it to its
   * product after the binds, and a barcode that could not be written is named
   * in `priceSkips` with a reason that starts with `Barcode`. A row whose EAN
   * another row of its chain prints teaches nothing and is never refused.
   *
   * There is no bulk reject, and there will not be one: junk is a person's call,
   * and a wrong reject hides a row from the queue that nobody looks at again.
   */
  @Post('decisions')
  @ApiContractResponse(SOURCE_ENTRY_PATTERNS.applyDecisions, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true })
  applyDecisions(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: ApplySourceEntryDecisionsDto
  ): Promise<ApplySourceEntryDecisionsResult> {
    return this.nats.send<ApplySourceEntryDecisionsResult>(
      SOURCE_ENTRY_PATTERNS.applyDecisions,
      {
        ...adminCredential(admin),
        runId: dto.runId,
        operations: dto.operations,
      }
    );
  }

  /**
   * Not a product he tracks. The row stays as REJECTED rather than being
   * deleted, so the next run that observes the key touches it and asks nobody.
   *
   * **Rejecting a bound row takes back what it wrote** (plan 0191). The
   * product it was bound to is settled at the row's chain, as
   * `POST items/:itemId/settle` does: the prices the row stated go, and when
   * no other row of the chain names the product, so do its offers and the
   * shop rows runs wrote. The barcode stays on the product. If the settle
   * fails the row stays rejected, and the request answers with that error.
   * The error names the product and the chain, and the settle route finishes
   * the job.
   */
  @Post(':id/reject')
  @ApiContractResponse(SOURCE_ENTRY_PATTERNS.reject, {
    status: HttpStatus.CREATED,
  })
  reject(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string
  ): Promise<SourceCatalogEntryView> {
    return this.nats.send<SourceCatalogEntryView>(
      SOURCE_ENTRY_PATTERNS.reject,
      { ...adminCredential(admin), entryId: id }
    );
  }
}

/**
 * The queue read from the other side: a product, and the source rows that name
 * it (plan 0160).
 *
 * The entries queue answers from the row's side only, so "which chain rows are
 * bound to this product" used to be a psql query. Each row carries
 * `eanSharedBy`, how many rows of its chain list the same barcode, which is the
 * count operator plan 0150 made by hand.
 */
@ApiTags('admin-harvest')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/harvest/items', version: '1' })
export class AdminHarvestItemsController {
  constructor(private readonly nats: NatsClient) {}

  /**
   * Every source row whose `itemId` is this product, newest observation first.
   * `ACTIVE` rows are bound and a `CANDIDATE` row proposes the product; the
   * status says which. A product id nothing names answers an empty page: the
   * harvester does not own products, so it cannot say one does not exist.
   *
   * `scopeSharedWith` names, for a bound row, the other bound rows of its
   * chain and source kind that hold an open price at a scope it prices too
   * (plan 0191). Catalog shows one price per product, scope and kind, so when
   * two such rows state two amounts and are not both sold by weight, neither
   * is written until a person makes a second product or removes a row.
   */
  @Get(':itemId/entries')
  @ApiContractResponse(SOURCE_ENTRY_PATTERNS.listByItem)
  entries(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('itemId') itemId: string,
    @Query() query: PageQueryDto
  ): Promise<ItemSourceEntryPage> {
    return this.nats.send<ItemSourceEntryPage>(
      SOURCE_ENTRY_PATTERNS.listByItem,
      {
        ...adminCredential(admin),
        itemId,
        cursor: query.cursor,
        limit: query.limit,
      }
    );
  }

  /**
   * Settle a product at a chain (plan 0191): make catalog agree with the rows
   * of the chain that are bound to the product now.
   *
   * A bound row that is moved to another product, or rejected, leaves on the
   * old product what it wrote there, and no later run takes it back. The
   * accept, create and reject routes settle the old product themselves. This
   * route is for a product a row left before that existed, and for a
   * decision whose own settle failed.
   *
   * **It removes only what no bound row accounts for.** For each scope of
   * the chain:
   *
   * - When no bound row holds a price row there, the price rows of the
   *   product that a run wrote there are removed.
   * - When a bound row holds a price row there, open or closed, the scope is
   *   left alone. A source row holds one price per scope, and it can have
   *   written more than that one: under another kind, or a newer price than
   *   the one it holds now. So nothing there counts as a leftover on this
   *   route. A move or a reject knows the row that left, and removes the
   *   rows of the run that row names.
   * - When the open prices of the bound rows come to one price at a scope
   *   and kind, that price is stated. Catalog removes the rows of the same
   *   run that were observed at its instant or later and say something else,
   *   and writes it, in one transaction. `pricesWritten` counts the rows that
   *   inserted. `pricesRestated` counts the stated prices that are the
   *   current price afterwards. `pricesNotCurrent` names the ones that are
   *   not: catalog holds a newer row of another run there, and it stays.
   *   `pricesNotWritable` names a price copied from a scope that is gone.
   * - When the bound rows state two amounts there, nothing is removed and
   *   nothing is written. `pricesWithheld` names the rows.
   *
   * The kind of a price is the kind of the run that observed it, not the kind
   * its row says today. When that run cannot be read, every kind at the scope
   * of the price is left alone. `pricesKeptAsWritten` names a price catalog
   * holds under another kind than its run's: it stays as it was written.
   *
   * A price a person typed is never removed: an `ADMIN` price, and a price of
   * any kind that names no run.
   *
   * Then, only when no bound row of the chain names the product, its offers
   * in the scopes of the chain are removed, with the shop rows a run wrote.
   * An offer stays when a price still exists for it (`PRICED`), when a shop
   * row a person wrote backs it (`SHOP_ROW`), when an operator wrote the
   * offer itself (`PERSON`), or when the offer is older than the audit trail
   * that would say so (`NO_TRAIL`). `offersKept` says which.
   *
   * `dryRun: true` answers the same and writes nothing. Calling it twice is
   * safe: the second call changes no row.
   *
   * An unknown chain answers 404. A product id nothing names answers zeros,
   * because the harvester does not own products.
   */
  @Post(':itemId/settle')
  @ApiContractResponse(SOURCE_ENTRY_PATTERNS.settleItem, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true })
  settle(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('itemId') itemId: string,
    @Body() dto: SettleItemAtChainDto
  ): Promise<SettleItemAtChainResult> {
    return this.nats.send<SettleItemAtChainResult>(
      SOURCE_ENTRY_PATTERNS.settleItem,
      {
        ...adminCredential(admin),
        itemId,
        supermarketId: dto.supermarketId,
        dryRun: dto.dryRun,
      }
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
    @UuidParam('id') id: string,
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
    @UuidParam('id') id: string
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
    @UuidParam('id') id: string
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
    @UuidParam('id') id: string
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
    @UuidParam('supermarketId') supermarketId: string
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
    @UuidParam('supermarketId') supermarketId: string,
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
    @UuidParam('supermarketId') supermarketId: string,
    @Body() dto: SetSourceEnabledDto
  ): Promise<SupermarketSourceView> {
    return this.nats.send<SupermarketSourceView>(
      SUPERMARKET_SOURCE_PATTERNS.setEnabled,
      { ...adminCredential(admin), supermarketId, enabled: dto.enabled }
    );
  }

  /**
   * Undescribe a chain.
   *
   * The row is keyed on the chain, so `upsert` cannot move one that was
   * created against the wrong chain: it would write a second row. This is the
   * way back, and it refuses while a run of that chain is in flight.
   */
  @Delete(':supermarketId')
  @ApiContractResponse(SUPERMARKET_SOURCE_PATTERNS.delete)
  remove(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('supermarketId') supermarketId: string
  ): Promise<{ id: string }> {
    return this.nats.send(SUPERMARKET_SOURCE_PATTERNS.delete, {
      ...adminCredential(admin),
      supermarketId,
    });
  }
}

/**
 * Run requests saved under a name, one chain each (plan 0120).
 *
 * The harvester validates a preset exactly as it validates a spawn, when it is
 * saved and again when a run starts from it, so a preset naming a scope that was
 * deleted since answers 400 naming the scope and the preset, and starts nothing.
 *
 * **Starting a run from a preset is its own route**, not a `presetId` on the
 * spawn body: a spawn naming a preset and a scope would have to decide which one
 * wins, and a route that takes nothing but the id cannot be asked. The run keeps
 * a copy of the input and the preset's id, so editing or deleting a preset never
 * changes a run.
 */
@ApiTags('admin-harvest')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/harvest/presets', version: '1' })
export class AdminHarvestPresetsController {
  constructor(private readonly nats: NatsClient) {}

  /** Ordered by name, paged with the house cursor, each with its latest run. */
  @Get()
  @ApiContractResponse(HARVEST_PRESET_PATTERNS.list)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: HarvestRunPresetListQueryDto
  ): Promise<HarvestRunPresetPage> {
    return this.nats.send<HarvestRunPresetPage>(HARVEST_PRESET_PATTERNS.list, {
      ...adminCredential(admin),
      supermarketId: query.supermarketId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  /** Answers 409 naming the preset that already holds the name, in any case. */
  @Post()
  @ApiContractResponse(HARVEST_PRESET_PATTERNS.create, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true })
  create(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: CreateHarvestRunPresetDto
  ): Promise<HarvestRunPresetView> {
    return this.nats.send<HarvestRunPresetView>(
      HARVEST_PRESET_PATTERNS.create,
      {
        ...adminCredential(admin),
        supermarketId: dto.supermarketId,
        name: dto.name,
        input: dto.input,
      }
    );
  }

  @Get(':id')
  @ApiContractResponse(HARVEST_PRESET_PATTERNS.get)
  get(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string
  ): Promise<HarvestRunPresetView> {
    return this.nats.send<HarvestRunPresetView>(HARVEST_PRESET_PATTERNS.get, {
      ...adminCredential(admin),
      presetId: id,
    });
  }

  /** `input` replaces the saved one whole and is validated again. */
  @Put(':id')
  @ApiContractResponse(HARVEST_PRESET_PATTERNS.update)
  @ApiProblemResponses({ body: true, conflict: true })
  update(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string,
    @Body() dto: UpdateHarvestRunPresetDto
  ): Promise<HarvestRunPresetView> {
    return this.nats.send<HarvestRunPresetView>(
      HARVEST_PRESET_PATTERNS.update,
      {
        ...adminCredential(admin),
        presetId: id,
        name: dto.name,
        input: dto.input,
      }
    );
  }

  /** Runs started from the preset keep their record and still name it. */
  @Delete(':id')
  @ApiContractResponse(HARVEST_PRESET_PATTERNS.delete)
  remove(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(HARVEST_PRESET_PATTERNS.delete, {
      ...adminCredential(admin),
      presetId: id,
    });
  }

  /**
   * Start a run from the preset. Answers the PENDING run, 400 when the preset no
   * longer validates, and 409 carrying the active run's id when the chain has
   * one in progress, as a spawn does.
   */
  @Post(':id/runs')
  @ApiContractResponse(HARVEST_PATTERNS.spawnFromPreset, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true, notConfigured: true })
  start(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string
  ): Promise<HarvestRunView> {
    return this.nats.send<HarvestRunView>(HARVEST_PATTERNS.spawnFromPreset, {
      ...adminCredential(admin),
      presetId: id,
    });
  }
}

/**
 * The postal code discovery queue (plan 0097).
 *
 * Plan 0063 built the queue and a listing subject nothing consumed, so the only
 * way to see whether a code had ever been looked at was to open the harvester's
 * database. This is that surface.
 *
 * **Demand driven, and that is the point.** A code is in this list because a
 * profile write announced it or because an operator typed it here. It is not the
 * shipped centroid table, which is eleven thousand rows and lives at
 * `admin/catalog/postal-codes`: a screen listing the whole country would bury
 * the forty codes that matter under eleven thousand that do not.
 */
@ApiTags('admin-harvest')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/harvest/postal-codes', version: '1' })
export class AdminHarvestPostalCodesController {
  constructor(private readonly nats: NatsClient) {}

  @Get()
  @ApiContractResponse(POSTAL_CODE_DISCOVERY_PATTERNS.list)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: PostalCodeDiscoveryListQueryDto
  ): Promise<PostalCodeDiscoveryRequestPage> {
    return this.nats.send<PostalCodeDiscoveryRequestPage>(
      POSTAL_CODE_DISCOVERY_PATTERNS.list,
      {
        ...adminCredential(admin),
        country: query.country,
        status: query.status,
        postalCode: query.postalCode,
        dismissed: query.dismissed,
        cursor: query.cursor,
        limit: query.limit,
      }
    );
  }

  /**
   * Counts by status, the oldest waiting row, and whether anything drains it.
   *
   * `draining` is `HARVEST_ENABLED`, and it is here rather than on
   * `GET /v1/admin/environment` because that route answers callers with no token
   * at all (plan 0097, section 7.1).
   */
  @Get('summary')
  @ApiContractResponse(POSTAL_CODE_DISCOVERY_PATTERNS.summary)
  summary(
    @ActingAdmin() admin: CurrentAdmin
  ): Promise<PostalCodeDiscoverySummaryView> {
    return this.nats.send<PostalCodeDiscoverySummaryView>(
      POSTAL_CODE_DISCOVERY_PATTERNS.summary,
      adminCredential(admin)
    );
  }

  /**
   * Add one code, queued now or parked (section 6.1).
   *
   * A code catalog does not hold is refused with `postal_code_unknown` and
   * nothing is written: the harvester asks catalog before it inserts.
   */
  @Post()
  @ApiContractResponse(POSTAL_CODE_DISCOVERY_PATTERNS.add, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true })
  add(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: AddPostalCodeDiscoveryDto
  ): Promise<PostalCodeDiscoveryRequestView> {
    return this.nats.send<PostalCodeDiscoveryRequestView>(
      POSTAL_CODE_DISCOVERY_PATTERNS.add,
      { ...adminCredential(admin), ...dto }
    );
  }

  /**
   * Discover it again, inside the cooldown (section 6.2).
   *
   * **It queues, and it does not run.** The queue drains serially and one run
   * exists at a time, so the answer says the row is waiting rather than working,
   * and the screen repeats that instead of promising a run.
   */
  @Post(':id/requeue')
  @ApiContractResponse(POSTAL_CODE_DISCOVERY_PATTERNS.requeue, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ conflict: true })
  requeue(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string
  ): Promise<PostalCodeDiscoveryRequestView> {
    return this.nats.send<PostalCodeDiscoveryRequestView>(
      POSTAL_CODE_DISCOVERY_PATTERNS.requeue,
      { ...adminCredential(admin), requestId: id }
    );
  }

  /** Hide a code nobody can geocode. Nothing is deleted (section 6.3). */
  @Post(':id/dismiss')
  @ApiContractResponse(POSTAL_CODE_DISCOVERY_PATTERNS.dismiss, {
    status: HttpStatus.CREATED,
  })
  dismiss(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string
  ): Promise<PostalCodeDiscoveryRequestView> {
    return this.nats.send<PostalCodeDiscoveryRequestView>(
      POSTAL_CODE_DISCOVERY_PATTERNS.dismiss,
      { ...adminCredential(admin), requestId: id }
    );
  }
}
