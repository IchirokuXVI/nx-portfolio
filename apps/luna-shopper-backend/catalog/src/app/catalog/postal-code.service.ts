import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  AdminPostalCodePage,
  AdminPostalCodeView,
  ListAdminPostalCodesRequest,
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
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
} from '@portfolio/luna-shopper/platform';
import { boundingBox } from '@portfolio/luna-shopper/postal-codes';
import { Between, Repository } from 'typeorm';
import { PostalCodePoint } from '../entities';
import { PlatformAdminService } from './platform-admin.service';

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
    private readonly points: Repository<PostalCodePoint>,
    private readonly admin: PlatformAdminService
  ) {}

  /**
   * The centroid table itself, for the back office (plan 0074, section 2).
   *
   * The third read on this class and the only gated one, which is the difference
   * worth noticing: the two below answer geography questions asked service to
   * service and carry no caller at all, while this is a page of a table ordered
   * for a person to look at. It goes through `requireAdmin` like every other
   * admin path in catalog, so the gate is the signature rather than the route it
   * arrived on.
   *
   * `locationCount` is counted with the same `postalCode` match that
   * `countByPostalCode` uses, so the coverage this screen reports and the
   * coverage the discovery queue acts on cannot disagree. The `served` filter is
   * the same count with a `HAVING`, rather than a second definition of served.
   *
   * Ordered by country then code, not by distance from anything: this is a table
   * being read, and an operator scanning for a gap wants the codes in the order
   * they think of them.
   */
  async listForAdmin(
    req: ListAdminPostalCodesRequest
  ): Promise<AdminPostalCodePage> {
    await this.admin.requireAdmin(req);

    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as
      | { country: string; postalCode: string }
      | undefined;

    const qb = this.points
      .createQueryBuilder('p')
      .select('p.country', 'country')
      .addSelect('p."postalCode"', 'postalCode')
      .addSelect('p.latitude', 'latitude')
      .addSelect('p.longitude', 'longitude')
      // A correlated count rather than a join and a group by: the table is one
      // row per code, so grouping would only undo a fan out this way never
      // creates. The country match mirrors `countByPostalCode`, including its
      // tolerance of a location whose country predates plan 0061.
      .addSelect(
        `(SELECT COUNT(*) FROM supermarket_locations l
           WHERE l."postalCode" = p."postalCode"
             AND (l.country IS NULL OR lower(l.country) = p.country))`,
        'locationCount'
      )
      .orderBy('p.country', 'ASC')
      .addOrderBy('p."postalCode"', 'ASC')
      .limit(limit + 1);

    if (req.country) {
      qb.andWhere('p.country = :country', {
        country: normalizeCountry(req.country),
      });
    }
    if (req.postalCode) {
      // A prefix rather than a contains match: a postal code is read left to
      // right, and "28" means the province rather than every code with a 28 in
      // the middle of it.
      qb.andWhere('p."postalCode" LIKE :prefix', {
        prefix: `${req.postalCode.trim()}%`,
      });
    }
    if (req.served !== undefined) {
      qb.andWhere(
        `(SELECT COUNT(*) FROM supermarket_locations l
           WHERE l."postalCode" = p."postalCode"
             AND (l.country IS NULL OR lower(l.country) = p.country)) ${
               req.served ? '> 0' : '= 0'
             }`
      );
    }
    if (cursor) {
      qb.andWhere('(p.country, p."postalCode") > (:cc, :cp)', {
        cc: cursor.country,
        cp: cursor.postalCode,
      });
    }

    const rows = await qb.getRawMany<RawAdminPostalCode>();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toAdminPostalCodeView),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              country: last.country,
              postalCode: last.postalCode,
            })
          : null,
    };
  }

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

/** What the admin listing selects, before the numbers are numbers. */
interface RawAdminPostalCode {
  country: string;
  postalCode: string;
  latitude: number | string;
  longitude: number | string;
  locationCount: string;
}

function toAdminPostalCodeView(row: RawAdminPostalCode): AdminPostalCodeView {
  return {
    country: row.country,
    postalCode: row.postalCode,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    locationCount: Number(row.locationCount),
  };
}
