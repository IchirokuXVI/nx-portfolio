import {
  ApiProperty,
  ApiPropertyOptional,
  IntersectionType,
} from '@nestjs/swagger';
import {
  ITEM_LOOKUP_LIMITS,
  ItemCategory,
  PriceScopeKind,
  UnitOfMeasure,
} from '@portfolio/luna-shopper/contracts';
import { PageQueryDto } from '@portfolio/luna-shopper/platform';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * How many price scopes one read may name.
 *
 * A bound rather than a budget: a shopper's profile holds the chains they
 * actually visit, which is a handful, and the number is here so one request
 * cannot turn a search into a scan of every price in the catalog.
 */
const MAX_PRICE_SCOPES = 20;

/**
 * The products a screen needs the names of, by id (plan 0053, section 1).
 *
 * **The cap is enforced here and not merely documented.** A batch read with no
 * ceiling is a listing, and plan 0049 section 3 deliberately stopped the catalog
 * being listable; {@link ITEM_LOOKUP_LIMITS.maxIds} is spread from the contract
 * rather than written again, so the route and the message cannot disagree about
 * what five hundred means.
 *
 * Every id is checked for shape, which costs nothing and means a malformed id
 * fails as a bad request rather than reaching a `WHERE id = ANY(...)` as a cast
 * error from inside catalog.
 */
export class LookupItemsDto {
  @ApiProperty({ type: [String], maxItems: ITEM_LOOKUP_LIMITS.maxIds })
  @IsArray()
  @ArrayMaxSize(ITEM_LOOKUP_LIMITS.maxIds)
  @IsUUID('all', { each: true })
  ids!: string[];
}

/** A localized text value carrying at least English and Spanish (plan 0012). */
export class LocalizedTextDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  en!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  es!: string;
}

/**
 * Per locale alternative words for a product group (plan 0048, section 1).
 *
 * The reason a group is findable at all: `leche` and `milk` have to reach the one
 * Milk group, and neither is a translation of the group's own name in the other
 * language.
 */
export class LocalizedSynonymsDto {
  @ApiProperty({ type: [String], maxItems: 50 })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  en!: string[];

  @ApiProperty({ type: [String], maxItems: 50 })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  es!: string[];
}

// --- Supermarkets ----------------------------------------------------------

export class CreateSupermarketDto {
  @ApiProperty({ type: LocalizedTextDto })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name!: LocalizedTextDto;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  websiteUrl?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "The chain's stable identity across discovery runs, the Wikidata QID (plan 0038, section 5.4). Owner editable: the QID splits `Carrefour` from `Carrefour Express`, which may or may not be wanted.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  externalBrandKey?: string | null;
}

export class UpdateSupermarketDto {
  @ApiPropertyOptional({ type: LocalizedTextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name?: LocalizedTextDto;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  websiteUrl?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "The chain's stable identity across discovery runs, the Wikidata QID (plan 0038, section 5.4). Owner editable: the QID splits `Carrefour` from `Carrefour Express`, which may or may not be wanted.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  externalBrandKey?: string | null;
}

// --- Supermarket locations -------------------------------------------------

export class CreateSupermarketLocationDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The scope this store prices against (plan 0038, section 5.1). Omit it and the store gets a STORE scope of its own, which is exactly how catalog behaved before scopes existed.',
  })
  @IsOptional()
  @IsUUID()
  priceScopeId?: string;

  @ApiPropertyOptional({ type: LocalizedTextDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  label?: LocalizedTextDto | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  country?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  latitude?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  longitude?: number | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 16 })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  postalCode?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The discovery provider’s own reference, e.g. `node/1156230891`. Not a reliable primary identity: an OSM element changes id and type when a shop is remapped from a node to a building way.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalRef?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  externalProvider?: string | null;
}

export class UpdateSupermarketLocationDto extends CreateSupermarketLocationDto {}

// --- Items -----------------------------------------------------------------

export class CreateItemDto {
  @ApiProperty({ type: LocalizedTextDto })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name!: LocalizedTextDto;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  brand?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sku?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 32,
    description:
      'The barcode: the only identifier that joins a product across chains (plan 0038, section 2.5). Unique across the catalog when present.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  ean?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    description:
      'Without it `defaultUnit` says nothing: "LITER" is not a size.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitSize?: number | null;

  @ApiProperty({ enum: ItemCategory })
  @IsEnum(ItemCategory)
  category!: ItemCategory;

  @ApiProperty({ enum: UnitOfMeasure })
  @IsEnum(UnitOfMeasure)
  defaultUnit!: UnitOfMeasure;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'The product group this belongs to (plan 0048, section 1): the statement that this milk is comparable with that milk. Owner curation, never assigned automatically.',
  })
  @IsOptional()
  @IsUUID()
  productGroupId?: string | null;
}

export class UpdateItemDto {
  @ApiPropertyOptional({ type: LocalizedTextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name?: LocalizedTextDto;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  brand?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sku?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 32,
    description:
      'The barcode: the only identifier that joins a product across chains (plan 0038, section 2.5). Unique across the catalog when present.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  ean?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    description:
      'Without it `defaultUnit` says nothing: "LITER" is not a size.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitSize?: number | null;

  @ApiPropertyOptional({ enum: ItemCategory })
  @IsOptional()
  @IsEnum(ItemCategory)
  category?: ItemCategory;

  @ApiPropertyOptional({ enum: UnitOfMeasure })
  @IsOptional()
  @IsEnum(UnitOfMeasure)
  defaultUnit?: UnitOfMeasure;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Assign, reassign or (with null) unassign the product’s group (plan 0048, section 1).',
  })
  @IsOptional()
  @IsUUID()
  productGroupId?: string | null;
}

// --- Price scopes (plan 0038, section 5.1) ---------------------------------

export class CreatePriceScopeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  supermarketId!: string;

  @ApiProperty({ enum: PriceScopeKind })
  @IsEnum(PriceScopeKind)
  kind!: PriceScopeKind;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 64,
    description:
      "The source's own key for the scope, e.g. Mercadona's warehouse. A string and never an integer: the key comes back as both a numeric code (`4661`) and a city slug (`mad3`).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  externalKey?: string | null;

  @ApiPropertyOptional({ type: LocalizedTextDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  label?: LocalizedTextDto | null;
}

export class UpdatePriceScopeDto {
  @ApiPropertyOptional({ enum: PriceScopeKind })
  @IsOptional()
  @IsEnum(PriceScopeKind)
  kind?: PriceScopeKind;

  @ApiPropertyOptional({ nullable: true, maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  externalKey?: string | null;

  @ApiPropertyOptional({ type: LocalizedTextDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  label?: LocalizedTextDto | null;
}

// --- Supermarket items (per SCOPE price, since plan 0038) ------------------

export class UpsertSupermarketItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  itemId!: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'The price scope, not the store (plan 0038, section 5.2). A chain that publishes one price per warehouse stores one row per warehouse instead of twelve identical ones per city.',
  })
  @IsUUID()
  priceScopeId!: string;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 3 })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    description:
      "The source's own normalized price per reference unit, stored verbatim and never recomputed (plan 0038, section 2.4).",
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 32,
    description:
      "The source's own label for `unitPrice`. Text and not a unit: a product labelled `100 ml` carries a per litre number, and `lv` means washing machine loads.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  unitPriceLabel?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  available?: boolean;
}

// --- The per store half (plan 0038, section 5.2) ---------------------------

export class UpsertSupermarketLocationItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  itemId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  supermarketLocationId!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  positionInStore?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'A per store override meaning "someone checked this specific shop". Null clears it and defers to the scope’s answer, which is not the same as saying "not available here".',
  })
  @IsOptional()
  @IsBoolean()
  available?: boolean | null;
}

// --- Queries ---------------------------------------------------------------

export class CatalogListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['name', 'created', 'updated'] })
  @IsOptional()
  @IsIn(['name', 'created', 'updated'])
  order?: string;
}

/**
 * The same orders plus `relevance` (plan 0048, section 3).
 *
 * A sibling of {@link CatalogListQueryDto} rather than a subclass that widens
 * `order`: class-validator collects the decorators of the whole prototype chain,
 * so a subclass restating the field would be validated against **both** lists and
 * `relevance` would be refused by the parent's.
 *
 * `relevance` is what a search does by default when it is given a query, so a
 * caller states it only to ask for it back after asking for something else. With
 * no query it degrades to `name`: there is nothing to be relevant to.
 */
export class SearchOrderQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    enum: ['relevance', 'name', 'created', 'updated'],
    description:
      'Defaults to `relevance` when a query is given and to `name` when one is not.',
  })
  @IsOptional()
  @IsIn(['relevance', 'name', 'created', 'updated'])
  order?: string;
}

/** How many postal codes or chains one read may name. Same reasoning, smaller. */
const MAX_SELECTORS = 20;

/** `?x=a&x=b` for one value arrives as a string; every list parameter needs it. */
const asArray = ({ value }: { value: unknown }) =>
  value === undefined || Array.isArray(value) ? value : [value];

/**
 * A flag as a query string spells it: `?flag=true`, or bare `?flag`, which
 * arrives as an empty string and means the caller set it. Anything else is
 * handed on untouched, so `@IsBoolean` refuses it rather than reading it as
 * false, which is what a typo deserves.
 */
export const asBoolean = ({ value }: { value: unknown }) => {
  if (value === '' || value === 'true' || value === true) {
    return true;
  }
  return value === 'false' || value === false ? false : value;
};

/**
 * Where the caller shops, for the reads that return items or prices (plan 0048
 * section 3.1, and plan 0049 section 3).
 *
 * Three ways to say it, in falling precedence:
 *
 * - `priceScopeId`, repeatable: the warehouses themselves. Nothing is resolved.
 * - `postalCode` and `supermarketId`, repeatable: a place, resolved through the
 *   ladder in section 3.1.
 * - Nothing at all, optionally with `profileId`: the caller's default (or named)
 *   shopping profile is resolved for them.
 *
 * **Saying nothing no longer means everything**, and it is not an error either.
 * A caller whose profile holds neither a postal code nor a chain resolves to no
 * scopes, and the read answers with the catalog ranked as usual and every price
 * field null (plan 0069, section 2). `GET /v1/catalog/scope` is what tells a
 * client whether that is because nothing was said, because nobody serves the
 * area, or because every shop in it was refused.
 */
export class PriceScopedQueryDto extends SearchOrderQueryDto {
  @ApiPropertyOptional({
    name: 'priceScopeId',
    type: [String],
    format: 'uuid',
    description:
      'Repeatable. Prices come from these scopes and no others, and nothing is resolved from your profile.',
  })
  @IsOptional()
  @Transform(asArray)
  @IsArray()
  @ArrayMaxSize(MAX_PRICE_SCOPES)
  @IsUUID(undefined, { each: true })
  priceScopeId?: string[];

  @ApiPropertyOptional({
    name: 'postalCode',
    type: [String],
    description:
      'Repeatable. Where you are shopping from, resolved to scopes per request rather than stored resolved.',
  })
  @IsOptional()
  @Transform(asArray)
  @IsArray()
  @ArrayMaxSize(MAX_SELECTORS)
  @IsString({ each: true })
  @MaxLength(16, { each: true })
  postalCode?: string[];

  @ApiPropertyOptional({
    name: 'supermarketId',
    type: [String],
    format: 'uuid',
    description:
      'Repeatable. The chains to shop, resolved through the ladder: their scopes serving your postal codes, else a national scope, else the chain default, flagged approximate.',
  })
  @IsOptional()
  @Transform(asArray)
  @IsArray()
  @ArrayMaxSize(MAX_SELECTORS)
  @IsUUID(undefined, { each: true })
  supermarketId?: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Shop as this profile of yours rather than as your default one. Somebody else’s profile is not found.',
  })
  @IsOptional()
  @IsUUID()
  profileId?: string;
}

export class SearchItemsQueryDto extends PriceScopedQueryDto {
  @ApiPropertyOptional({
    description:
      'What to search for. A whole barcode matches the product carrying it, and that product is listed first.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  query?: string;

  @ApiPropertyOptional({ enum: ItemCategory })
  @IsOptional()
  @IsEnum(ItemCategory)
  category?: ItemCategory;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Only this group’s members (plan 0048). What "show me every milk" asks.',
  })
  @IsOptional()
  @IsUUID()
  productGroupId?: string;
}

/** The composer's own read: ranked groups, priced (plan 0048, section 3). */
export class SearchOffersQueryDto extends PriceScopedQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  query?: string;
}

/**
 * The dropdown's one call (plan 0048, section 3).
 *
 * `q` rather than `query`, because it is what the plan names and what a search
 * box parameter is called everywhere. The limit is per kind, not a total: the
 * response interleaves two reads and a client asking for ten wants ten of each
 * to choose from, not a split it cannot predict.
 */
export class SuggestQueryDto extends PriceScopedQueryDto {
  @ApiPropertyOptional({
    description:
      'What the person has typed. The composer asks after three characters. A whole barcode matches the product carrying it, and that product is listed first.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

/**
 * Where the caller is looking for a shop (plan 0068, section 2).
 *
 * Two ways to say it, and they are not exclusive: `postalCode` states the codes
 * outright, which is what a screen showing a code the user has not saved yet
 * needs; anything else resolves the named or default profile. **The refusals
 * always come from the profile**, whichever way the codes were named, because a
 * caller trying a code out is still the same person who said they will not go
 * to that DIA.
 *
 * Saying nothing is not an error here, unlike on a priced read: somebody in the
 * middle of filling their profile in gets an empty answer rather than
 * `catalog_scope_required`.
 */
export class ShopQueryDto {
  @ApiPropertyOptional({
    name: 'postalCode',
    type: [String],
    description:
      'Repeatable. The codes to look in, instead of the ones on your profile.',
  })
  @IsOptional()
  @Transform(asArray)
  @IsArray()
  @ArrayMaxSize(MAX_SELECTORS)
  @IsString({ each: true })
  @MaxLength(16, { each: true })
  postalCode?: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Look as this profile of yours rather than as your default one. Somebody else’s profile is not found.',
  })
  @IsOptional()
  @IsUUID()
  profileId?: string;

  @ApiPropertyOptional({
    description:
      'Include what you have refused, flagged. The screen that edits those choices is the caller that asks for it; every other caller is offering a shop.',
  })
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  includeExcluded?: boolean;
}

/**
 * The page of shops (plan 0068, section 3.2): the same selector, plus one chain
 * and one typed word, both optional and both narrowing.
 *
 * Composed rather than subclassed because it needs the fields of two DTOs, and
 * restating a page’s `cursor` and `limit` here would be a second place for the
 * page size cap to be wrong.
 */
export class SearchShopsQueryDto extends IntersectionType(
  ShopQueryDto,
  PageQueryDto
) {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Only this chain’s shops. What tapping a franchise asks.',
  })
  @IsOptional()
  @IsUUID()
  supermarketId?: string;

  @ApiPropertyOptional({
    description:
      'Matched against the shop’s name, its chain’s name in any language, its address, its city and its postal code.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  query?: string;
}

export class CreateProductGroupDto {
  @ApiProperty({ type: LocalizedTextDto })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name!: LocalizedTextDto;

  @ApiProperty({
    maxLength: 80,
    description:
      'A stable handle for admin tooling and tests: lower case words separated by single dashes.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  slug!: string;

  @ApiProperty({
    enum: UnitOfMeasure,
    description: 'The unit this group’s members are compared in.',
  })
  @IsEnum(UnitOfMeasure)
  referenceUnit!: UnitOfMeasure;

  @ApiPropertyOptional({ type: LocalizedSynonymsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedSynonymsDto)
  synonyms?: LocalizedSynonymsDto;
}

export class UpdateProductGroupDto {
  @ApiPropertyOptional({ type: LocalizedTextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name?: LocalizedTextDto;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  slug?: string;

  @ApiPropertyOptional({ enum: UnitOfMeasure })
  @IsOptional()
  @IsEnum(UnitOfMeasure)
  referenceUnit?: UnitOfMeasure;

  @ApiPropertyOptional({ type: LocalizedSynonymsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedSynonymsDto)
  synonyms?: LocalizedSynonymsDto;
}

export class ListProductGroupsQueryDto extends CatalogListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  query?: string;
}
