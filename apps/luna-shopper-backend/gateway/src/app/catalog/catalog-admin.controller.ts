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
  HARVEST_SCHEMA_IDS,
  ITEM_PATTERNS,
  ITEM_PRICE_PATTERNS,
  PRICE_POLICY_PATTERNS,
  PRICE_SCOPE_PATTERNS,
  PriceSourceKind,
  PRODUCT_GROUP_PATTERNS,
  SOURCE_ENTRY_PATTERNS,
  SUPERMARKET_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  SUPERMARKET_PATTERNS,
  type AdminSupermarketItemPage,
  type ApplyProductGroupAssignmentsResult,
  type BrandKeysResult,
  type BrandPage,
  type BrandSpellingsResult,
  type BrandSuggestionPage,
  type BrandView,
  type CreateBrandResult,
  type CreateItemsResult,
  type DeleteBrandResult,
  type ItemPage,
  type ItemPricePage,
  type ItemPriceView,
  type ItemView,
  type PricePolicyListView,
  type PricePolicyView,
  type PriceScopePage,
  type PriceScopeView,
  type ProductGroupPage,
  type ProductGroupView,
  type RegisterBrandSuggestionResult,
  type SetSupermarketItemAvailabilityResult,
  type SetSupermarketLocationItemAvailabilityResult,
  type SupermarketLocationItemPage,
  type SupermarketLocationItemView,
  type SupermarketLocationPage,
  type SupermarketLocationView,
  type SupermarketPage,
  type SupermarketView,
  type UpdateBrandResult,
} from '@portfolio/luna-shopper/contracts';
import { MAX_PAGE_SIZE, UuidParam } from '@portfolio/luna-shopper/platform';
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
  AdminListBrandsQueryDto,
  AdminListBrandSuggestionsQueryDto,
  AdminListLocationItemsQueryDto,
  AdminListLocationsQueryDto,
  AdminListSupermarketItemsQueryDto,
  AdminListSupermarketsQueryDto,
  AdminSearchItemsQueryDto,
} from './catalog-admin.dto';
import {
  AddItemPriceDto,
  ApplyProductGroupAssignmentsDto,
  CreateBrandDto,
  CreateItemDto,
  CreateItemsDto,
  CreatePriceScopeDto,
  CreateProductGroupDto,
  CreateSupermarketDto,
  CreateSupermarketLocationDto,
  ListItemPricesQueryDto,
  ListPriceScopesQueryDto,
  ListProductGroupsQueryDto,
  RegisterBrandSuggestionDto,
  SetSupermarketItemAvailabilityDto,
  SetSupermarketLocationItemAvailabilityDto,
  UpdateBrandDto,
  UpdateItemDto,
  UpdatePricePolicyDto,
  UpdatePriceScopeDto,
  UpdateProductGroupDto,
  UpdateSupermarketDto,
  UpdateSupermarketLocationDto,
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
  createMany(
    @ActingAdmin() admin: CurrentAdmin,
    @Body() dto: CreateItemsDto
  ): Promise<CreateItemsResult> {
    return this.nats.send<CreateItemsResult>(ITEM_PATTERNS.createMany, {
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
      category: query.category,
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

  /** The only place an item joins a product group, and it is a person doing it. */
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

  /** The history for one (item, scope), newest first. */
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
