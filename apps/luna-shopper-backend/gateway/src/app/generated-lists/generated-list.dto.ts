import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  GENERATED_LIST_LIMITS,
  GeneratedListStatus,
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
    format: 'uuid',
    nullable: true,
    description:
      'The list every line added to this basket should also be written into. A default on new lines, never a retroactive sweep over lines already added.',
  })
  @IsOptional()
  @IsUUID()
  defaultTargetListId?: string | null;

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

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  defaultTargetListId?: string | null;
}

export class AddGeneratedListLineDto {
  @ApiProperty({ maxLength: GENERATED_LIST_LIMITS.contentMaxLength })
  @IsString()
  @MinLength(1)
  @MaxLength(GENERATED_LIST_LIMITS.contentMaxLength)
  content!: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: GENERATED_LIST_LIMITS.maxQuantity,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(GENERATED_LIST_LIMITS.maxQuantity)
  quantity?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'The product this line means to buy. Null for a free text line.',
  })
  @IsOptional()
  @IsUUID()
  itemId?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'The products the pick may be switched between.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  options?: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'The zone list to also create this line in, through the ordinary add path. Omitted falls back to the basket default; an explicit null means this basket alone, whatever the default says.',
  })
  @IsOptional()
  @IsUUID()
  targetListId?: string | null;
}

export class UpdateGeneratedListLineDto {
  @ApiPropertyOptional({ maxLength: GENERATED_LIST_LIMITS.contentMaxLength })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(GENERATED_LIST_LIMITS.contentMaxLength)
  content?: string;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: GENERATED_LIST_LIMITS.maxQuantity,
    description:
      'Zero is allowed on an edit: a line at zero is one the basket knows about and does not currently need.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(GENERATED_LIST_LIMITS.maxQuantity)
  quantity?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Switch the pick to another of this line options. An id that is not one of them is refused.',
  })
  @IsOptional()
  @IsUUID()
  itemId?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Send an added line into a zone list. Only meaningful on a line added to this basket, and it promotes the line once.',
  })
  @IsOptional()
  @IsUUID()
  targetListId?: string | null;
}

export class ReorderGeneratedListLinesDto {
  @ApiProperty({
    type: [String],
    description:
      'Every line of the basket, in the order it should now be in. A partial order is refused.',
  })
  @IsArray()
  @ArrayMaxSize(GENERATED_LIST_LIMITS.maxLines)
  @IsUUID(undefined, { each: true })
  lineIds!: string[];
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
