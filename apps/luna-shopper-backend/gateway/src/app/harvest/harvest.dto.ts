import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ADAPTER_KEYS,
  BULK_DECISION_MAX_OPERATIONS,
  DiscoveredPlaceStatus,
  HarvestRunMode,
  HarvestRunStatus,
  ItemCategory,
  PostalCodeDiscoveryStatus,
  PriceSourceKind,
  SourceEntryStatus,
  SourceLocationStatus,
  UnitOfMeasure,
  type AdapterKey,
  type HarvestDocument,
} from '@portfolio/luna-shopper/contracts';
import { PageQueryDto } from '@portfolio/luna-shopper/platform';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { asBoolean } from '../catalog/catalog.dto';

/**
 * What an operator may type into a postal code field.
 *
 * Letters and digits, because a Spanish code is five digits and a Dutch one is
 * not, and nothing else at all: the queue listing puts the value straight into a
 * `LIKE` prefix, and a `%` there would match every code, which reads as a filter
 * that does nothing rather than one that found nothing.
 */
const POSTAL_CODE_PATTERN = /^[A-Za-z0-9 -]{1,16}$/;

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
    description:
      'Required for CATALOG_DISCOVERY and FILE_IMPORT, and for a STORE_DISCOVERY of a chain that publishes its own shop list (`lidl-api`).',
  })
  @IsOptional()
  @IsUUID()
  supermarketId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The scope the run writes its prices for. Required for a CATALOG_DISCOVERY of a chain whose adapter yields prices. A `deza-web` one accepts it and ignores it, because the site prints none, and a `lidl-api` one refuses it, because that chain publishes a price per region and creates the scopes itself.',
  })
  @IsOptional()
  @IsUUID()
  priceScopeId?: string;

  @ApiPropertyOptional({
    maxLength: 16,
    description:
      'Required for STORE_DISCOVERY, unless the chain named publishes its own shop list. It decides the price scope through the chain’s own resolver; the radius below decides the store list. Two questions, two sources (plan 0038, section 2.8).',
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

/**
 * The row as the decisions file saw it (plan 0100).
 *
 * Two fields, because two are enough: a row whose status has moved was decided
 * by somebody else, and a row whose `lastSeenAt` has moved was observed again by
 * a later run and may say something different from what was decided about.
 */
export class SourceEntryExpectationDto {
  @ApiProperty({ enum: SourceEntryStatus })
  @IsEnum(SourceEntryStatus)
  status!: SourceEntryStatus;

  @ApiProperty({
    format: 'date-time',
    description:
      'Exactly the string the queue listing printed for this row. A row observed again since then fails the check.',
  })
  @IsDateString()
  lastSeenAt!: string;
}

/**
 * One decision of a decisions file (plan 0100).
 *
 * **One class for both kinds, with `kind` deciding which fields matter.** A
 * discriminated union of two DTO classes is not something `class-validator`
 * expresses without a custom decorator, and the combinations are checked in the
 * harvester anyway, where they have to be: the gateway is one caller among
 * several rather than a wall. What this class buys is the type of every field
 * and the cap on the list.
 */
export class SourceEntryDecisionDto {
  @ApiProperty({
    enum: ['accept', 'createItem'],
    description:
      'accept binds the row to a product; createItem creates the product and binds the row to it. There is no bulk reject: junk is a person’s call.',
  })
  @IsIn(['accept', 'createItem'])
  op!: 'accept' | 'createItem';

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  entryId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'accept: a product the catalog already holds. Exactly one of this and itemRef.',
  })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({
    maxLength: 120,
    description:
      'accept: a product a createItem of this same file creates, which is how a second row of the same product is bound before an id exists.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  itemRef?: string;

  @ApiPropertyOptional({
    maxLength: 120,
    description: 'createItem: this file’s own name for the product it creates.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  ref?: string;

  @ApiPropertyOptional({
    type: CreateItemFromEntryDto,
    description:
      'createItem: the product to create. Every field is optional, because the row already holds a default for each.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateItemFromEntryDto)
  item?: CreateItemFromEntryDto;

  @ApiProperty({ type: SourceEntryExpectationDto })
  @ValidateNested()
  @Type(() => SourceEntryExpectationDto)
  expect!: SourceEntryExpectationDto;
}

export class ApplySourceEntryDecisionsDto {
  @ApiPropertyOptional({
    maxLength: 120,
    description:
      'The curation session this file came out of. Provenance, echoed back in the answer so a report can be filed under it; the backend stores no run of its own for a decisions file.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  runId?: string;

  @ApiProperty({
    type: [SourceEntryDecisionDto],
    maxItems: BULK_DECISION_MAX_OPERATIONS,
    description:
      'The whole file, applied in the order given. A longer file is refused rather than split: two chunks are two transactions, so the first can land while the second fails.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_DECISION_MAX_OPERATIONS)
  @ValidateNested({ each: true })
  @Type(() => SourceEntryDecisionDto)
  operations!: SourceEntryDecisionDto[];
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

  @ApiPropertyOptional({
    description: 'ISO 3166-1 alpha-2. Pair it with `postalCode`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  @ApiPropertyOptional({
    description:
      'The places located in this code, whichever run found them. It reads the place own postal code and never the run centre, so a run centred on 14013 does not put its Cordoba city neighbours in this answer.',
  })
  @IsOptional()
  @Matches(POSTAL_CODE_PATTERN)
  @MaxLength(16)
  postalCode?: string;
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
 * The one queue, of one chain or of every chain (plan 0086, section 10).
 *
 * `supermarketId` is **on the DTO** rather than a `@Query('supermarketId')`
 * argument beside it. `createValidationPipe` sets `whitelist` with
 * `forbidNonWhitelisted`, so a property the declared class does not carry is
 * refused with a 400 however correctly the handler then reads it from a
 * parameter of its own.
 */
export class SourceEntryListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'One chain’s rows. Absent lists every chain’s: the chain narrows the queue rather than addressing it, and a row names the chain it came from.',
  })
  @IsOptional()
  @IsUUID()
  supermarketId?: string;

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

/** What the postal code queue screen filters on (plan 0097, section 7). */
export class PostalCodeDiscoveryListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ maxLength: 2, description: 'ISO 3166-1 alpha-2.' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  @ApiPropertyOptional({ enum: PostalCodeDiscoveryStatus })
  @IsOptional()
  @IsEnum(PostalCodeDiscoveryStatus)
  status?: PostalCodeDiscoveryStatus;

  @ApiPropertyOptional({
    description:
      'Prefix match. A postal code is read left to right, so `140` means Cordoba city rather than every code with a 140 in the middle of it.',
  })
  @IsOptional()
  @Matches(POSTAL_CODE_PATTERN)
  @MaxLength(16)
  postalCode?: string;

  @ApiPropertyOptional({
    description:
      'Omitted lists the working set, which is the codes nobody has dismissed. True lists the dismissed ones alone, so one can be found and put back.',
  })
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  dismissed?: boolean;
}

/**
 * An operator adds one code (plan 0097, section 6.1).
 *
 * One code per call. Adding twenty is twenty calls, under the partial failure
 * rules `apps/luna-shopper-admin/plans/0020` already wrote for bulk work: a bulk
 * endpoint is a transaction boundary and a timeout budget this service does not
 * have and this screen does not need.
 */
export class AddPostalCodeDiscoveryDto {
  @ApiProperty({ maxLength: 2, description: 'ISO 3166-1 alpha-2.' })
  @IsString()
  @MaxLength(2)
  country!: string;

  @ApiProperty({
    maxLength: 16,
    description:
      'A code catalog does not hold is refused with `postal_code_unknown`: the centroid table is the whole national list, so a code missing from it is a typo.',
  })
  @Matches(POSTAL_CODE_PATTERN)
  @MaxLength(16)
  postalCode!: string;

  @ApiProperty({
    description:
      'True queues it for the worker. False parks it, which is a row the worker never claims until somebody queues it.',
  })
  @IsBoolean()
  discoverNow!: boolean;
}
