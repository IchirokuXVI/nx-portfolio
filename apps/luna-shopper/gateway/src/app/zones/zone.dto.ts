import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ZoneRole } from '@portfolio/luna-shopper/contracts';
import { PageQueryDto } from '@portfolio/luna-shopper/platform';
import {
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Create a zone (plan 0006, section 3). */
export class CreateZoneDto {
  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ maxLength: 40, description: 'Your display name in this zone' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  username!: string;
}

/** Join a zone by code (plan 0006, section 3). */
export class JoinZoneDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  joinCode!: string;

  @ApiProperty({ maxLength: 40, description: 'Your display name in this zone' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
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
