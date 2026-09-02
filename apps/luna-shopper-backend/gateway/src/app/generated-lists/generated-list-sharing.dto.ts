import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  GENERATED_LIST_LIMITS,
  GENERATED_LIST_SHARING_LIMITS,
  LINE_QUANTITY_MAX,
  SettlementOutcome,
} from '@portfolio/luna-shopper/contracts';
import { MAX_PAGE_SIZE } from '@portfolio/luna-shopper/platform';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
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
 * The longest search term the composer may send (plan 0055, section 5).
 *
 * The same hundred and twenty characters `catalog/suggest` accepts, because the
 * plan asks for the same answer field for field and a term one route would
 * refuse and the other would run is not the same route twice.
 */
export const BASKET_SUGGEST_QUERY_MAX_LENGTH = 120;

/**
 * Request bodies for sharing a basket (plan 0051).
 *
 * The caps come from `GENERATED_LIST_SHARING_LIMITS` rather than from numbers
 * written here, so the DTO, the JSON Schema and the service enforce the same
 * forty characters and the same fifty people.
 */

export class EnsureShareLinkDto {
  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    description:
      'When the invitation lapses. Defaults to the cap; a longer value is capped rather than refused, since an unauthenticated read of somebody’s shopping habits should not outlive the trip.',
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

export class RevokeShareLinkDto {
  @ApiPropertyOptional({
    description:
      'Also revoke everybody this link let in. Without it the link stops accepting new people and every existing participant keeps working, which is the common case: stop it spreading, do not throw out the people in the shop.',
  })
  @IsOptional()
  @IsBoolean()
  revokeParticipants?: boolean;
}

export class JoinGeneratedListDto {
  @ApiPropertyOptional({
    maxLength: GENERATED_LIST_SHARING_LIMITS.displayNameMaxLength,
    description:
      'What to call this person on the screen. Unverified text on an unauthenticated link, so it is never treated as identity; skipping it gets them "Guest N".',
  })
  @IsOptional()
  @IsString()
  @MaxLength(GENERATED_LIST_SHARING_LIMITS.displayNameMaxLength)
  displayName?: string;
}

/**
 * Swap a line's pick (plan 0051, section 6.1).
 *
 * A body of one field rather than a query parameter, because it is a write and
 * because the same shape is where a second product attribute would go if the
 * pick ever grew one.
 */
export class SetGeneratedListPickDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The product to buy instead. Must be one of the line’s own options, which the service checks: the options are the line’s set rather than the whole catalog.',
  })
  @IsUUID()
  itemId!: string;
}

/**
 * Set one list's contribution to a basket line (plan 0057, section 5).
 *
 * `listId` and `lineId` name the **zone** line, not the basket line: the basket
 * line is already in the path. They keep the plan's own names here, where the
 * body is read beside the URL and the pairing is obvious, and are forwarded to
 * core as `sourceListId` and `sourceLineId`, where nothing sits beside them to
 * make the difference obvious.
 *
 * **This buys nothing.** The same control one screen up means "bought"; this one
 * means what a household wants, and the response carries neither settlement refs
 * nor a skip report so a client cannot read one into the other.
 */
export class SetGeneratedListOriginQuantityDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The zone list whose contribution is being set. It must be one the basket’s owner and you both hold write access on.',
  })
  @IsUUID()
  listId!: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'The zone line: an existing origin of this basket line, or one holding the same thing that is being adopted into it.',
  })
  @IsUUID()
  lineId!: string;

  @ApiProperty({
    minimum: 0,
    maximum: GENERATED_LIST_LIMITS.maxQuantity,
    description:
      'What this list should contribute. Zero takes the list off the line, releases its claim and lowers its own line by what it had contributed. No settlement is written and no bought indicator is set.',
  })
  @IsInt()
  @Min(0)
  @Max(GENERATED_LIST_LIMITS.maxQuantity)
  quantity!: number;

  @ApiProperty({
    minimum: 0,
    maximum: GENERATED_LIST_LIMITS.maxQuantity,
    description:
      'The contribution you believed this list had, which is 0 for an adoption. A mismatch is refused with `stale_quantity` rather than applied: two people editing one split must not silently overwrite each other’s arithmetic.',
  })
  @IsInt()
  @Min(0)
  @Max(GENERATED_LIST_LIMITS.maxQuantity)
  from!: number;
}

export class GeneratedListAllocationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  listId!: string;

  @ApiProperty({ minimum: 0, maximum: GENERATED_LIST_LIMITS.maxQuantity })
  @IsInt()
  @Min(0)
  @Max(GENERATED_LIST_LIMITS.maxQuantity)
  quantity!: number;
}

/**
 * Settle a basket line (plan 0051, section 6).
 *
 * Three gestures in one body, because they are the same act with progressively
 * more of it supplied: no `quantity` settles the whole outstanding amount, a
 * `quantity` settles that many allocated oldest origin first, and `allocations`
 * supplies the allocation as well.
 */
export class SettleGeneratedListLineDto {
  @ApiProperty({ enum: SettlementOutcome, enumName: 'SettlementOutcome' })
  @IsEnum(SettlementOutcome)
  outcome!: SettlementOutcome;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: GENERATED_LIST_LIMITS.maxQuantity,
    description:
      'Units settled. Absent means the whole outstanding amount. Ignored for NOT_AVAILABLE, which is an outcome rather than a quantity.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(GENERATED_LIST_LIMITS.maxQuantity)
  quantity?: number;

  @ApiPropertyOptional({
    type: [GeneratedListAllocationDto],
    description:
      'The allocation sheet: the same operation with the allocation supplied instead of derived. Refused for a caller who may not see zone data, since naming source lists is naming zone data.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(GENERATED_LIST_LIMITS.maxSources)
  @ValidateNested({ each: true })
  @Type(() => GeneratedListAllocationDto)
  allocations?: GeneratedListAllocationDto[];

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The product actually in the trolley, when it is not the line’s current pick. Must be one of the line’s own options.',
  })
  @IsOptional()
  @IsUUID()
  itemId?: string;
}

/**
 * Put a line in the basket, as any live participant (plan 0055, section 3).
 *
 * ## No `targetListId`, and that is the field's absence doing work
 *
 * The owner's own `AddGeneratedListLineDto` has one, and this deliberately does
 * not. A body that named a target would be asking a household's shopping list
 * for a line, which is a gesture with a list picker in front of it and which
 * plan `0058` owns. With `forbidNonWhitelisted` on the global pipe, sending one
 * is refused by name rather than dropped, so a client that tries learns which
 * field was wrong instead of watching its target vanish.
 */
export class AddGeneratedListParticipantLineDto {
  @ApiProperty({
    maxLength: GENERATED_LIST_LIMITS.contentMaxLength,
    description: 'What to buy, as the shopper typed it.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(GENERATED_LIST_LIMITS.contentMaxLength)
  content!: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: GENERATED_LIST_LIMITS.maxQuantity,
    description: 'How many. Defaults to one; zero is not an add.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(GENERATED_LIST_LIMITS.maxQuantity)
  quantity?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The product this line means, when the composer offered one and the shopper took it. Absent for a free text line, which has been first class since plan 0043.',
  })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'The products the pick may be switched between: what a product group suggestion attaches.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(GENERATED_LIST_LIMITS.maxOptions)
  @IsUUID(undefined, { each: true })
  options?: string[];
}

/**
 * Searching the catalog through a basket (plan 0055, section 5).
 *
 * A query and a size, and deliberately no scope selector: `catalog/suggest`
 * takes postal codes, supermarkets and a profile because its caller has an
 * account to own them, and the scope here is the **run's** rather than the
 * caller's (section 5.1). A guest naming where to price a stranger's basket is
 * not a thing to accept and ignore.
 */
export class BasketSuggestQueryDto {
  @ApiPropertyOptional({
    description:
      'What the shopper has typed. The composer asks after three characters.',
    maxLength: BASKET_SUGGEST_QUERY_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(BASKET_SUGGEST_QUERY_MAX_LENGTH)
  q?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;
}

/**
 * Move what is still to get on a basket line (plan 0056, section 3).
 *
 * **Two absolute numbers rather than a signed delta**, which deviates from plan
 * 0047 section 2.1 on purpose. The zone list’s stepper emits a run of increments
 * while a thumb moves, so a delta there cannot race and a retry is harmless;
 * this control commits once, on release, and its meaning depends on its sign, so
 * a retried `-2` after a network wobble would buy two more tins.
 *
 * Bounded by `LINE_QUANTITY_MAX` rather than by `GENERATED_LIST_LIMITS.maxQuantity`
 * above it, and the two are different bounds on different things: that one caps
 * the units **one settle** may claim, and this is how many a line may ask for,
 * which is the limit a zone line already has. The service applies it again to
 * the resulting `quantity`, which is the number it is really about.
 */
export class SetGeneratedListLineOutstandingDto {
  @ApiProperty({
    minimum: 0,
    maximum: LINE_QUANTITY_MAX,
    description:
      'How many are still to get after this. Above the current amount the basket will buy more and nothing is settled; below it, the difference was bought. Zero finishes the line, exactly as “got all” does.',
  })
  @IsInt()
  @Min(0)
  @Max(LINE_QUANTITY_MAX)
  outstanding!: number;

  @ApiProperty({
    minimum: 0,
    maximum: LINE_QUANTITY_MAX,
    description:
      'What the client believed was outstanding when the control was picked up. A mismatch is refused with `stale_quantity` rather than applied, because somebody else moving the line can invert what the gesture meant: refetch and show the number as it stands.',
  })
  @IsInt()
  @Min(0)
  @Max(LINE_QUANTITY_MAX)
  from!: number;
}

/**
 * Send an added basket line to a shopping list (plan 0058, section 4).
 *
 * `listId` names the **zone** list receiving the line; the basket line is
 * already in the path.
 *
 * **One field, and deliberately no quantity.** What the created line asks for is
 * the basket line's outstanding amount, and the server computes it (section
 * 4.1): a shopper who has already bought three of the four batteries is asking
 * the household for one, and a number here would let a client ask for four.
 *
 * There is no inverse of this request and there is not going to be one. Clearing
 * a target does not delete the line it created (plan 0050, section 5); removing
 * it is done on the target list, by somebody with access, as an ordinary delete.
 */
export class BindGeneratedListLineDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The shopping list to send this line to. Must be one both you and the basket’s owner can write right now: the owner’s access is what authorizes every later settle on it, so a list they cannot write would give the household a line it never sees bought.',
  })
  @IsUUID()
  listId!: string;
}
