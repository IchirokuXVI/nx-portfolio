import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  ListNearbyPostalCodesRequest,
  NearbyPostalCodesView,
  NearestPostalCodeView,
  PostalCodeDistanceView,
  ResolveNearestPostalCodeRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  distanceMetres,
  type LatLon,
} from '@portfolio/luna-shopper/osm-places';
import { boundingBox } from '@portfolio/luna-shopper/postal-codes';
import { Between, Repository } from 'typeorm';
import { PostalCodePoint } from '../entities';

/**
 * The two reads over the postal code centroids (plan 0060, section 5).
 *
 * Both are the same shape: a bounding box the btree index can serve, then an
 * exact great circle distance over the survivors. The distance is
 * `distanceMetres` from `osm-places` rather than a second haversine, because
 * there is one definition of distance in this system.
 *
 * Both are **approximate** in a way the caller has to say (section 6). A
 * centroid is one point standing in for an area, so the nearest centroid may
 * belong to the neighbouring code, and two adjacent codes may sit further
 * apart than the radius. `maxDistanceMetres` exists so the first read can
 * answer "we don't know", and the second answers centroid to centroid and
 * nothing more.
 */
@Injectable()
export class PostalCodeService {
  constructor(
    @InjectRepository(PostalCodePoint)
    private readonly points: Repository<PostalCodePoint>
  ) {}

  /**
   * Which postal code is this point in. Null beyond `maxDistanceMetres`,
   * rather than a confident wrong code.
   */
  async nearest(
    req: ResolveNearestPostalCodeRequest
  ): Promise<NearestPostalCodeView> {
    const country = normalizeCountry(req.country);
    const centre: LatLon = { lat: req.latitude, lon: req.longitude };
    const candidates = await this.inBox(country, centre, req.maxDistanceMetres);
    const ranked = rank(candidates, centre, req.maxDistanceMetres);
    return { country, nearest: ranked[0] ?? null };
  }

  /**
   * Which postal codes have their centroid within `radiusMetres` of this one.
   * Never the code asked about, and empty rather than that code when nothing
   * else is in range. An unknown code is empty too, with `known: false`.
   */
  async nearby(
    req: ListNearbyPostalCodesRequest
  ): Promise<NearbyPostalCodesView> {
    const country = normalizeCountry(req.country);
    const postalCode = req.postalCode.trim();
    const origin = await this.points.findOne({
      where: { country, postalCode },
    });
    if (!origin) {
      return { country, postalCode, known: false, postalCodes: [] };
    }

    const centre: LatLon = { lat: origin.latitude, lon: origin.longitude };
    const candidates = await this.inBox(country, centre, req.radiusMetres);
    const others = candidates.filter((c) => c.postalCode !== postalCode);
    return {
      country,
      postalCode,
      known: true,
      postalCodes: rank(others, centre, req.radiusMetres),
    };
  }

  /** The survivors of the bounding box, which the index answers. */
  private inBox(
    country: string,
    centre: LatLon,
    radiusMetres: number
  ): Promise<PostalCodePoint[]> {
    const box = boundingBox(centre.lat, centre.lon, radiusMetres);
    return this.points.find({
      where: {
        country,
        latitude: Between(box.minLatitude, box.maxLatitude),
        longitude: Between(box.minLongitude, box.maxLongitude),
      },
    });
  }
}

/**
 * Exact distance over the box's survivors, dropping the corners the box kept
 * and the radius does not; nearest first, then by code so ties are stable.
 * Distances are whole metres: nothing downstream reads finer than that, and a
 * fraction of a metre would suggest a precision a centroid does not have.
 */
function rank(
  candidates: readonly PostalCodePoint[],
  centre: LatLon,
  radiusMetres: number
): PostalCodeDistanceView[] {
  return candidates
    .map((c) => ({
      postalCode: c.postalCode,
      distanceMetres: Math.round(
        distanceMetres(centre, { lat: c.latitude, lon: c.longitude })
      ),
    }))
    .filter((c) => c.distanceMetres <= radiusMetres)
    .sort(
      (a, b) =>
        a.distanceMetres - b.distanceMetres ||
        a.postalCode.localeCompare(b.postalCode)
    );
}

/** The table stores lowercase alpha-2; a caller sending `ES` means the same. */
function normalizeCountry(country: string): string {
  return country.trim().toLowerCase();
}
