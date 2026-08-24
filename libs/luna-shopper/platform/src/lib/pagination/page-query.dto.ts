import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { MAX_PAGE_SIZE } from './cursor';

/**
 * The shared query DTO every collection endpoint extends (plan 0004, section 11).
 *
 * `cursor` is the opaque token from the previous page's `nextCursor`; `limit` is
 * validated to `[1, MAX_PAGE_SIZE]` here and further clamped by `clampPageSize`.
 * Endpoints that let the caller choose an order add an `order` field of their own
 * allowed values on top of this base.
 */
export class PageQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;
}
