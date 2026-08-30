import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ADAPTER_KEYS,
  DiscoveredPlaceStatus,
  HarvestRunMode,
  HarvestRunStatus,
  ItemSourceRefStatus,
  ItemCategory,
  type AdapterKey,
} from '@portfolio/luna-shopper/contracts';
import { PageQueryDto } from '@portfolio/luna-shopper/platform';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * The admin harvest surface's request bodies (plan 0038, section 7).
 *
 * Every route this backs is platform admin gated inside the harvester. Nothing
 * here is open to ordinary users; the one user facing addition that was designed
 * went to backlog 0006 with its cooldown.
 */

export class SpawnHarvestRunDto {
  @ApiProperty({ enum: HarvestRunMode })
  @IsEnum(HarvestRunMode)
  mode!: HarvestRunMode;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Required for CATALOG_DISCOVERY and REFRESH.',
  })
  @IsOptional()
  @IsUUID()
  supermarketId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'The scope a REFRESH writes its prices for. Required for REFRESH.',
  })
  @IsOptional()
  @IsUUID()
  priceScopeId?: string;

  @ApiPropertyOptional({
    maxLength: 16,
    description:
      'Required for STORE_DISCOVERY. It decides the price scope through the chain’s own resolver; the radius below decides the store list. Two questions, two sources (plan 0038, section 2.8).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  postalCode?: string;

  @ApiPropertyOptional({ maxLength: 2, default: 'es' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  @ApiPropertyOptional({
    minimum: 100,
    maximum: 50000,
    default: 3000,
    description:
      'A radius, never a postcode filter: two thirds of OSM stores carry no postcode, and a postal code’s bounding box spans a whole city. 3 km returned 26 supermarkets around 14013.',
  })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(50_000)
  radiusMetres?: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'Restrict the report to these `brand:wikidata` keys.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  brandKeys?: string[];
}

export class ImportDiscoveredPlaceDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Attach to an existing chain instead of resolving it by `brand:wikidata`.',
  })
  @IsOptional()
  @IsUUID()
  supermarketId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  priceScopeId?: string;
}

export class CreateItemFromEntryDto {
  @ApiPropertyOptional({
    enum: ItemCategory,
    description:
      'Override the category the source’s own tree mapped to. Mercadona has 26 top level categories against our 12, so the mapping is lossy by construction.',
  })
  @IsOptional()
  @IsEnum(ItemCategory)
  category?: ItemCategory;
}

export class SetManualItemSourceRefDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  itemId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  supermarketId!: string;

  @ApiProperty({ maxLength: 64 })
  @IsString()
  @MaxLength(64)
  externalId!: string;
}

export class UpsertSupermarketSourceDto {
  @ApiProperty({ enum: ADAPTER_KEYS })
  @IsIn([...ADAPTER_KEYS])
  adapterKey!: AdapterKey;

  @ApiPropertyOptional({
    description:
      'A source is created disabled. Turning fetching on for a third party is a decision made explicitly, never a side effect of describing the chain.',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Adapter specific settings. For `mercadona-api` this is where the resolved `warehouse` lives, e.g. `{ "warehouse": "4661" }`.',
  })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 64,
    description:
      'How many requests may be in flight at once: sockets and memory. NOT the rate — see maxRequestsPerSecond.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(64)
  workers?: number;

  @ApiPropertyOptional({
    minimum: 0.1,
    maximum: 100,
    description:
      'The politeness rate, held by one token bucket every worker blocks on. Watch for 429s and treat any as a signal to halve this rather than to retry harder.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(100)
  maxRequestsPerSecond?: number;
}

export class SetSourceEnabledDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

// --- Queries ---------------------------------------------------------------

export class HarvestRunListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supermarketId?: string;

  @ApiPropertyOptional({ enum: HarvestRunMode })
  @IsOptional()
  @IsEnum(HarvestRunMode)
  mode?: HarvestRunMode;

  @ApiPropertyOptional({ enum: HarvestRunStatus })
  @IsOptional()
  @IsEnum(HarvestRunStatus)
  status?: HarvestRunStatus;
}

export class DiscoveredPlaceListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  runId?: string;

  @ApiPropertyOptional({ description: 'A `brand:wikidata` key, e.g. `Q377705`.' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  brandKey?: string;

  @ApiPropertyOptional({ enum: DiscoveredPlaceStatus })
  @IsOptional()
  @IsEnum(DiscoveredPlaceStatus)
  status?: DiscoveredPlaceStatus;
}

export class DiscoveredPlaceGroupQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  runId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  sampleSize?: number;
}

export class SourceEntryListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description:
      'Only entries the matching ladder could not tie to a catalog item: the candidate new products the owner reviews.',
  })
  @IsOptional()
  @IsBoolean()
  unmatchedOnly?: boolean;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  query?: string;
}

export class ItemSourceRefListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supermarketId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({ enum: ItemSourceRefStatus })
  @IsOptional()
  @IsEnum(ItemSourceRefStatus)
  status?: ItemSourceRefStatus;
}
