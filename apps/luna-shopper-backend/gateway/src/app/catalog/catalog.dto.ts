import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ItemCategory, UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
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
}

// --- Supermarket locations -------------------------------------------------

export class CreateSupermarketLocationDto {
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

  @ApiPropertyOptional({ enum: ItemCategory })
  @IsOptional()
  @IsEnum(ItemCategory)
  category?: ItemCategory;

  @ApiPropertyOptional({ enum: UnitOfMeasure })
  @IsOptional()
  @IsEnum(UnitOfMeasure)
  defaultUnit?: UnitOfMeasure;
}

// --- Supermarket items (per location price/position) -----------------------

export class UpsertSupermarketItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  itemId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  supermarketLocationId!: string;

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

  @ApiPropertyOptional({ nullable: true, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  positionInStore?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  available?: boolean;
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
