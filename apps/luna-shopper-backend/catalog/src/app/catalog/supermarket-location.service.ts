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
import { Repository } from 'typeorm';
import { Supermarket, SupermarketLocation } from '../entities';
import { PlatformAdminService } from './platform-admin.service';
import { toSupermarketLocationView } from './catalog.mappers';

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
    private readonly admin: PlatformAdminService
  ) {}

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
    const saved = await this.locations.save(
      this.locations.create({
        supermarketId: req.supermarketId,
        label: req.label ?? null,
        address: req.address ?? null,
        city: req.city ?? null,
        country: req.country ?? null,
        latitude: req.latitude ?? null,
        longitude: req.longitude ?? null,
      })
    );
    return toSupermarketLocationView(saved);
  }

  async update(
    req: UpdateSupermarketLocationRequest
  ): Promise<SupermarketLocationView> {
    this.admin.requireAdmin(req.userId);
    const row = await this.load(req.supermarketLocationId);
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
    return toSupermarketLocationView(await this.locations.save(row));
  }

  async delete(
    req: SupermarketLocationIdRequest
  ): Promise<{ id: string }> {
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
    return toSupermarketLocationView(await this.load(req.supermarketLocationId));
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
