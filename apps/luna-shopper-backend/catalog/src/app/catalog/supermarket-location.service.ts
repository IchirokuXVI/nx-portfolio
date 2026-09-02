import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
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
import { Supermarket, SupermarketLocation } from '../entities';
import { toSupermarketLocationView } from './catalog.mappers';
import { PlatformAdminService } from './platform-admin.service';
import { PriceScopeService } from './price-scope.service';

interface LocationCursor {
  value: string;
  id: string;
}

/** Supermarket locations (plan 0012). Writes owner only; reads open. */
@Injectable()
export class SupermarketLocationService {
  constructor(
    @InjectRepository(SupermarketLocation)
    private readonly locations: Repository<SupermarketLocation>,
    @InjectRepository(Supermarket)
    private readonly supermarkets: Repository<Supermarket>,
    private readonly scopes: PriceScopeService,
    private readonly admin: PlatformAdminService
  ) {}

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

    const saved = await this.locations.save(
      this.locations.create({
        id,
        supermarketId: req.supermarketId,
        priceScopeId,
        label: req.label ?? null,
        address: req.address ?? null,
        city: req.city ?? null,
        country: req.country ?? null,
        postalCode: req.postalCode ?? null,
        latitude: req.latitude ?? null,
        longitude: req.longitude ?? null,
        externalRef: req.externalRef ?? null,
        externalProvider: req.externalProvider ?? null,
      })
    );
    return toSupermarketLocationView(saved);
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
      row.postalCode = req.postalCode;
    }
    if (req.externalRef !== undefined) {
      row.externalRef = req.externalRef;
    }
    if (req.externalProvider !== undefined) {
      row.externalProvider = req.externalProvider;
    }
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

  private async load(id: string): Promise<SupermarketLocation> {
    const row = await this.locations.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Supermarket location not found');
    }
    return row;
  }
}
