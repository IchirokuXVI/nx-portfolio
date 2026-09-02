import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  GENERATED_LIST_LIMITS,
  GENERATED_LIST_SHARING_LIMITS,
  LINE_QUANTITY_MAX,
  SettlementOutcome,
} from '@portfolio/luna-shopper/contracts';
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
  ValidateNested,
} from 'class-validator';

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
      'What the client believed was outstanding when the control was picked up. A mismatch is refused with `outstanding_moved` rather than applied, because somebody else moving the line can invert what the gesture meant: refetch and show the number as it stands.',
  })
  @IsInt()
  @Min(0)
  @Max(LINE_QUANTITY_MAX)
  from!: number;
}
