import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DiscoveredPlaceStatus,
  PostalCodeSource,
  PriceScopeKind,
  type DiscoveredPlaceGroup,
  type DiscoveredPlaceGroupsResult,
  type DiscoveredPlaceIdRequest,
  type DiscoveredPlacePage,
  type DiscoveredPlaceView,
  type GroupDiscoveredPlacesRequest,
  type ImportDiscoveredPlaceRequest,
  type ListDiscoveredPlacesRequest,
  type SupermarketView,
} from '@portfolio/luna-shopper/contracts';
import { OSM_ATTRIBUTION } from '@portfolio/luna-shopper/osm-places';
import {
  clampPageSize,
  ConflictException,
  decodeCursor,
  encodeCursor,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { DiscoveredPlace } from '../entities';
import { CatalogClient } from './catalog-client.service';
import { toDiscoveredPlaceView } from './harvest.mappers';
import { PlatformAdminService } from './platform-admin.service';

interface PlaceCursor {
  value: string;
  id: string;
}

/**
 * The review queue a store discovery run fills (plan 0038, section 6.1).
 *
 * **A run creates nothing in catalog**, so this is where a place becomes a real
 * `Supermarket` and `SupermarketLocation`, one at a time and by the owner's
 * choice. That is also where hand entered supermarkets already fit, with no new
 * mechanism.
 *
 * The data is ODbL, so anything derived from it that reaches a user must carry
 * {@link OSM_ATTRIBUTION}. Imported locations record `externalProvider: 'OSM'`
 * precisely so that obligation travels with the row rather than living in a
 * comment here.
 */
@Injectable()
export class DiscoveredPlaceService {
  constructor(
    @InjectRepository(DiscoveredPlace)
    private readonly places: Repository<DiscoveredPlace>,
    private readonly catalog: CatalogClient,
    private readonly admin: PlatformAdminService
  ) {}

  async list(req: ListDiscoveredPlacesRequest): Promise<DiscoveredPlacePage> {
    await this.admin.requireAdmin(req);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as PlaceCursor | undefined;

    const qb = this.places
      .createQueryBuilder('p')
      .orderBy('p."lastSeenAt"', 'DESC')
      .addOrderBy('p.id', 'DESC')
      .take(limit + 1);
    if (req.runId) {
      qb.andWhere('p."runId" = :runId', { runId: req.runId });
    }
    if (req.brandKey) {
      qb.andWhere('p."brandKey" = :brandKey', { brandKey: req.brandKey });
    }
    if (req.status) {
      qb.andWhere('p.status = :status', { status: req.status });
    }
    if (cursor) {
      qb.andWhere('(p."lastSeenAt", p.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toDiscoveredPlaceView),
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.lastSeenAt.toISOString(), id: last.id })
          : null,
    };
  }

  /**
   * Section 6.1 step 4's report: the run's places grouped by chain, with a count,
   * a sample, and whether catalog already knows that chain.
   *
   * Grouping is on `brandKey` and never on the name (section 2.7): `Dia` and
   * `Maxi Dia` share one QID, and matching on the name would split one chain into
   * several. Places with no brand tag group under `null`, which is a real answer:
   * they are independent shops, and 35 of the 75 elements in the wider search
   * looked like that.
   */
  async groups(
    req: GroupDiscoveredPlacesRequest
  ): Promise<DiscoveredPlaceGroupsResult> {
    await this.admin.requireAdmin(req);
    const sampleSize = Math.max(1, Math.min(req.sampleSize ?? 3, 20));

    const qb = this.places.createQueryBuilder('p').orderBy('p.name', 'ASC');
    if (req.runId) {
      qb.andWhere('p."runId" = :runId', { runId: req.runId });
    }
    const rows = await qb.getMany();

    const known = await this.knownBrandKeys();
    const buckets = new Map<string | null, DiscoveredPlace[]>();
    for (const row of rows) {
      const bucket = buckets.get(row.brandKey);
      if (bucket) {
        bucket.push(row);
      } else {
        buckets.set(row.brandKey, [row]);
      }
    }

    const groups: DiscoveredPlaceGroup[] = [...buckets.entries()].map(
      ([brandKey, places]) => {
        const match = brandKey ? known.get(brandKey) : undefined;
        return {
          brandKey,
          brandName: places.find((p) => p.brandName)?.brandName ?? null,
          count: places.length,
          known: Boolean(match),
          supermarketId: match?.id ?? null,
          sample: places.slice(0, sampleSize).map(toDiscoveredPlaceView),
        };
      }
    );
    groups.sort((a, b) => b.count - a.count);
    return { groups };
  }

  /**
   * Promote one place into catalog.
   *
   * **Import is per place and creates the chain on demand** (section 11): one run
   * returns 17 brands, and creating a `Supermarket` row for every one of them
   * would clutter the catalog with chains the owner will never shop at.
   *
   * The scope: a named one wins; otherwise the location gets a STORE scope of its
   * own, which catalog creates for any location that names none. Resolving a
   * warehouse from the store's postal code is a Mercadona specific step that
   * belongs to the chain's own source configuration, not to a generic import.
   */
  async import(
    req: ImportDiscoveredPlaceRequest
  ): Promise<DiscoveredPlaceView> {
    await this.admin.requireAdmin(req);
    const place = await this.load(req.placeId);
    if (place.status === DiscoveredPlaceStatus.IMPORTED) {
      throw new ConflictException(
        'That place has already been imported into the catalog'
      );
    }

    const supermarketId =
      req.supermarketId ?? (await this.resolveSupermarket(place)).id;

    const location = await this.catalog.createLocation({
      supermarketId,
      priceScopeId: req.priceScopeId,
      label: place.name ? { en: place.name, es: place.name } : null,
      address: place.street,
      city: place.city,
      // The run's own country, which used to be discarded and hardcoded null
      // here (plan 0061, section 4). Catalog needs it to key the centroid
      // lookup that fills the postcode two thirds of these places lack.
      country: place.country,
      postalCode: place.postalCode,
      // A tag OSM gave us, so it is the source's and never overridden. A place
      // with no tag sends nothing and catalog derives one, or does not.
      postalCodeSource: place.postalCode ? PostalCodeSource.SOURCE : undefined,
      latitude: place.latitude,
      longitude: place.longitude,
      externalRef: place.externalRef,
      // Recorded so the ODbL attribution obligation travels with the row.
      externalProvider: place.provider,
    });

    place.status = DiscoveredPlaceStatus.IMPORTED;
    // Written back so a re-run recognizes the place as already ours rather than
    // offering it again.
    place.supermarketLocationId = location.id;
    return toDiscoveredPlaceView(await this.places.save(place));
  }

  async reject(req: DiscoveredPlaceIdRequest): Promise<DiscoveredPlaceView> {
    await this.admin.requireAdmin(req);
    const place = await this.load(req.placeId);
    place.status = DiscoveredPlaceStatus.REJECTED;
    return toDiscoveredPlaceView(await this.places.save(place));
  }

  /**
   * Find the chain by its `externalBrandKey`, or create it. The QID is the
   * identity because the brand name splits `Dia` from `Maxi Dia`; it is a good
   * default the owner can override afterwards, not an oracle.
   */
  private async resolveSupermarket(
    place: DiscoveredPlace
  ): Promise<SupermarketView> {
    if (place.brandKey) {
      const known = await this.knownBrandKeys();
      const existing = known.get(place.brandKey);
      if (existing) {
        return existing;
      }
    }
    const name = place.brandName ?? place.name;
    if (!name) {
      throw new ConflictException(
        'That place carries neither a brand nor a name, so there is nothing to ' +
          'call the chain. Pass an explicit supermarketId to attach it to one.'
      );
    }
    return this.catalog.createSupermarket({
      name: { en: name, es: name },
      externalBrandKey: place.brandKey,
    });
  }

  private async knownBrandKeys(): Promise<Map<string, SupermarketView>> {
    const known = new Map<string, SupermarketView>();
    let cursor: string | undefined;
    do {
      const page = await this.catalog.listSupermarkets(cursor);
      for (const supermarket of page.items) {
        if (supermarket.externalBrandKey) {
          known.set(supermarket.externalBrandKey, supermarket);
        }
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return known;
  }

  private async load(id: string): Promise<DiscoveredPlace> {
    const row = await this.places.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Discovered place not found');
    }
    return row;
  }
}

/** Re-exported so the runner and the module share one constant. */
export { OSM_ATTRIBUTION, PriceScopeKind };
