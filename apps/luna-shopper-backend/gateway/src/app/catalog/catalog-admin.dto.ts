import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ItemCategory,
  PostalCodeSource,
  PriceSourceKind,
} from '@portfolio/luna-shopper/contracts';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
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

  @ApiPropertyOptional({ enum: ItemCategory })
  @IsOptional()
  @IsEnum(ItemCategory)
  category?: ItemCategory;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Only this group’s members.',
  })
  @IsOptional()
  @IsUUID()
  productGroupId?: string;

  @ApiPropertyOptional({
    description:
      'Only the products belonging to no group, which is what curation has not reached yet. Set beside `productGroupId` it answers with nothing, because the two together are a contradiction.',
  })
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  withoutProductGroup?: boolean;
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
