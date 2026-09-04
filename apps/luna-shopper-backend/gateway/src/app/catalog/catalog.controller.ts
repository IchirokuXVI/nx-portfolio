import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
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
  type GetItemsRequest,
  type GetItemsResult,
  type ItemPage,
  type ItemView,
  type PriceScopePage,
  type ProductGroupOfferPage,
  type ProductGroupPage,
  type ProductGroupView,
  type ShopChainSummariesView,
  type ShopPage,
  type SupermarketItemPage,
  type SupermarketItemView,
  type SupermarketLocationChainSummariesView,
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
  ListPriceScopesQueryDto,
  ListProductGroupsQueryDto,
  LookupItemsDto,
  PriceScopedQueryDto,
  SearchItemsQueryDto,
  SearchOffersQueryDto,
  SearchShopsQueryDto,
  ShopQueryDto,
  SuggestQueryDto,
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
export const SUGGEST_SCHEMA = hoistContractSchema(
  CATALOG_SCHEMA_IDS.catalogSuggestResponse
);

/**
 * The ladder's outcome, for the one endpoint that describes it rather than uses
 * it (plan 0049, sections 3.1 and 5).
 */
const SCOPE_SCHEMA = hoistContractSchema(CATALOG_SCHEMA_IDS.catalogScopeView);

/**
 * The franchise buttons (plan 0068, section 3.1). Hoisted like the two above it
 * because the row is assembled here, from catalog's counts and core's refusals,
 * so no broker subject answers with it.
 */
const SHOP_SUMMARY_SCHEMA = hoistContractSchema(
  CATALOG_SCHEMA_IDS.shopChainSummariesView
);

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
 * NATS. Every route requires a valid velista access token.
 *
 * **Reads only, since plan 0073.** The writes that used to sit beside them moved
 * to `/v1/admin/catalog/**` and `AdminJwtGuard`, because an operator and a user
 * are different principals verified against different keys and a URL is the unit
 * that carries a guard. What stayed is what velista calls, and the split was by
 * **who may call it** rather than by HTTP verb: `POST items/lookup` is here, and
 * belongs here, because it is a read that takes a body of ids.
 *
 * Adding a write to this file is the mistake the split exists to prevent. It
 * would be reachable with any user's token, and catalog would refuse it with a
 * 403 that looks like a bug rather than like a boundary.
 */
@ApiTags('catalog')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'catalog/supermarkets', version: '1' })
export class CatalogSupermarketsController {
  constructor(
    private readonly nats: NatsClient,
    private readonly scopes: ScopeResolutionService
  ) {}

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

  /**
   * Every shop of one chain, nationwide, newest first.
   *
   * **It applies nobody's refusals.** The shopper's read of the same table is
   * `GET /v1/catalog/shops` (plan 0068), which is narrowed to the caller's
   * postal codes and knows what they have switched off; this one answers "where
   * does this chain have shops", which is the same answer for everybody.
   *
   * The operator's version of it is `GET /v1/admin/catalog/supermarkets/:id/locations`,
   * which is this read plus the `postalCodeSource` filter. Both exist because the
   * question is legitimate for a shopper and the review filter is not.
   */
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

/**
 * The shops in the caller's postal codes (plan 0068), which is what
 * `apps/velista/plans/0059` draws.
 *
 * **`shops` rather than `locations`, and the word is doing work.**
 * {@link CatalogLocationsController} is the owner surface for one location by
 * id: it is administered, one row at a time, by the app owner. This is the same
 * table browsed, by a shopper, keyed on the one axis a shopper has, which is
 * where they are. Distance is deliberately not that axis (plan 0068, section
 * 3.3): a profile can hold Córdoba and Madrid, so there is no single centre to
 * sort by, and the postal code is the one thing both services already agree on.
 *
 * Both routes resolve and pass, like every priced read since plan 0049: core
 * says what the caller wants, catalog says what that means, and the gateway is
 * the only place that holds both.
 */
@ApiTags('catalog')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'catalog/shops', version: '1' })
export class CatalogShopsController {
  constructor(
    private readonly nats: NatsClient,
    private readonly scopes: ScopeResolutionService
  ) {}

  /**
   * One row per chain with a shop in the caller's codes (plan 0068, section
   * 3.1): the franchise buttons, ready to draw.
   *
   * The row's three states come from two services. Catalog counts, because only
   * catalog knows which shop belongs to which chain; core says which chains the
   * caller refused outright, which is a statement about the brand that covers
   * shops it has not opened yet; and this method is where they meet.
   */
  @Get('summary')
  @ApiOkResponse({
    description:
      'Every chain with at least one shop in your postal codes: how many it has there, how many of those you have refused, and whether you have refused the chain itself.',
    schema: componentRef(SHOP_SUMMARY_SCHEMA),
  })
  async summary(
    @AuthUser() user: CurrentUser,
    @Query() query: ShopQueryDto
  ): Promise<ShopChainSummariesView> {
    const selection = await this.scopes.forShops(user.userId, {
      postalCodes: query.postalCode,
      profileId: query.profileId,
    });
    const summaries =
      await this.nats.send<SupermarketLocationChainSummariesView>(
        SUPERMARKET_LOCATION_PATTERNS.summarizeByChain,
        {
          userId: user.userId,
          postalCodes: selection.postalCodes,
          excludedSupermarketIds: selection.excludedSupermarketIds,
          excludedSupermarketLocationIds:
            selection.excludedSupermarketLocationIds,
          includeExcluded: query.includeExcluded ?? false,
        }
      );

    const refusedChains = new Set(selection.excludedSupermarketIds);
    return {
      chains: summaries.chains.map((chain) => ({
        ...chain,
        excludedChain: refusedChains.has(chain.supermarketId),
      })),
    };
  }

  /**
   * The shops themselves (plan 0068, section 3.2): a franchise's, or a typed
   * word's across all of them.
   *
   * A page rather than the whole set, unlike the summary above: a dense city
   * holds hundreds of shops in a profile's codes and the screen scrolls them.
   */
  @Get()
  @ApiContractResponse(SUPERMARKET_LOCATION_PATTERNS.search)
  async search(
    @AuthUser() user: CurrentUser,
    @Query() query: SearchShopsQueryDto
  ): Promise<ShopPage> {
    const selection = await this.scopes.forShops(user.userId, {
      postalCodes: query.postalCode,
      profileId: query.profileId,
    });
    return this.nats.send<ShopPage>(SUPERMARKET_LOCATION_PATTERNS.search, {
      userId: user.userId,
      postalCodes: selection.postalCodes,
      supermarketId: query.supermarketId,
      query: query.query,
      includeExcluded: query.includeExcluded ?? false,
      excludedSupermarketIds: selection.excludedSupermarketIds,
      excludedSupermarketLocationIds: selection.excludedSupermarketLocationIds,
      cursor: query.cursor,
      limit: query.limit,
    });
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

  /**
   * Ranked products (plan 0048, section 3), scoped to where the caller shops
   * (plan 0049, section 3).
   *
   * **Sending no selector resolves the caller's profile**, default or named,
   * rather than meaning everything. A profile that holds neither a postal code
   * nor a chain resolves to no scopes, and the page comes back ranked with every
   * price field null (plan 0069, section 2): the catalog is readable whether or
   * not anything can be priced. `GET /v1/catalog/scope` is where a client learns
   * which of the three priceless states it is in.
   */
  @Get()
  @ApiContractResponse(ITEM_PATTERNS.search)
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
   * Several known products, in one round trip (plan 0053, section 1).
   *
   * A line carries a **set** of products (`0048`'s `itemSetHash` hashes that
   * set), so resolving one line's names through `GET :id` is one request per
   * product from a sheet that opens on a tap. That is what velista shipped a
   * fixture instead of, and what this exists to replace.
   *
   * Three things about its shape:
   *
   * - **Unknown ids are omitted, not an error.** A line can outlive a product. A
   *   sheet that fails to open because one of five products was withdrawn is a
   *   worse failure than a sheet that names four, so the caller matches the
   *   answer back by id and draws what it got.
   * - **Unscoped**, exactly as reading one product is: a line may reference an
   *   item nobody near the caller sells, and the product existing and the price
   *   being absent are different answers.
   * - **`POST` for a read**, which is the one uncomfortable thing here and is
   *   forced by the cap. Five hundred UUIDs is roughly eighteen kilobytes of
   *   query string, comfortably past Node's sixteen kilobyte header limit, so a
   *   `GET` carrying repeated `id` parameters would answer 431 at exactly the
   *   size the contract says is allowed. The ids go in the body instead.
   *
   * It therefore answers **201**, like every other POST in this gateway, and
   * nothing is created. 200 would read better, and so would it on
   * `POST /v1/assistant`; the whole surface follows Nest's default statuses with
   * no `@HttpCode` anywhere and `openapi-document.spec.ts` enforces that as a
   * house rule, so breaking it here to be tidier would cost a red test and a
   * precedent.
   *
   * Account authenticated, and **not** the guest path. A basket's composition
   * stays inside the participant authenticated surface where velista `0044` put
   * it: a guest reaching a general catalog route is a wider hole than a guest
   * reading the names in the basket they were invited to.
   */
  @Post('lookup')
  @ApiContractResponse(ITEM_PATTERNS.getMany, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ body: true })
  lookup(@Body() dto: LookupItemsDto): Promise<GetItemsResult> {
    const req: GetItemsRequest = { ids: dto.ids };
    return this.nats.send<GetItemsResult>(ITEM_PATTERNS.getMany, req);
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

  /**
   * The group's members, which is `item.search` with the group filter set, and
   * therefore scoped exactly as that read is (plan 0049, section 3).
   */
  @Get(':id/items')
  @ApiContractResponse(ITEM_PATTERNS.search)
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
  async suggest(
    @AuthUser() user: CurrentUser,
    @Query() query: SuggestQueryDto
  ): Promise<CatalogSuggestResponse> {
    // Resolved once and passed to both halves, so the two reads cannot quote
    // prices from different places, and so a caller with no scopes gets one
    // priceless dropdown rather than half a priced one.
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
 * - **which postal codes nobody serves**, which is what turns a page of unpriced
 *   products into "no chain we know reaches 12345" rather than "there is
 *   nothing";
 * - **which profile** answered, when the caller named none.
 *
 * Since plan 0069 it is also the only place the three priceless states are told
 * apart, and it cannot fail: no scopes with no `coverage` is a caller who has
 * said nothing, no scopes with `coverage` rows all unserved is an area we do not
 * know yet, and no scopes with a served row is a caller who has refused
 * everywhere they could shop. No error code could ever have expressed the third.
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

  @Get()
  @ApiContractResponse(PRICE_SCOPE_PATTERNS.list)
  list(
    @AuthUser() user: CurrentUser,
    @Query() query: ListPriceScopesQueryDto
  ): Promise<PriceScopePage> {
    return this.nats.send<PriceScopePage>(PRICE_SCOPE_PATTERNS.list, {
      userId: user.userId,
      supermarketId: query.supermarketId,
      cursor: query.cursor,
      limit: query.limit,
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
