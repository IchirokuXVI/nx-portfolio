import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UsernamePropagation } from '@portfolio/luna-shopper/contracts';
import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from '@portfolio/luna-shopper/platform';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Update the caller's own profile (plan 0018, section 12). A partial update: the
 * profile's other fields (`email`, `kind`, `displayName`) are not settable here,
 * which is why the route is a PATCH and not a PUT.
 */
export class UpdateProfileDto {
  @ApiProperty({ maxLength: USERNAME_MAX_LENGTH })
  @IsString()
  @MinLength(USERNAME_MIN_LENGTH)
  @MaxLength(USERNAME_MAX_LENGTH)
  username!: string;

  @ApiPropertyOptional({
    enum: UsernamePropagation,
    default: UsernamePropagation.GLOBAL_ONLY,
    description:
      'How far the change travels. Omitted means GLOBAL_ONLY: the zones where you chose a different name keep it.',
  })
  @IsOptional()
  @IsEnum(UsernamePropagation)
  propagation?: UsernamePropagation;
}
