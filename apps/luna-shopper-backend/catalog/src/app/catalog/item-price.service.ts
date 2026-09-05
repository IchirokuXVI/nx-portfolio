import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  AddItemPriceBatchRequest,
  AddItemPriceBatchResult,
  AddItemPriceRequest,
  ItemPriceIdRequest,
  ItemPricePage,
  ItemPriceView,
  ListItemPricesRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { Item, ItemPrice, PriceScope } from '../entities';
import { CatalogAuditService } from './catalog-audit.service';
import { toItemPriceView } from './catalog.mappers';
import { EffectivePriceService } from './effective-price.service';
import { writeItemPrices } from './item-price-writer';
import { PlatformAdminService } from './platform-admin.service';

interface ItemPriceCursor {
  value: string;
  id: string;
}

/**
 * Every price a source gave (plan 0080, section 9). Writes are owner or
 * service gated like every other catalog write; the history read is operator
 * only, because it is reached through the back office and nowhere else.
 *
 * Every insert and delete is audited through `CatalogAuditService.write`. A
 * confirmation, a `lastObservedAt` that moved, records nothing: that is plan
 * 0075 section 4's first mitigation applied to the new shape. The materialized
 * row is derived, recomputed inside the same transaction, and its changes are
 * not audited separately.
 */
@Injectable()
export class ItemPriceService {
  constructor(
    @InjectRepository(ItemPrice)
    private readonly prices: Repository<ItemPrice>,
    @InjectRepository(Item) private readonly items: Repository<Item>,
    @InjectRepository(PriceScope)
    private readonly scopes: Repository<PriceScope>,
    private readonly admin: PlatformAdminService,
    private readonly audit: CatalogAuditService,
    private readonly effective: EffectivePriceService
  ) {}

  /** One row. An `ADMIN` add computes its override snapshot server side. */
  async add(req: AddItemPriceRequest): Promise<ItemPriceView> {
    const actor = await this.admin.requireAdmin(req);
    const scope = await this.requireItemAndScope(req.itemId, req.priceScopeId);
    const now = new Date();

    const row = await this.audit.write(actor, async (tx) => {
      const outcome = await writeItemPrices(tx.manager, {
        scope,
        sourceKind: req.sourceKind,
        sourceRunId: req.sourceRunId ?? null,
        entries: [
          {
            itemId: req.itemId,
            price: req.price,
            currency: req.currency,
            unitPrice: req.unitPrice,
            unitPriceLabel: req.unitPriceLabel,
            observedAt: req.observedAt,
            validFrom: req.validFrom,
            validUntil: req.validUntil,
          },
        ],
        now,
      });
      for (const inserted of outcome.inserted) {
        await tx.recordCreate(ItemPrice, inserted);
      }
      const keys = await this.effective.affectedKeys(
        tx.manager,
        [req.itemId],
        scope.id
      );
      await this.effective.recompute(tx.manager, keys, now);

      const written = outcome.inserted[0] ?? outcome.confirmed[0];
      if (written) {
        return written;
      }
      // Equal on every value and not later: the current row is the answer.
      return tx.manager.findOne(ItemPrice, {
        where: {
          itemId: req.itemId,
          priceScopeId: scope.id,
          sourceKind: req.sourceKind,
        },
        order: { observedAt: 'DESC' },
      });
    });
    if (!row) {
      throw new NotFoundException('Item price not found');
    }
    return toItemPriceView(row);
  }

  /**
   * Many rows of one kind for one scope, which is how a run writes. A run may
   * write official kinds only; the writer refuses anything else.
   */
  async addBatch(
    req: AddItemPriceBatchRequest
  ): Promise<AddItemPriceBatchResult> {
    const actor = await this.admin.requireAdmin(req);
    const scope = await this.requireScope(req.priceScopeId);
    const now = new Date();

    return this.audit.write(actor, async (tx) => {
      const outcome = await writeItemPrices(tx.manager, {
        scope,
        sourceKind: req.sourceKind,
        sourceRunId: req.sourceRunId ?? null,
        entries: req.entries,
        now,
      });
      for (const inserted of outcome.inserted) {
        await tx.recordCreate(ItemPrice, inserted);
      }
      const touched = [
        ...new Set(
          [...outcome.inserted, ...outcome.confirmed].map((row) => row.itemId)
        ),
      ];
      const keys = await this.effective.affectedKeys(
        tx.manager,
        touched,
        scope.id
      );
      await this.effective.recompute(tx.manager, keys, now);
      return {
        inserted: outcome.inserted.length,
        confirmed: outcome.confirmed.length,
      };
    });
  }

  /** The history for one (item, scope), newest first. Operator only. */
  async list(req: ListItemPricesRequest): Promise<ItemPricePage> {
    await this.admin.requireAdmin(req);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as ItemPriceCursor | undefined;

    const qb = this.prices
      .createQueryBuilder('p')
      .where('p."itemId" = :itemId', { itemId: req.itemId })
      .andWhere('p."priceScopeId" = :scopeId', { scopeId: req.priceScopeId })
      // The one read that wants what a leaflet printed beside the number
      // (plan 0081, section 6.4). Left joined here and nowhere else: the
      // recompute reads this table on every write and must not pay for it.
      .leftJoinAndSelect('p.details', 'details')
      .orderBy('p.observedAt', 'DESC')
      .addOrderBy('p.id', 'DESC')
      .take(limit + 1);
    if (cursor) {
      qb.andWhere('(p."observedAt", p.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const list = rows.slice(0, limit);
    const last = list[list.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ value: last.observedAt.toISOString(), id: last.id })
        : null;
    return { items: list.map(toItemPriceView), nextCursor };
  }

  /** Remove one row. The materialized row is recomputed behind it. */
  async delete(req: ItemPriceIdRequest): Promise<{ id: string }> {
    const actor = await this.admin.requireAdmin(req);
    const row = await this.prices.findOne({ where: { id: req.itemPriceId } });
    if (!row) {
      throw new NotFoundException('Item price not found');
    }
    await this.audit.write(actor, async (tx) => {
      await tx.delete(ItemPrice, row);
      const keys = await this.effective.affectedKeys(
        tx.manager,
        [row.itemId],
        row.priceScopeId
      );
      await this.effective.recompute(tx.manager, keys);
    });
    return { id: req.itemPriceId };
  }

  private async requireItemAndScope(
    itemId: string,
    priceScopeId: string
  ): Promise<PriceScope> {
    const [item, scope] = await Promise.all([
      this.items.findOne({ where: { id: itemId } }),
      this.scopes.findOne({ where: { id: priceScopeId } }),
    ]);
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    if (!scope) {
      throw new NotFoundException('Price scope not found');
    }
    return scope;
  }

  private async requireScope(priceScopeId: string): Promise<PriceScope> {
    const scope = await this.scopes.findOne({ where: { id: priceScopeId } });
    if (!scope) {
      throw new NotFoundException('Price scope not found');
    }
    return scope;
  }
}
