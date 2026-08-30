import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  LineApprovalStatus,
  LineStatus,
  ListPermission,
} from '@portfolio/luna-shopper/contracts';
import { PageQueryDto } from '@portfolio/luna-shopper/platform';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
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

export class CreateListDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /**
   * Whether every approved member of the zone gets access to it (plan 0034).
   *
   * Optional, and omitting it shares. See `CreateListRequest.shareWithZone`: the
   * default is the common case and it is also the behaviour every client written
   * before this field existed already relies on.
   */
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  shareWithZone?: boolean;
}

export class UpdateListDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  /**
   * Whether a new line on this list arrives already approved (plan 0037,
   * section 3).
   *
   * List configuration rather than a preference, so core gates it on `MANAGE`,
   * and it governs only what a **new** line starts as: turning it on leaves the
   * lines already pending exactly where they are.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoApproveLines?: boolean;
}

export class ListAccessEntryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  membershipId!: string;

  /**
   * The whole of what this membership may do on the list, replacing the single
   * `ListRole` (plan 0036, section 2). `setAccess` sets the row outright rather
   * than patching it, so this array is the complete answer for that membership.
   *
   * **An empty array is valid and is how access is revoked** (section 5, rule
   * 5): core deletes the row rather than storing a zero-permission one, so no
   * `ArrayNotEmpty` here. Duplicates are refused because the value is a set and
   * a repeated member says nothing a single one does not.
   */
  @ApiProperty({
    enum: ListPermission,
    isArray: true,
    description:
      'The complete permission set for this membership. Empty revokes access.',
  })
  @IsArray()
  @ArrayUnique()
  @IsEnum(ListPermission, { each: true })
  permissions!: ListPermission[];
}

export class SetListAccessDto {
  @ApiProperty({ type: [ListAccessEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ListAccessEntryDto)
  entries!: ListAccessEntryDto[];
}

export class AddLineDto {
  @ApiProperty({ maxLength: 400 })
  @IsString()
  @MinLength(1)
  @MaxLength(400)
  content!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  quantity?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Optional catalog item this line references (plan 0012)',
  })
  @IsOptional()
  @IsUUID()
  itemId?: string | null;
}

export class UpdateLineDto {
  @ApiPropertyOptional({ maxLength: 400 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(400)
  content?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  quantity?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Set or clear the catalog item link; null clears it (plan 0012)',
  })
  @IsOptional()
  @IsUUID()
  itemId?: string | null;
}

export class SetApprovalDto {
  @ApiProperty({ enum: LineApprovalStatus })
  @IsEnum(LineApprovalStatus)
  approvalStatus!: LineApprovalStatus;
}

export class SetStatusDto {
  @ApiProperty({ enum: LineStatus })
  @IsEnum(LineStatus)
  status!: LineStatus;
}

export class ReorderLinesDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  orderedLineIds!: string[];
}

export class AddCommentDto {
  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}

/**
 * The rest of a voice comment's form (plan 0045, section 3).
 *
 * The recording itself is not here: it is a file part, handled by
 * {@link VoiceRecordingInterceptor}, which is why this DTO has one optional field
 * and no `body`. A voice comment has no text until the transcript arrives.
 *
 * `durationSeconds` arrives as a string, like every multipart field, so it is
 * coerced here. It is **metadata and never trusted** (section 6): nothing
 * authorizes on it and nothing rejects on it, and the upper bound below exists
 * only so an absurd value is not stored and drawn on a row.
 */
export class AddVoiceCommentDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 3600 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(3600)
  durationSeconds?: number;
}

export class ListQueryDto extends PageQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  order?: string;
}

export class LineQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['position', 'created', 'updated'] })
  @IsOptional()
  @IsIn(['position', 'created', 'updated'])
  order?: string;
}
