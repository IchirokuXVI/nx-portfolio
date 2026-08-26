import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ZoneRole } from '@portfolio/luna-shopper/contracts';
import {
  PageQueryDto,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from '@portfolio/luna-shopper/platform';
import {
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * The per zone display name is optional on both create and join (plan 0018,
 * section 9). Omitting it means "call me by my global username here", which is
 * the common path: the home page offers "Create a group" and "Join with a code"
 * as one tap actions with no name field, and the backend already generated a
 * name when the identity was created. The gateway resolves the default before
 * calling core, which always receives a concrete string.
 */
const USERNAME_API_PROPERTY = {
  maxLength: USERNAME_MAX_LENGTH,
  description:
    'Your display name in this zone. Omit it to be called by your global username.',
};

/** Create a zone (plan 0006, section 3). */
export class CreateZoneDto {
  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional(USERNAME_API_PROPERTY)
  @IsOptional()
  @IsString()
  @MinLength(USERNAME_MIN_LENGTH)
  @MaxLength(USERNAME_MAX_LENGTH)
  username?: string;
}

/** Join a zone by code (plan 0006, section 3). */
export class JoinZoneDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  joinCode!: string;

  @ApiPropertyOptional(USERNAME_API_PROPERTY)
  @IsOptional()
  @IsString()
  @MinLength(USERNAME_MIN_LENGTH)
  @MaxLength(USERNAME_MAX_LENGTH)
  username?: string;
}

/** Rename one membership in a zone (plan 0018, section 5). */
export class SetMembershipUsernameDto {
  @ApiProperty(USERNAME_API_PROPERTY)
  @IsString()
  @MinLength(USERNAME_MIN_LENGTH)
  @MaxLength(USERNAME_MAX_LENGTH)
  username!: string;
}

/** Edit a zone (plan 0006, section 4). */
export class UpdateZoneDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

/** Promote/demote a member (plan 0006, section 4). */
export class SetRoleDto {
  @ApiProperty({ enum: [ZoneRole.ADMIN, ZoneRole.MEMBER] })
  @IsEnum(ZoneRole)
  role!: ZoneRole;
}

/** Cursor + order for listing my zones (plan 0006, section 7). */
export class ListMyZonesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['name', 'joined', 'recent'] })
  @IsOptional()
  @IsIn(['name', 'joined', 'recent'])
  order?: string;
}
