import { ApiPropertyOptional } from '@nestjs/swagger';
import { MAX_PAGE_SIZE } from '@portfolio/luna-shopper/platform';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** The query half of the contacts listing (plan 0114, section 2). */
export class ContactsQueryDto {
  @ApiPropertyOptional({
    description: 'The `nextCursor` of the previous page. Opaque.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;
}
