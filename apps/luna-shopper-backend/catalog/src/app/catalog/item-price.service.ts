import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ITEM_PRICE_OBSERVED_AT_MAX_AGE_DAYS,
  ItemPriceWrittenBy,
  PriceSourceKind,
  type AddItemPriceBatchRequest,
  type AddItemPriceBatchResult,
  type AddItemPriceRequest,
  type DeleteItemPricesByRunRequest,
  type DeleteItemPricesByRunResult,
  type ItemPriceIdRequest,
  type ItemPricePage,
  type ItemPricesByItemRequest,
  type ItemPriceView,
  type ItemScopePricesPage,
  type ItemScopePricesView,
  type ListItemPricesRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { Repository, type EntityManager } from 'typeorm';
import { Item, ItemPrice, PricePolicy, PriceScope } from '../entities';
import { CatalogAuditService } from './catalog-audit.service';
import { toItemPriceView } from './catalog.mappers';
import { AUTOMATED_KINDS, resolveEffectivePrice } from './effective-price';
import {
  currentPriceRows,
  EffectivePriceService,
  lessSpecificScopesOf,
  type PriceKey,
} from './effective-price.service';
import { writeItemPrices } from './item-price-writer';
import { PlatformAdminService } from './platform-admin.service';

interface ItemPriceCursor {
  value: string;
  id: string;
}

/** Where the all scopes read stopped: chain, then priority, then scope id. */
interface ScopeCursor {
  supermarketId: string;
  priority: number;
  id: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

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
    if (
      req.sourceKind !== PriceSourceKind.ADMIN &&
      !AUTOMATED_KINDS.includes(req.sourceKind)
    ) {
      // Backlog 0008 opens the user kinds, and until then nothing writes one
      // through here (plan 0158). Not in the writer: the reference seed
      // writes USER_RECEIPT through it on purpose, with no run.
      throw new ValidationException(
        `sourceKind ${req.sourceKind} is not accepted here. A price typed ` +
          'through the back office is ADMIN or one of the automated kinds.',
        { messageArgs: { field: 'sourceKind' } }
      );
    }
    const now = new Date();
    requireObservedAtInWindow(req.observedAt, now);
    const scope = await this.requireItemAndScope(req.itemId, req.priceScopeId);

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
    const copiedFromScopeId = await this.requireCopySource(
      scope,
      req.copiedFromScopeId ?? null
    );
    const now = new Date();

    return this.audit.write(actor, async (tx) => {
      const outcome = await writeItemPrices(tx.manager, {
        scope,
        sourceKind: req.sourceKind,
        sourceRunId: req.sourceRunId ?? null,
        copiedFromScopeId,
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

  /**
   * The history for one (item, scope), newest first, or the rows one run
   * wrote (plan 0160). Operator only.
   *
   * A run's rows are the ones it inserted, which carry it in `sourceRunId`,
   * and the ones whose `lastObservedAt` it moved **last**, which carry it in
   * `lastObservedRunId` only. A later run that repeats the price takes the
   * second column over, so an old run's confirmations shrink as newer runs
   * confirm the same rows. That is the stored record and not a gap in the read.
   */
  async list(req: ListItemPricesRequest): Promise<ItemPricePage> {
    await this.admin.requireAdmin(req);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as ItemPriceCursor | undefined;

    const qb = this.prices.createQueryBuilder('p');
    const runId = req.runId;
    if (runId) {
      if (req.priceScopeId) {
        throw new ValidationException(
          'A run read takes runId and, optionally, itemId. Leave out priceScopeId.',
          { details: { priceScopeId: 'not allowed with runId' } }
        );
      }
      qb.where('(p."sourceRunId" = :runId OR p."lastObservedRunId" = :runId)', {
        runId,
      });
      if (req.itemId) {
        qb.andWhere('p."itemId" = :itemId', { itemId: req.itemId });
      }
    } else {
      if (!req.itemId || !req.priceScopeId) {
        throw new ValidationException(
          'Name itemId and priceScopeId for a history, or runId for the rows a run wrote.',
          {
            details: {
              ...(req.itemId ? {} : { itemId: 'required without runId' }),
              ...(req.priceScopeId
                ? {}
                : { priceScopeId: 'required without runId' }),
            },
          }
        );
      }
      qb.where('p."itemId" = :itemId', { itemId: req.itemId }).andWhere(
        'p."priceScopeId" = :scopeId',
        { scopeId: req.priceScopeId }
      );
    }
    qb
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
    const items = list.map((row): ItemPriceView => {
      const view = toItemPriceView(row);
      if (!runId) {
        return view;
      }
      return {
        ...view,
        writtenBy:
          row.sourceRunId === runId
            ? ItemPriceWrittenBy.INSERTED
            : ItemPriceWrittenBy.CONFIRMED,
      };
    });
    return { items, nextCursor };
  }

  /**
   * One product at every scope that prices it, with the row each scope shows
   * and why (plan 0160). Operator only, paged by scope.
   *
   * A scope is listed when the product has a price row there or a materialized
   * row there, so a shop that only inherits a region's price is listed too.
   *
   * **The reason comes from the decision, run again here.** Each scope's
   * current rows across its stack go through `resolveEffectivePrice`, the
   * function the recompute calls, and `shownBecause` is what it returned
   * beside the row. Nothing here restates the rule. The stored row follows
   * within one sweep, so for at most sixty seconds this read is ahead of it.
   */
  async byItem(req: ItemPricesByItemRequest): Promise<ItemScopePricesPage> {
    await this.admin.requireAdmin(req);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as ScopeCursor | undefined;
    const item = await this.items.findOne({ where: { id: req.itemId } });
    if (!item) {
      throw new NotFoundException('Item not found');
    }

    const qb = this.scopes
      .createQueryBuilder('s')
      .where(
        `(EXISTS (SELECT 1 FROM "item_prices" p
                   WHERE p."itemId" = :itemId AND p."priceScopeId" = s.id)
          OR EXISTS (SELECT 1 FROM "supermarket_items" si
                      WHERE si."itemId" = :itemId AND si."priceScopeId" = s.id))`,
        { itemId: req.itemId }
      )
      .orderBy('s."supermarketId"', 'ASC')
      .addOrderBy('s."priority"', 'ASC')
      .addOrderBy('s.id', 'ASC')
      .take(limit + 1);
    if (cursor) {
      qb.andWhere(
        '(s."supermarketId", s."priority", s.id) > (:csid, :cpriority, :cid)',
        {
          csid: cursor.supermarketId,
          cpriority: cursor.priority,
          cid: cursor.id,
        }
      );
    }
    const scopes = await qb.getMany();
    const hasMore = scopes.length > limit;
    const page = scopes.slice(0, limit);
    const last = page[page.length - 1];

    const manager = this.prices.manager;
    const policies = await manager.find(PricePolicy);
    const now = new Date();
    const items: ItemScopePricesView[] = [];
    // One scope at a time, through one manager: each scope reads its own
    // stack, and the page is at most one page of scopes.
    for (const scope of page) {
      const inherited = await lessSpecificScopesOf(manager, scope);
      const stack = [scope, ...inherited];
      const rows = await currentPriceRows(
        manager,
        [req.itemId],
        stack.map((row) => row.id)
      );
      const resolved = resolveEffectivePrice({
        rows,
        priceScopeId: scope.id,
        scopePriorities: new Map(stack.map((row) => [row.id, row.priority])),
        policies,
        now,
      });
      const shown = resolved.row
        ? (rows.find((row) => row.id === resolved.row?.id) ?? null)
        : null;
      const isAdmin = shown?.sourceKind === PriceSourceKind.ADMIN;
      items.push({
        priceScopeId: scope.id,
        supermarketId: scope.supermarketId,
        scopeKind: scope.kind,
        scopeExternalKey: scope.externalKey ?? null,
        scopeLabel: scope.label ?? null,
        scopePriority: scope.priority,
        rows: [...rows]
          .sort(
            (a, b) => b.lastObservedAt.getTime() - a.lastObservedAt.getTime()
          )
          .map(toItemPriceView),
        shownItemPriceId: shown?.id ?? null,
        shownBecause: resolved.shownBecause,
        stale: resolved.stale,
        protectedUntil:
          isAdmin && shown?.protectedUntil
            ? shown.protectedUntil.toISOString()
            : null,
        overrides: isAdmin ? (shown?.overrides ?? null) : null,
      });
    }

    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeCursor({
              supermarketId: last.supermarketId,
              priority: last.priority,
              id: last.id,
            })
          : null,
    };
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

  /**
   * Take back everything one run said about prices (plan 0082, section 2), in
   * one transaction.
   *
   * Three things happen, and the order of the first two is what makes the
   * second one cheap to express. Every row carrying this `sourceRunId` is
   * deleted, details cascading with it. Then every row still carrying it in
   * `lastObservedRunId` is a row the run **confirmed** rather than wrote, and
   * the confirmation is withdrawn: `lastObservedAt` goes back to `observedAt`
   * and `lastObservedRunId` back to `sourceRunId`. Reading the confirmations
   * after the delete is what makes "written by this run" and "only confirmed by
   * this run" two disjoint sets with no `sourceRunId <> :run` clause and no
   * argument about how SQL compares a null to anything.
   *
   * The previous `lastObservedAt` was overwritten and is gone, so it cannot be
   * restored. The row ages as if the run never happened, which errs toward
   * stale, and where the only thing keeping a price fresh was a run the owner
   * distrusts, stale is the honest state.
   *
   * `ADMIN` rows carry no run id and are never touched. So does a `USER_RECEIPT`
   * row from the reference seed. Rows another run wrote are never touched.
   *
   * **Availability is not restored.** A refresh that met a 404 wrote
   * `available: false` through `supermarketItem.setAvailability`, which carries
   * no run id and has no history (plan 0080, section 2). A 404 from a chain's
   * own detail endpoint is the chain's answer about its own stock, and the next
   * refresh states it again either way. It is a stated limit rather than a
   * hidden one.
   *
   * A run with no rows answers zeros. That is not a special case, it is what
   * makes the harvester's two database operation safe to retry after a partial
   * failure (plan 0082, section 5).
   *
   * The actor is whoever the gate let through, which for the only caller there
   * is means the harvester as a `SERVICE`. The run id is in every audit row's
   * `before` already, because `sourceRunId` is a column of the row that was
   * deleted, so plan 0075's trail answers why a price vanished on Tuesday with
   * nothing added here.
   */
  async deleteByRun(
    req: DeleteItemPricesByRunRequest
  ): Promise<DeleteItemPricesByRunResult> {
    const actor = await this.admin.requireAdmin(req);
    const now = new Date();

    return this.audit.write(actor, async (tx) => {
      const written = await tx.manager.find(ItemPrice, {
        where: { sourceRunId: req.sourceRunId },
      });
      if (written.length > 0) {
        // One statement for the rows, then one audit row each, as the batch
        // write records its inserts: a run writes thousands of prices and
        // deleting them one round trip at a time is the same work twice.
        await tx.manager.delete(ItemPrice, { sourceRunId: req.sourceRunId });
        for (const row of written) {
          await tx.recordDelete(ItemPrice, row);
        }
      }

      const confirmed = await tx.manager.find(ItemPrice, {
        where: { lastObservedRunId: req.sourceRunId },
      });
      for (const row of confirmed) {
        const before = { ...row };
        row.lastObservedAt = row.observedAt;
        row.lastObservedRunId = row.sourceRunId;
        await tx.update(ItemPrice, before, row);
      }

      const keys = await this.affectedBy(tx.manager, [
        ...written,
        ...confirmed,
      ]);
      await this.effective.recompute(tx.manager, keys, now);
      return {
        deleted: written.length,
        reset: confirmed.length,
        recomputed: keys.length,
      };
    });
  }

  /**
   * Every (item, scope) key these rows belonged to, deduplicated, including the
   * fan out a NATIONAL row causes (plan 0080, section 6).
   *
   * Grouped by scope before asking, because `affectedKeys` reads the scope once
   * per call and a run's rows are nearly always all at one scope.
   */
  private async affectedBy(
    manager: EntityManager,
    rows: readonly ItemPrice[]
  ): Promise<PriceKey[]> {
    const byScope = new Map<string, Set<string>>();
    for (const row of rows) {
      const items = byScope.get(row.priceScopeId) ?? new Set<string>();
      items.add(row.itemId);
      byScope.set(row.priceScopeId, items);
    }

    const keys: PriceKey[] = [];
    const seen = new Set<string>();
    for (const [priceScopeId, items] of byScope) {
      const fanned = await this.effective.affectedKeys(
        manager,
        [...items],
        priceScopeId
      );
      for (const key of fanned) {
        const token = `${key.itemId}|${key.priceScopeId}`;
        if (!seen.has(token)) {
          seen.add(token);
          keys.push(key);
        }
      }
    }
    return keys;
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

  /**
   * The scope a copied batch was read at, checked (plan 0118, section 5).
   *
   * It must be a scope of the chain the batch writes to, because a price read
   * at another chain's warehouse is not this chain's price, and it must not be
   * the scope written to, because a copy of a scope onto itself records a
   * provenance that says nothing.
   */
  private async requireCopySource(
    target: PriceScope,
    copiedFromScopeId: string | null
  ): Promise<string | null> {
    if (copiedFromScopeId === null) {
      return null;
    }
    if (copiedFromScopeId === target.id) {
      throw new ValidationException(
        `A batch for the price scope ${target.id} cannot be a copy of that same scope.`
      );
    }
    const source = await this.scopes.findOne({
      where: { id: copiedFromScopeId },
    });
    if (!source || source.supermarketId !== target.supermarketId) {
      throw new ValidationException(
        `The price scope ${copiedFromScopeId} is not a scope of the chain the ` +
          `price scope ${target.id} belongs to, so a batch cannot be copied from it.`
      );
    }
    return copiedFromScopeId;
  }
}

/**
 * A hand typed `observedAt` may reach back 30 days and never forward (plan
 * 0160).
 *
 * Protection runs from `observedAt` (`ADMIN_PROTECTION_DAYS`), so a past date
 * protects a row for less time, never more, which is why the window opens
 * backwards only. A future date would protect a row past its seven days, and
 * that is refused. Absent means now, and passes.
 */
export function requireObservedAtInWindow(
  observedAt: string | null | undefined,
  now: Date
): void {
  if (observedAt === null || observedAt === undefined || observedAt === '') {
    return;
  }
  const at = new Date(observedAt).getTime();
  if (Number.isNaN(at)) {
    // The writer refuses it with the field named. Nothing to add here.
    return;
  }
  if (at > now.getTime()) {
    throw new ValidationException('observedAt cannot be in the future.', {
      details: { observedAt: 'must not be in the future' },
    });
  }
  if (at < now.getTime() - ITEM_PRICE_OBSERVED_AT_MAX_AGE_DAYS * DAY_MS) {
    throw new ValidationException(
      `observedAt can reach back ${ITEM_PRICE_OBSERVED_AT_MAX_AGE_DAYS} days at most.`,
      {
        details: {
          observedAt: `must be within the last ${ITEM_PRICE_OBSERVED_AT_MAX_AGE_DAYS} days`,
        },
      }
    );
  }
}
