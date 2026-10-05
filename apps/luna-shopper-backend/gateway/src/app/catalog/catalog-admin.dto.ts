import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ADMIN_PRICE_ITEM_IDS_MAX,
  BRAND_ORDERS,
  CATEGORY_KINDS,
  PostalCodeSource,
  PriceSourceKind,
  type BrandOrder,
  type CategoryKind,
} from '@portfolio/luna-shopper/contracts';
import { PageQueryDto } from '@portfolio/luna-shopper/platform';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  IsUuidOrNone,
  referenceFilterDescription,
} from '../admin/reference-none';
import {
  asArray,
  asBoolean,
  CatalogListQueryDto,
  SearchOrderQueryDto,
} from './catalog.dto';

/**
 * The query parameters the back office's catalog lists take (plan 0073, section
 * 4).
 *
 * They are separate classes rather than optional fields on the shopper's DTOs
 * because the two reads answer different questions. A shopper's item search
 * carries `priceScopeId`, `postalCode` and `profileId`, which say where the
 * caller shops; an operator has no such place, and offering them the parameters
 * would invite exactly the scoped, partial answer section 4 exists to avoid.
 */
export class AdminSearchItemsQueryDto extends SearchOrderQueryDto {
  @ApiPropertyOptional({
    description:
      'What to search for. A whole barcode matches the product carrying it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  query?: string;

  /**
   * One parameter for two questions, as {@link productGroupId} is (admin plan
   * 0043, section 2). A uuid is the products under that category; the literal
   * `none` is the products on no category at all, which is the "No category"
   * entry of the back office's tree.
   */
  @ApiPropertyOptional({
    description: referenceFilterDescription(
      'Only the products under this category (plan 0166, section 4): a leaf, or a root meaning the products under any of its children.',
      'the products on no category at all.'
    ),
  })
  @IsOptional()
  // Any uuid version: seeded categories carry version 5 ids derived from the
  // slug, and the validator beneath checks the shape and not the version.
  @IsUuidOrNone()
  categoryId?: string;

  /**
   * One parameter for two questions (admin plan 0012, section 2). A uuid is
   * the group's members; the literal `none` is the products in no group, which
   * is what curation has not reached yet. It used to be a second boolean
   * parameter, `withoutProductGroup`, which the back office's picker could not
   * offer as a choice; the literal is what the picker sends.
   */
  @ApiPropertyOptional({
    description: referenceFilterDescription(
      'Only this group’s members.',
      'the products belonging to no group, which is what curation has not reached yet.'
    ),
  })
  @IsOptional()
  @IsUuidOrNone()
  productGroupId?: string;

  /**
   * The products one price scope shows no price for (plan 0187): what a crawl
   * of the chain did not reach.
   *
   * **A uuid and nothing else.** The literal `none` has no meaning here, since
   * the parameter does not name a reference of the product: it names the scope
   * the question is asked at. It is also not a boolean beside `priceScopeId`,
   * because this route takes no scope and prices nothing.
   */
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Only the products this price scope shows no price for: the scope holds no row for the product, or a row with no price that still says the product is sold. A row that says the scope does not sell the product is an answer, and keeps the product out. It combines with every other filter of this route. With it the page carries `total`, the number of products that match the whole request, on every page of it. An id that names no price scope answers 404.',
  })
  @IsOptional()
  @IsUUID()
  withoutPriceAtScopeId?: string;
}

/**
 * The chain list, with the one parameter its picker needs.
 *
 * Admin only, and the shopper's read of the same subject keeps taking a cursor
 * and an order and nothing else. A chain listing is reference data a shopper
 * scrolls; the operator reaches this one through a reference field on another
 * form, where scrolling a page they cannot narrow is what the field is for.
 */
export class AdminListSupermarketsQueryDto extends CatalogListQueryDto {
  @ApiPropertyOptional({
    description:
      'Only the chains whose name, in either content language, or whose brand key contains this text.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  query?: string;
}

/**
 * One chain's shops, with the review filter of plan 0005, section 3 and the one
 * parameter its picker needs (admin plan 0011, section 4).
 *
 * The picker binds a source's shop to one of ours and is scoped to a chain, so
 * it types into this list rather than scrolling it. Without the parameter the
 * descriptor has nowhere to put the term, drops it, and answers every search
 * with the same first page.
 */
export class AdminListLocationsQueryDto extends CatalogListQueryDto {
  @ApiPropertyOptional({
    description:
      'Only the shops whose label, in either content language, or whose address or town contains this text.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  query?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Only the shops that sell at this scope.',
  })
  @IsOptional()
  @IsUUID()
  priceScopeId?: string;

  @ApiPropertyOptional({
    enum: PostalCodeSource,
    description:
      'Only the shops whose postal code came from here. `DERIVED` is the guessed ones. A shop with no postal code at all matches no value, since it has no source.',
  })
  @IsOptional()
  @IsEnum(PostalCodeSource)
  postalCodeSource?: PostalCodeSource;
}

/**
 * The price list, which is the one read with no user facing counterpart at all
 * (plan 0005, section 4).
 *
 * `sourceKind=ADMIN` is the question "what have I overridden": the effective
 * rows an operator's price won (plan 0080, section 10). `stale=true` is "what
 * is shown on sufferance". Nothing else can ask either.
 */
export class AdminListSupermarketItemsQueryDto extends CatalogListQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({
    name: 'itemIds',
    type: [String],
    format: 'uuid',
    description: `Repeatable, at most ${ADMIN_PRICE_ITEM_IDS_MAX}. Only the prices of these products: with priceScopeId, the price of every product on one page of the product list in one read (admin plan 0043). Empty and absent both mean every product.`,
  })
  @IsOptional()
  @Transform(asArray)
  @IsArray()
  @ArrayMaxSize(ADMIN_PRICE_ITEM_IDS_MAX)
  // Any version: a seeded product carries a version 5 id.
  @IsUUID('all', { each: true })
  itemIds?: string[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  priceScopeId?: string;

  @ApiPropertyOptional({
    enum: PriceSourceKind,
    description:
      'The effective row’s kind. ADMIN answers "what have I overridden".',
  })
  @IsOptional()
  @IsEnum(PriceSourceKind)
  sourceKind?: PriceSourceKind;

  @ApiPropertyOptional({
    description:
      'The rows shown on sufferance: nothing eligible prices them, so the newest row of any kind is shown and flagged (plan 0080, section 5).',
  })
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  stale?: boolean;

  @ApiPropertyOptional({
    description:
      'The scope wide flag, not the per store override on a location item.',
  })
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  available?: boolean;
}

/**
 * One location's per store rows.
 *
 * The shop is required rather than optional, which makes this the one admin list
 * that starts from something. Aisle positions are per store by definition, so a
 * listing across every shop would be rows nothing could read.
 */
export class AdminListLocationItemsQueryDto extends CatalogListQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  supermarketLocationId!: string;
}

/**
 * The registry, read as a list (plan 0115, section 5.2).
 *
 * `order` is its own two values rather than `CatalogListQueryDto`'s, because a
 * brand has no localized name to order by and `itemCount` is not a column any
 * other list has. It extends {@link PageQueryDto} directly for the reason
 * {@link SearchOrderQueryDto} is a sibling rather than a subclass:
 * class-validator collects the decorators of the whole prototype chain, so a
 * subclass restating `order` would be validated against both lists.
 *
 * Every parameter is on this class and none is a `@Query('name')` argument
 * beside it, which is the rule the price scope lists were written against and
 * broke: the pipe validates the whole query object against the declared class,
 * so a parameter the class does not carry is a 400 however the handler reads it.
 */
export class AdminListBrandsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description:
      'Matches when the text’s own brand key is contained in the brand’s key, or when the label contains the text. A query with no letters or digits matches on the label only.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  query?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Only this chain’s private labels, including the brands linked to one of them: the chain a linked brand belongs to is its canonical brand’s.',
  })
  @IsOptional()
  @IsUUID()
  privateLabelSupermarketId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Only the brands linked to this one, which is its list of other spellings.',
  })
  @IsOptional()
  @IsUUID()
  canonicalBrandId?: string;

  @ApiPropertyOptional({
    enum: BRAND_ORDERS,
    description:
      '`label` ascending by default, `itemCount` descending. Both break ties on the id, so either is safe to page the whole registry with.',
  })
  @IsOptional()
  @IsIn([...BRAND_ORDERS])
  order?: BrandOrder;
}

/**
 * The unregistered keys queued rows carry (plan 0115, section 7.3).
 *
 * No order: the read has exactly one, most products first, and offering a
 * parameter with one value would suggest there is a choice.
 */
export class AdminListBrandSuggestionsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description:
      'Keyed before matching, so `el pozo` finds `elpozo`. A query with no letters or digits answers every suggestion.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  query?: string;
}

/**
 * The category tree as the back office lists it (plan 0166, section 3).
 *
 * `parentId=none` is the roots, spelled with the literal every other admin
 * reference filter uses, and `kind=leaf` is what a product's picker asks for:
 * a product goes on a leaf and only there. The two filters combine, so
 * `parentId=<a root>` with `kind=root` answers nothing.
 */
export class AdminListCategoriesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description: referenceFilterDescription(
      'Only the children of this root.',
      'the roots, the categories with no parent.'
    ),
  })
  @IsOptional()
  @IsUuidOrNone()
  parentId?: string;

  @ApiPropertyOptional({
    enum: CATEGORY_KINDS,
    description:
      '`root` is the categories with no parent, `leaf` the ones inside a root, which are the only ones a product can go on.',
  })
  @IsOptional()
  @IsIn([...CATEGORY_KINDS])
  kind?: CategoryKind;

  @ApiPropertyOptional({
    description:
      'Only the categories whose name, in either content language, or whose slug contains this text.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  query?: string;
}

// --- Shop sections (plan 0167, section 4) -----------------------------------

/** One chain's sections, in `position` order. */
export class AdminListSupermarketSectionsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description:
      'Only the sections whose name, in either content language, or whose slug contains this text.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  query?: string;
}

/**
 * The pins of one chain. Both filters are optional and combine as AND:
 * `itemId` is one product's pins, `sectionId` the products pinned to one
 * section, and neither is every pin in the chain.
 */
export class AdminListItemSectionPinsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Only this product’s pins in the chain.',
  })
  @IsOptional()
  @IsUUID('all')
  itemId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Only the products pinned to this section, each with all of its pins in the chain.',
  })
  @IsOptional()
  @IsUUID('all')
  sectionId?: string;
}

/**
 * How many products one preview may name. The back office previews one
 * product at a time; the bound keeps the query string short.
 */
export const SECTION_PREVIEW_MAX_ITEMS = 50;

/** The products the "where shoppers will find it" preview asks about. */
export class AdminItemSectionsAtLocationQueryDto {
  @ApiProperty({
    name: 'itemIds',
    type: [String],
    format: 'uuid',
    minItems: 1,
    maxItems: SECTION_PREVIEW_MAX_ITEMS,
    description:
      'Repeatable. The products to answer the rule of plan 0167, section 3 for, at this shop.',
  })
  @Transform(asArray)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SECTION_PREVIEW_MAX_ITEMS)
  @IsUUID('all', { each: true })
  itemIds!: string[];
}
