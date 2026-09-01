import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  GENERATED_LIST_LIMITS,
  GENERATED_LIST_SHARING_LIMITS,
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
