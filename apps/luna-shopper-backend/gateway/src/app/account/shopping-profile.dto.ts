import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  GenerationScope,
  PROFILE_LIMITS,
} from '@portfolio/luna-shopper/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
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
 * The shopping profile request bodies (plan 0049, section 6).
 *
 * The caps come from `PROFILE_LIMITS` rather than from numbers written here, so
 * the DTO, the JSON Schema and the service enforce the same ten and the same
 * five. What the DTO cannot express is checked in core anyway: a request that
 * slips past validation still meets the service's own rules.
 */

export class ProfilePostalCodeDto {
  @ApiProperty({ maxLength: PROFILE_LIMITS.postalCodeMaxLength })
  @IsString()
  @MinLength(1)
  @MaxLength(PROFILE_LIMITS.postalCodeMaxLength)
  postalCode!: string;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: PROFILE_LIMITS.labelMaxLength,
    description:
      '"home", "the office". Display only; nothing is derived from it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(PROFILE_LIMITS.labelMaxLength)
  label?: string | null;
}

export class ProfileSupermarketDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The chain, never one of its locations: "no DIA" means no DIA anywhere.',
  })
  @IsUUID()
  supermarketId!: string;

  @ApiPropertyOptional({
    description:
      'Excluded rather than simply absent, so "everything except DIA" does not mean listing every other chain, and a chain added later is included by default.',
  })
  @IsOptional()
  @IsBoolean()
  excluded?: boolean;
}

export class ProfileGenerationSourceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  zoneId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Null means the whole zone rather than one list within it.',
  })
  @IsOptional()
  @IsUUID()
  listId?: string | null;
}

/**
 * Everything editable about a profile. Create and update take the same body, and
 * the three collections are **full replacements**: absent leaves them alone,
 * present makes them exactly what was sent, empty clears them.
 */
export class ShoppingProfileBodyDto {
  @ApiPropertyOptional({
    nullable: true,
    maxLength: PROFILE_LIMITS.nameMaxLength,
    description:
      'Null renders as the client’s localized default ("My profile" / "Mi perfil"). The server stores no English word, because it does not know the caller’s language.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(PROFILE_LIMITS.nameMaxLength)
  name?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: PROFILE_LIMITS.addressMaxLength,
    description:
      'Display and context only. Nothing is geocoded; the postal codes are what resolve to prices.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(PROFILE_LIMITS.addressMaxLength)
  addressText?: string | null;

  @ApiPropertyOptional({
    minimum: 0,
    description:
      'What a second stop must save before a generated basket suggests it.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  minSavingCents?: number;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    maximum: 100,
    description: 'The optional relative floor beside the absolute one.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minSavingPercent?: number | null;

  @ApiPropertyOptional({
    enum: GenerationScope,
    description:
      'Which zones and lists feed a generated basket. SELECTED narrows it to the sources below.',
  })
  @IsOptional()
  @IsEnum(GenerationScope)
  generationScope?: GenerationScope;

  @ApiPropertyOptional({
    type: [ProfilePostalCodeDto],
    maxItems: PROFILE_LIMITS.maxPostalCodes,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PROFILE_LIMITS.maxPostalCodes)
  @ValidateNested({ each: true })
  @Type(() => ProfilePostalCodeDto)
  postalCodes?: ProfilePostalCodeDto[];

  @ApiPropertyOptional({
    type: [ProfileSupermarketDto],
    maxItems: PROFILE_LIMITS.maxSupermarketPreferences,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PROFILE_LIMITS.maxSupermarketPreferences)
  @ValidateNested({ each: true })
  @Type(() => ProfileSupermarketDto)
  supermarkets?: ProfileSupermarketDto[];

  @ApiPropertyOptional({
    type: [ProfileGenerationSourceDto],
    maxItems: PROFILE_LIMITS.maxGenerationSources,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PROFILE_LIMITS.maxGenerationSources)
  @ValidateNested({ each: true })
  @Type(() => ProfileGenerationSourceDto)
  generationSources?: ProfileGenerationSourceDto[];
}

export class CreateShoppingProfileDto extends ShoppingProfileBodyDto {}
export class UpdateShoppingProfileDto extends ShoppingProfileBodyDto {}
