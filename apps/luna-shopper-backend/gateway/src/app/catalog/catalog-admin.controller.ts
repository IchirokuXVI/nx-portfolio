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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ITEM_PATTERNS,
  PRICE_SCOPE_PATTERNS,
  PRODUCT_GROUP_PATTERNS,
  SUPERMARKET_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  SUPERMARKET_PATTERNS,
  type ItemPage,
  type ItemView,
  type PriceScopePage,
  type PriceScopeView,
  type ProductGroupPage,
  type ProductGroupView,
  type SupermarketItemPage,
  type SupermarketItemView,
  type SupermarketLocationItemPage,
  type SupermarketLocationItemView,
  type SupermarketLocationPage,
  type SupermarketLocationView,
  type SupermarketPage,
  type SupermarketView,
} from '@portfolio/luna-shopper/contracts';
import { adminCredential } from '../admin/admin-credential';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import type { CurrentAdmin } from '../admin/admin-jwt.strategy';
import { ActingAdmin } from '../admin/current-admin.decorator';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import {
  AdminListLocationItemsQueryDto,
  AdminListLocationsQueryDto,
  AdminListSupermarketItemsQueryDto,
  AdminSearchItemsQueryDto,
} from './catalog-admin.dto';
import {
  CatalogListQueryDto,
  CreateItemDto,
  CreatePriceScopeDto,
  CreateProductGroupDto,
  CreateSupermarketDto,
  CreateSupermarketLocationDto,
  ListPriceScopesQueryDto,
  ListProductGroupsQueryDto,
  UpdateItemDto,
  UpdatePriceScopeDto,
  UpdateProductGroupDto,
  UpdateSupermarketDto,
  UpdateSupermarketLocationDto,
  UpsertSupermarketItemDto,
  UpsertSupermarketLocationItemDto,
} from './catalog.dto';

/**
 * The back office's catalog surface (plan 0073), under `/v1/admin/catalog/**`
 * and guarded by {@link AdminJwtGuard}.
 *
 * **Why these routes are not simply the catalog routes with a second guard.** A
 * URL is the unit that carries `@UseGuards`, and since plan 0071 an operator and
 * a velista user are different principals verified against different keys. A
 * route cannot ask for either, so a differently guarded thing needs a different
 * URL. That is the whole rule, and section 2 of the plan is the one awkward case
 * it produces: catalog's controllers were mixed, so they were **split** rather
 * than moved. Every read velista uses stays exactly where it was, including
 * `POST /v1/catalog/items/lookup`, which is a read that happens to be a POST.
 *
 * What lives here:
 *
 * - **The eighteen writes** of section 3, moved verbatim. Same handler, same
 *   NATS subject, same service; only the path and the guard changed.
 * - **The reads the back office needs**, which are new and are deliberately not
 *   the open ones (section 4). A shopper's read is scoped to their profile and
 *   postal codes and ranked for buying, and for an operator that is not merely
 *   unhelpful but wrong: a product sold nowhere near them would look unpriced.
 *   These are unscoped, ordered for administration, and filterable on the things
 *   an operator looks for.
 *
 * Every handler takes {@link ActingAdmin} rather than `AuthUser`, and forwards
 * the operator's token with {@link adminCredential}. Catalog verifies that token
 * again for itself (plan 0072, section 3), so a route added here without a guard
 * still cannot write anything.
 */
@ApiTags('admin-catalog')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
// `membership` is the option that documents 403 beside 404. The refusal here is
// the platform admin gate rather than a zone membership, but the statuses and
// the envelope are the same, and `admin-harvest` already reads this way.
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/catalog/supermarkets', version: '1' })
export class AdminCatalogSupermarketsController {
  constructor(private readonly nats: NatsClient) {}

  @Post()
  @ApiContractResponse(SUPERMARKET_PATTERNS.create, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true })
  create(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: CreateSupermarketDto
  ): Promise<SupermarketView> {
    return this.nats.send<SupermarketView>(SUPERMARKET_PATTERNS.create, {
      ...adminCredential(admin),
      ...dto,
    });
  }

  /**
   * Every chain. The same subject the open read calls, because a chain listing
   * was never scoped to anybody: it is reference data, and the two callers want
   * the identical answer.
   */
  @Get()
  @ApiContractResponse(SUPERMARKET_PATTERNS.list)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: CatalogListQueryDto
  ): Promise<SupermarketPage> {
    return this.nats.send<SupermarketPage>(SUPERMARKET_PATTERNS.list, {
      userId: admin.adminId,
      cursor: query.cursor,
      limit: query.limit,
      order: query.order,
    });
  }

  @Get(':id')
  @ApiContractResponse(SUPERMARKET_PATTERNS.get)
  get(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<SupermarketView> {
    return this.nats.send<SupermarketView>(SUPERMARKET_PATTERNS.get, {
      userId: admin.adminId,
      supermarketId: id,
    });
  }

  @Patch(':id')
  @ApiContractResponse(SUPERMARKET_PATTERNS.update)
  @ApiProblemResponses({ body: true })
  update(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Body() dto: UpdateSupermarketDto
  ): Promise<SupermarketView> {
    return this.nats.send<SupermarketView>(SUPERMARKET_PATTERNS.update, {
      ...adminCredential(admin),
      supermarketId: id,
      ...dto,
    });
  }

  @Delete(':id')
  @ApiContractResponse(SUPERMARKET_PATTERNS.delete)
  remove(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(SUPERMARKET_PATTERNS.delete, {
      ...adminCredential(admin),
      supermarketId: id,
    });
  }

  @Post(':id/locations')
  @ApiContractResponse(SUPERMARKET_LOCATION_PATTERNS.create, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true })
  createLocation(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Body() dto: CreateSupermarketLocationDto
  ): Promise<SupermarketLocationView> {
    return this.nats.send<SupermarketLocationView>(
      SUPERMARKET_LOCATION_PATTERNS.create,
      { ...adminCredential(admin), supermarketId: id, ...dto }
    );
  }

  /**
   * One chain's shops, with the review filter of `apps/luna-shopper-admin/plans/0005`
   * section 3: `postalCodeSource=DERIVED` lists the addresses whose postal code
   * was guessed from the nearest centroid rather than known.
   *
   * A shop with no postal code at all is a **third** state and matches no value
   * of the filter, because a wrong postcode is worse than none and the two are
   * not the same problem to review.
   */
  @Get(':id/locations')
  @ApiContractResponse(SUPERMARKET_LOCATION_PATTERNS.list)
  listLocations(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Query() query: AdminListLocationsQueryDto
  ): Promise<SupermarketLocationPage> {
    return this.nats.send<SupermarketLocationPage>(
      SUPERMARKET_LOCATION_PATTERNS.list,
      {
        userId: admin.adminId,
        supermarketId: id,
        priceScopeId: query.priceScopeId,
        postalCodeSource: query.postalCodeSource,
        cursor: query.cursor,
        limit: query.limit,
      }
    );
  }
}

@ApiTags('admin-catalog')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/catalog/locations', version: '1' })
export class AdminCatalogLocationsController {
  constructor(private readonly nats: NatsClient) {}

  @Get(':id')
  @ApiContractResponse(SUPERMARKET_LOCATION_PATTERNS.get)
  get(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<SupermarketLocationView> {
    return this.nats.send<SupermarketLocationView>(
      SUPERMARKET_LOCATION_PATTERNS.get,
      { userId: admin.adminId, supermarketLocationId: id }
    );
  }

  /**
   * **Editing a postal code does not move the shop's price scope**, which the
   * entity says and which is a real trap: an operator correcting an address may
   * reasonably expect the pricing to follow, and it does not.
   */
  @Patch(':id')
  @ApiContractResponse(SUPERMARKET_LOCATION_PATTERNS.update)
  @ApiProblemResponses({ body: true })
  update(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Body() dto: UpdateSupermarketLocationDto
  ): Promise<SupermarketLocationView> {
    return this.nats.send<SupermarketLocationView>(
      SUPERMARKET_LOCATION_PATTERNS.update,
      { ...adminCredential(admin), supermarketLocationId: id, ...dto }
    );
  }

  @Delete(':id')
  @ApiContractResponse(SUPERMARKET_LOCATION_PATTERNS.delete)
  remove(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(SUPERMARKET_LOCATION_PATTERNS.delete, {
      ...adminCredential(admin),
      supermarketLocationId: id,
    });
  }
}

@ApiTags('admin-catalog')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/catalog/items', version: '1' })
export class AdminCatalogItemsController {
  constructor(private readonly nats: NatsClient) {}

  @Post()
  @ApiContractResponse(ITEM_PATTERNS.create, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ body: true, conflict: true })
  create(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: CreateItemDto
  ): Promise<ItemView> {
    return this.nats.send<ItemView>(ITEM_PATTERNS.create, {
      ...adminCredential(admin),
      ...dto,
    });
  }

  /**
   * The product table, unscoped (plan 0073, section 4).
   *
   * **It names no price scopes, so every price field comes back null**, and that
   * is the honest answer rather than a gap: an operator has no postal code and
   * no profile, so there is no set of scopes that is theirs, and inventing one
   * would price the catalog from somewhere arbitrary. What a product costs is
   * `GET /v2/admin/catalog/supermarket-items`, which lists prices as prices and
   * says which scope each belongs to.
   *
   * `withoutProductGroup` is the filter with no user facing counterpart: an
   * ungrouped product is invisible to every "show me milk" read, so this is how
   * the ones curation has not reached are found.
   */
  @Get()
  @ApiContractResponse(ITEM_PATTERNS.search)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: AdminSearchItemsQueryDto
  ): Promise<ItemPage> {
    return this.nats.send<ItemPage>(ITEM_PATTERNS.search, {
      userId: admin.adminId,
      query: query.query,
      category: query.category,
      productGroupId: query.productGroupId,
      withoutProductGroup: query.withoutProductGroup,
      cursor: query.cursor,
      limit: query.limit,
      order: query.order,
    });
  }

  @Get(':id')
  @ApiContractResponse(ITEM_PATTERNS.get)
  get(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<ItemView> {
    return this.nats.send<ItemView>(ITEM_PATTERNS.get, {
      userId: admin.adminId,
      itemId: id,
    });
  }

  /** The only place an item joins a product group, and it is a person doing it. */
  @Patch(':id')
  @ApiContractResponse(ITEM_PATTERNS.update)
  @ApiProblemResponses({ body: true })
  update(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Body() dto: UpdateItemDto
  ): Promise<ItemView> {
    return this.nats.send<ItemView>(ITEM_PATTERNS.update, {
      ...adminCredential(admin),
      itemId: id,
      ...dto,
    });
  }

  @Delete(':id')
  @ApiContractResponse(ITEM_PATTERNS.delete)
  remove(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(ITEM_PATTERNS.delete, {
      ...adminCredential(admin),
      itemId: id,
    });
  }
}

@ApiTags('admin-catalog')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/catalog/product-groups', version: '1' })
export class AdminCatalogProductGroupsController {
  constructor(private readonly nats: NatsClient) {}

  @Post()
  @ApiContractResponse(PRODUCT_GROUP_PATTERNS.create, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true })
  create(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: CreateProductGroupDto
  ): Promise<ProductGroupView> {
    return this.nats.send<ProductGroupView>(PRODUCT_GROUP_PATTERNS.create, {
      ...adminCredential(admin),
      ...dto,
    });
  }

  @Get()
  @ApiContractResponse(PRODUCT_GROUP_PATTERNS.list)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: ListProductGroupsQueryDto
  ): Promise<ProductGroupPage> {
    return this.nats.send<ProductGroupPage>(PRODUCT_GROUP_PATTERNS.list, {
      userId: admin.adminId,
      query: query.query,
      cursor: query.cursor,
      limit: query.limit,
      order: query.order,
    });
  }

  @Get(':id')
  @ApiContractResponse(PRODUCT_GROUP_PATTERNS.get)
  get(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<ProductGroupView> {
    return this.nats.send<ProductGroupView>(PRODUCT_GROUP_PATTERNS.get, {
      userId: admin.adminId,
      productGroupId: id,
    });
  }

  @Patch(':id')
  @ApiContractResponse(PRODUCT_GROUP_PATTERNS.update)
  @ApiProblemResponses({ body: true, conflict: true })
  update(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Body() dto: UpdateProductGroupDto
  ): Promise<ProductGroupView> {
    return this.nats.send<ProductGroupView>(PRODUCT_GROUP_PATTERNS.update, {
      ...adminCredential(admin),
      productGroupId: id,
      ...dto,
    });
  }

  /**
   * Delete a group. Its members are kept and simply lose their group: undoing a
   * curation decision must not be blocked by the products it was about.
   */
  @Delete(':id')
  @ApiContractResponse(PRODUCT_GROUP_PATTERNS.delete)
  remove(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(PRODUCT_GROUP_PATTERNS.delete, {
      ...adminCredential(admin),
      productGroupId: id,
    });
  }
}

/**
 * Prices, and the screen `apps/luna-shopper-admin/plans/0005` section 4 is about.
 *
 * **`v2`, and the version did not move with the path.** It says what shape the
 * payload has, which is unrelated to who may send it, so bumping it here would
 * claim a change that did not happen.
 *
 * A price belongs to a **scope**, not to a shop: `SupermarketItem` is keyed on
 * `(itemId, priceScopeId)`, and twelve stores served by one warehouse share one
 * row. Anything rendering these rows has to say so, or an operator correcting a
 * price they saw in one shop silently changes it for eleven others.
 */
@ApiTags('admin-catalog')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/catalog/supermarket-items', version: '2' })
export class AdminCatalogSupermarketItemsController {
  constructor(private readonly nats: NatsClient) {}

  /**
   * Write one price by hand. **This pins the row**: it sets `priceSourceKind` to
   * `ADMIN`, and plan 0038 section 6.5 then stops every automated fetch from
   * overwriting it, with no queue anywhere surfacing the disagreement. Listing
   * `priceSourceKind=ADMIN` below is how a pin is found again.
   */
  @Put()
  @ApiContractResponse(SUPERMARKET_ITEM_PATTERNS.upsert)
  @ApiProblemResponses({ body: true, conflict: true })
  upsert(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: UpsertSupermarketItemDto
  ): Promise<SupermarketItemView> {
    return this.nats.send<SupermarketItemView>(
      SUPERMARKET_ITEM_PATTERNS.upsert,
      { ...adminCredential(admin), ...dto }
    );
  }

  /**
   * The price table, filterable and starting from nothing.
   *
   * The catalog's three other price lists each begin with something the caller
   * already named, a product or a shop or a scope, because that is what a shopper
   * has. This one begins with nothing, which is what makes "which prices did I
   * type in" answerable, and it is gated for that reason rather than for what it
   * changes.
   */
  @Get()
  @ApiContractResponse(SUPERMARKET_ITEM_PATTERNS.adminList)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: AdminListSupermarketItemsQueryDto
  ): Promise<SupermarketItemPage> {
    return this.nats.send<SupermarketItemPage>(
      SUPERMARKET_ITEM_PATTERNS.adminList,
      {
        ...adminCredential(admin),
        itemId: query.itemId,
        priceScopeId: query.priceScopeId,
        priceSourceKind: query.priceSourceKind,
        available: query.available,
        cursor: query.cursor,
        limit: query.limit,
      }
    );
  }

  @Delete(':id')
  @ApiContractResponse(SUPERMARKET_ITEM_PATTERNS.delete)
  remove(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(SUPERMARKET_ITEM_PATTERNS.delete, {
      ...adminCredential(admin),
      supermarketItemId: id,
    });
  }
}

@ApiTags('admin-catalog')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/catalog/price-scopes', version: '1' })
export class AdminCatalogPriceScopesController {
  constructor(private readonly nats: NatsClient) {}

  @Post()
  @ApiContractResponse(PRICE_SCOPE_PATTERNS.create, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true })
  create(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: CreatePriceScopeDto
  ): Promise<PriceScopeView> {
    return this.nats.send<PriceScopeView>(PRICE_SCOPE_PATTERNS.create, {
      ...adminCredential(admin),
      ...dto,
    });
  }

  @Get()
  @ApiContractResponse(PRICE_SCOPE_PATTERNS.list)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: ListPriceScopesQueryDto
  ): Promise<PriceScopePage> {
    return this.nats.send<PriceScopePage>(PRICE_SCOPE_PATTERNS.list, {
      userId: admin.adminId,
      supermarketId: query.supermarketId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Patch(':id')
  @ApiContractResponse(PRICE_SCOPE_PATTERNS.update)
  @ApiProblemResponses({ body: true })
  update(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string,
    @Body() dto: UpdatePriceScopeDto
  ): Promise<PriceScopeView> {
    return this.nats.send<PriceScopeView>(PRICE_SCOPE_PATTERNS.update, {
      ...adminCredential(admin),
      priceScopeId: id,
      ...dto,
    });
  }

  @Delete(':id')
  @ApiContractResponse(PRICE_SCOPE_PATTERNS.delete)
  @ApiProblemResponses({ conflict: true })
  remove(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(PRICE_SCOPE_PATTERNS.delete, {
      ...adminCredential(admin),
      priceScopeId: id,
    });
  }
}

/**
 * Where a product sits in one particular shop, and the per store availability
 * override (plan 0038, section 5.2).
 *
 * `available` here is a **nullable override** of the scope wide flag on a price,
 * where null means "use the scope's". Two columns making two different claims,
 * and a screen showing both as one checkbox called "available" is wrong.
 */
@ApiTags('admin-catalog')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/catalog/location-items', version: '1' })
export class AdminCatalogLocationItemsController {
  constructor(private readonly nats: NatsClient) {}

  @Put()
  @ApiContractResponse(SUPERMARKET_LOCATION_ITEM_PATTERNS.upsert)
  @ApiProblemResponses({ body: true })
  upsert(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: UpsertSupermarketLocationItemDto
  ): Promise<SupermarketLocationItemView> {
    return this.nats.send<SupermarketLocationItemView>(
      SUPERMARKET_LOCATION_ITEM_PATTERNS.upsert,
      { ...adminCredential(admin), ...dto }
    );
  }

  @Get()
  @ApiContractResponse(SUPERMARKET_LOCATION_ITEM_PATTERNS.listByLocation)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: AdminListLocationItemsQueryDto
  ): Promise<SupermarketLocationItemPage> {
    return this.nats.send<SupermarketLocationItemPage>(
      SUPERMARKET_LOCATION_ITEM_PATTERNS.listByLocation,
      {
        userId: admin.adminId,
        supermarketLocationId: query.supermarketLocationId,
        cursor: query.cursor,
        limit: query.limit,
      }
    );
  }
}
