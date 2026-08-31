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
  constructor(private readonly nats: NatsClient) {}

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
   * Ranked products (plan 0048, section 3), and a plain listing when no query is
   * given, which is what the admin surface uses it as.
   *
   * `priceScopeId` is repeatable and optional. Sending none quotes no prices and
   * is not an error: resolving a default from the caller's shopping profile is
   * plan 0049's job, and until then the search degrades exactly the way the
   * composer wants it to.
   */
  @Get()
  @ApiContractResponse(ITEM_PATTERNS.search)
  search(
    @AuthUser() user: CurrentUser,
    @Query() query: SearchItemsQueryDto
  ): Promise<ItemPage> {
    return this.nats.send<ItemPage>(ITEM_PATTERNS.search, {
      userId: user.userId,
      query: query.query,
      category: query.category,
      productGroupId: query.productGroupId,
      priceScopeIds: query.priceScopeId,
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
  searchOffers(
    @AuthUser() user: CurrentUser,
    @Query() query: SearchOffersQueryDto
  ): Promise<ProductGroupOfferPage> {
    return this.nats.send<ProductGroupOfferPage>(ITEM_PATTERNS.searchOffers, {
      userId: user.userId,
      query: query.query,
      priceScopeIds: query.priceScopeId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

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
  constructor(private readonly nats: NatsClient) {}

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

  /** The group's members, which is `item.search` with the group filter set. */
  @Get(':id/items')
  @ApiContractResponse(ITEM_PATTERNS.search)
  items(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Query() query: PriceScopedQueryDto
  ): Promise<ItemPage> {
    return this.nats.send<ItemPage>(ITEM_PATTERNS.search, {
      userId: user.userId,
      productGroupId: id,
      priceScopeIds: query.priceScopeId,
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
  constructor(private readonly nats: NatsClient) {}

  @Get()
  @ApiOkResponse({
    description:
      'The dropdown, in the order it is to be drawn: every matching group first, then the individual products. One ordered array and not two lists, because the rule it carries is an ordering.',
    schema: componentRef(SUGGEST_SCHEMA),
  })
  async suggest(
    @AuthUser() user: CurrentUser,
    @Query() query: SuggestQueryDto
  ): Promise<CatalogSuggestResponse> {
    const common = {
      userId: user.userId,
      query: query.q,
      priceScopeIds: query.priceScopeId,
      limit: query.limit,
    };
    const [groups, items] = await Promise.all([
      this.nats
        .send<ProductGroupOfferPage>(ITEM_PATTERNS.searchOffers, common)
        .catch(() => ({ items: [], nextCursor: null }) as ProductGroupOfferPage),
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
