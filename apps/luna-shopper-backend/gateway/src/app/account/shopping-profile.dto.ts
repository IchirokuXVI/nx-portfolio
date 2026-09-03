import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DEFAULT_POSTAL_CODE_COUNTRY,
  GenerationScope,
  PROFILE_LIMITS,
  ProfilePostalCodeSource,
} from '@portfolio/luna-shopper/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
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

/**
 * One postal code of the user's own.
 *
 * `source` accepts `TYPED` and `DEVICE` and not `NEARBY` (plan 0062, section 2):
 * a derived code is a thing the server concluded, never a thing the client says.
 * Naming one that is already derived is an ordinary add and promotes it, so
 * there is no error state here for a client to handle.
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

  @ApiPropertyOptional({
    default: DEFAULT_POSTAL_CODE_COUNTRY,
    minLength: 2,
    maxLength: 2,
    description:
      'ISO 3166-1 alpha-2. The centroid table is keyed on (country, postalCode), and a lookup without one searches every shipped country at once.',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(2)
  country?: string;

  @ApiPropertyOptional({
    enum: [ProfilePostalCodeSource.TYPED, ProfilePostalCodeSource.DEVICE],
    default: ProfilePostalCodeSource.TYPED,
    description:
      'Whose code this is. NEARBY is a conclusion of the server’s and is refused here.',
  })
  @IsOptional()
  @IsIn([ProfilePostalCodeSource.TYPED, ProfilePostalCodeSource.DEVICE])
  source?: ProfilePostalCodeSource.TYPED | ProfilePostalCodeSource.DEVICE;

  @ApiPropertyOptional({
    description:
      'Also add the codes near this one, marked as ours: visible, removable, and recomputed rather than maintained.',
  })
  @IsOptional()
  @IsBoolean()
  expandNearby?: boolean;
}

/** The body of the add route; the code itself comes from the body too. */
export class AddPostalCodeDto extends ProfilePostalCodeDto {}

/**
 * Where a device says it is (`apps/velista/plans/0058`, section 3).
 *
 * **A body and not a query string**, on a route that stores nothing. The point is
 * the one piece of this feature we promise not to keep, and a query parameter is
 * kept by every access log between the phone and the process whether we mean to
 * or not. A body is the only shape in which "the coordinates appear in exactly one
 * request and in no stored field" can be true of the whole system rather than only
 * of our own tables.
 */
export class ResolvePostalCodeDto {
  @ApiProperty({
    minimum: -90,
    maximum: 90,
    description: 'Degrees, as the device reported them. Not stored.',
  })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({
    minimum: -180,
    maximum: 180,
    description: 'Degrees, as the device reported them. Not stored.',
  })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @ApiPropertyOptional({
    default: DEFAULT_POSTAL_CODE_COUNTRY,
    minLength: 2,
    maxLength: 2,
    description:
      'ISO 3166-1 alpha-2. The centroid table is keyed on (country, postalCode), and a lookup without one searches every shipped country at once.',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(2)
  country?: string;
}

export class ProfileSupermarketDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The chain: "no DIA" means no DIA anywhere, including the DIA that opens next month. Refusing one particular shop is the separate, finer choice below.',
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

/**
 * One shop, and whether the profile refuses it (plan 0064).
 *
 * The finer axis beside {@link ProfileSupermarketDto}, not a replacement for it:
 * "not that shop" is about parking and a route home, "not DIA" is about the
 * brand, and an excluded chain hides its shops whatever these say.
 */
export class ProfileLocationDto {
  @ApiProperty({
    format: 'uuid',
    description: 'One shop of a chain, rather than the chain.',
  })
  @IsUUID()
  supermarketLocationId!: string;

  @ApiPropertyOptional({
    description:
      'False switches the shop back on, and deletes the row rather than storing it: absence already means included, so a shop imported later is one you can see rather than one silently missing.',
  })
  @IsOptional()
  @IsBoolean()
  excluded?: boolean;
}

/**
 * Several shops at once (plan 0064, section 5).
 *
 * A **partial** write, unlike the collections on the profile body: shops it does
 * not name keep whatever they had. A profile can see hundreds of shops and a
 * screen holds a screenful, so a replacement would make one toggle require the
 * client to send every shop it has ever seen.
 */
export class SetProfileLocationsDto {
  @ApiProperty({
    type: [ProfileLocationDto],
    maxItems: PROFILE_LIMITS.maxLocationPreferences,
  })
  @IsArray()
  @ArrayMaxSize(PROFILE_LIMITS.maxLocationPreferences)
  @ValidateNested({ each: true })
  @Type(() => ProfileLocationDto)
  locations!: ProfileLocationDto[];
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
    description:
      'The profile’s **own** codes, TYPED and DEVICE (plan 0062). Codes derived from these are the server’s and are not stated here: a client that omits them loses nothing, and one that echoes them back promotes them. Add and remove a single code with the two routes below instead.',
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
