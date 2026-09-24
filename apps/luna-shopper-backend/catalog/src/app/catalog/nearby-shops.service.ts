import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  isInProfile,
  type BasketShopView,
  type NearbyShopsRequest,
  type NearbyShopsView,
  type NearbyShopView,
  type ShopsByIdRequest,
  type ShopsByIdView,
} from '@portfolio/luna-shopper/contracts';
import { distanceMetres } from '@portfolio/luna-shopper/osm-places';
import {
  boundingBox,
  type BoundingBox,
} from '@portfolio/luna-shopper/postal-codes';
import { In, Repository, type SelectQueryBuilder } from 'typeorm';
import { SupermarketLocation } from '../entities';
import { NEARBY_SHOP_THRESHOLDS, pickNearbyShop } from './nearby-shop-pick';

/**
 * A shop named for a person, with whether it is in a profile (plan 0163,
 * section 1): the one shape both reads below answer, so one client model draws
 * a shop near a point and a shop bought at recently.
 */
export function toNamedShop(
  location: SupermarketLocation,
  profilePostalCodes: readonly string[]
): BasketShopView {
  return {
    id: location.id,
    supermarketId: location.supermarketId,
    supermarketName: location.supermarket.name,
    label: location.label,
    address: location.address,
    city: location.city,
    postalCode: location.postalCode,
    inProfile: isInProfile(location.postalCode, profilePostalCodes),
  };
}

/**
 * The shops near a point and the shops named by id (plan 0164).
 *
 * ## The point is never kept
 *
 * It is read from the request, turned into a bounding box and a distance for
 * each shop, and dropped. Nothing here stores it, caches it, logs it or puts it
 * in an error, and no answer carries it back: a candidate says how far it is,
 * not from where.
 *
 * ## Distance is the axis here, and only here
 *
 * Plan 0068 section 3.3 keeps the shop lists of a profile by postal code,
 * because a profile can hold two cities and has no single centre. Plan 0164
 * reverses that for one purpose, choosing where to buy now, when the device
 * says where the person is standing. Nothing else reads this.
 */
@Injectable()
export class NearbyShopsService {
  constructor(
    @InjectRepository(SupermarketLocation)
    private readonly locations: Repository<SupermarketLocation>
  ) {}

  /**
   * Every located shop within the capture radius, nearest first, then by id,
   * and the automatic pick (plan 0164, sections 1 to 3).
   *
   * The bounding box is what the index serves; exact distance over what it
   * keeps drops the corners. A shop with no coordinates falls outside every
   * range, so it is never a candidate. Distances are whole metres, and the pick
   * decides on the same numbers the client is shown.
   */
  async nearby(req: NearbyShopsRequest): Promise<NearbyShopsView> {
    const radius = NEARBY_SHOP_THRESHOLDS.captureRadiusMetres;
    const centre = { lat: req.latitude, lon: req.longitude };
    const box = boundingBox(req.latitude, req.longitude, radius);

    const rows = await this.inBox(box).getMany();

    const refusedChains = new Set(req.excludedSupermarketIds);
    const refusedShops = new Set(req.excludedSupermarketLocationIds);
    const candidates: NearbyShopView[] = [];
    for (const row of rows) {
      if (row.latitude === null || row.longitude === null) {
        continue;
      }
      const distance = Math.round(
        distanceMetres(centre, { lat: row.latitude, lon: row.longitude })
      );
      if (distance > radius) {
        continue;
      }
      candidates.push({
        ...toNamedShop(row, req.profilePostalCodes),
        distanceMetres: distance,
        excluded:
          refusedShops.has(row.id) || refusedChains.has(row.supermarketId),
      });
    }
    candidates.sort(
      (a, b) => a.distanceMetres - b.distanceMetres || a.id.localeCompare(b.id)
    );

    return {
      candidates,
      ...pickNearbyShop(req.accuracyMetres, candidates),
    };
  }

  /**
   * The located shops inside a box, with their chain: the one statement the
   * index on `(latitude, longitude)` serves. Public so the integration spec can
   * ask Postgres how it would run this exact statement.
   */
  inBox(box: BoundingBox): SelectQueryBuilder<SupermarketLocation> {
    return this.locations
      .createQueryBuilder('l')
      .innerJoinAndSelect('l.supermarket', 's')
      .where('l.latitude BETWEEN :minLat AND :maxLat', {
        minLat: box.minLatitude,
        maxLat: box.maxLatitude,
      })
      .andWhere('l.longitude BETWEEN :minLon AND :maxLon', {
        minLon: box.minLongitude,
        maxLon: box.maxLongitude,
      });
  }

  /**
   * The shops these ids name, with their chain (plan 0164, section 4). An id
   * that names no shop is left out, which is how a shop deleted since somebody
   * bought there drops off their recent shops.
   */
  async shopsById(req: ShopsByIdRequest): Promise<ShopsByIdView> {
    const ids = [...new Set(req.supermarketLocationIds)];
    if (ids.length === 0) {
      return { shops: [] };
    }
    const rows = await this.locations.find({
      where: { id: In(ids) },
      relations: { supermarket: true },
    });
    return {
      shops: rows.map((row) => toNamedShop(row, req.profilePostalCodes)),
    };
  }
}
