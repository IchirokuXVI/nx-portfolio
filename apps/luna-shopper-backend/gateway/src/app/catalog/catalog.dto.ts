import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ItemCategory,
  PriceScopeKind,
  UnitOfMeasure,
} from '@portfolio/luna-shopper/contracts';
import { PageQueryDto } from '@portfolio/luna-shopper/platform';
import { Type } from 'class-transformer';
import {
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
    description: 'Without it `defaultUnit` says nothing: "LITER" is not a size.',
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
    description: 'Without it `defaultUnit` says nothing: "LITER" is not a size.',
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

export class SearchItemsQueryDto extends CatalogListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  query?: string;

  @ApiPropertyOptional({ enum: ItemCategory })
  @IsOptional()
  @IsEnum(ItemCategory)
  category?: ItemCategory;
}
