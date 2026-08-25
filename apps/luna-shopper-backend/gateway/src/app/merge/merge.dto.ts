import { ApiProperty } from '@nestjs/swagger';
import { PageQueryDto } from '@portfolio/luna-shopper/platform';
import { IsUUID } from 'class-validator';

/** Request a merge of one member's zone data into another (plan 0008). */
export class RequestMergeDto {
  @ApiProperty({ format: 'uuid', description: 'Account whose data is taken from' })
  @IsUUID()
  sourceUserId!: string;

  @ApiProperty({ format: 'uuid', description: 'Account the data is moved into' })
  @IsUUID()
  targetUserId!: string;
}

/** Cursor for listing a zone's pending merge requests (plan 0008). */
export class ListMergesQueryDto extends PageQueryDto {}
