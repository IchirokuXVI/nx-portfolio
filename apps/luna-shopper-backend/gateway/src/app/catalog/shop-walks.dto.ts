import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SHOP_WALK_ENTRY_KINDS,
  SHOP_WALK_LIMITS,
  SHOP_WALK_SCHEMA_IDS,
  SHOP_WALK_STOP_REASONS,
  type ShopWalkEntryKind,
  type ShopWalkEvent,
  type ShopWalkStopReason,
} from '@portfolio/luna-shopper/contracts';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { componentRef, hoistContractSchema } from '../docs';

/** The event schema the contracts publish, so the document names one shape for both halves. */
const EVENT_SCHEMA = hoistContractSchema(SHOP_WALK_SCHEMA_IDS.shopWalkEvent);

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** `POST /v1/catalog/locations/:id/walks` (plan 0168, section 3). */
export class CreateShopWalkDto {
  @ApiProperty({ minLength: 1, maxLength: SHOP_WALK_LIMITS.nameMaxLength })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(SHOP_WALK_LIMITS.nameMaxLength)
  name!: string;
}

/**
 * `PATCH /v1/catalog/walks/:walkId`. `shown: true` stops showing the shop's
 * other walk in the same transaction; `shown: false` leaves the shop with no
 * map.
 */
export class UpdateShopWalkDto {
  @ApiPropertyOptional({
    minLength: 1,
    maxLength: SHOP_WALK_LIMITS.nameMaxLength,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(SHOP_WALK_LIMITS.nameMaxLength)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  shown?: boolean;
}

/** `GET /v1/catalog/walks/:walkId/log?fromSeq=`. */
export class ShopWalkLogQueryDto {
  @ApiPropertyOptional({
    minimum: 0,
    description:
      'The entries after the latest snapshot at or before this `seq` are answered, with that snapshot. Absent or 0 answers the whole log with no snapshot.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fromSeq?: number;
}

/**
 * `POST /v1/catalog/walks/:walkId/entries` (plan 0168, section 2).
 *
 * The head of the entry is checked here; the events are checked whole by
 * catalog against the contract schema, which states every event shape, so the
 * two cannot disagree about what an event is. The body is capped at
 * {@link SHOP_WALK_LIMITS.entryMaxBytes} by the parser mounted for this path.
 */
export class AppendShopWalkEntryDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Given by the client, so a retried save is the same entry and answers what the first one stored.',
  })
  @IsUUID('all')
  id!: string;

  @ApiProperty({
    minimum: 0,
    description:
      'The walk’s `lastSeq` this entry was built on. Anything else is refused with `walk_changed`.',
  })
  @IsInt()
  @Min(0)
  baseSeq!: number;

  @ApiProperty({ enum: SHOP_WALK_ENTRY_KINDS })
  @IsIn(SHOP_WALK_ENTRY_KINDS)
  kind!: ShopWalkEntryKind;

  @ApiProperty({ format: 'date-time', description: 'Wall clock, ISO.' })
  @IsDateString()
  at!: string;

  @ApiProperty({ minimum: 0, description: 'Log milliseconds.' })
  @IsInt()
  @Min(0)
  logFrom!: number;

  @ApiProperty({ minimum: 0, description: 'Log milliseconds.' })
  @IsInt()
  @Min(0)
  logTo!: number;

  @ApiProperty({ type: 'array', items: componentRef(EVENT_SCHEMA) })
  @IsArray()
  @IsObject({ each: true })
  events!: ShopWalkEvent[];

  @ApiPropertyOptional({
    minimum: 0,
    description:
      'Kind `rewound` only: the point of the log the map returns to.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  rewoundTo?: number;

  @ApiPropertyOptional({
    enum: SHOP_WALK_STOP_REASONS,
    description: 'Kind `stopped` only: why.',
  })
  @IsOptional()
  @IsIn(SHOP_WALK_STOP_REASONS)
  reason?: ShopWalkStopReason;
}
