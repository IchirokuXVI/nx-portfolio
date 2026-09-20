import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  GENERATED_LIST_LIMITS,
  GENERATED_LIST_SHARING_LIMITS,
  GeneratedListStatus,
} from '@portfolio/luna-shopper/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
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
 * The generated shopping list request bodies (plan 0050, section 9).
 *
 * The caps come from `GENERATED_LIST_LIMITS` rather than from numbers written
 * here, so the DTO, the JSON Schema and the service enforce the same five hundred
 * and the same one hundred. What the DTO cannot express is checked in core
 * anyway: a request that slips past validation still meets the service's own
 * rules, chiefly that a source the caller cannot draw from contributes nothing.
 */

export class GeneratedListSourceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  zoneId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Null means every list in the zone the caller may draw from, rather than one list within it.',
  })
  @IsOptional()
  @IsUUID()
  listId?: string | null;
}

export class CreateGeneratedListDto {
  @ApiPropertyOptional({
    type: [GeneratedListSourceDto],
    maxItems: GENERATED_LIST_LIMITS.maxSources,
    description:
      'The zones and lists to draw from. Omitted falls back to the profile named below, then to the caller default profile, which draws from everything they may write to.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(GENERATED_LIST_LIMITS.maxSources)
  @ValidateNested({ each: true })
  @Type(() => GeneratedListSourceDto)
  sources?: GeneratedListSourceDto[];

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The shopping profile whose stored generation sources the run should use. Only consulted when no sources are given.',
  })
  @IsOptional()
  @IsUUID()
  profileId?: string;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: GENERATED_LIST_LIMITS.nameMaxLength,
    description:
      'Null renders as the generation date on the client. The default is never stored, because the server does not know the reader locale.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(GENERATED_LIST_LIMITS.nameMaxLength)
  name?: string | null;


  @ApiPropertyOptional({
    maxLength: 200,
    description:
      'Repeat the same key to get the basket the first call produced, rather than a second basket.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  idempotencyKey?: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: GENERATED_LIST_SHARING_LIMITS.maxParticipants - 1,
    uniqueItems: true,
    description:
      'People to share the basket with as it is created, chosen from GET /v1/contacts. Each must share an approved group with the caller at this moment, or the whole request is refused with validation_failed naming the ids that are not.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(GENERATED_LIST_SHARING_LIMITS.maxParticipants - 1)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  memberUserIds?: string[];
}

export class UpdateGeneratedListDto {
  @ApiPropertyOptional({
    nullable: true,
    maxLength: GENERATED_LIST_LIMITS.nameMaxLength,
  })
  @IsOptional()
  @IsString()
  @MaxLength(GENERATED_LIST_LIMITS.nameMaxLength)
  name?: string | null;

  @ApiPropertyOptional({ enum: GeneratedListStatus })
  @IsOptional()
  @IsEnum(GeneratedListStatus)
  status?: GeneratedListStatus;

}

/** The query half of the history listing (plan 0050, section 7). */
export class ListGeneratedListsQueryDto {
  @ApiPropertyOptional({
    description: 'The `nextCursor` of the previous page. Opaque.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Include archived baskets, which the default listing leaves out without deleting them.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeArchived?: boolean;
}

/** The query half of the shared baskets listing (plan 0114, section 8). */
export class ListSharedGeneratedListsQueryDto {
  @ApiPropertyOptional({
    description: 'The `nextCursor` of the previous page. Opaque.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
