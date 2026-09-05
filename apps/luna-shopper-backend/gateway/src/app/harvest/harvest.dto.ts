import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ADAPTER_KEYS,
  DiscoveredPlaceStatus,
  HarvestRunMode,
  HarvestRunStatus,
  ItemCategory,
  ItemSourceRefStatus,
  SourceAliasStatus,
  SourceLocationStatus,
  UnitOfMeasure,
  type AdapterKey,
  type LeafletDocument,
} from '@portfolio/luna-shopper/contracts';
import { PageQueryDto } from '@portfolio/luna-shopper/platform';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
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
  ValidateNested,
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
    description:
      'The scope a REFRESH writes its prices for. Required for REFRESH.',
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

/**
 * The name a product created from a queued leaflet row is saved with (plan
 * 0081, section 3; plan 0079).
 *
 * One locale is enough: a leaflet prints Spanish, and a product with no English
 * name is legal since plan 0079. A reader in English sees the Spanish string
 * through the fallback, and the catalog screens list what still wants
 * translating.
 */
export class LocalizedNameDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  es?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  en?: string;
}

/**
 * One leaflet upload (plan 0081, section 7).
 *
 * The document is **not** described field by field here. It has its own
 * versioned JSON Schema in the contracts library, the gateway validates against
 * that before the document crosses the broker, and restating the shape as a DTO
 * would be a second copy to drift from the first.
 */
export class ImportLeafletDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The chain this leaflet is from. The document `retailer.chain_id` is a hint the upload screen shows beside this picker and is never a lookup key: two extractors spell one chain two ways.',
  })
  @IsUUID()
  supermarketId!: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'The scope the prices are written for. Most leaflets are nationwide, so usually the chain NATIONAL scope, which then reaches every scope of that chain.',
  })
  @IsUUID()
  priceScopeId!: string;

  @ApiPropertyOptional({
    format: 'date',
    description:
      'Override the document `validity.starts_on`, as a local day in Spain. Required when the document states none: the backend refuses a run with a null bound.',
  })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional({
    format: 'date',
    description:
      'Override the document `validity.ends_on`, as a local day in Spain. Inclusive: a leaflet valid to the 23rd is valid through the whole of the 23rd.',
  })
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'The leaflet, as `tmp/leaflet` produced it. Validated against the versioned import schema this backend can read; a document that fails is answered 400 with every failure named by its JSON path and its offer id.',
  })
  @IsObject()
  document!: LeafletDocument;
}

/** Bind a queued printed name to a product the catalog already holds. */
export class AcceptSourceAliasDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  itemId!: string;
}

/**
 * Create the product a queued printed name is for, and bind it, in one call.
 * The alias keeps what the leaflet printed whatever the item is called.
 */
export class CreateItemFromAliasDto {
  @ApiProperty({ type: LocalizedNameDto })
  @ValidateNested()
  @Type(() => LocalizedNameDto)
  name!: LocalizedNameDto;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  brand?: string | null;

  @ApiPropertyOptional({ maxLength: 32, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  ean?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  unitSize?: number | null;

  @ApiProperty({ enum: ItemCategory })
  @IsEnum(ItemCategory)
  category!: ItemCategory;

  @ApiProperty({ enum: UnitOfMeasure })
  @IsEnum(UnitOfMeasure)
  defaultUnit!: UnitOfMeasure;
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

/** Bind one source shop to a catalog location (plan 0084, section 7). */
export class MapSourceLocationDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Must belong to the same chain as the row being mapped; the harvester checks that against catalog rather than trusting the picker.',
  })
  @IsUUID()
  supermarketLocationId!: string;
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

  @ApiPropertyOptional({
    description:
      'Reverted runs only, or unreverted runs only (plan 0082). Absent lists both. A filter of its own rather than a status, because a revert does not change how the run ended.',
  })
  @IsOptional()
  @IsBoolean()
  reverted?: boolean;
}

export class DiscoveredPlaceListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  runId?: string;

  @ApiPropertyOptional({
    description: 'A `brand:wikidata` key, e.g. `Q377705`.',
  })
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

/**
 * The shops queue, one chain at a time (plan 0084, section 7).
 *
 * `supermarketId` is **on the DTO** rather than a `@Query('supermarketId')`
 * argument beside it. `createValidationPipe` sets `whitelist` with
 * `forbidNonWhitelisted`, so a property the declared class does not carry is
 * refused with a 400 however correctly the handler then reads it from a
 * parameter of its own.
 */
export class SourceLocationListQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  supermarketId!: string;

  @ApiPropertyOptional({
    enum: SourceLocationStatus,
    description:
      'The queue defaults to UNMAPPED in the back office, because it exists to be drained. The other two are reachable so a wrong mapping can be found and undone.',
  })
  @IsOptional()
  @IsEnum(SourceLocationStatus)
  status?: SourceLocationStatus;
}

/**
 * The alias queue, per chain. The chain is chosen first, as the entries queue
 * does, because the queue is per chain by construction.
 *
 * The chain is a path segment here rather than a property on this class, so the
 * trap plan 0084 met next door does not apply: `forbidNonWhitelisted` refuses a
 * QUERY parameter the class does not declare, and a route parameter is not one.
 */
export class SourceAliasListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    enum: SourceAliasStatus,
    description:
      'Absent lists CANDIDATE and UNRESOLVED, which is the queue: the rows waiting for a person.',
  })
  @IsOptional()
  @IsEnum(SourceAliasStatus)
  status?: SourceAliasStatus;

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
