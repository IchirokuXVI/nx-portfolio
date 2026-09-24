import type { NearbyShopsRequest } from '@portfolio/luna-shopper/contracts';
import type { DevicePointDto } from './nearby-shops.dto';
import type { ShopperSelection } from './scope-resolution.service';

/**
 * What catalog is asked for the shops near a point (plan 0164, section 1): the
 * point, and the profile's postal codes and refusals, because catalog decides
 * the pick and the pick reads both.
 *
 * The three point fields are copied by name rather than spread, so nothing
 * else a body carried can reach the broker. A selection that could not be
 * named (no profile) is empty: every shop is then outside the profile, and a
 * clear nearest one answers `OUTSIDE_PROFILE` rather than a pick.
 */
export function toNearbyShopsRequest(
  point: DevicePointDto,
  selection: ShopperSelection | null
): NearbyShopsRequest {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    accuracyMetres: point.accuracyMetres,
    profilePostalCodes: selection?.postalCodes ?? [],
    excludedSupermarketIds: selection?.excludedSupermarketIds ?? [],
    excludedSupermarketLocationIds:
      selection?.excludedSupermarketLocationIds ?? [],
  };
}
