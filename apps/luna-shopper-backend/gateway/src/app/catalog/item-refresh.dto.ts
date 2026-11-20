import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** The scope of the offer the client drew (harvester plan 0216, section 3). */
const PRICE_SCOPE_DESCRIPTION =
  'The `priceScopeId` of the offer the client drew: the scope the shopper is looking at.';

/** `GET /v1/catalog/items/:id/refresh?priceScopeId=`. */
export class ItemRefreshQueryDto {
  @ApiProperty({ format: 'uuid', description: PRICE_SCOPE_DESCRIPTION })
  @IsUUID()
  priceScopeId!: string;
}

/** `POST /v1/catalog/items/:id/refresh`. */
export class ItemRefreshBodyDto {
  @ApiProperty({ format: 'uuid', description: PRICE_SCOPE_DESCRIPTION })
  @IsUUID()
  priceScopeId!: string;
}
