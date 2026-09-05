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
import {
  type AuditedWrite,
  CatalogAuditService,
} from './catalog-audit.service';
import { toPriceScopeView } from './catalog.mappers';
import { EffectivePriceService } from './effective-price.service';
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
    private readonly admin: PlatformAdminService,
    private readonly audit: CatalogAuditService,
    private readonly effective: EffectivePriceService
  ) {}

  async create(req: CreatePriceScopeRequest): Promise<PriceScopeView> {
    const actor = await this.admin.requireAdmin(req);
    await this.requireSupermarket(req.supermarketId);
    const draft = this.scopes.create({
      supermarketId: req.supermarketId,
      kind: req.kind,
      externalKey: req.externalKey ?? null,
      label: req.label ?? null,
    });
    try {
      const saved = await this.audit.write(actor, async (tx) => {
        const created = await tx.create(PriceScope, draft);
        // A scope made later inherits the chain's national prices on arrival
        // (plan 0080, section 6).
        await this.effective.inheritNational(tx.manager, created);
        return created;
      });
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
    const actor = await this.admin.requireAdmin(req);
    const row = await this.load(req.priceScopeId);
    const before = { ...row };
    if (req.kind !== undefined) {
      row.kind = req.kind;
    }
    if (req.externalKey !== undefined) {
      row.externalKey = req.externalKey;
    }
    if (req.label !== undefined) {
      row.label = req.label;
    }
    return toPriceScopeView(
      await this.audit.write(actor, (tx) => tx.update(PriceScope, before, row))
    );
  }

  async delete(req: PriceScopeIdRequest): Promise<{ id: string }> {
    const actor = await this.admin.requireAdmin(req);
    const row = await this.load(req.priceScopeId);
    try {
      await this.audit.write(actor, (tx) => tx.delete(PriceScope, row));
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
   *
   * **It takes the caller's transaction** rather than opening its own (plan
   * 0075). The only caller is a location being created, and the two rows are one
   * act: a scope left behind by a location save that then failed is a scope
   * nothing points at, and before this the failure produced exactly that.
   */
  async ensureStoreScope(
    tx: AuditedWrite,
    supermarketId: string,
    locationId: string,
    label: PriceScope['label'] = null
  ): Promise<PriceScope> {
    const existing = await tx.manager.findOne(PriceScope, {
      where: {
        supermarketId,
        kind: PriceScopeKind.STORE,
        externalKey: locationId,
      },
    });
    if (existing) {
      return existing;
    }
    const created = await tx.create(
      PriceScope,
      this.scopes.create({
        supermarketId,
        kind: PriceScopeKind.STORE,
        externalKey: locationId,
        label,
      })
    );
    // The same inheritance `create` gives a scope made by hand (plan 0080,
    // section 6): a chain priced nationally prices its new shop at once.
    await this.effective.inheritNational(tx.manager, created);
    return created;
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
