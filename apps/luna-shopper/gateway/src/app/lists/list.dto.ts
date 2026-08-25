import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  LineApprovalStatus,
  LineStatus,
  ListRole,
} from '@portfolio/luna-shopper/contracts';
import { PageQueryDto } from '@portfolio/luna-shopper/platform';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
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
  ValidateNested,
} from 'class-validator';

export class CreateListDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}

export class UpdateListDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;
}

export class ListAccessEntryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  membershipId!: string;

  @ApiProperty({ enum: ListRole })
  @IsEnum(ListRole)
  role!: ListRole;
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
