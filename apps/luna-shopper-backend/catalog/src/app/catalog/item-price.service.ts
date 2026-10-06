import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ITEM_PRICE_OBSERVED_AT_MAX_AGE_DAYS,
  ItemPriceWrittenBy,
  PriceSourceKind,
  WITHDRAW_MAX_SCOPES,
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
  type StatedItemPrice,
  type WithdrawItemPricesRequest,
  type WithdrawItemPricesResult,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  isUuid,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { In, IsNull, Not, Repository, type EntityManager } from 'typeorm';
import { Item, ItemPrice, PricePolicy, PriceScope } from '../entities';
import {
  CatalogAuditService,
  type AuditedWrite,
} from './catalog-audit.service';
import { toItemPriceView } from './catalog.mappers';
import { AUTOMATED_KINDS, resolveEffectivePrice } from './effective-price';
import {
  affectedPriceKeys,
  currentPriceRows,
  EffectivePriceService,
  lessSpecificScopesOf,
  recomputeEffectivePrices,
  type PriceKey,
} from './effective-price.service';
import { statesTheSame, writeItemPrices } from './item-price-writer';
import {
  PlatformAdminService,
  requireServiceActor,
} from './platform-admin.service';

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
      // wrote USER_RECEIPT through it with no run until plan 0180 removed it.
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
   * row the reference seed wrote before plan 0180 removed it. Rows another
   * run wrote are never touched.
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
   * Make the run written price rows of one product agree with the rows still
   * bound to it, at named scopes and kinds, and recompute (plan 0191).
   *
   * The harvester sends it when a row left the product: a person moved the
   * row to another product, or rejected it. `item_prices` names no queue row,
   * so the harvester says what the rows still bound account for and what they
   * state, and {@link withdrawRunWrittenPrices} is the rule for the rest.
   *
   * **Only a service may send it.** What it removes follows from which rows
   * are bound, and only the harvester knows that.
   *
   * Audited like {@link deleteByRun}: one trail row per price row removed or
   * inserted, by the actor the gate let through.
   *
   * `dryRun` runs the same statements in a transaction that is rolled back,
   * so its answer is the answer of a real call and not a second rule.
   */
  async withdraw(
    req: WithdrawItemPricesRequest
  ): Promise<WithdrawItemPricesResult> {
    const actor = await this.admin.requireAdmin(req);
    requireServiceActor(actor, 'itemPrice.withdraw');
    requireWithdrawablePrices(req);
    return dryRunnable(req.dryRun === true, (rollback) =>
      this.audit.write(actor, async (tx) =>
        rollback(await withdrawRunWrittenPrices(tx, req))
      )
    );
  }

  /**
   * Every (item, scope) key these rows belonged to, deduplicated, including the
   * fan out a NATIONAL row causes (plan 0080, section 6).
   */
  private affectedBy(
    manager: EntityManager,
    rows: readonly ItemPrice[]
  ): Promise<PriceKey[]> {
    return affectedByRows(manager, rows);
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
 * Every (item, scope) key these rows belonged to, deduplicated, including the
 * fan out a NATIONAL row causes (plan 0080, section 6).
 *
 * Grouped by scope before asking, because `affectedPriceKeys` reads the scope
 * once per call and a run's rows are nearly always all at one scope.
 */
async function affectedByRows(
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
    const fanned = await affectedPriceKeys(manager, [...items], priceScopeId);
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

/** What a withdraw names, which is all {@link withdrawRunWrittenPrices} reads. */
export type RunWrittenPrices = Pick<
  WithdrawItemPricesRequest,
  'itemId' | 'priceScopeIds' | 'sourceKinds' | 'held' | 'stated' | 'left'
>;

/**
 * Refuse a withdraw that names a kind a run cannot write, or too many scopes.
 *
 * `ADMIN` is refused and not skipped: a caller that names it has asked for a
 * person's price to be removed, and saying no is better than doing less than
 * was asked without saying so. A statement of such a kind is refused for the
 * same reason, and so is one that names no run.
 */
export function requireWithdrawablePrices(req: RunWrittenPrices): void {
  const refused = [
    ...req.sourceKinds,
    ...(req.stated ?? []).map((each) => each.sourceKind),
  ].filter((kind) => !AUTOMATED_KINDS.includes(kind));
  if (refused.length > 0) {
    throw new ValidationException(
      `Only the prices a harvest run wrote can be withdrawn, and a run writes ` +
        `official kinds only, not ${[...new Set(refused)].join(', ')}.`,
      { details: { sourceKinds: 'must be automated kinds' } }
    );
  }
  if ((req.stated ?? []).some((each) => !isUuid(each.sourceRunId))) {
    throw new ValidationException(
      'A stated price names the run that observed it.',
      { details: { stated: 'sourceRunId must be a uuid' } }
    );
  }
  if (req.priceScopeIds.length > WITHDRAW_MAX_SCOPES) {
    throw new ValidationException(
      `A withdraw names at most ${WITHDRAW_MAX_SCOPES} price scopes, and ` +
        `this one names ${req.priceScopeIds.length}.`,
      { details: { priceScopeIds: `at most ${WITHDRAW_MAX_SCOPES}` } }
    );
  }
}

const pairKey = (priceScopeId: string, sourceKind: string): string =>
  `${priceScopeId}|${sourceKind}`;

/**
 * Make the run written price rows of one product agree with the rows still
 * bound to it, record each change in the trail, and recompute (plan 0191).
 *
 * A plain function over the caller's audited transaction, for the reason the
 * recompute is one: the offers withdraw runs it inside its own transaction to
 * answer a dry run of the two calls in a row.
 *
 * **The rule for every doubt is that the row stays.** These rows were curated
 * by hand, and a leftover price is a smaller error than a price nobody can
 * bring back.
 *
 * ## Which rows can go at all
 *
 * A row is a candidate when it is the product's, at a named scope, of a named
 * kind, and **names a run** (`sourceRunId` is not null). That, with the kind,
 * is what tells a run's row from a person's. An `ADMIN` row is never named
 * here, and a row of an automated kind that a person typed through the back
 * office carries no run. A run's row from before plan 0086, which has no run
 * either, is kept too: nothing tells it from a typed one.
 *
 * ## What a source row can and cannot account for
 *
 * A source row holds **one** price per scope, and that price names **one**
 * run. What the same row wrote before is not on it:
 *
 * - A row a website and a leaflet both print is one row (plan 0190). It wrote
 *   under both kinds, and holds the price of whichever run came last.
 * - A file import stamps the instant of its document. An import of last
 *   week's file leaves the row holding an older observation than the one
 *   catalog shows, which a newer run of the same row wrote.
 *
 * So a bound row's price does not say "this is all I wrote here", and the
 * absence of a statement for a row of catalog does not make it a leftover.
 * What does is knowing **which run the row that left wrote with**.
 *
 * ## The three cases, per scope
 *
 * 1. **No bound row holds a price at the scope.** Every candidate goes. That
 *    is the figurine: nothing of the chain stands behind anything there.
 * 2. **A bound row holds a price at the scope** (`held`). A candidate goes
 *    only when its run is one the leaving row names there (`left`) and no
 *    bound row names it. On the route a person calls, no row is leaving, and
 *    nothing goes here.
 * 3. **A statement names the scope and the kind of the candidate.** It goes
 *    when it was observed at the statement's instant or later, its values
 *    differ from the statement's, and its run is the statement's own or one
 *    the leaving row names and no bound row does. The statement's own run is
 *    there for two rows that one walk priced: it stamps every product with
 *    one instant, so the row that left and the row that stayed carry the same
 *    `observedAt`, and `currentPriceRows` breaks the tie by id.
 *
 * A newer row of a run nobody names is therefore never removed. When such a
 * row says something else than the statement, the statement is not the
 * current price, and `notCurrent` says so.
 *
 * ## The statement is written in this transaction
 *
 * After the removal, the statement goes through `writeItemPrices`, the insert
 * on change of every other write. A row that already says it, at its instant
 * or later, means nothing is written at all. So a second call removes
 * nothing, inserts nothing and records nothing, and there is no moment at
 * which the product shows an older price because a second message failed.
 *
 * ## A statement that is not applied
 *
 * Its scope stays a held scope, and nothing is removed for it:
 *
 * - Catalog holds a row of its run at its scope under another kind
 *   (`keptAsWritten`).
 * - The scope it was copied from is gone, or is not another scope of the
 *   chain (`notWritable`). It is reported and not thrown: a product must
 *   stay possible to settle whatever one of its prices points at.
 * - A held price at its scope has no kind, or two statements name the pair.
 *
 * ## What happens to the materialized row
 *
 * The recompute runs for every key a removed or written row reached. It
 * leaves a held `supermarket_items` row in place with no price. This function
 * removes none: whether such a row is an offer or a leftover is
 * `supermarketItem.withdraw`'s to say.
 */
export async function withdrawRunWrittenPrices(
  tx: AuditedWrite,
  req: RunWrittenPrices,
  now: Date = new Date()
): Promise<WithdrawItemPricesResult> {
  const result: WithdrawItemPricesResult = {
    deleted: 0,
    removed: [],
    inserted: 0,
    confirmed: 0,
    keptAsWritten: [],
    notWritable: [],
    notCurrent: [],
    recomputed: 0,
  };
  const scopeIds = [...new Set(req.priceScopeIds.filter(isUuid))];
  const kinds = [...new Set(req.sourceKinds)];
  if (!isUuid(req.itemId) || scopeIds.length === 0 || kinds.length === 0) {
    return result;
  }
  const named = new Set(scopeIds);
  const held = (req.held ?? []).filter((each) => named.has(each.priceScopeId));

  const runsBy = (): {
    add: (priceScopeId: string, runId: string | null) => void;
    has: (priceScopeId: string, runId: string | null) => boolean;
  } => {
    const runs = new Map<string, Set<string>>();
    return {
      add: (priceScopeId, runId) => {
        if (runId) {
          runs.set(
            priceScopeId,
            (runs.get(priceScopeId) ?? new Set<string>()).add(runId)
          );
        }
      },
      has: (priceScopeId, runId) =>
        runId !== null && (runs.get(priceScopeId)?.has(runId) ?? false),
    };
  };
  /** The runs a bound row names, per scope. */
  const boundRuns = runsBy();
  /** The runs the leaving row names, per scope. */
  const leftRuns = runsBy();
  /** Scopes at which a bound row holds a price row. */
  const heldScopes = new Set<string>();
  /** Scopes at which a held price has no kind: nothing is stated there. */
  const kindlessScopes = new Set<string>();
  for (const each of held) {
    heldScopes.add(each.priceScopeId);
    if (each.sourceKind === null) {
      kindlessScopes.add(each.priceScopeId);
    }
    boundRuns.add(each.priceScopeId, each.sourceRunId);
  }
  for (const each of req.left ?? []) {
    leftRuns.add(each.priceScopeId, each.sourceRunId);
  }

  // One statement per scope and kind. Two is a caller that does not know
  // which price is stated, so neither is applied.
  const statements = new Map<string, StatedItemPrice>();
  const statedTwice = new Set<string>();
  for (const each of req.stated ?? []) {
    if (!named.has(each.priceScopeId) || !kinds.includes(each.sourceKind)) {
      continue;
    }
    // A statement is a price a bound row holds, whether or not it is applied.
    heldScopes.add(each.priceScopeId);
    boundRuns.add(each.priceScopeId, each.sourceRunId);
    const key = pairKey(each.priceScopeId, each.sourceKind);
    if (statements.has(key) || statedTwice.has(key)) {
      statements.delete(key);
      statedTwice.add(key);
      continue;
    }
    statements.set(key, each);
  }

  // The scopes the statements write to and say they were copied from. Read
  // before anything is removed, so a statement that cannot be written removes
  // nothing either.
  const scopeById = new Map<string, PriceScope>();
  if (statements.size > 0) {
    const scopes = await tx.manager.find(PriceScope, {
      where: {
        id: In([
          ...new Set(
            [...statements.values()].flatMap((each) => [
              each.priceScopeId,
              ...(each.copiedFromScopeId ? [each.copiedFromScopeId] : []),
            ])
          ),
        ]),
      },
    });
    for (const scope of scopes) {
      scopeById.set(scope.id, scope);
    }
  }
  for (const [key, statement] of [...statements]) {
    const scope = scopeById.get(statement.priceScopeId);
    const copiedFromScopeId = statement.copiedFromScopeId ?? null;
    const source = copiedFromScopeId
      ? scopeById.get(copiedFromScopeId)
      : undefined;
    if (!scope || kindlessScopes.has(statement.priceScopeId)) {
      // Deleted since the caller listed it, or a scope where nothing is
      // stated. Nothing to write.
      statements.delete(key);
    } else if (
      copiedFromScopeId &&
      (!source ||
        source.id === scope.id ||
        source.supermarketId !== scope.supermarketId)
    ) {
      statements.delete(key);
      result.notWritable.push({
        priceScopeId: statement.priceScopeId,
        sourceKind: statement.sourceKind,
        copiedFromScopeId,
      });
    }
  }

  const rows = await tx.manager.find(ItemPrice, {
    where: {
      itemId: req.itemId,
      priceScopeId: In(scopeIds),
      sourceKind: In(kinds),
      sourceRunId: Not(IsNull()),
    },
    order: { observedAt: 'ASC', id: 'ASC' },
  });
  // A statement whose run already wrote at its scope under another kind.
  for (const [key, statement] of [...statements]) {
    const other = rows.find(
      (row) =>
        row.priceScopeId === statement.priceScopeId &&
        row.sourceKind !== statement.sourceKind &&
        (row.sourceRunId === statement.sourceRunId ||
          row.lastObservedRunId === statement.sourceRunId)
    );
    if (other) {
      statements.delete(key);
      result.keptAsWritten.push({
        priceScopeId: statement.priceScopeId,
        sourceKind: statement.sourceKind,
        heldAs: other.sourceKind,
      });
    }
  }

  /** A row of a run the leaving row names and no bound row does. */
  const leftBehind = (row: ItemPrice): boolean =>
    leftRuns.has(row.priceScopeId, row.sourceRunId) &&
    !boundRuns.has(row.priceScopeId, row.sourceRunId) &&
    !boundRuns.has(row.priceScopeId, row.lastObservedRunId);

  const doomed: ItemPrice[] = [];
  const kept: ItemPrice[] = [];
  for (const row of rows) {
    const statement = statements.get(pairKey(row.priceScopeId, row.sourceKind));
    let goes: boolean;
    if (statement) {
      goes =
        row.observedAt.getTime() >=
          new Date(statement.price.observedAt).getTime() &&
        !statesTheSame(
          row,
          statement.price,
          statement.copiedFromScopeId ?? null,
          now
        ) &&
        (row.sourceRunId === statement.sourceRunId || leftBehind(row));
    } else if (heldScopes.has(row.priceScopeId)) {
      goes = leftBehind(row);
    } else {
      goes = true;
    }
    (goes ? doomed : kept).push(row);
  }

  const touched: ItemPrice[] = [...doomed];
  if (doomed.length > 0) {
    // One statement for the rows, then one trail row each, as `deleteByRun`.
    await tx.manager.delete(ItemPrice, { id: In(doomed.map((row) => row.id)) });
    const removed = new Map<
      string,
      WithdrawItemPricesResult['removed'][number]
    >();
    for (const row of doomed) {
      await tx.recordDelete(ItemPrice, row);
      const key = pairKey(row.priceScopeId, row.sourceKind);
      const counted = removed.get(key) ?? {
        priceScopeId: row.priceScopeId,
        sourceKind: row.sourceKind,
        deleted: 0,
      };
      counted.deleted += 1;
      removed.set(key, counted);
    }
    result.deleted = doomed.length;
    result.removed = [...removed.values()];
  }

  for (const statement of statements.values()) {
    const scope = scopeById.get(statement.priceScopeId) as PriceScope;
    const copiedFromScopeId = statement.copiedFromScopeId ?? null;
    const instant = new Date(statement.price.observedAt).getTime();
    const alreadyStated = kept.some(
      (row) =>
        row.priceScopeId === scope.id &&
        row.sourceKind === statement.sourceKind &&
        row.observedAt.getTime() >= instant &&
        statesTheSame(row, statement.price, copiedFromScopeId, now)
    );
    if (alreadyStated) {
      continue;
    }
    const outcome = await writeItemPrices(tx.manager, {
      scope,
      sourceKind: statement.sourceKind,
      sourceRunId: statement.sourceRunId,
      copiedFromScopeId,
      entries: [{ ...statement.price, itemId: req.itemId }],
      now,
    });
    for (const inserted of outcome.inserted) {
      await tx.recordCreate(ItemPrice, inserted);
    }
    result.inserted += outcome.inserted.length;
    result.confirmed += outcome.confirmed.length;
    touched.push(...outcome.inserted, ...outcome.confirmed);
  }

  if (statements.size > 0) {
    // Whether each statement is what its scope and kind show now, by the
    // rule every read uses for "the current row".
    const current = await currentPriceRows(
      tx.manager,
      [req.itemId],
      [...new Set([...statements.values()].map((each) => each.priceScopeId))]
    );
    for (const statement of statements.values()) {
      const shown = current.find(
        (row) =>
          row.priceScopeId === statement.priceScopeId &&
          row.sourceKind === statement.sourceKind
      );
      if (
        !shown ||
        !statesTheSame(
          shown,
          statement.price,
          statement.copiedFromScopeId ?? null,
          now
        )
      ) {
        result.notCurrent.push({
          priceScopeId: statement.priceScopeId,
          sourceKind: statement.sourceKind,
        });
      }
    }
  }

  if (touched.length > 0) {
    const keys = await affectedByRows(tx.manager, touched);
    await recomputeEffectivePrices(tx.manager, keys, now);
    result.recomputed = keys.length;
  }
  return result;
}

/** Thrown inside a transaction to undo it and carry its answer out. */
class DryRunRollback<T> extends Error {
  constructor(readonly answer: T) {
    super('dry run');
  }
}

/**
 * Run `work` for real, or run it and roll it back (plan 0191).
 *
 * `work` is handed `rollback`, and returns what `rollback` answers. For a real
 * call that is the value itself. For a dry run it throws out of the
 * transaction `work` opened, which undoes every write, and the value comes
 * back here. So a dry run executes the statements of a real call, and what it
 * answers cannot drift from what a real call does.
 */
export async function dryRunnable<T>(
  dryRun: boolean,
  work: (rollback: (answer: T) => T) => Promise<T>
): Promise<T> {
  if (!dryRun) {
    return work((answer) => answer);
  }
  try {
    return await work((answer) => {
      throw new DryRunRollback(answer);
    });
  } catch (error) {
    if (error instanceof DryRunRollback) {
      return error.answer as T;
    }
    throw error;
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
