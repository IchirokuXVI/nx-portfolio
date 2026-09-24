import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * Where a device says it is, and how sure it is (plan 0164; velista 0103).
 *
 * **A body and not a query string**, on routes that store nothing, for the
 * reason `ResolvePostalCodeDto` gives: a query parameter is kept by every
 * access log between the phone and the process. The two routes that take it
 * also withhold their bodies from the error log (`WithholdBodyMiddleware`), so
 * the point appears in exactly one request and in no stored line.
 *
 * The validation messages are the default ones, which name the property and
 * never the value, so a refused point is not echoed in the error either.
 */
export class DevicePointDto {
  @ApiProperty({
    minimum: -90,
    maximum: 90,
    description: 'Degrees, as the device reported them. Not stored.',
  })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({
    minimum: -180,
    maximum: 180,
    description: 'Degrees, as the device reported them. Not stored.',
  })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @ApiProperty({
    minimum: 0,
    description:
      'The radius in metres the device is sure of, as `GeolocationCoordinates.accuracy` reports it. Over 150 nothing is picked automatically. Not stored.',
  })
  @IsNumber()
  @Min(0)
  accuracyMetres!: number;
}

/** `POST /v1/catalog/shops/nearby`: the point, and optionally which profile. */
export class NearbyShopsDto extends DevicePointDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Judge the shops against this profile of yours rather than your default one. Somebody else’s profile is not found.',
  })
  @IsOptional()
  @IsUUID()
  profileId?: string;
}

/**
 * `POST /v1/baskets/:id/shops/nearby`: the point alone. The profile is the
 * basket's pricing profile, so a `profileId` is refused as an unknown field.
 */
export class BasketNearbyShopsDto extends DevicePointDto {}
