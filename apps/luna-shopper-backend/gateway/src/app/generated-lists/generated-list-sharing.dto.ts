import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  GENERATED_LIST_SHARING_LIMITS,
} from '@portfolio/luna-shopper/contracts';
import { MAX_PAGE_SIZE } from '@portfolio/luna-shopper/platform';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
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

/** Add one of the caller's contacts to a basket (plan 0114, section 4). */
export class AddGeneratedListParticipantDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The person to add, chosen from GET /v1/contacts. They must share an approved group with the caller at this moment.',
  })
  @IsUUID()
  userId!: string;
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
      'What the shopper has typed. The composer asks after three characters. A whole barcode matches the product carrying it, and that product is listed first.',
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

