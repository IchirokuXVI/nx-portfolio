import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  PostalCodeSource,
  type CreateSupermarketLocationRequest,
  type ListSupermarketLocationsRequest,
  type SupermarketLocationIdRequest,
  type SupermarketLocationPage,
  type SupermarketLocationView,
  type UpdateSupermarketLocationRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import type { CatalogConfig } from '../config/app-config';
import { Supermarket, SupermarketLocation } from '../entities';
import { toSupermarketLocationView } from './catalog.mappers';
import { PlatformAdminService } from './platform-admin.service';
import { PostalCodeService } from './postal-code.service';
import { PriceScopeService } from './price-scope.service';

interface LocationCursor {
  value: string;
  id: string;
}

/**
 * Supermarket locations (plan 0012). Writes owner only; reads open.
 *
 * Since plan 0061 it is also where a missing postal code is filled in. **Catalog
 * fills it, not the harvester** (section 3): every creator gets the behaviour,
 * including a supermarket an admin typed by hand, and the centroid table lives
 * here, so filling it from the harvester would send one fact across a service
 * boundary and straight back.
 */
@Injectable()
export class SupermarketLocationService {
  private readonly deriveMaxMetres: number;

  constructor(
    @InjectRepository(SupermarketLocation)
    private readonly locations: Repository<SupermarketLocation>,
    @InjectRepository(Supermarket)
    private readonly supermarkets: Repository<Supermarket>,
    private readonly scopes: PriceScopeService,
    private readonly admin: PlatformAdminService,
    private readonly postalCodes: PostalCodeService,
    config: ConfigService
  ) {
    this.deriveMaxMetres =
      config.getOrThrow<CatalogConfig>('catalog').postalCodeDeriveMaxMetres;
  }

  /**
   * Create a store.
   *
   * Every location must price against a scope, and a caller that names none gets
   * a `STORE` scope of its own (plan 0038, section 5.1). That is what keeps hand
   * entered supermarkets working exactly as they did before scopes existed: the
   * per store shape is still expressible, it is just no longer the only one.
   *
   * The id is generated here rather than by the database because the scope and
   * the location each need the other's key: the scope's `externalKey` is the
   * location id, and the location's `priceScopeId` is the scope. Choosing the id
   * first breaks the cycle without a nullable column or a second UPDATE.
   */
  async create(
    req: CreateSupermarketLocationRequest
  ): Promise<SupermarketLocationView> {
    this.admin.requireAdmin(req.userId);
    const parent = await this.supermarkets.findOne({
      where: { id: req.supermarketId },
    });
    if (!parent) {
      throw new NotFoundException('Supermarket not found');
    }

    const id = randomUUID();
    const priceScopeId = req.priceScopeId
      ? (await this.scopes.requireScopeOf(req.priceScopeId, req.supermarketId))
          .id
      : (
          await this.scopes.ensureStoreScope(
            req.supermarketId,
            id,
            req.label ?? null
          )
        ).id;

    const draft = this.locations.create({
      id,
      supermarketId: req.supermarketId,
      priceScopeId,
      label: req.label ?? null,
      address: req.address ?? null,
      city: req.city ?? null,
      country: req.country ?? null,
      postalCode: req.postalCode ?? null,
      postalCodeSource: req.postalCode
        ? (req.postalCodeSource ?? PostalCodeSource.MANUAL)
        : null,
      latitude: req.latitude ?? null,
      longitude: req.longitude ?? null,
      externalRef: req.externalRef ?? null,
      externalProvider: req.externalProvider ?? null,
    });
    await this.fillPostalCodeFromCentroid(draft);

    return toSupermarketLocationView(await this.locations.save(draft));
  }

  async update(
    req: UpdateSupermarketLocationRequest
  ): Promise<SupermarketLocationView> {
    this.admin.requireAdmin(req.userId);
    const row = await this.load(req.supermarketLocationId);
    if (req.priceScopeId !== undefined) {
      row.priceScopeId = (
        await this.scopes.requireScopeOf(req.priceScopeId, row.supermarketId)
      ).id;
    }
    if (req.label !== undefined) {
      row.label = req.label;
    }
    if (req.address !== undefined) {
      row.address = req.address;
    }
    if (req.city !== undefined) {
      row.city = req.city;
    }
    if (req.country !== undefined) {
      row.country = req.country;
    }
    if (req.latitude !== undefined) {
      row.latitude = req.latitude;
    }
    if (req.longitude !== undefined) {
      row.longitude = req.longitude;
    }
    if (req.postalCode !== undefined) {
      // An update that sets one is a statement (plan 0061, section 3), and it
      // stands even against a nearer centroid. Setting it to null hands the
      // field back to the lookup below.
      row.postalCode = req.postalCode;
      row.postalCodeSource = req.postalCode
        ? (req.postalCodeSource ?? PostalCodeSource.MANUAL)
        : null;
    }
    if (req.externalRef !== undefined) {
      row.externalRef = req.externalRef;
    }
    if (req.externalProvider !== undefined) {
      row.externalProvider = req.externalProvider;
    }
    await this.fillPostalCodeFromCentroid(row);

    return toSupermarketLocationView(await this.locations.save(row));
  }

  async delete(req: SupermarketLocationIdRequest): Promise<{ id: string }> {
    this.admin.requireAdmin(req.userId);
    const result = await this.locations.delete({
      id: req.supermarketLocationId,
    });
    if (!result.affected) {
      throw new NotFoundException('Supermarket location not found');
    }
    return { id: req.supermarketLocationId };
  }

  async get(
    req: SupermarketLocationIdRequest
  ): Promise<SupermarketLocationView> {
    return toSupermarketLocationView(
      await this.load(req.supermarketLocationId)
    );
  }

  /**
   * A chain's shops, newest first.
   *
   * The caller's refusals are filtered out when the request carries them (plan
   * 0064, section 3) and not otherwise, which is what keeps this one read
   * serving both the screen that **offers** shops and the screen that **edits**
   * the refusals: the second has to render a shop that is switched off, and a
   * read that hid it could not be used to switch it back on.
   */
  async list(
    req: ListSupermarketLocationsRequest
  ): Promise<SupermarketLocationPage> {
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as LocationCursor | undefined;

    const qb = this.locations
      .createQueryBuilder('l')
      .where('l."supermarketId" = :sid', { sid: req.supermarketId })
      .orderBy('l.createdAt', 'DESC')
      .addOrderBy('l.id', 'DESC')
      .take(limit + 1);
    if (req.priceScopeId) {
      // Plan 0066, section 4: the shops that sell at one scope, which is how a
      // price keyed by scope becomes somewhere a person can go.
      qb.andWhere('l."priceScopeId" = :scope', { scope: req.priceScopeId });
    }
    const refused = req.excludedSupermarketLocationIds ?? [];
    if (refused.length > 0) {
      // Plan 0064, section 3: a shop the caller refused is not offered. Catalog
      // is handed the ids rather than asked to work them out, because the
      // preference lives in core and the gateway is the one thing that knows
      // both. An empty list is not a filter: `NOT IN ()` is not valid SQL, and
      // "the caller refused nothing" is the ordinary case.
      qb.andWhere('l.id NOT IN (:...refused)', { refused });
    }
    if (cursor) {
      qb.andWhere('(l."createdAt", l.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ value: last.createdAt.toISOString(), id: last.id })
        : null;

    return { items: page.map(toSupermarketLocationView), nextCursor };
  }

  /**
   * Take the nearest postal code centroid where the row has no code of its own
   * (plan 0061, sections 3 and 4). Mutates the row in place, and does nothing at
   * all to a row that has one.
   *
   * **A source postcode is never overridden**, which is the rule this exists to
   * obey rather than to bend: the centroid is an approximation of a boundary and
   * the tag is somebody's observation of a sign on a building. The guard is the
   * first line, and it is the whole of it.
   *
   * **A guess beyond the bound is not made.** A store in the middle of nowhere
   * whose nearest centroid is 30 km away keeps a null postcode, because a wrong
   * postcode is worse than none: none produces a price flagged approximate,
   * wrong produces a confident price for the wrong scope.
   *
   * The country is required and has to be alpha-2, because the lookup is keyed
   * on `(country, postalCode)` and a search with no country would put Spain and
   * Bolivia in one result. A row carrying a country spelled some other way is
   * left alone rather than guessed at.
   */
  private async fillPostalCodeFromCentroid(
    row: Pick<
      SupermarketLocation,
      'country' | 'latitude' | 'longitude' | 'postalCode' | 'postalCodeSource'
    >
  ): Promise<void> {
    if (row.postalCode) {
      return;
    }
    row.postalCodeSource = null;

    const country = alpha2(row.country);
    if (!country || row.latitude === null || row.longitude === null) {
      return;
    }

    const { nearest } = await this.postalCodes.nearest({
      country,
      latitude: row.latitude,
      longitude: row.longitude,
      maxDistanceMetres: this.deriveMaxMetres,
    });
    if (!nearest) {
      return;
    }

    row.postalCode = nearest.postalCode;
    row.postalCodeSource = PostalCodeSource.DERIVED;
  }

  private async load(id: string): Promise<SupermarketLocation> {
    const row = await this.locations.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Supermarket location not found');
    }
    return row;
  }
}

/**
 * The country as the centroid table spells it, or null. `country` on a location
 * is a free text column an admin can type a full name into, and only alpha-2 is
 * a key into `postal_code_points`.
 */
function alpha2(country: string | null): string | null {
  const trimmed = (country ?? '').trim();
  return trimmed.length === 2 ? trimmed.toLowerCase() : null;
}
