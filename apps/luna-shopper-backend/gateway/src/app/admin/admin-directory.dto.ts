import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserKind } from '@portfolio/luna-shopper/contracts';
import { PageQueryDto } from '@portfolio/luna-shopper/platform';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { IsUuidOrNone, referenceFilterDescription } from './reference-none';

/**
 * A query string boolean.
 *
 * `?verified` with no value means true, which is how a checkbox that is simply
 * present reads, and the two spellings are accepted so a client can be explicit.
 * Anything else falls through unchanged and `@IsBoolean` refuses it, rather than
 * being silently coerced to false, which would answer a different question from
 * the one asked.
 */
const asBoolean = ({ value }: { value: unknown }) => {
  if (value === '' || value === 'true' || value === true) {
    return true;
  }
  return value === 'false' || value === false ? false : value;
};

/**
 * The filters on the user directory (plan 0074, section 2).
 *
 * Every one of them is optional and they compose with AND, so no combination is
 * a special case and a request with none of them is the whole table. They are a
 * class of their own rather than fields on any user facing DTO: nothing a velista
 * user can send searches other people.
 */
export class ListAdminUsersQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description:
      'Case insensitive substring of the global username. This is what `ix_users_username` exists for.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  username?: string;

  @ApiPropertyOptional({
    description: 'Case insensitive substring of the email address.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @ApiPropertyOptional({ enum: UserKind })
  @IsOptional()
  @IsEnum(UserKind)
  kind?: UserKind;

  @ApiPropertyOptional({
    description:
      'True for confirmed addresses only. False is unconfirmed **and** absent: an account with no address has not confirmed one, and an operator looking for unconfirmed accounts wants it in the answer.',
  })
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  verified?: boolean;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Inclusive lower bound on when the account was created.',
  })
  @IsOptional()
  @IsISO8601()
  createdAfter?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Exclusive upper bound on when the account was created.',
  })
  @IsOptional()
  @IsISO8601()
  createdBefore?: string;
}

/**
 * The zone listing's filters (plan 0074, section 2).
 *
 * `userId` is the whole filter and that is the requirement rather than a first
 * version of it: a general zone search with usage statistics is a different
 * feature. It is not validated against auth and cannot be, because core has no
 * access to that table; an id belonging to nobody answers with an empty page.
 */
export class ListAdminZonesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Only zones this person is in, as owner or as a member of any status. A banned membership counts: "why can this person not see their zone" is a question this screen exists to answer.',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  /**
   * The owner alone, where `userId` is anybody in the zone (admin plan 0012,
   * section 3). It exists for its other answer: `none` is the zones nobody
   * owns, which is what an owner's deletion leaves behind, and the one
   * orphaned row the back office's people screens can hold.
   */
  @ApiPropertyOptional({
    description: referenceFilterDescription(
      'Only zones this person owns.',
      'the zones with no owner, which is what deleting an owner leaves behind.'
    ),
  })
  @IsOptional()
  @IsUuidOrNone()
  ownerUserId?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  createdAfter?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  createdBefore?: string;
}

/** Shopping lists, by the zone they are in or the person who created them. */
export class ListAdminListsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The person who created the list, who is not necessarily the zone’s owner.',
  })
  @IsOptional()
  @IsUUID()
  createdByUserId?: string;
}

/** Baskets, by owner or by a zone their lines were drawn from. */
export class ListAdminBasketsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Baskets with at least one line drawn from a list in this zone. A basket belongs to a person rather than to a zone, so this matches through the line origins.',
  })
  @IsOptional()
  @IsUUID()
  zoneId?: string;
}

/** The postal code table's two filters (plan 0074, section 2). */
export class ListAdminPostalCodesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description: 'ISO 3166-1 alpha-2. Defaults to every country in the table.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  @ApiPropertyOptional({
    description:
      'Prefix match. A postal code is read left to right, so `28` means the province rather than every code with a 28 in the middle of it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  postalCode?: string;

  @ApiPropertyOptional({
    description:
      'True for codes with at least one shop, false for those with none. Omitted is every code, which is the default because a listing that hid the empty ones would hide the coverage gap it exists to show.',
  })
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  served?: boolean;
}

/** The locale of the confirmation mail an operator resends on somebody's behalf. */
export class ResendAdminVerificationDto {
  @ApiPropertyOptional({
    description:
      'Locale for the confirmation email; defaults to the request locale.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(35)
  locale?: string;
}
