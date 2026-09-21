import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BASKET_CHANGE_LIMITS,
  GENERATED_LIST_LIMITS,
  LINE_QUANTITY_MAX,
  SettlementOutcome,
} from '@portfolio/luna-shopper/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
 */

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
      'The row’s `left` as you drew it. Refused with `stale_quantity` when somebody else moved it first, which is also what catches a double tap.',
  })
  @IsInt()
  @Min(0)
  @Max(LINE_QUANTITY_MAX)
  from!: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The product actually in the trolley, when it is not what the row suggests. Must be one of the row’s own `optionIds`.',
  })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The price scope the row’s price was read at on your screen: the scope of the shop you picked, or of the offer the screen showed. There is no field for an amount, and there will not be: the gateway reads the price itself, as the basket’s owner.',
  })
  @IsOptional()
  @IsUUID()
  priceScopeId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The one shop you are standing in. Sent only by a client that was served shops, and ignored from any other.',
  })
  @IsOptional()
  @IsUUID()
  supermarketLocationId?: string;

  @ApiPropertyOptional({
    type: [BasketAllocationDto],
    description:
      'Which household got what. Derived oldest first when absent. Every `lineId` must belong to a list you were served a ref for.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(GENERATED_LIST_LIMITS.maxSources)
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
    description: 'The row’s `bought` as you drew it. Required for UNITS.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(LINE_QUANTITY_MAX)
  from?: number;
}

export class SetBasketRowDemandDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Which household’s ask to move. Required when the row holds more than one entry, since a row of two households asks two different questions.',
  })
  @IsOptional()
  @IsUUID()
  lineId?: string;

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
    maxLength: GENERATED_LIST_LIMITS.contentMaxLength,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(GENERATED_LIST_LIMITS.contentMaxLength)
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
  @ArrayMaxSize(GENERATED_LIST_LIMITS.maxOptions)
  @IsUUID('4', { each: true })
  itemIds?: string[];
}

export class RenameBasketRowDto {
  @ApiProperty({
    minLength: 1,
    maxLength: GENERATED_LIST_LIMITS.contentMaxLength,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(GENERATED_LIST_LIMITS.contentMaxLength)
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
