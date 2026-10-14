import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BASKET_CHANGE_LIMITS,
  BASKET_LIMITS,
  BASKET_SHARING_LIMITS,
  BasketStatus,
  LINE_QUANTITY_MAX,
  SettlementOutcome,
} from '@portfolio/luna-shopper/contracts';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Request bodies for the basket (plan 0136).
 *
 * Every write carries `from`: what the client believed the number was when it
 * drew the control. A gesture whose meaning depends on where it started must be
 * refused rather than reinterpreted when somebody else moved it, which is why
 * `from` is **required** on three of the four and never optional.
 *
 * Every write on a row also carries `lineIds` (plan 0201, section 4). A row is
 * recomputed on every read, and two reads at two shops can group the same
 * lines differently, so the write names the lines it means and core acts on
 * those and no others. The `rowKey` of the path must be one of them.
 */

/**
 * The lines a write on a row acts on (plan 0201, section 4).
 *
 * One stack of decorators for the five places that take it, so the bounds
 * cannot differ between them: 1 to `BASKET_LIMITS.maxWriteLines` ids, each a
 * uuid, none twice.
 */
function LineIds(description: string): PropertyDecorator {
  return applyDecorators(
    ApiProperty({
      type: [String],
      format: 'uuid',
      minItems: 1,
      maxItems: BASKET_LIMITS.maxWriteLines,
      uniqueItems: true,
      description,
    }),
    IsArray(),
    ArrayMinSize(1),
    ArrayMaxSize(BASKET_LIMITS.maxWriteLines),
    ArrayUnique(),
    IsUUID('all', { each: true })
  );
}

/** One entry's share of a settle, when the caller allocates by hand. */
export class BasketAllocationDto {
  @ApiProperty({ format: 'uuid', description: 'The list line to charge.' })
  @IsUUID()
  lineId!: string;

  @ApiProperty({ minimum: 0, maximum: LINE_QUANTITY_MAX })
  @IsInt()
  @Min(0)
  @Max(LINE_QUANTITY_MAX)
  quantity!: number;
}

export class SettleBasketRowDto {
  @LineIds(
    'The list lines this settle acts on: the entries of the row as you drew it. The `rowKey` of the path must be one of them. A line the basket does not cover, or on a list you were not served, answers 404.'
  )
  lineIds!: string[];

  @ApiProperty({ enum: SettlementOutcome, enumName: 'SettlementOutcome' })
  @IsIn(Object.values(SettlementOutcome))
  outcome!: SettlementOutcome;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: LINE_QUANTITY_MAX,
    description:
      'Units bought. Absent means everything the row still asks for. Ignored for NOT_AVAILABLE, which is an outcome rather than a quantity. It is not capped at what the row asks for: buying three of a row that says two records three.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(LINE_QUANTITY_MAX)
  quantity?: number;

  @ApiProperty({
    minimum: 0,
    maximum: LINE_QUANTITY_MAX,
    description:
      'The sum of `left` over the lines in `lineIds`, as you drew them. Refused with `stale_quantity` when somebody else moved it first, which is also what catches a double tap.',
  })
  @IsInt()
  @Min(0)
  @Max(LINE_QUANTITY_MAX)
  from!: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The product of the row as you drew it: its `productId`, or another product chosen for this trip only, which does not have to be a product of any of the lines. An id the catalog does not know answers 400 `validation_failed` on `itemId`. Left out, the settle records the product the named lines count as when they agree on one, and none otherwise. Leave it out for lines that hold no product.',
  })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    deprecated: true,
    description:
      'No longer read (plan 0202). The gateway chooses the price itself, as the basket’s owner: at the shop of the settle, or the cheapest across the owner’s areas when the settle has no shop. The field is accepted for one release, so a client that still sends it is not refused.',
  })
  @IsOptional()
  @IsUUID()
  priceScopeId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The one shop you are standing in, when you chose one. The buy is priced at that shop, also when it is outside the basket owner’s areas, and records the shop with its chain. A shop that has no price for the product records no price and no shop. Leave it out in "any shop" mode: the buy then records the cheapest price across the owner’s areas, with no shop and no chain. On a basket started at a shop, that shop is the shop of every settle, and a different one answers 409 `basket_shop_locked`.',
  })
  @IsOptional()
  @IsUUID()
  supermarketLocationId?: string;

  @ApiPropertyOptional({
    type: [BasketAllocationDto],
    description:
      'Which household got what. Derived oldest first when absent. Every `lineId` must be one of `lineIds`.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BASKET_LIMITS.maxSources)
  @ValidateNested({ each: true })
  @Type(() => BasketAllocationDto)
  allocations?: BasketAllocationDto[];
}

/**
 * Take part of a row back.
 *
 * One body with a discriminating `target` rather than two routes, because they
 * are one gesture with two things it can be aimed at. `units` and `from` belong
 * to `UNITS` alone: a close holds no units, so it has no number to take back,
 * and the service refuses them on the other branch.
 */
export class RevertBasketRowDto {
  @LineIds(
    'The list lines this revert acts on. The `rowKey` of the path must be one of them.'
  )
  lineIds!: string[];

  @ApiProperty({
    enum: ['UNITS', 'CLOSE'],
    description:
      'UNITS takes back what somebody said they bought. CLOSE takes back the standing "the shop did not have it".',
  })
  @IsIn(['UNITS', 'CLOSE'])
  target!: 'UNITS' | 'CLOSE';

  @ApiPropertyOptional({ minimum: 1, maximum: LINE_QUANTITY_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(LINE_QUANTITY_MAX)
  units?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: LINE_QUANTITY_MAX,
    description:
      'The sum of `bought` over the lines in `lineIds`, as you drew them. Required for UNITS.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(LINE_QUANTITY_MAX)
  from?: number;
}

export class SetBasketRowDemandDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The list line whose ask to move, always. It is the `rowKey` of the path. It can be a line at zero on a covered list, which is how a list that holds a product at zero asks for it again.',
  })
  @IsUUID()
  lineId!: string;

  @ApiProperty({
    minimum: 0,
    maximum: LINE_QUANTITY_MAX,
    description: 'What that list asks for from now on. Zero is allowed.',
  })
  @IsInt()
  @Min(0)
  @Max(LINE_QUANTITY_MAX)
  quantity!: number;

  @ApiProperty({ minimum: 0, maximum: LINE_QUANTITY_MAX })
  @IsInt()
  @Min(0)
  @Max(LINE_QUANTITY_MAX)
  from!: number;
}

/**
 * Put a line on one of the basket's lists.
 *
 * **`targetListId` is required, and that is the field's presence doing work.**
 * Plan 0055's guest composer had no target because the line lived in the basket
 * and nowhere else. A basket holds no lines now, so a line has to reach a list
 * or it does not exist, and naming which one is the whole of the gesture.
 */
export class AddBasketLineDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The list to put it on. You must hold WRITE on it yourself, and it must be one the basket covers.',
  })
  @IsUUID()
  targetListId!: string;

  @ApiProperty({
    minLength: 1,
    maxLength: BASKET_LIMITS.contentMaxLength,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(BASKET_LIMITS.contentMaxLength)
  content!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: LINE_QUANTITY_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(LINE_QUANTITY_MAX)
  quantity?: number;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'The product set to attach, as the list’s own add takes it.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BASKET_LIMITS.maxOptions)
  @IsUUID('4', { each: true })
  itemIds?: string[];

  @ApiPropertyOptional({
    default: true,
    description:
      'Whether a person typed the content (plan 0207), as the list’s own add takes it. False is kept only when the line holds a product.',
  })
  // As on the list's own add: only a JSON true or false passes.
  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj?.['named'])
  @IsOptional()
  @IsBoolean()
  named?: boolean;
}

/**
 * Change the product of basket lines (plan 0202, section 3).
 *
 * The body has no field for a price or a name. The gateway reads both, as it
 * does for a settle.
 */
export class ChangeBasketLinesProductDto {
  @LineIds(
    'The list lines whose product changes: the entries of the row as you drew it. A line the basket does not cover answers 404 for the whole request, and nothing is written.'
  )
  lineIds!: string[];

  @ApiProperty({
    format: 'uuid',
    description:
      'The product the lines change to. It does not have to be a product of any of them. An id the catalog does not know answers 400 `validation_failed` on `itemId`.',
  })
  @IsUUID()
  itemId!: string;

  @ApiProperty({
    description:
      'True keeps the change: the product joins the products of each line and becomes its favourite, which needs the right to edit each line, and one line that fails that answers 403 with nothing written. False holds it for this trip only: the buys of this trip are rewritten and no line is. With false and no buy in this trip nothing is written, and the answer is the lines as they are.',
  })
  @IsBoolean()
  keep!: boolean;
}

/**
 * Put the named lines of a row off for now (plan 0137; plan 0201, section 4).
 *
 * The body of the `PUT`. It carries no `from`, for the reason the contract
 * gives: "not today" means the same whatever the row says is left.
 */
export class SkipBasketRowDto {
  @LineIds(
    'The list lines to put off. The `rowKey` of the path must be one of them.'
  )
  lineIds!: string[];
}

/**
 * Take the skip back from the named lines (plan 0137; plan 0201, section 4).
 *
 * **A query and not a body**, because a body on a `DELETE` is not delivered
 * reliably: proxies and HTTP clients are free to drop it. So the lines travel
 * as one comma separated parameter, `?lineIds=a,b`. The parameter repeated
 * (`?lineIds=a&lineIds=b`) is read the same way.
 *
 * The bounds are the ones of every other write on a row. A hundred ids are
 * about 3,700 characters, which fits a URL.
 */
export class UnskipBasketRowQueryDto {
  @LineIds(
    'The list lines to take the skip back from, comma separated. The `rowKey` of the path must be one of them.'
  )
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value
  )
  lineIds!: string[];
}

export class RenameBasketRowDto {
  @LineIds(
    'The list lines to rename, each on its own list. The `rowKey` of the path must be one of them. A line that has a product answers 400 `validation_failed`: a row with a product is named by the catalog.'
  )
  lineIds!: string[];

  @ApiProperty({
    minLength: 1,
    maxLength: BASKET_LIMITS.contentMaxLength,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(BASKET_LIMITS.contentMaxLength)
  content!: string;

  @ApiPropertyOptional({
    description:
      'Agree to the fold the new name would cause on a list that already holds it. Anything but true refuses the rename with `line_merge_required`, and the refusal writes nothing.',
  })
  @IsOptional()
  @IsBoolean()
  confirmMerge?: boolean;
}

/**
 * The query half of the changes view (plan 0138, section 8).
 *
 * **Every value lives on this DTO**, including the ones a route might otherwise
 * take as a second `@Query()`: a `@Query('x')` beside a `@Query()` object makes
 * the whole route answer 400, so the object is the only shape a query ever has
 * here.
 *
 * Its own class rather than `PageQueryDto`, because the bounds are this route's:
 * the page is twenty by default and a hundred at most, stated in the contract so
 * core and the gateway cannot name different numbers.
 */
/**
 * The query half of the basket read (plan 0163, section 2).
 *
 * Only a shop id travels. A person's coordinates never reach this read.
 */
export class BasketReadQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Read the basket at this shop: every product carries `atShop`, its price at the shop and what is known about its availability there, and the shop is named in `scopes`. The shop does not have to be in the owner’s areas. On a basket started at a shop, that shop is always used and a different one answers 409 `basket_shop_locked`.',
  })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export class BasketChangesQueryDto {
  @ApiPropertyOptional({
    description: 'The `nextCursor` of the previous page. Opaque.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: BASKET_CHANGE_LIMITS.maxPageSize,
    description: `Changes per page. ${BASKET_CHANGE_LIMITS.pageSize} when absent.`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(BASKET_CHANGE_LIMITS.maxPageSize)
  limit?: number;
}

/**
 * Say which changes were drawn (plan 0138, section 6).
 *
 * The id of the newest change the client **drew**, never "everything up to now"
 * and never a timestamp: a change that arrived between the read and this call
 * stays unseen, and no client clock is ever compared to a server one.
 */
export class AcknowledgeBasketChangesDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The newest change you drew, from `newestUnseenChangeId` on the basket or from the changes view. One older than the cursor writes nothing and answers the count as it stands.',
  })
  @IsUUID()
  through!: string;
}

/** The longest search term the composer may send (plan 0055, section 5). */
export const BASKET_SUGGEST_QUERY_MAX_LENGTH = 120;

// --- The collection routes' bodies and queries (plan 0050) -------------------

/**
 * The generated shopping list request bodies (plan 0050, section 9).
 *
 * The caps come from `BASKET_LIMITS` rather than from numbers written
 * here, so the DTO, the JSON Schema and the service enforce the same five hundred
 * and the same one hundred. What the DTO cannot express is checked in core
 * anyway: a request that slips past validation still meets the service's own
 * rules, chiefly that a source the caller cannot draw from contributes nothing.
 */

export class BasketSourceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  zoneId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Null means every list in the zone the caller may draw from, rather than one list within it.',
  })
  @IsOptional()
  @IsUUID()
  listId?: string | null;
}

export class CreateBasketDto {
  @ApiPropertyOptional({
    type: [BasketSourceDto],
    maxItems: BASKET_LIMITS.maxSources,
    description:
      'The zones and lists to draw from. Omitted falls back to the profile named below, then to the caller default profile, which draws from everything they may write to.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BASKET_LIMITS.maxSources)
  @ValidateNested({ each: true })
  @Type(() => BasketSourceDto)
  sources?: BasketSourceDto[];

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The shopping profile whose stored generation sources the run should use. Only consulted when no sources are given.',
  })
  @IsOptional()
  @IsUUID()
  profileId?: string;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: BASKET_LIMITS.nameMaxLength,
    description:
      'Null renders as the generation date on the client. The default is never stored, because the server does not know the reader locale.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(BASKET_LIMITS.nameMaxLength)
  name?: string | null;

  @ApiPropertyOptional({
    maxLength: 200,
    description:
      'Repeat the same key to get the basket the first call produced, rather than a second basket.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  idempotencyKey?: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: BASKET_SHARING_LIMITS.maxParticipants - 1,
    uniqueItems: true,
    description:
      'People to share the basket with as it is created, chosen from GET /v1/contacts. Each must share an approved group with the caller at this moment, or the whole request is refused with validation_failed naming the ids that are not.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BASKET_SHARING_LIMITS.maxParticipants - 1)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  memberUserIds?: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The shop the basket is bought at. It must exist (404 otherwise) and does not have to be in your areas. It is fixed for the life of the basket and for everybody in it: no request changes it afterwards.',
  })
  @IsOptional()
  @IsUUID()
  supermarketLocationId?: string;
}

export class UpdateBasketDto {
  @ApiPropertyOptional({
    nullable: true,
    maxLength: BASKET_LIMITS.nameMaxLength,
  })
  @IsOptional()
  @IsString()
  @MaxLength(BASKET_LIMITS.nameMaxLength)
  name?: string | null;

  @ApiPropertyOptional({ enum: BasketStatus })
  @IsOptional()
  @IsEnum(BasketStatus)
  status?: BasketStatus;
}

/** The query half of the history listing (plan 0050, section 7). */
export class ListBasketsQueryDto {
  @ApiPropertyOptional({
    description: 'The `nextCursor` of the previous page. Opaque.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Include archived baskets, which the default listing leaves out without deleting them.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeArchived?: boolean;
}

/** The query half of the shared baskets listing (plan 0114, section 8). */
export class ListSharedBasketsQueryDto {
  @ApiPropertyOptional({
    description: 'The `nextCursor` of the previous page. Opaque.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
