import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  CATALOG_SCHEMA_IDS,
  ITEM_PATTERNS,
  PRICE_SCOPE_PATTERNS,
  PRODUCT_GROUP_PATTERNS,
  SUPERMARKET_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  SUPERMARKET_PATTERNS,
  type CatalogScopeView,
  type CatalogSuggestResponse,
  type ItemPage,
  type ItemView,
  type PriceScopePage,
  type PriceScopeView,
  type ProductGroupOfferPage,
  type ProductGroupPage,
  type ProductGroupView,
  type SupermarketItemPage,
  type SupermarketItemView,
  type SupermarketLocationItemView,
  type SupermarketLocationPage,
  type SupermarketLocationView,
  type SupermarketPage,
  type SupermarketView,
} from '@portfolio/luna-shopper/contracts';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import {
  ApiContractResponse,
  ApiProblemResponses,
  componentRef,
  hoistContractSchema,
} from '../docs';
import { NatsClient } from '../messaging/nats-client';
import {
  CatalogListQueryDto,
  CreateItemDto,
  CreatePriceScopeDto,
  CreateProductGroupDto,
  CreateSupermarketDto,
  CreateSupermarketLocationDto,
  ListProductGroupsQueryDto,
  PriceScopedQueryDto,
  SearchItemsQueryDto,
  SearchOffersQueryDto,
  SuggestQueryDto,
  UpdateItemDto,
  UpdatePriceScopeDto,
  UpdateProductGroupDto,
  UpdateSupermarketDto,
  UpdateSupermarketLocationDto,
  UpsertSupermarketItemDto,
  UpsertSupermarketLocationItemDto,
} from './catalog.dto';
import {
  ScopeResolutionService,
  type ScopeQuery,
} from './scope-resolution.service';

/**
 * Hoisted at module load, so the component exists before the document is built.
 *
 * The suggestion envelope is a contract schema like any other, even though no
 * broker subject answers with it: the interleave is a gateway shape, and writing
 * it in the contracts library is what keeps its two halves referencing the same
 * `ProductGroupOfferView` and `ItemView` the messages already publish.
 */
const SUGGEST_SCHEMA = hoistContractSchema(
  CATALOG_SCHEMA_IDS.catalogSuggestResponse
);

/**
 * The ladder's outcome, for the one endpoint that describes it rather than uses
 * it (plan 0049, sections 3.1 and 5).
 */
const SCOPE_SCHEMA = hoistContractSchema(CATALOG_SCHEMA_IDS.catalogScopeView);

/**
 * The three ways a query says where the caller shops (plan 0049, section 3),
 * lifted off the DTO once so five routes cannot spell it four ways.
 *
 * The query parameters are singular because that is how a repeated parameter
 * reads in a URL (`?postalCode=28001&postalCode=41001`); the service takes the
 * plurals, because by then they are lists.
 */
function toScopeQuery(query: PriceScopedQueryDto): ScopeQuery {
  return {
    priceScopeIds: query.priceScopeId,
    postalCodes: query.postalCode,
    supermarketIds: query.supermarketId,
    profileId: query.profileId,
  };
}

/**
 * The catalog REST surface (plan 0012), proxying to the catalog service over
 * NATS. Every route requires a valid token; write routes are additionally gated
 * to the platform-admin allowlist inside the catalog service (the app owner
 * alone), while read routes are open to any authenticated user.
 */
@ApiTags('catalog')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'catalog/supermarkets', version: '1' })
export class CatalogSupermarketsController {
  constructor(private readonly nats: NatsClient) {}

  @Post()
  @ApiContractResponse(SUPERMARKET_PATTERNS.create, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true })
  create(
    @AuthUser() user: CurrentUser,
    @Body() dto: CreateSupermarketDto
  ): Promise<SupermarketView> {
    return this.nats.send<SupermarketView>(SUPERMARKET_PATTERNS.create, {
      userId: user.userId,
      ...dto,
    });
  }

  @Get()
  @ApiContractResponse(SUPERMARKET_PATTERNS.list)
  list(
    @AuthUser() user: CurrentUser,
    @Query() query: CatalogListQueryDto
  ): Promise<SupermarketPage> {
    return this.nats.send<SupermarketPage>(SUPERMARKET_PATTERNS.list, {
      userId: user.userId,
      cursor: query.cursor,
      limit: query.limit,
      order: query.order,
    });
  }

  @Get(':id')
  @ApiContractResponse(SUPERMARKET_PATTERNS.get)
  get(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<SupermarketView> {
    return this.nats.send<SupermarketView>(SUPERMARKET_PATTERNS.get, {
      userId: user.userId,
      supermarketId: id,
    });
  }

  @Patch(':id')
  @ApiContractResponse(SUPERMARKET_PATTERNS.update)
  @ApiProblemResponses({ body: true })
  update(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: UpdateSupermarketDto
  ): Promise<SupermarketView> {
    return this.nats.send<SupermarketView>(SUPERMARKET_PATTERNS.update, {
      userId: user.userId,
      supermarketId: id,
      ...dto,
    });
  }

  @Delete(':id')
  @ApiContractResponse(SUPERMARKET_PATTERNS.delete)
  remove(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(SUPERMARKET_PATTERNS.delete, {
      userId: user.userId,
      supermarketId: id,
    });
  }

  @Post(':id/locations')
  @ApiContractResponse(SUPERMARKET_LOCATION_PATTERNS.create, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true })
  createLocation(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: CreateSupermarketLocationDto
  ): Promise<SupermarketLocationView> {
    return this.nats.send<SupermarketLocationView>(
      SUPERMARKET_LOCATION_PATTERNS.create,
      { userId: user.userId, supermarketId: id, ...dto }
    );
  }

  @Get(':id/locations')
  @ApiContractResponse(SUPERMARKET_LOCATION_PATTERNS.list)
  listLocations(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Query() query: CatalogListQueryDto
  ): Promise<SupermarketLocationPage> {
    return this.nats.send<SupermarketLocationPage>(
      SUPERMARKET_LOCATION_PATTERNS.list,
      {
        userId: user.userId,
        supermarketId: id,
        cursor: query.cursor,
        limit: query.limit,
      }
    );
  }
}

@ApiTags('catalog')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'catalog/locations', version: '1' })
export class CatalogLocationsController {
  constructor(private readonly nats: NatsClient) {}

  @Get(':id')
  @ApiContractResponse(SUPERMARKET_LOCATION_PATTERNS.get)
  get(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<SupermarketLocationView> {
    return this.nats.send<SupermarketLocationView>(
      SUPERMARKET_LOCATION_PATTERNS.get,
      { userId: user.userId, supermarketLocationId: id }
    );
  }

  @Patch(':id')
  @ApiContractResponse(SUPERMARKET_LOCATION_PATTERNS.update)
  @ApiProblemResponses({ body: true })
  update(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: UpdateSupermarketLocationDto
  ): Promise<SupermarketLocationView> {
    return this.nats.send<SupermarketLocationView>(
      SUPERMARKET_LOCATION_PATTERNS.update,
      { userId: user.userId, supermarketLocationId: id, ...dto }
    );
  }

  @Delete(':id')
  @ApiContractResponse(SUPERMARKET_LOCATION_PATTERNS.delete)
  remove(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(SUPERMARKET_LOCATION_PATTERNS.delete, {
      userId: user.userId,
      supermarketLocationId: id,
    });
  }

  @Get(':id/offers')
  @ApiContractResponse(SUPERMARKET_ITEM_PATTERNS.listByLocation)
  offers(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Query() query: CatalogListQueryDto
  ): Promise<SupermarketItemPage> {
    return this.nats.send<SupermarketItemPage>(
      SUPERMARKET_ITEM_PATTERNS.listByLocation,
      {
        userId: user.userId,
        supermarketLocationId: id,
        cursor: query.cursor,
        limit: query.limit,
      }
    );
  }
}

@ApiTags('catalog')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'catalog/items', version: '1' })
export class CatalogItemsController {
  constructor(
    private readonly nats: NatsClient,
    private readonly scopes: ScopeResolutionService
  ) {}

  @Post()
  @ApiContractResponse(ITEM_PATTERNS.create, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ body: true, conflict: true })
  create(
    @AuthUser() user: CurrentUser,
    @Body() dto: CreateItemDto
  ): Promise<ItemView> {
    return this.nats.send<ItemView>(ITEM_PATTERNS.create, {
      userId: user.userId,
      ...dto,
    });
  }

  /**
   * Ranked products (plan 0048, section 3), scoped to where the caller shops
   * (plan 0049, section 3).
   *
   * **Sending no selector no longer means everything.** The caller's default (or
   * named) profile is resolved for them, and a profile that holds neither a
   * postal code nor a chain is answered with `catalog_scope_required` rather
   * than with the whole catalog or with an empty page.
   */
  @Get()
  @ApiContractResponse(ITEM_PATTERNS.search)
  @ApiProblemResponses({ scopeRequired: true })
  async search(
    @AuthUser() user: CurrentUser,
    @Query() query: SearchItemsQueryDto
  ): Promise<ItemPage> {
    return this.nats.send<ItemPage>(ITEM_PATTERNS.search, {
      userId: user.userId,
      query: query.query,
      category: query.category,
      productGroupId: query.productGroupId,
      priceScopeIds: await this.scopes.forRead(
        user.userId,
        toScopeQuery(query)
      ),
      cursor: query.cursor,
      limit: query.limit,
      order: query.order,
    });
  }

  /**
   * Ranked **groups**, each with its cheapest member (plan 0048, section 3).
   *
   * The read that answers "milk" rather than "Pascual Milk". A group with no
   * priced member at the given scopes still comes back with its price fields
   * null, because the composer is attaching identity rather than quoting a price.
   */
  @Get('offers')
  @ApiContractResponse(ITEM_PATTERNS.searchOffers)
  @ApiProblemResponses({ scopeRequired: true })
  async searchOffers(
    @AuthUser() user: CurrentUser,
    @Query() query: SearchOffersQueryDto
  ): Promise<ProductGroupOfferPage> {
    return this.nats.send<ProductGroupOfferPage>(ITEM_PATTERNS.searchOffers, {
      userId: user.userId,
      query: query.query,
      priceScopeIds: await this.scopes.forRead(
        user.userId,
        toScopeQuery(query)
      ),
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  /**
   * One known product, **unscoped and deliberately so** (plan 0049, section 3).
   *
   * This is how a list line renders its product, and a line can reference an
   * item the user cannot currently buy anywhere near them. The item exists; its
   * price at your scopes may be absent; those are different answers, and gating
   * this read would collapse them into "no such product".
   */
  @Get(':id')
  @ApiContractResponse(ITEM_PATTERNS.get)
  get(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<ItemView> {
    return this.nats.send<ItemView>(ITEM_PATTERNS.get, {
      userId: user.userId,
      itemId: id,
    });
  }

  @Patch(':id')
  @ApiContractResponse(ITEM_PATTERNS.update)
  @ApiProblemResponses({ body: true })
  update(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: UpdateItemDto
  ): Promise<ItemView> {
    return this.nats.send<ItemView>(ITEM_PATTERNS.update, {
      userId: user.userId,
      itemId: id,
      ...dto,
    });
  }

  @Delete(':id')
  @ApiContractResponse(ITEM_PATTERNS.delete)
  remove(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(ITEM_PATTERNS.delete, {
      userId: user.userId,
      itemId: id,
    });
  }

  /**
   * Every price one known product has, across scopes.
   *
   * Unscoped for the same reason reading the product is (plan 0049, section 3):
   * the request already names the one thing it is about, so it cannot return the
   * catalog, and "what does this cost anywhere" is the question the price detail
   * of a line asks.
   */
  @Get(':id/offers')
  @ApiContractResponse(SUPERMARKET_ITEM_PATTERNS.listByItem)
  offers(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Query() query: CatalogListQueryDto
  ): Promise<SupermarketItemPage> {
    return this.nats.send<SupermarketItemPage>(
      SUPERMARKET_ITEM_PATTERNS.listByItem,
      {
        userId: user.userId,
        itemId: id,
        cursor: query.cursor,
        limit: query.limit,
      }
    );
  }
}

/**
 * Product groups (plan 0048, section 1): "milk as a thing you can buy".
 *
 * The ordinary catalog admin surface, because that is what curating one is.
 * Writes are platform admin gated inside the catalog service, reads are open to
 * any authenticated user, and **nothing here assigns items to groups**: an item
 * joins a group through `PATCH /v1/catalog/items/:id`, by a person.
 */
@ApiTags('catalog')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'catalog/product-groups', version: '1' })
export class CatalogProductGroupsController {
  constructor(
    private readonly nats: NatsClient,
    private readonly scopes: ScopeResolutionService
  ) {}

  @Post()
  @ApiContractResponse(PRODUCT_GROUP_PATTERNS.create, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true })
  create(
    @AuthUser() user: CurrentUser,
    @Body() dto: CreateProductGroupDto
  ): Promise<ProductGroupView> {
    return this.nats.send<ProductGroupView>(PRODUCT_GROUP_PATTERNS.create, {
      userId: user.userId,
      ...dto,
    });
  }

  @Get()
  @ApiContractResponse(PRODUCT_GROUP_PATTERNS.list)
  list(
    @AuthUser() user: CurrentUser,
    @Query() query: ListProductGroupsQueryDto
  ): Promise<ProductGroupPage> {
    return this.nats.send<ProductGroupPage>(PRODUCT_GROUP_PATTERNS.list, {
      userId: user.userId,
      query: query.query,
      cursor: query.cursor,
      limit: query.limit,
      order: query.order,
    });
  }

  @Get(':id')
  @ApiContractResponse(PRODUCT_GROUP_PATTERNS.get)
  get(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<ProductGroupView> {
    return this.nats.send<ProductGroupView>(PRODUCT_GROUP_PATTERNS.get, {
      userId: user.userId,
      productGroupId: id,
    });
  }

  @Patch(':id')
  @ApiContractResponse(PRODUCT_GROUP_PATTERNS.update)
  @ApiProblemResponses({ body: true, conflict: true })
  update(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductGroupDto
  ): Promise<ProductGroupView> {
    return this.nats.send<ProductGroupView>(PRODUCT_GROUP_PATTERNS.update, {
      userId: user.userId,
      productGroupId: id,
      ...dto,
    });
  }

  /**
   * Delete a group. Its members are kept and simply lose their group, which is
   * the catalog service's rule and the database's: undoing a curation decision
   * must not be blocked by the products it was about.
   */
  @Delete(':id')
  @ApiContractResponse(PRODUCT_GROUP_PATTERNS.delete)
  remove(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(PRODUCT_GROUP_PATTERNS.delete, {
      userId: user.userId,
      productGroupId: id,
    });
  }

  /**
   * The group's members, which is `item.search` with the group filter set, and
   * therefore scoped exactly as that read is (plan 0049, section 3).
   */
  @Get(':id/items')
  @ApiContractResponse(ITEM_PATTERNS.search)
  @ApiProblemResponses({ scopeRequired: true })
  async items(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Query() query: PriceScopedQueryDto
  ): Promise<ItemPage> {
    return this.nats.send<ItemPage>(ITEM_PATTERNS.search, {
      userId: user.userId,
      productGroupId: id,
      priceScopeIds: await this.scopes.forRead(
        user.userId,
        toScopeQuery(query)
      ),
      cursor: query.cursor,
      limit: query.limit,
      order: query.order,
    });
  }
}

/**
 * The list composer's one call (plan 0048, section 3).
 *
 * It performs the interleave itself, and that is the entire reason it exists as
 * an endpoint rather than as two calls a client makes: **a group beats an item
 * for a bare word**. velista `0043` section 6 states the rule from the client
 * side and backlog `0004` section 1.2 states it as a hard one, so the server is
 * where it is enforced, in one ordered array that a client cannot reassemble
 * wrongly.
 *
 * The two reads run in parallel and neither is allowed to take the other down:
 * a failure on one side answers with what the other found, because a dropdown
 * that shows fewer suggestions is a worse dropdown and a dropdown that shows an
 * error is a broken composer.
 */
@ApiTags('catalog')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'catalog/suggest', version: '1' })
export class CatalogSuggestController {
  constructor(
    private readonly nats: NatsClient,
    private readonly scopes: ScopeResolutionService
  ) {}

  @Get()
  @ApiOkResponse({
    description:
      'The dropdown, in the order it is to be drawn: every matching group first, then the individual products. One ordered array and not two lists, because the rule it carries is an ordering.',
    schema: componentRef(SUGGEST_SCHEMA),
  })
  @ApiProblemResponses({ scopeRequired: true })
  async suggest(
    @AuthUser() user: CurrentUser,
    @Query() query: SuggestQueryDto
  ): Promise<CatalogSuggestResponse> {
    // Resolved once and passed to both halves, so the two reads cannot quote
    // prices from different places, and so an empty profile refuses the whole
    // dropdown rather than half of it.
    const common = {
      userId: user.userId,
      query: query.q,
      priceScopeIds: await this.scopes.forRead(
        user.userId,
        toScopeQuery(query)
      ),
      limit: query.limit,
    };
    const [groups, items] = await Promise.all([
      this.nats
        .send<ProductGroupOfferPage>(ITEM_PATTERNS.searchOffers, common)
        .catch(
          () => ({ items: [], nextCursor: null }) as ProductGroupOfferPage
        ),
      this.nats
        .send<ItemPage>(ITEM_PATTERNS.search, common)
        .catch(() => ({ items: [], nextCursor: null }) as ItemPage),
    ]);

    return {
      suggestions: [
        ...groups.items.map((group) => ({
          kind: 'group' as const,
          group,
          item: null,
        })),
        ...items.items.map((item) => ({
          kind: 'item' as const,
          group: null,
          item,
        })),
      ],
    };
  }
}

/**
 * Where the caller is shopping, and why (plan 0049, sections 3.1 and 5).
 *
 * It exists because the flags have to reach a client and a page cannot carry
 * them: every catalog page is bare by house rule, and wrapping `ItemPage` to
 * hang two booleans off it would change the shape of every catalog read. So the
 * resolution is described once, here, beside the searches it explains.
 *
 * Three things a client can only learn from it:
 *
 * - **which scopes** its results came from, and by which rung of the ladder, so
 *   it can say "prices shown for Madrid" when `approximate` is set;
 * - **which postal codes nobody serves**, which is what turns an empty search
 *   into "no chain we know reaches 12345" rather than "there is nothing";
 * - **which profile** answered, when the caller named none.
 *
 * It resolves exactly as a search does and shares its cache, so calling both is
 * one resolution and not two.
 */
@ApiTags('catalog')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'catalog/scope', version: '1' })
export class CatalogScopeController {
  constructor(private readonly scopes: ScopeResolutionService) {}

  @Get()
  @ApiOkResponse({
    description:
      'The scopes this caller shops at, the reason for each, and whether every postal code they gave is served by anybody we know.',
    schema: componentRef(SCOPE_SCHEMA),
  })
  @ApiProblemResponses({ scopeRequired: true })
  describe(
    @AuthUser() user: CurrentUser,
    @Query() query: PriceScopedQueryDto
  ): Promise<CatalogScopeView> {
    return this.scopes.describe(user.userId, toScopeQuery(query));
  }
}

/**
 * Prices, keyed on a **price scope** since plan 0038 (section 5.2).
 *
 * **This controller is `v2`, and that is required rather than tidy.**
 * `SupermarketItemView` lost `supermarketLocationId` and `positionInStore`, which
 * is a breaking wire change, so it takes a version bump under plan 0004's per
 * controller versioning. Controllers version independently, so nothing else in
 * the catalog surface moved.
 *
 * Where the two fields went: the price now belongs to a scope, and what is
 * genuinely per store lives on {@link CatalogLocationItemsController}.
 */
@ApiTags('catalog')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'catalog/supermarket-items', version: '2' })
export class CatalogSupermarketItemsController {
  constructor(private readonly nats: NatsClient) {}

  @Put()
  @ApiContractResponse(SUPERMARKET_ITEM_PATTERNS.upsert)
  @ApiProblemResponses({ body: true, conflict: true })
  upsert(
    @AuthUser() user: CurrentUser,
    @Body() dto: UpsertSupermarketItemDto
  ): Promise<SupermarketItemView> {
    return this.nats.send<SupermarketItemView>(
      SUPERMARKET_ITEM_PATTERNS.upsert,
      { userId: user.userId, ...dto }
    );
  }

  @Get()
  @ApiContractResponse(SUPERMARKET_ITEM_PATTERNS.get)
  get(
    @AuthUser() user: CurrentUser,
    @Query('itemId') itemId: string,
    @Query('priceScopeId') priceScopeId: string
  ): Promise<SupermarketItemView> {
    return this.nats.send<SupermarketItemView>(SUPERMARKET_ITEM_PATTERNS.get, {
      userId: user.userId,
      itemId,
      priceScopeId,
    });
  }

  @Delete(':id')
  @ApiContractResponse(SUPERMARKET_ITEM_PATTERNS.delete)
  remove(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(SUPERMARKET_ITEM_PATTERNS.delete, {
      userId: user.userId,
      supermarketItemId: id,
    });
  }
}

/**
 * Price scopes (plan 0038, section 5.1). Platform admin gated inside catalog,
 * like every other catalog write.
 */
@ApiTags('catalog')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'catalog/price-scopes', version: '1' })
export class CatalogPriceScopesController {
  constructor(private readonly nats: NatsClient) {}

  @Post()
  @ApiContractResponse(PRICE_SCOPE_PATTERNS.create, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true })
  create(
    @AuthUser() user: CurrentUser,
    @Body() dto: CreatePriceScopeDto
  ): Promise<PriceScopeView> {
    return this.nats.send<PriceScopeView>(PRICE_SCOPE_PATTERNS.create, {
      userId: user.userId,
      ...dto,
    });
  }

  @Get()
  @ApiContractResponse(PRICE_SCOPE_PATTERNS.list)
  list(
    @AuthUser() user: CurrentUser,
    @Query() query: CatalogListQueryDto,
    @Query('supermarketId') supermarketId?: string
  ): Promise<PriceScopePage> {
    return this.nats.send<PriceScopePage>(PRICE_SCOPE_PATTERNS.list, {
      userId: user.userId,
      supermarketId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Patch(':id')
  @ApiContractResponse(PRICE_SCOPE_PATTERNS.update)
  @ApiProblemResponses({ body: true })
  update(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: UpdatePriceScopeDto
  ): Promise<PriceScopeView> {
    return this.nats.send<PriceScopeView>(PRICE_SCOPE_PATTERNS.update, {
      userId: user.userId,
      priceScopeId: id,
      ...dto,
    });
  }

  @Delete(':id')
  @ApiContractResponse(PRICE_SCOPE_PATTERNS.delete)
  @ApiProblemResponses({ conflict: true })
  remove(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(PRICE_SCOPE_PATTERNS.delete, {
      userId: user.userId,
      priceScopeId: id,
    });
  }

  @Get(':id/offers')
  @ApiContractResponse(SUPERMARKET_ITEM_PATTERNS.listByScope)
  offers(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Query() query: CatalogListQueryDto
  ): Promise<SupermarketItemPage> {
    return this.nats.send<SupermarketItemPage>(
      SUPERMARKET_ITEM_PATTERNS.listByScope,
      {
        userId: user.userId,
        priceScopeId: id,
        cursor: query.cursor,
        limit: query.limit,
      }
    );
  }
}

/**
 * Where a product sits in one particular shop (plan 0038, section 5.2).
 *
 * It has its own surface because the price moving to the scope would otherwise
 * have left `positionInStore` unreachable: it left `SupermarketItem` and nothing
 * else could set it. A warehouse cannot answer which aisle a product is in, so
 * the question needed somewhere to live rather than nowhere.
 */
@ApiTags('catalog')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'catalog/location-items', version: '1' })
export class CatalogLocationItemsController {
  constructor(private readonly nats: NatsClient) {}

  @Put()
  @ApiContractResponse(SUPERMARKET_LOCATION_ITEM_PATTERNS.upsert)
  @ApiProblemResponses({ body: true })
  upsert(
    @AuthUser() user: CurrentUser,
    @Body() dto: UpsertSupermarketLocationItemDto
  ): Promise<SupermarketLocationItemView> {
    return this.nats.send<SupermarketLocationItemView>(
      SUPERMARKET_LOCATION_ITEM_PATTERNS.upsert,
      { userId: user.userId, ...dto }
    );
  }

  @Get()
  @ApiContractResponse(SUPERMARKET_LOCATION_ITEM_PATTERNS.get)
  get(
    @AuthUser() user: CurrentUser,
    @Query('itemId') itemId: string,
    @Query('supermarketLocationId') supermarketLocationId: string
  ): Promise<SupermarketLocationItemView> {
    return this.nats.send<SupermarketLocationItemView>(
      SUPERMARKET_LOCATION_ITEM_PATTERNS.get,
      { userId: user.userId, itemId, supermarketLocationId }
    );
  }
}
