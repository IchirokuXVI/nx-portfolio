import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ADAPTER_KEYS,
  DiscoveredPlaceStatus,
  HarvestRunMode,
  HarvestRunStatus,
  ItemCategory,
  PriceSourceKind,
  SourceEntryStatus,
  SourceLocationStatus,
  UnitOfMeasure,
  type AdapterKey,
  type HarvestDocument,
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
    description: 'Required for CATALOG_DISCOVERY and FILE_IMPORT.',
  })
  @IsOptional()
  @IsUUID()
  supermarketId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The scope the run writes its prices for. Required for a CATALOG_DISCOVERY of a chain whose adapter yields prices; a `deza-web` one accepts it and ignores it, because the site prints none.',
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

  @ApiPropertyOptional({
    default: false,
    description:
      'Read product pages for the EAN instead of crawling the assortment (plan 0090, section 12.1). `carrefour-web` only. A crawl reads 851 listing pages in about an hour; a backfill reads one page per product that has no EAN yet, of the order of 18,000 the first time, so the two are never one run. Stopping a backfill costs nothing: an EAN is written as it is read, and a product that has one is never fetched again.',
  })
  @IsOptional()
  @IsBoolean()
  detailBackfill?: boolean;
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
 * The three official kinds, which are the only ones an upload may write (plan
 * 0086, section 9). `catalog.addPrices` enforces the same rule; stating it here
 * refuses the request before it crosses the broker.
 */
export const IMPORTABLE_SOURCE_KINDS = [
  PriceSourceKind.OFFICIAL_API,
  PriceSourceKind.OFFICIAL_WEB,
  PriceSourceKind.OFFICIAL_LEAFLET,
] as const;

/**
 * One file import (plan 0086, section 6).
 *
 * The document is **not** described field by field here. It has its own
 * versioned JSON Schema in the contracts library, the gateway validates against
 * that before the document crosses the broker, and restating the shape as a DTO
 * would be a second copy to drift from the first.
 */
export class ImportHarvestDocumentDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The chain this file is from. The document hints.chain_id fills the upload screen picker and is never a lookup key: ids do not survive an environment change.',
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

  @ApiProperty({
    enum: IMPORTABLE_SOURCE_KINDS,
    description:
      'What observed these products, which is what the rows and the prices are stamped with. Not what the upload is: a re-imported Mercadona walk is OFFICIAL_API, because that is what saw the price.',
  })
  @IsIn([...IMPORTABLE_SOURCE_KINDS])
  sourceKind!: PriceSourceKind;

  @ApiPropertyOptional({
    format: 'date',
    description:
      'Override the document validity.from, as a local day in Spain. Required when the document states none: the backend refuses a run with a null bound.',
  })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional({
    format: 'date',
    description:
      'Override the document validity.until, as a local day in Spain. Inclusive: a file valid to the 23rd is valid through the whole of the 23rd.',
  })
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'The file, as a HarvestDocument: a leaflet extractor, a person typing a chain’s prices, or another cluster’s harvest export all produce one. Validated against the versioned schema this backend can read; a document that fails is answered 400 with every failure named by its JSON path and its product id.',
  })
  @IsObject()
  document!: HarvestDocument;
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

/** Bind a queued row to a product the catalog already holds (plan 0086, section 7). */
export class AcceptSourceEntryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  itemId!: string;
}

/**
 * Create the product a queued row is for, and bind it, in one call.
 *
 * **Every field is optional**, which is the difference from the alias form this
 * replaces: the row already holds a default for each, so an operator sends only
 * what he changed and the backend fills the rest. What he cannot change is the
 * row itself, which keeps what the source printed whatever the item is called.
 */
export class CreateItemFromEntryDto {
  @ApiPropertyOptional({ type: LocalizedNameDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedNameDto)
  name?: LocalizedNameDto;

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

  @ApiPropertyOptional({
    enum: ItemCategory,
    description:
      'Override the category the source’s own tree mapped to. Mercadona has 26 top level categories against our 12, so the mapping is lossy by construction.',
  })
  @IsOptional()
  @IsEnum(ItemCategory)
  category?: ItemCategory;

  @ApiPropertyOptional({
    enum: UnitOfMeasure,
    description: 'Override the unit the source’s own size text mapped to.',
  })
  @IsOptional()
  @IsEnum(UnitOfMeasure)
  defaultUnit?: UnitOfMeasure;
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

/**
 * The one queue, per chain (plan 0086, section 10).
 *
 * `supermarketId` is **on the DTO** rather than a `@Query('supermarketId')`
 * argument beside it. `createValidationPipe` sets `whitelist` with
 * `forbidNonWhitelisted`, so a property the declared class does not carry is
 * refused with a 400 however correctly the handler then reads it from a
 * parameter of its own.
 */
export class SourceEntryListQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  supermarketId!: string;

  @ApiPropertyOptional({
    enum: SourceEntryStatus,
    description:
      'Absent lists CANDIDATE and UNRESOLVED, which is the queue: the rows waiting for a person. Naming one reaches a decision to look up or undo.',
  })
  @IsOptional()
  @IsEnum(SourceEntryStatus)
  status?: SourceEntryStatus;

  @ApiPropertyOptional({
    enum: PriceSourceKind,
    description:
      'Which kind of observation to show, so an operator working through one file’s rows is not interleaved with a walk’s 4,000.',
  })
  @IsOptional()
  @IsEnum(PriceSourceKind)
  sourceKind?: PriceSourceKind;

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
