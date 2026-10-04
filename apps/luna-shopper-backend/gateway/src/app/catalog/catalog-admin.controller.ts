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
  BRAND_PATTERNS,
  CATEGORY_PATTERNS,
  HARVEST_SCHEMA_IDS,
  ITEM_PATTERNS,
  ITEM_PRICE_PATTERNS,
  PRICE_POLICY_PATTERNS,
  PRICE_SCOPE_PATTERNS,
  PriceSourceKind,
  PRODUCT_GROUP_PATTERNS,
  SECTION_PATTERNS,
  SOURCE_ENTRY_PATTERNS,
  SUPERMARKET_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  SUPERMARKET_PATTERNS,
  type AdminSupermarketItemPage,
  type ApplyProductGroupAssignmentsResult,
  type BrandHomonymsView,
  type BrandKeysResult,
  type BrandPage,
  type BrandSpellingsResult,
  type BrandSuggestionPage,
  type BrandView,
  type CategoryPage,
  type CategoryView,
  type CreateBrandResult,
  type CreateItemsResult,
  type DeleteBrandResult,
  type ItemPage,
  type ItemPricePage,
  type ItemPriceView,
  type ItemScopePricesPage,
  type ItemSectionPinsPage,
  type ItemSectionPinsView,
  type ItemSectionsAtLocationRequest,
  type ItemSectionsAtLocationView,
  type ItemView,
  type LocationSectionsRequest,
  type LocationSectionsView,
  type PricePolicyListView,
  type PricePolicyView,
  type PriceScopePage,
  type PriceScopeView,
  type ProductGroupPage,
  type ProductGroupView,
  type RegisterBrandsResult,
  type RegisterBrandSuggestionResult,
  type SetSupermarketItemAvailabilityResult,
  type SetSupermarketLocationItemAvailabilityResult,
  type SupermarketLocationItemPage,
  type SupermarketLocationItemView,
  type SupermarketLocationPage,
  type SupermarketLocationView,
  type SupermarketPage,
  type SupermarketSectionPage,
  type SupermarketSectionView,
  type SupermarketView,
  type UpdateBrandResult,
  type UpdateItemsResult,
} from '@portfolio/luna-shopper/contracts';
import {
  MAX_PAGE_SIZE,
  PageQueryDto,
  requireProductEan,
  UuidParam,
} from '@portfolio/luna-shopper/platform';
import { adminCredential } from '../admin/admin-credential';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import type { CurrentAdmin } from '../admin/admin-jwt.strategy';
import { ActingAdmin } from '../admin/current-admin.decorator';
import { referenceFilter } from '../admin/reference-none';
import {
  ApiComposedResponse,
  ApiContractResponse,
  ApiProblemResponses,
} from '../docs';
import { NatsClient } from '../messaging/nats-client';
import {
  AdminItemSectionsAtLocationQueryDto,
  AdminListBrandsQueryDto,
  AdminListBrandSuggestionsQueryDto,
  AdminListCategoriesQueryDto,
  AdminListItemSectionPinsQueryDto,
  AdminListLocationItemsQueryDto,
  AdminListLocationsQueryDto,
  AdminListSupermarketItemsQueryDto,
  AdminListSupermarketSectionsQueryDto,
  AdminListSupermarketsQueryDto,
  AdminSearchItemsQueryDto,
} from './catalog-admin.dto';
import {
  AddBrandHomonymDto,
  AddItemPriceDto,
  ApplyProductGroupAssignmentsDto,
  CreateBrandDto,
  CreateCategoryDto,
  CreateItemDto,
  CreateItemsDto,
  CreatePriceScopeDto,
  CreateProductGroupDto,
  CreateSupermarketDto,
  CreateSupermarketLocationDto,
  CreateSupermarketSectionDto,
  ListItemPricesQueryDto,
  ListPriceScopesQueryDto,
  ListProductGroupsQueryDto,
  RegisterBrandsDto,
  RegisterBrandSuggestionDto,
  SetItemSectionPinsDto,
  SetLocationSectionsDto,
  SetSupermarketItemAvailabilityDto,
  SetSupermarketLocationItemAvailabilityDto,
  UpdateBrandDto,
  UpdateCategoryDto,
  UpdateItemDto,
  UpdateItemsDto,
  UpdatePricePolicyDto,
  UpdatePriceScopeDto,
  UpdateProductGroupDto,
  UpdateSupermarketDto,
  UpdateSupermarketLocationDto,
  UpdateSupermarketSectionDto,
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
   * Every chain, or the ones a search term names.
   *
   * The same subject the open read calls, because a chain listing was never
   * scoped to anybody: it is reference data, and the two callers want the
   * identical answer. The term is the one thing they do not share, and the
   * handler treats an absent one as no filter, so the two reads stay identical
   * when nobody is searching.
   */
  @Get()
  @ApiContractResponse(SUPERMARKET_PATTERNS.list)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: AdminListSupermarketsQueryDto
  ): Promise<SupermarketPage> {
    return this.nats.send<SupermarketPage>(SUPERMARKET_PATTERNS.list, {
      userId: admin.adminId,
      query: query.query,
      cursor: query.cursor,
      limit: query.limit,
      order: query.order,
    });
  }

  @Get(':id')
  @ApiContractResponse(SUPERMARKET_PATTERNS.get)
  get(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string
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
    @UuidParam('id') id: string,
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
    @UuidParam('id') id: string
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
    @UuidParam('id') id: string,
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
    @UuidParam('id') id: string,
    @Query() query: AdminListLocationsQueryDto
  ): Promise<SupermarketLocationPage> {
    return this.nats.send<SupermarketLocationPage>(
      SUPERMARKET_LOCATION_PATTERNS.list,
      {
        userId: admin.adminId,
        supermarketId: id,
        query: query.query,
        priceScopeId: query.priceScopeId,
        postalCodeSource: query.postalCodeSource,
        cursor: query.cursor,
        limit: query.limit,
      }
    );
  }

  /**
   * Create a section on this chain (plan 0167, section 4): an aisle as the
   * chain names it, and the categories it holds. A slug the chain already
   * holds answers 409 `section_slug_taken`, and an unknown category 404
   * `category_not_found`.
   */
  @Post(':id/sections')
  @ApiContractResponse(SECTION_PATTERNS.create, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true })
  createSection(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string,
    @Body() dto: CreateSupermarketSectionDto
  ): Promise<SupermarketSectionView> {
    return this.nats.send<SupermarketSectionView>(SECTION_PATTERNS.create, {
      ...adminCredential(admin),
      supermarketId: id,
      ...dto,
    });
  }

  /** This chain's sections, in `position` order, each with its shop count. */
  @Get(':id/sections')
  @ApiContractResponse(SECTION_PATTERNS.list)
  listSections(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string,
    @Query() query: AdminListSupermarketSectionsQueryDto
  ): Promise<SupermarketSectionPage> {
    return this.nats.send<SupermarketSectionPage>(SECTION_PATTERNS.list, {
      userId: admin.adminId,
      supermarketId: id,
      query: query.query,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  /**
   * The pins of this chain (plan 0167, section 4): `?itemId=` for one
   * product's, `?sectionId=` for the products pinned to one section. One entry
   * per pinned product, carrying all of its pins in the chain.
   */
  @Get(':id/item-sections')
  @ApiContractResponse(SECTION_PATTERNS.listPins)
  listItemSections(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string,
    @Query() query: AdminListItemSectionPinsQueryDto
  ): Promise<ItemSectionPinsPage> {
    return this.nats.send<ItemSectionPinsPage>(SECTION_PATTERNS.listPins, {
      userId: admin.adminId,
      supermarketId: id,
      itemId: query.itemId,
      sectionId: query.sectionId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  /**
   * Replace one product's pins in this chain. An empty list removes them. A
   * section of another chain answers 409 `section_of_another_chain`.
   */
  @Put(':id/item-sections')
  @ApiContractResponse(SECTION_PATTERNS.setPins)
  @ApiProblemResponses({ body: true, conflict: true })
  setItemSections(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string,
    @Body() dto: SetItemSectionPinsDto
  ): Promise<ItemSectionPinsView> {
    return this.nats.send<ItemSectionPinsView>(SECTION_PATTERNS.setPins, {
      ...adminCredential(admin),
      supermarketId: id,
      itemId: dto.itemId,
      sectionIds: dto.sectionIds,
    });
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
    @UuidParam('id') id: string
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
    @UuidParam('id') id: string,
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
    @UuidParam('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(SUPERMARKET_LOCATION_PATTERNS.delete, {
      ...adminCredential(admin),
      supermarketLocationId: id,
    });
  }

  /**
   * This shop's sections, in its order, and whether the list is its own or
   * its chain's default (plan 0167, section 4). The same answer as the public
   * `GET /v1/catalog/locations/:id/sections`, behind the operator's guard.
   */
  @Get(':id/sections')
  @ApiContractResponse(SECTION_PATTERNS.forLocation)
  sections(@UuidParam('id') id: string): Promise<LocationSectionsView> {
    const req: LocationSectionsRequest = { supermarketLocationId: id };
    return this.nats.send<LocationSectionsView>(
      SECTION_PATTERNS.forLocation,
      req
    );
  }

  /**
   * Replace this shop's ordered section list, whole. An empty array deletes
   * the shop's own list and returns it to its chain's default. A section of
   * another chain answers 409 `section_of_another_chain`.
   */
  @Put(':id/sections')
  @ApiContractResponse(SECTION_PATTERNS.setForLocation)
  @ApiProblemResponses({ body: true, conflict: true })
  setSections(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string,
    @Body() dto: SetLocationSectionsDto
  ): Promise<LocationSectionsView> {
    return this.nats.send<LocationSectionsView>(
      SECTION_PATTERNS.setForLocation,
      {
        ...adminCredential(admin),
        supermarketLocationId: id,
        sectionIds: dto.sectionIds,
      }
    );
  }

  /**
   * Where shoppers will find these products in this shop: the rule of plan
   * 0167, section 3, for the back office's preview, naming the step that
   * answered for each. The subject the basket read at a shop calls too.
   */
  @Get(':id/item-sections')
  @ApiContractResponse(SECTION_PATTERNS.itemsAtLocation)
  @ApiProblemResponses({ body: true })
  itemSections(
    @UuidParam('id') id: string,
    @Query() query: AdminItemSectionsAtLocationQueryDto
  ): Promise<ItemSectionsAtLocationView> {
    const req: ItemSectionsAtLocationRequest = {
      supermarketLocationId: id,
      itemIds: query.itemIds,
    };
    return this.nats.send<ItemSectionsAtLocationView>(
      SECTION_PATTERNS.itemsAtLocation,
      req
    );
  }
}

/**
 * One shop section, read, edited and deleted at its own id (plan 0167,
 * section 4). Created and listed under its chain, at
 * `/supermarkets/:id/sections`, the way locations are.
 */
@ApiTags('admin-catalog')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/catalog/sections', version: '1' })
export class AdminCatalogSectionsController {
  constructor(private readonly nats: NatsClient) {}

  @Get(':id')
  @ApiContractResponse(SECTION_PATTERNS.get)
  get(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string
  ): Promise<SupermarketSectionView> {
    return this.nats.send<SupermarketSectionView>(SECTION_PATTERNS.get, {
      ...adminCredential(admin),
      sectionId: id,
    });
  }

  /** Rename, reorder, or replace the categories. The slug is not editable. */
  @Patch(':id')
  @ApiContractResponse(SECTION_PATTERNS.update)
  @ApiProblemResponses({ body: true })
  update(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string,
    @Body() dto: UpdateSupermarketSectionDto
  ): Promise<SupermarketSectionView> {
    return this.nats.send<SupermarketSectionView>(SECTION_PATTERNS.update, {
      ...adminCredential(admin),
      sectionId: id,
      ...dto,
    });
  }

  /** Cascades out of every shop's list and every pin (plan 0167, section 2). */
  @Delete(':id')
  @ApiContractResponse(SECTION_PATTERNS.delete)
  remove(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(SECTION_PATTERNS.delete, {
      ...adminCredential(admin),
      sectionId: id,
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

  /**
   * **The EAN is a real barcode or null, and it is refused here** (plan 0184)
   * with `item_ean_invalid`, before anything crosses the broker. Catalog makes
   * the same check for every other writer, with the same function.
   */
  @Post()
  @ApiContractResponse(ITEM_PATTERNS.create, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ body: true, conflict: true })
  async create(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: CreateItemDto
  ): Promise<ItemView> {
    return this.nats.send<ItemView>(ITEM_PATTERNS.create, {
      ...adminCredential(admin),
      ...dto,
      ean: requireProductEan(dto.ean),
    });
  }

  /**
   * Several products in one transaction, all or nothing (plan 0100).
   *
   * The step a bulk decisions file needs before it can bind anything: forty
   * products are created or none are, because the binds that follow name every
   * one of them. Exposed here as an ordinary admin route rather than hidden
   * behind the harvester, since nothing about it is the harvester's.
   *
   * A list over the cap is answered 400 and never split: two chunks are two
   * transactions, so the first can land while the second fails.
   */
  @Post('batch')
  @ApiContractResponse(ITEM_PATTERNS.createMany, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true })
  async createMany(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: CreateItemsDto
  ): Promise<CreateItemsResult> {
    return this.nats.send<CreateItemsResult>(ITEM_PATTERNS.createMany, {
      ...adminCredential(admin),
      // Each EAN a real barcode or null, as on the single create (plan 0184).
      items: dto.items.map((item) => ({
        ...item,
        ean: requireProductEan(item.ean),
      })),
    });
  }

  /**
   * Edit several products in one transaction, all or nothing (plan 0166,
   * section 3): the update op of the items batch.
   *
   * What the back office's "Set categories" sends, one entry per ticked row
   * carrying `categoryIds`, and each entry is what `PATCH :id` takes. The first
   * refusal refuses the whole request and nothing is written, so the answer is
   * every product as it now stands, in the order the request named them.
   *
   * **Declared above `PATCH :id`**, so the literal segment is never read as a
   * product id.
   */
  @Patch('batch')
  @ApiContractResponse(ITEM_PATTERNS.updateMany)
  @ApiProblemResponses({ body: true, conflict: true })
  updateMany(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: UpdateItemsDto
  ): Promise<UpdateItemsResult> {
    return this.nats.send<UpdateItemsResult>(ITEM_PATTERNS.updateMany, {
      ...adminCredential(admin),
      items: dto.items,
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
   * `productGroupId=none` is the filter with no user facing counterpart: an
   * ungrouped product is invisible to every "show me milk" read, so this is how
   * the ones curation has not reached are found. Catalog knows the question as
   * `withoutProductGroup`, and this is where the literal becomes the flag
   * (admin plan 0012, section 2).
   */
  @Get()
  @ApiContractResponse(ITEM_PATTERNS.search)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: AdminSearchItemsQueryDto
  ): Promise<ItemPage> {
    const group = referenceFilter(query.productGroupId);
    return this.nats.send<ItemPage>(ITEM_PATTERNS.search, {
      userId: admin.adminId,
      query: query.query,
      categoryId: query.categoryId,
      productGroupId: group.id,
      withoutProductGroup: group.none,
      cursor: query.cursor,
      limit: query.limit,
      order: query.order,
    });
  }

  @Get(':id')
  @ApiContractResponse(ITEM_PATTERNS.get)
  get(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string
  ): Promise<ItemView> {
    return this.nats.send<ItemView>(ITEM_PATTERNS.get, {
      userId: admin.adminId,
      itemId: id,
    });
  }

  /**
   * The product at every scope that prices it (plan 0160), paged by scope.
   *
   * Each scope carries the current row of every kind the price decision
   * weighed there, the row it chose, and `shownBecause`, which the decision
   * function returns beside its answer rather than a second copy of the rule
   * working it out. `protectedUntil` and the overrides snapshot come with an
   * `ADMIN` row, so an operator reads when its protection ends and what a
   * source would have to say to displace it.
   */
  @Get(':id/prices')
  @ApiContractResponse(ITEM_PRICE_PATTERNS.byItem)
  prices(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string,
    @Query() query: PageQueryDto
  ): Promise<ItemScopePricesPage> {
    return this.nats.send<ItemScopePricesPage>(ITEM_PRICE_PATTERNS.byItem, {
      ...adminCredential(admin),
      itemId: id,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  /**
   * The only place an item joins a product group, and it is a person doing it.
   *
   * **An EAN that is not a real barcode is refused with `item_ean_invalid`, by
   * catalog and not here** (plan 0184). Only catalog holds the product, and
   * the check runs only on a write that changes the EAN. A product that already
   * holds an in-store code keeps it, so an edit that sends that code back
   * unchanged must still save, and this route cannot tell that edit from one
   * that sets the code. The back office sends only the fields that changed;
   * any other client may send the whole product.
   */
  @Patch(':id')
  @ApiContractResponse(ITEM_PATTERNS.update)
  @ApiProblemResponses({ body: true, conflict: true })
  update(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string,
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
    @UuidParam('id') id: string
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

  /**
   * A whole curation session's group decisions, in one transaction (plan 0100).
   *
   * Create the groups the session invented, then move every product it sorted
   * into one, all or nothing. Truly all or nothing, unlike the entry decisions
   * this mirrors: groups and item membership live in one database, so there is
   * no price shaped step outside the transaction.
   *
   * **A refused request answers 201 with `applied: false`**, for the same reason
   * the entry decisions route does: the caller needs to know which operation
   * failed which check, and a problem document carries one message.
   */
  @Post('assignments')
  @ApiContractResponse(PRODUCT_GROUP_PATTERNS.applyAssignments, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true })
  applyAssignments(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: ApplyProductGroupAssignmentsDto
  ): Promise<ApplyProductGroupAssignmentsResult> {
    return this.nats.send<ApplyProductGroupAssignmentsResult>(
      PRODUCT_GROUP_PATTERNS.applyAssignments,
      { ...adminCredential(admin), operations: dto.operations }
    );
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
    @UuidParam('id') id: string
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
    @UuidParam('id') id: string,
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
    @UuidParam('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(PRODUCT_GROUP_PATTERNS.delete, {
      ...adminCredential(admin),
      productGroupId: id,
    });
  }
}

/**
 * The category tree (plan 0166, sections 1 to 3): two levels, a root and its
 * children, and a product only ever on a child.
 *
 * Thin proxies like every route here. The four rules of the tree are catalog's
 * to enforce, in the service and in the database: a third level answers 409
 * `category_too_deep`, a product on a root 409 `category_not_a_leaf`, and a
 * delete of a category that holds children or products 409 `category_in_use`.
 * A product's categories are not written here: they are a field of the
 * product, sent as `categoryIds` on the item routes.
 */
@ApiTags('admin-catalog')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/catalog/categories', version: '1' })
export class AdminCatalogCategoriesController {
  constructor(private readonly nats: NatsClient) {}

  @Post()
  @ApiContractResponse(CATEGORY_PATTERNS.create, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true })
  create(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: CreateCategoryDto
  ): Promise<CategoryView> {
    return this.nats.send<CategoryView>(CATEGORY_PATTERNS.create, {
      ...adminCredential(admin),
      ...dto,
    });
  }

  /**
   * The tree as a page, filtered. `parentId=none` is the roots, which catalog
   * knows as `withoutParent`, and this is where the literal becomes the flag.
   */
  @Get()
  @ApiContractResponse(CATEGORY_PATTERNS.list)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: AdminListCategoriesQueryDto
  ): Promise<CategoryPage> {
    const parent = referenceFilter(query.parentId);
    return this.nats.send<CategoryPage>(CATEGORY_PATTERNS.list, {
      userId: admin.adminId,
      parentId: parent.id,
      withoutParent: parent.none,
      kind: query.kind,
      query: query.query,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get(':id')
  @ApiContractResponse(CATEGORY_PATTERNS.get)
  get(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string
  ): Promise<CategoryView> {
    return this.nats.send<CategoryView>(CATEGORY_PATTERNS.get, {
      userId: admin.adminId,
      categoryId: id,
    });
  }

  /** Rename, reorder or move a category. The slug is not editable. */
  @Patch(':id')
  @ApiContractResponse(CATEGORY_PATTERNS.update)
  @ApiProblemResponses({ body: true, conflict: true })
  update(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string,
    @Body() dto: UpdateCategoryDto
  ): Promise<CategoryView> {
    return this.nats.send<CategoryView>(CATEGORY_PATTERNS.update, {
      ...adminCredential(admin),
      categoryId: id,
      ...dto,
    });
  }

  /** Refused with 409 `category_in_use` while it holds children or products. */
  @Delete(':id')
  @ApiContractResponse(CATEGORY_PATTERNS.delete)
  @ApiProblemResponses({ conflict: true })
  remove(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(CATEGORY_PATTERNS.delete, {
      ...adminCredential(admin),
      categoryId: id,
    });
  }
}

/**
 * The registry of brands a person fills (plan 0115).
 *
 * A brand used to be free text on every table, so `+Proteinas` sat as a brand on
 * 24 Mercadona products when it is a range of Hacendado, and nobody could list
 * the brands the catalog holds because there was no such list. These routes are
 * the list, plus the one read that says how each chain spells a brand.
 *
 * **The only brand that can be deleted is a spelling of another** (plan 0124).
 * Everything else still cannot be removed, by section 9 of plan 0115, because
 * its products have nowhere to go.
 *
 * There is no `key` anywhere in a request body: the key is made from the label,
 * and editing the label is the only thing that changes it.
 */
@ApiTags('admin-catalog')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/catalog/brands', version: '1' })
export class AdminCatalogBrandsController {
  constructor(private readonly nats: NatsClient) {}

  /**
   * Register a brand, and claim the products already carrying its key.
   *
   * The answer is the brand plus `linkedItems`, the number of products the
   * create picked up, which the back office says out loud. Zero is ordinary: a
   * brand registered ahead of any product carries nothing yet.
   */
  @Post()
  @ApiContractResponse(BRAND_PATTERNS.create, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ body: true, conflict: true })
  create(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: CreateBrandDto
  ): Promise<CreateBrandResult> {
    return this.nats.send<CreateBrandResult>(BRAND_PATTERNS.create, {
      ...adminCredential(admin),
      ...dto,
    });
  }

  /**
   * Register a suggestion under the name a person typed (plan 0124, section 5).
   *
   * **A literal path above `:id`**, so the segment cannot be read as a brand id.
   * Nothing here posts to `:id` today, but the two are one segment apart and the
   * next route added under this controller would decide it by declaration order
   * rather than by anything written down.
   *
   * One request for one decision: registering `DEBORAH 48H` as `Deborah`
   * creates the brand for the typed name if it is new, registers the spelling
   * beside it, links the second to the first, and moves the products, in one
   * transaction. Two requests would leave the suggestion half registered
   * whenever the second failed.
   */
  @Post('register-suggestion')
  @ApiContractResponse(BRAND_PATTERNS.registerSuggestion, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true })
  registerSuggestion(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: RegisterBrandSuggestionDto
  ): Promise<RegisterBrandSuggestionResult> {
    return this.nats.send<RegisterBrandSuggestionResult>(
      BRAND_PATTERNS.registerSuggestion,
      { ...adminCredential(admin), ...dto }
    );
  }

  /**
   * Register many brands, one outcome per name (plan 0160).
   *
   * A literal path above `:id`, like `register-suggestion`. A person still
   * chose every name on the list, so each registration stays a decision; the
   * batch only saves the round trips. Each name is its own transaction and
   * answers `CREATED`, `EXISTS` with the brand holding its key, or `REFUSED`
   * with the reason, so one refused name never fails the others. The route
   * answers 201 whatever the outcomes are: the outcomes are the answer.
   */
  @Post('register-many')
  @ApiContractResponse(BRAND_PATTERNS.registerMany, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true })
  registerMany(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: RegisterBrandsDto
  ): Promise<RegisterBrandsResult> {
    return this.nats.send<RegisterBrandsResult>(BRAND_PATTERNS.registerMany, {
      ...adminCredential(admin),
      brands: dto.brands,
    });
  }

  @Get()
  @ApiContractResponse(BRAND_PATTERNS.list)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: AdminListBrandsQueryDto
  ): Promise<BrandPage> {
    return this.nats.send<BrandPage>(BRAND_PATTERNS.list, {
      userId: admin.adminId,
      query: query.query,
      privateLabelSupermarketId: query.privateLabelSupermarketId,
      canonicalBrandId: query.canonicalBrandId,
      cursor: query.cursor,
      limit: query.limit,
      order: query.order,
    });
  }

  /**
   * How each chain spells this brand (plan 0115, section 8).
   *
   * Composed from two services: catalog holds the brand, and the spellings are
   * whatever the chains printed, which only the harvester has. The brand is read
   * first so a missing id answers 404 from the service that owns the row rather
   * than an empty list from the one that does not.
   *
   * **The keys of the brands linked to this one go too** (plan 0124,
   * section 6), which is what puts `DEBORAH 48H` in `DEBORAH`'s spellings table.
   * They come from the registry itself, filtered by `canonicalBrandId`, in one
   * page: a brand with more spellings than a page holds is not a case the
   * registry has, and the harvester caps its own answer at 200 rows anyway.
   */
  @Get(':id/spellings')
  @ApiComposedResponse(HARVEST_SCHEMA_IDS.brandSpellingsResult, {
    description:
      'How each chain spells this brand, from the harvester’s source rows, including the spellings registered as brands linked to it. Composed: the brand and its links are read from catalog first.',
  })
  async spellings(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string
  ): Promise<BrandSpellingsResult> {
    const brand = await this.nats.send<BrandView>(BRAND_PATTERNS.get, {
      userId: admin.adminId,
      brandId: id,
    });
    const linked = await this.nats.send<BrandPage>(BRAND_PATTERNS.list, {
      userId: admin.adminId,
      canonicalBrandId: brand.id,
      limit: MAX_PAGE_SIZE,
    });
    return this.nats.send<BrandSpellingsResult>(
      SOURCE_ENTRY_PATTERNS.brandSpellings,
      {
        ...adminCredential(admin),
        keys: [brand.key, ...linked.items.map((row) => row.key)],
      }
    );
  }

  @Get(':id')
  @ApiContractResponse(BRAND_PATTERNS.get)
  get(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string
  ): Promise<BrandView> {
    return this.nats.send<BrandView>(BRAND_PATTERNS.get, {
      userId: admin.adminId,
      brandId: id,
    });
  }

  /**
   * Rename a brand, or move it under a chain.
   *
   * A rename rewrites `brand` on every item linked to this brand, and links the
   * unlinked items that carry the new key. Items linked under the old key stay
   * linked: they were this brand, and a corrected spelling does not change that.
   *
   * `canonicalBrandId` is the other edit, and it moves products: the answer's
   * `movedItems` is how many (plan 0124, section 4.2).
   */
  @Patch(':id')
  @ApiContractResponse(BRAND_PATTERNS.update)
  @ApiProblemResponses({ body: true, conflict: true })
  update(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string,
    @Body() dto: UpdateBrandDto
  ): Promise<UpdateBrandResult> {
    return this.nats.send<UpdateBrandResult>(BRAND_PATTERNS.update, {
      ...adminCredential(admin),
      brandId: id,
      ...dto,
    });
  }

  /**
   * Remove a spelling (plan 0124).
   *
   * **The only brand that can be deleted is one linked to another**, and every
   * other brand answers 409 `brand_not_linked`. Deleting a spelling puts its
   * products back where it found them, unbranded and still carrying the text
   * the chain printed, so the key returns to the suggestions list on its own and
   * registering it again picks the same products up. `movedItems` is how many
   * went back.
   */
  @Delete(':id')
  @ApiContractResponse(BRAND_PATTERNS.delete)
  @ApiProblemResponses({ conflict: true })
  remove(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string
  ): Promise<DeleteBrandResult> {
    return this.nats.send<DeleteBrandResult>(BRAND_PATTERNS.delete, {
      ...adminCredential(admin),
      brandId: id,
    });
  }

  /**
   * Say that a printed name also names this brand (plan 0178).
   *
   * One name can belong to two businesses, and the key is unique, so the second
   * brand gets a pointer from that printed key rather than a key of its own.
   * The key's own brand stays the first answer, no product moves, and the queue
   * then answers both brands for a row printing that name. Answers 400
   * `brand_homonym_is_own_key` for the brand's own key, and the brand's whole
   * list of homonyms otherwise. Adding one that is already there changes
   * nothing.
   */
  @Post(':id/homonyms')
  @ApiContractResponse(BRAND_PATTERNS.addHomonym, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true })
  addHomonym(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string,
    @Body() dto: AddBrandHomonymDto
  ): Promise<BrandHomonymsView> {
    return this.nats.send<BrandHomonymsView>(BRAND_PATTERNS.addHomonym, {
      ...adminCredential(admin),
      brandId: id,
      printedKey: dto.printedKey,
    });
  }

  /**
   * Take a homonym back (plan 0178).
   *
   * Only the pointer goes: the brand, the key's own brand and every product
   * stay as they were. The printed key travels in the path, keyed the same way
   * as on the way in, and one this brand does not hold answers 404.
   */
  @Delete(':id/homonyms/:printedKey')
  @ApiContractResponse(BRAND_PATTERNS.removeHomonym)
  removeHomonym(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string,
    @Param('printedKey') printedKey: string
  ): Promise<BrandHomonymsView> {
    return this.nats.send<BrandHomonymsView>(BRAND_PATTERNS.removeHomonym, {
      ...adminCredential(admin),
      brandId: id,
      printedKey,
    });
  }
}

/**
 * The brands the queue is asking for (plan 0115, section 7).
 *
 * Its own controller because its path is a sibling of `brands` rather than a
 * child: a suggestion has no id and is not a resource, it is a key nothing has
 * registered yet.
 *
 * **Composed, and in this order.** Catalog answers which keys are registered,
 * and the harvester answers which keys its queued rows carry; subtracting one
 * from the other is the whole read. The keys travel in the NATS message, and the
 * ceiling on that is documented on `BRAND_PATTERNS.keys`.
 */
@ApiTags('admin-catalog')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/catalog/brand-suggestions', version: '1' })
export class AdminCatalogBrandSuggestionsController {
  constructor(private readonly nats: NatsClient) {}

  @Get()
  @ApiComposedResponse(HARVEST_SCHEMA_IDS.brandSuggestionPage, {
    description:
      'The brand keys queued source rows carry that no registered brand holds, most products first. Composed from catalog’s registry and the harvester’s queue.',
  })
  async list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: AdminListBrandSuggestionsQueryDto
  ): Promise<BrandSuggestionPage> {
    const { keys } = await this.nats.send<BrandKeysResult>(
      BRAND_PATTERNS.keys,
      { userId: admin.adminId }
    );
    return this.nats.send<BrandSuggestionPage>(
      SOURCE_ENTRY_PATTERNS.brandSuggestions,
      {
        ...adminCredential(admin),
        registeredKeys: keys,
        query: query.query,
        cursor: query.cursor,
        limit: query.limit,
      }
    );
  }
}

/**
 * The effective prices: the materialized rows a shopper sees (plan 0080,
 * section 10), and the screen `apps/luna-shopper-admin/plans/0005` section 4
 * was about before the price model beneath it changed.
 *
 * **`v3`**, per plan 0004's per controller versioning. The view's meaning
 * changed from "the price" to "the price chosen among several", and two fields
 * were renamed with it so an old build cannot silently read a stale number as
 * fresh. Nothing here writes a price any more: the rows a source gave live at
 * {@link AdminCatalogItemPricesController}, and this row is derived from them.
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
@Controller({ path: 'admin/catalog/supermarket-items', version: '3' })
export class AdminCatalogSupermarketItemsController {
  constructor(private readonly nats: NatsClient) {}

  /**
   * The effective price table, filterable and starting from nothing.
   *
   * The catalog's three other price lists each begin with something the caller
   * already named, a product or a shop or a scope, because that is what a shopper
   * has. This one begins with nothing, which is what makes "which prices did I
   * override" and "which are shown on sufferance" answerable, and it is gated
   * for that reason rather than for what it changes.
   */
  @Get()
  @ApiContractResponse(SUPERMARKET_ITEM_PATTERNS.adminList)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: AdminListSupermarketItemsQueryDto
  ): Promise<AdminSupermarketItemPage> {
    return this.nats.send<AdminSupermarketItemPage>(
      SUPERMARKET_ITEM_PATTERNS.adminList,
      {
        ...adminCredential(admin),
        itemId: query.itemId,
        priceScopeId: query.priceScopeId,
        sourceKind: query.sourceKind,
        stale: query.stale,
        available: query.available,
        cursor: query.cursor,
        limit: query.limit,
      }
    );
  }

  /**
   * Whether a scope carries each of these products (plan 0080, section 9). The
   * one write left on this row, because stock is not a price: a row that does
   * not exist yet is created with no price behind it.
   */
  @Put('availability')
  @ApiContractResponse(SUPERMARKET_ITEM_PATTERNS.setAvailability)
  @ApiProblemResponses({ body: true })
  setAvailability(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: SetSupermarketItemAvailabilityDto
  ): Promise<SetSupermarketItemAvailabilityResult> {
    return this.nats.send<SetSupermarketItemAvailabilityResult>(
      SUPERMARKET_ITEM_PATTERNS.setAvailability,
      { ...adminCredential(admin), ...dto }
    );
  }
}

/**
 * Every price a source gave (plan 0080, section 10): the history behind an
 * effective row, and the two things an operator does to it.
 *
 * **Editing a price is inserting a price.** An operator who typed 1.29 and
 * meant 1.92 removes the row and adds another, and the history shows both,
 * which is the point of a history. There is no `PATCH` here on purpose.
 */
@ApiTags('admin-catalog')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/catalog/item-prices', version: '1' })
export class AdminCatalogItemPricesController {
  constructor(private readonly nats: NatsClient) {}

  /**
   * Add one row. An `ADMIN` row records what it is overriding, server side,
   * and is protected for seven days against a repeated automated value
   * (plan 0080, section 4.2).
   */
  @Post()
  @ApiContractResponse(ITEM_PRICE_PATTERNS.add, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ body: true })
  add(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: AddItemPriceDto
  ): Promise<ItemPriceView> {
    return this.nats.send<ItemPriceView>(ITEM_PRICE_PATTERNS.add, {
      ...adminCredential(admin),
      ...dto,
      sourceKind: dto.sourceKind ?? PriceSourceKind.ADMIN,
    });
  }

  /**
   * The history for one (item, scope), newest first, or with `runId` the rows
   * one harvest run wrote (plan 0160).
   *
   * A run's rows are the ones it inserted and the ones whose `lastObservedAt`
   * it moved last, each marked `writtenBy`: `INSERTED` or `CONFIRMED`. A later
   * run that repeats a price takes the confirmation over, so an old run's
   * confirmed rows shrink as newer runs confirm them.
   */
  @Get()
  @ApiContractResponse(ITEM_PRICE_PATTERNS.list)
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: ListItemPricesQueryDto
  ): Promise<ItemPricePage> {
    return this.nats.send<ItemPricePage>(ITEM_PRICE_PATTERNS.list, {
      ...adminCredential(admin),
      itemId: query.itemId,
      priceScopeId: query.priceScopeId,
      runId: query.runId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  /** Remove one row. The effective row is recomputed behind it. */
  @Delete(':id')
  @ApiContractResponse(ITEM_PRICE_PATTERNS.delete)
  remove(
    @ActingAdmin() admin: CurrentAdmin,
    @UuidParam('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(ITEM_PRICE_PATTERNS.delete, {
      ...adminCredential(admin),
      itemPriceId: id,
    });
  }
}

/**
 * The six policy rows (plan 0080, section 3). The smallest screen in the back
 * office: read them, change one. A change recomputes every effective price.
 */
@ApiTags('admin-catalog')
@ApiBearerAuth('access-token')
@UseGuards(AdminJwtGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'admin/catalog/price-policies', version: '1' })
export class AdminCatalogPricePoliciesController {
  constructor(private readonly nats: NatsClient) {}

  @Get()
  @ApiContractResponse(PRICE_POLICY_PATTERNS.list)
  list(@ActingAdmin() admin: CurrentAdmin): Promise<PricePolicyListView> {
    return this.nats.send<PricePolicyListView>(PRICE_POLICY_PATTERNS.list, {
      ...adminCredential(admin),
    });
  }

  @Patch(':sourceKind')
  @ApiContractResponse(PRICE_POLICY_PATTERNS.update)
  @ApiProblemResponses({ body: true })
  update(
    @ActingAdmin() admin: CurrentAdmin,
    @Param('sourceKind') sourceKind: PriceSourceKind,
    @Body() dto: UpdatePricePolicyDto
  ): Promise<PricePolicyView> {
    return this.nats.send<PricePolicyView>(PRICE_POLICY_PATTERNS.update, {
      ...adminCredential(admin),
      sourceKind,
      ...dto,
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
  /**
   * One chain's scopes, which is how the back office finds the thing a price
   * belongs to (plan 0005, section 2).
   *
   * `supermarketId` sits on {@link ListPriceScopesQueryDto} rather than in a
   * `@Query('supermarketId')` argument of its own, because a bare query argument
   * beside a `@Query()` DTO makes the validation pipe refuse the request.
   */
  list(
    @ActingAdmin() admin: CurrentAdmin,
    @Query() query: ListPriceScopesQueryDto
  ): Promise<PriceScopePage> {
    return this.nats.send<PriceScopePage>(PRICE_SCOPE_PATTERNS.list, {
      kinds: query.kind,
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
    @UuidParam('id') id: string,
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
    @UuidParam('id') id: string
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

  /**
   * Whether this shop carries each of these products (plan 0084, section 4).
   *
   * The route `upsert` no longer covers, and the operator's way to state a fact
   * about one shop: `sourceKind: ADMIN` records who said it, and from then on no
   * crawl overwrites it. A crawl reaches the same subject over NATS as a service
   * actor and is refused this column wherever a person already filled it,
   * getting the disagreement back in `conflicts` instead.
   */
  @Put('availability')
  @ApiContractResponse(SUPERMARKET_LOCATION_ITEM_PATTERNS.setAvailability)
  @ApiProblemResponses({ body: true })
  setAvailability(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: SetSupermarketLocationItemAvailabilityDto
  ): Promise<SetSupermarketLocationItemAvailabilityResult> {
    return this.nats.send<SetSupermarketLocationItemAvailabilityResult>(
      SUPERMARKET_LOCATION_ITEM_PATTERNS.setAvailability,
      { ...adminCredential(admin), ...dto }
    );
  }
}
