import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  PriceScopeKind,
  type CreatePriceScopeRequest,
  type ListPriceScopesRequest,
  type PriceScopeIdRequest,
  type PriceScopePage,
  type PriceScopeView,
  type UpdatePriceScopeRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  ConflictException,
  decodeCursor,
  encodeCursor,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { QueryFailedError, Repository } from 'typeorm';
import { PriceScope, Supermarket } from '../entities';
import { toPriceScopeView } from './catalog.mappers';
import { PlatformAdminService } from './platform-admin.service';

const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';

interface PriceScopeCursor {
  value: string;
  id: string;
}

/**
 * Price scopes (plan 0038, section 5.1): the sets of stores a chain charges the
 * same in. Platform admin gated like every other catalog write.
 *
 * The invariant worth knowing: **a location cannot be left without a scope**, so
 * deleting a scope a location still points at is refused rather than cascaded.
 * The database enforces it too (`ON DELETE RESTRICT`); this turns the constraint
 * violation into a sentence the owner can act on.
 */
@Injectable()
export class PriceScopeService {
  constructor(
    @InjectRepository(PriceScope)
    private readonly scopes: Repository<PriceScope>,
    @InjectRepository(Supermarket)
    private readonly supermarkets: Repository<Supermarket>,
    private readonly admin: PlatformAdminService
  ) {}

  async create(req: CreatePriceScopeRequest): Promise<PriceScopeView> {
    this.admin.requireAdmin(req.userId);
    await this.requireSupermarket(req.supermarketId);
    try {
      const saved = await this.scopes.save(
        this.scopes.create({
          supermarketId: req.supermarketId,
          kind: req.kind,
          externalKey: req.externalKey ?? null,
          label: req.label ?? null,
        })
      );
      return toPriceScopeView(saved);
    } catch (error) {
      if (isPgError(error, PG_UNIQUE_VIOLATION)) {
        throw new ConflictException(
          'That chain already has a scope of this kind with that key'
        );
      }
      throw error;
    }
  }

  async update(req: UpdatePriceScopeRequest): Promise<PriceScopeView> {
    this.admin.requireAdmin(req.userId);
    const row = await this.load(req.priceScopeId);
    if (req.kind !== undefined) {
      row.kind = req.kind;
    }
    if (req.externalKey !== undefined) {
      row.externalKey = req.externalKey;
    }
    if (req.label !== undefined) {
      row.label = req.label;
    }
    return toPriceScopeView(await this.scopes.save(row));
  }

  async delete(req: PriceScopeIdRequest): Promise<{ id: string }> {
    this.admin.requireAdmin(req.userId);
    try {
      const result = await this.scopes.delete({ id: req.priceScopeId });
      if (!result.affected) {
        throw new NotFoundException('Price scope not found');
      }
    } catch (error) {
      if (isPgError(error, PG_FOREIGN_KEY_VIOLATION)) {
        throw new ConflictException(
          'Stores still price against this scope. Move them to another scope first.'
        );
      }
      throw error;
    }
    return { id: req.priceScopeId };
  }

  async list(req: ListPriceScopesRequest): Promise<PriceScopePage> {
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as PriceScopeCursor | undefined;

    const qb = this.scopes
      .createQueryBuilder('s')
      .orderBy('s.createdAt', 'DESC')
      .addOrderBy('s.id', 'DESC')
      .take(limit + 1);
    if (req.supermarketId) {
      qb.andWhere('s."supermarketId" = :sid', { sid: req.supermarketId });
    }
    if (cursor) {
      qb.andWhere('(s."createdAt", s.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toPriceScopeView),
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  /**
   * The STORE scope for one location, created on demand.
   *
   * This is what makes hand entered supermarkets need no special case (section
   * 5.1): a chain with no obtainable price data gets one scope per store, which
   * is exactly the shape the schema had before scopes existed. The migration
   * seeded these for every location that already existed; this is the same rule
   * applied to a location created afterwards.
   */
  async ensureStoreScope(
    supermarketId: string,
    locationId: string,
    label: PriceScope['label'] = null
  ): Promise<PriceScope> {
    const existing = await this.scopes.findOne({
      where: {
        supermarketId,
        kind: PriceScopeKind.STORE,
        externalKey: locationId,
      },
    });
    if (existing) {
      return existing;
    }
    return this.scopes.save(
      this.scopes.create({
        supermarketId,
        kind: PriceScopeKind.STORE,
        externalKey: locationId,
        label,
      })
    );
  }

  /** Load a scope, asserting it belongs to the chain the caller named. */
  async requireScopeOf(
    priceScopeId: string,
    supermarketId: string
  ): Promise<PriceScope> {
    const scope = await this.load(priceScopeId);
    if (scope.supermarketId !== supermarketId) {
      throw new ConflictException(
        'That price scope belongs to a different supermarket chain'
      );
    }
    return scope;
  }

  async load(id: string): Promise<PriceScope> {
    const row = await this.scopes.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Price scope not found');
    }
    return row;
  }

  private async requireSupermarket(id: string): Promise<void> {
    const parent = await this.supermarkets.findOne({ where: { id } });
    if (!parent) {
      throw new NotFoundException('Supermarket not found');
    }
  }
}

function isPgError(error: unknown, code: string): boolean {
  return (
    error instanceof QueryFailedError &&
    (error as { driverError?: { code?: string } }).driverError?.code === code
  );
}
