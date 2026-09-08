import { Injectable } from '@angular/core';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import {
  POSTAL_CODE_USAGE_SEED,
  SHIPPED_POSTAL_CODE_SEED,
} from './postal-code-seed';
import type { PostalCodeServiceI } from './postal-code-service';

/**
 * How far the seeded neighbours reach, when nobody names a radius.
 *
 * The same default the route carries, which is the radius a profile widens by.
 * Repeated as a number rather than imported from the backend library, because
 * this app depends on the gateway's document and not on the services behind it.
 */
const DEFAULT_RADIUS_METRES = 15_000;

/** Metres per degree of latitude, near enough for a seeded distance. */
const METRES_PER_DEGREE = 111_320;

/**
 * What catalog and core say about a postal code, out of memory.
 *
 * It is the default binding of {@link POSTAL_CODE_SERVICE}, so the queue screen
 * and its detail page draw fully with nothing listening.
 *
 * The distances are **computed** from the seeded centroids rather than written
 * down beside them. A hand written distance that disagreed with its own
 * coordinates would make the detail page's "centroid to centroid" sentence read
 * as nonsense, and the arithmetic is four lines.
 */
@Injectable({ providedIn: 'root' })
export class PostalCodeMemory implements PostalCodeServiceI {
  async usage(
    country: string,
    postalCodes: readonly string[]
  ): Promise<Wire.AdminCorePostalCodeUsageListView> {
    // Every code asked about, including the ones nobody uses. A screen deciding
    // what is unknown needs the zeros, which is the whole point of asking.
    const usage = postalCodes.map(
      (postalCode) =>
        POSTAL_CODE_USAGE_SEED.find((row) => row.postalCode === postalCode) ?? {
          postalCode,
          mainProfiles: 0,
          nearbyProfiles: 0,
          suppressedProfiles: 0,
          mainUsers: 0,
          nearbyUsers: 0,
        }
    );

    return { country, usage };
  }

  async nearby(
    country: string,
    postalCode: string,
    radiusMetres: number = DEFAULT_RADIUS_METRES
  ): Promise<Wire.CatalogNearbyPostalCodesView> {
    const centre = SHIPPED_POSTAL_CODE_SEED.find(
      (row) => row.country === country && row.postalCode === postalCode
    );

    // An unknown code gets an empty answer too, and `known` is the only thing
    // separating it from a code with nothing in range.
    if (centre === undefined) {
      return { country, postalCode, known: false, postalCodes: [] };
    }

    const postalCodes = SHIPPED_POSTAL_CODE_SEED.filter(
      (row) => row.country === country && row.postalCode !== postalCode
    )
      .map((row) => ({
        postalCode: row.postalCode,
        distanceMetres: Math.round(metresBetween(centre, row)),
      }))
      .filter((row) => row.distanceMetres <= radiusMetres)
      .sort((left, right) => left.distanceMetres - right.distanceMetres);

    return { country, postalCode, known: true, postalCodes };
  }

  async shipped(
    country: string,
    postalCode: string
  ): Promise<Wire.CatalogAdminPostalCodeView | null> {
    return (
      SHIPPED_POSTAL_CODE_SEED.find(
        (row) => row.country === country && row.postalCode === postalCode
      ) ?? null
    );
  }
}

/**
 * Roughly how far apart two centroids are, on the equirectangular approximation.
 *
 * Good to a fraction of a percent over the tens of kilometres a neighbour list
 * covers, and the real answer is PostGIS's. Nothing here is shown as a fact
 * about geography: it exists so the seeded list is in a believable order.
 */
function metresBetween(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
): number {
  const meanLatitude = ((from.latitude + to.latitude) / 2) * (Math.PI / 180);
  const north = (to.latitude - from.latitude) * METRES_PER_DEGREE;
  const east =
    (to.longitude - from.longitude) *
    METRES_PER_DEGREE *
    Math.cos(meanLatitude);

  return Math.hypot(north, east);
}
