import { Injectable, Logger } from '@nestjs/common';
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
import type { ObservedPlace } from './run-report';

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
  private readonly logger = new Logger(DiscoveredPlaceService.name);

  constructor(
    @InjectRepository(DiscoveredPlace)
    private readonly places: Repository<DiscoveredPlace>,
    private readonly catalog: CatalogClient,
    private readonly admin: PlatformAdminService
  ) {}

  /**
   * What a run does with the shops it found (plan 0103, section 6.4).
   *
   * Both store discovery runners held a `Repository<DiscoveredPlace>` and wrote
   * this themselves, twice, with the postal code derivation in one of them only.
   * A runner reports places now and holds nothing that could write them, so the
   * upsert is here, once, for every source that finds a shop.
   *
   * **Re-discovery refreshes the description and never resurrects a decision.**
   * `status` is the owner's: a place already imported or rejected keeps that
   * answer however many runs meet it again.
   *
   * **A postal code the source stated is never overridden by a guess.** A place
   * that arrives without one is derived from its coordinates, bounded by the
   * same limit plan 0061 bounds a location's own derivation with, and a place
   * beyond that bound keeps both columns null. A wrong postcode puts the shop in
   * somebody else's list, which is worse than no postcode at all.
   *
   * No admin gate, unlike every other method here: the caller is a run, not a
   * person, and the run was already gated at the spawn.
   */
  async observe(
    places: readonly ObservedPlace[],
    options: { runId: string; deriveMaxMetres: number }
  ): Promise<{ created: number; refreshed: number }> {
    const seenAt = new Date();
    let created = 0;
    let refreshed = 0;

    for (const place of places) {
      const located = await this.locate(place, options.deriveMaxMetres);
      const fields = {
        brandKey: place.brandKey,
        brandName: place.brandName,
        name: place.name,
        latitude: place.latitude,
        longitude: place.longitude,
        street: place.street,
        city: place.city,
        postalCode: located.postalCode,
        postalCodeSource: located.postalCodeSource,
        country: place.country,
        website: place.website,
        openingHours: place.openingHours,
        tags: place.tags,
        runId: options.runId,
        lastSeenAt: seenAt,
      };

      const existing = await this.places.findOne({
        where: { provider: place.provider, externalRef: place.externalRef },
      });
      if (existing) {
        Object.assign(existing, fields);
        await this.places.save(existing);
        refreshed += 1;
        continue;
      }
      await this.places.save(
        this.places.create({
          provider: place.provider,
          externalRef: place.externalRef,
          status: DiscoveredPlaceStatus.NEW,
          firstSeenAt: seenAt,
          ...fields,
        })
      );
      created += 1;
    }

    return { created, refreshed };
  }

  /**
   * The place's postal code, and where it came from (plan 0097, section 3).
   *
   * A failure asking catalog leaves the place with no code rather than failing
   * the run. One untagged address is not worth losing an eighteen minute walk
   * over, and the next run of this code fills it in.
   */
  private async locate(
    place: ObservedPlace,
    deriveMaxMetres: number
  ): Promise<{
    postalCode: string | null;
    postalCodeSource: PostalCodeSource | null;
  }> {
    if (place.postalCode) {
      return {
        postalCode: place.postalCode,
        postalCodeSource: place.postalCodeSource ?? PostalCodeSource.SOURCE,
      };
    }
    const country = place.country.trim().toLowerCase();
    if (!country) {
      return { postalCode: null, postalCodeSource: null };
    }
    try {
      const { nearest } = await this.catalog.resolveNearestPostalCode(
        country,
        place.latitude,
        place.longitude,
        deriveMaxMetres
      );
      return nearest
        ? {
            postalCode: nearest.postalCode,
            postalCodeSource: PostalCodeSource.DERIVED,
          }
        : { postalCode: null, postalCodeSource: null };
    } catch (error) {
      this.logger.warn(
        `Could not derive a postal code for a place in ${country}: ` +
          `${String(error)}`
      );
      return { postalCode: null, postalCodeSource: null };
    }
  }

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
    // The places **located in** a code, which is what the postal code detail
    // screen's panel asks for (plan 0097, section 9). It reads the place's own
    // postal code and never the run's: a run centred on 14013 writes places in
    // four other codes, and those belong to those codes.
    if (req.country) {
      qb.andWhere('lower(p.country) = :country', {
        country: req.country.trim().toLowerCase(),
      });
    }
    if (req.postalCode) {
      qb.andWhere('p."postalCode" = :postalCode', {
        postalCode: req.postalCode.trim(),
      });
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
