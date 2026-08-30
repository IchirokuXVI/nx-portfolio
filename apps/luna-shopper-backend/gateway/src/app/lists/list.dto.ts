import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  LINE_BATCH_MAX_ITEMS,
  LINE_QUANTITY_MAX,
  LINE_QUANTITY_MIN,
  LineApprovalStatus,
  LineStatus,
  ListPermission,
} from '@portfolio/luna-shopper/contracts';
import { PageQueryDto } from '@portfolio/luna-shopper/platform';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotEquals,
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

  @ApiPropertyOptional({
    minimum: LINE_QUANTITY_MIN,
    maximum: LINE_QUANTITY_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(LINE_QUANTITY_MIN)
  @Max(LINE_QUANTITY_MAX)
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

/**
 * Add several lines to one list in one request (plan 0040, section 6).
 *
 * The item type is {@link AddLineDto} itself rather than a copy of it, so the
 * bounds on a batched line are the bounds on a single one by construction and
 * cannot drift apart. Every item is validated at the edge, which is what lets
 * core answer all or nothing: by the time it sees the batch, a bad item has
 * already produced a 400 for the whole request.
 */
export class AddLinesDto {
  @ApiProperty({
    type: [AddLineDto],
    minItems: 1,
    maxItems: LINE_BATCH_MAX_ITEMS,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(LINE_BATCH_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => AddLineDto)
  items!: AddLineDto[];
}

/**
 * A signed change to a line's quantity (plan 0040, section 3.7).
 *
 * Zero is refused because a delta of zero is a request that means nothing and is
 * more likely a client bug than an intention. The bound is the quantity ceiling,
 * so neither direction can be used to write a number nobody meant; the
 * **resulting** quantity is what the floor and ceiling then apply to, in core,
 * because core is the only layer that can see it.
 */
export class AddLineQuantityDto {
  @ApiProperty({
    minimum: -LINE_QUANTITY_MAX,
    maximum: LINE_QUANTITY_MAX,
    description:
      'How many to add, or a negative number to take off. Never zero. The resulting quantity has to stay within the line quantity bounds.',
  })
  @IsInt()
  @NotEquals(0)
  @Min(-LINE_QUANTITY_MAX)
  @Max(LINE_QUANTITY_MAX)
  delta!: number;
}

export class UpdateLineDto {
  @ApiPropertyOptional({ maxLength: 400 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(400)
  content?: string;

  @ApiPropertyOptional({
    minimum: LINE_QUANTITY_MIN,
    maximum: LINE_QUANTITY_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(LINE_QUANTITY_MIN)
  @Max(LINE_QUANTITY_MAX)
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
