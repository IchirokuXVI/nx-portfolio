import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  PriceSourceKind,
  type AdminListSupermarketItemsRequest,
  type GetSupermarketItemRequest,
  type ListSupermarketItemsByItemRequest,
  type ListSupermarketItemsByLocationRequest,
  type ListSupermarketItemsByScopeRequest,
  type SupermarketItemBatchEntry,
  type SupermarketItemIdRequest,
  type SupermarketItemPage,
  type SupermarketItemPriceDisagreement,
  type SupermarketItemView,
  type UpsertSupermarketItemBatchRequest,
  type UpsertSupermarketItemBatchResult,
  type UpsertSupermarketItemRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  ConflictException,
  decodeCursor,
  encodeCursor,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { QueryFailedError, Repository } from 'typeorm';
import {
  Item,
  PriceScope,
  SupermarketItem,
  SupermarketLocation,
} from '../entities';
import { CatalogAuditService } from './catalog-audit.service';
import { toSupermarketItemView } from './catalog.mappers';
import { PlatformAdminService } from './platform-admin.service';

/** Postgres unique-violation error code, raised on the (item, scope) clash. */
const PG_UNIQUE_VIOLATION = '23505';

interface SupermarketItemCursor {
  value: string;
  id: string;
}

/**
 * The price of an item within a price scope (plan 0038, section 5.2). Writes are
 * owner only; reads are open. Unique on (itemId, priceScopeId), so an upsert
 * either creates or updates that one row.
 *
 * **The rule that matters here is section 6.5**, and it exists because the first
 * import writes over rows a human may have typed in:
 *
 * - `OFFICIAL_API` over a row whose `priceSourceKind` is `ADMIN` does **not**
 *   overwrite the price. It reports the fetched value as a disagreement and
 *   leaves the row alone.
 * - `OFFICIAL_API` over a row that is already `OFFICIAL_API`, or over a row with
 *   no price, overwrites and updates `priceObservedAt`.
 * - The owner overrides by editing through `supermarketItem.upsert`, which sets
 *   `ADMIN` and pins it.
 *
 * It is a two case, hard coded version of backlog 0001's stored `PricePolicy`,
 * hard coded because two kinds are reachable. When `ItemPrice` and `PricePolicy`
 * arrive **this rule is deleted, not extended**: it is not written as a
 * foundation for them.
 */
@Injectable()
export class SupermarketItemService {
  constructor(
    @InjectRepository(SupermarketItem)
    private readonly supermarketItems: Repository<SupermarketItem>,
    @InjectRepository(Item) private readonly items: Repository<Item>,
    @InjectRepository(PriceScope)
    private readonly scopes: Repository<PriceScope>,
    @InjectRepository(SupermarketLocation)
    private readonly locations: Repository<SupermarketLocation>,
    private readonly admin: PlatformAdminService,
    private readonly audit: CatalogAuditService
  ) {}

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error as { driverError?: { code?: string } }).driverError?.code ===
        PG_UNIQUE_VIOLATION
    );
  }

  /**
   * Create or update the price for one item in one scope. Owner only.
   *
   * A caller that names no `priceSourceKind` means ADMIN, which is what a person
   * editing through the gateway is, and an ADMIN write always wins: it is the
   * owner's override, and section 6.5 is what keeps an import from undoing it.
   */
  async upsert(req: UpsertSupermarketItemRequest): Promise<SupermarketItemView> {
    const actor = await this.admin.requireAdmin(req);
    await this.requireItemAndScope(req.itemId, req.priceScopeId);

    const existing = await this.supermarketItems.findOne({
      where: { itemId: req.itemId, priceScopeId: req.priceScopeId },
    });
    const sourceKind = req.priceSourceKind ?? PriceSourceKind.ADMIN;

    const row =
      existing ??
      this.supermarketItems.create({
        itemId: req.itemId,
        priceScopeId: req.priceScopeId,
      });
    const before = existing ? { ...existing } : null;

    if (sourceKind !== PriceSourceKind.ADMIN && existing) {
      const decision = decidePriceWrite(existing, sourceKind);
      if (decision === 'skip') {
        throw new ConflictException(
          'A price entered by the owner already exists for that item and scope'
        );
      }
    }

    applyPriceFields(row, req, sourceKind);

    try {
      const saved = await this.audit.write(actor, (tx) =>
        before
          ? tx.update(SupermarketItem, before, row)
          : tx.create(SupermarketItem, row)
      );
      return toSupermarketItemView(saved);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'This item already has a price for that scope'
        );
      }
      throw error;
    }
  }

  /**
   * Write many prices for one scope in one call (plan 0038, section 7), so a
   * harvest run does not make one NATS round trip per item.
   *
   * Section 6.5 is applied **per entry**, and the entries it declined come back
   * in `skipped` with the value that was fetched. A disagreement the owner cannot
   * see is the same as having no rule at all.
   */
  async upsertBatch(
    req: UpsertSupermarketItemBatchRequest
  ): Promise<UpsertSupermarketItemBatchResult> {
    const actor = await this.admin.requireAdmin(req);
    await this.requireScope(req.priceScopeId);

    const itemIds = req.entries.map((entry) => entry.itemId);
    const existingRows = await this.supermarketItems.find({
      where: itemIds.map((itemId) => ({
        itemId,
        priceScopeId: req.priceScopeId,
      })),
    });
    const byItem = new Map(existingRows.map((row) => [row.itemId, row]));
    // Every row as it was, captured before the loop assigns anything. The trail
    // needs the old values and the loop overwrites them in place.
    const wasBefore = new Map(
      existingRows.map((row) => [row.id, { ...row }] as const)
    );

    const skipped: SupermarketItemPriceDisagreement[] = [];
    const toSave: SupermarketItem[] = [];
    const fresh = new Set<SupermarketItem>();
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const entry of req.entries) {
      const existing = byItem.get(entry.itemId);
      if (!existing) {
        const row = this.supermarketItems.create({
          itemId: entry.itemId,
          priceScopeId: req.priceScopeId,
        });
        applyPriceFields(row, entry, req.priceSourceKind);
        toSave.push(row);
        fresh.add(row);
        created += 1;
        continue;
      }

      if (decidePriceWrite(existing, req.priceSourceKind) === 'skip') {
        skipped.push({
          itemId: entry.itemId,
          storedPrice: existing.price === null ? null : Number(existing.price),
          storedSourceKind: existing.priceSourceKind,
          fetchedPrice: entry.price ?? null,
        });
        continue;
      }

      if (isSamePrice(existing, entry)) {
        // Still worth recording that the price was observed again: an unchanged
        // price with a stale observation time reads as an unrefreshed one.
        existing.priceObservedAt = resolveObservedAt(entry);
        toSave.push(existing);
        unchanged += 1;
        continue;
      }

      applyPriceFields(existing, entry, req.priceSourceKind);
      toSave.push(existing);
      updated += 1;
    }

    if (toSave.length > 0) {
      await this.audit.write(actor, async (tx) => {
        // Chunked so one run's batch does not build a single statement large
        // enough to be refused by the driver.
        await tx.manager.save(SupermarketItem, toSave, { chunk: 200 });
        for (const row of toSave) {
          if (fresh.has(row)) {
            await tx.recordCreate(SupermarketItem, row);
            continue;
          }
          // The `unchanged` rows go through here too and come out with nothing
          // recorded: their only moved field is `priceObservedAt`, which the
          // diff does not read. That is section 4's first mitigation, and it is
          // the one that keeps a run from growing the trail by a catalog.
          await tx.recordUpdate(
            SupermarketItem,
            wasBefore.get(row.id) ?? {},
            row
          );
        }
      });
    }

    return { created, updated, unchanged, skipped };
  }

  async delete(req: SupermarketItemIdRequest): Promise<{ id: string }> {
    const actor = await this.admin.requireAdmin(req);
    const row = await this.supermarketItems.findOne({
      where: { id: req.supermarketItemId },
    });
    if (!row) {
      throw new NotFoundException('Supermarket item not found');
    }
    await this.audit.write(actor, (tx) => tx.delete(SupermarketItem, row));
    return { id: req.supermarketItemId };
  }

  /** Read one item's price in a scope (plan 0012, section 3): open. */
  async get(req: GetSupermarketItemRequest): Promise<SupermarketItemView> {
    const row = await this.supermarketItems.findOne({
      where: { itemId: req.itemId, priceScopeId: req.priceScopeId },
    });
    if (!row) {
      throw new NotFoundException('No price for that item in that scope');
    }
    return toSupermarketItemView(row);
  }

  async listByItem(
    req: ListSupermarketItemsByItemRequest
  ): Promise<SupermarketItemPage> {
    return this.page('itemId', req.itemId, req.cursor, req.limit);
  }

  /**
   * Still answered by location, because that is the question a shopper asks:
   * "what does this shop charge". The location resolves to its scope and the
   * scope's rows are paged, so the subject survived the re-keying unchanged.
   */
  async listByLocation(
    req: ListSupermarketItemsByLocationRequest
  ): Promise<SupermarketItemPage> {
    const location = await this.locations.findOne({
      where: { id: req.supermarketLocationId },
    });
    if (!location) {
      throw new NotFoundException('Supermarket location not found');
    }
    return this.page(
      'priceScopeId',
      location.priceScopeId,
      req.cursor,
      req.limit
    );
  }

  async listByScope(
    req: ListSupermarketItemsByScopeRequest
  ): Promise<SupermarketItemPage> {
    return this.page('priceScopeId', req.priceScopeId, req.cursor, req.limit);
  }

  /**
   * The back office's price list (plan 0073, section 4).
   *
   * Gated, unlike the three lists above it, and gated for what it returns rather
   * than for what it changes: with no filter at all it pages the entire price
   * table, which is not a shape any user facing screen has a use for. The gate
   * is also what makes `priceSourceKind` answerable — "which prices did I type
   * in" is a question about the operator's own past writes.
   */
  async adminList(
    req: AdminListSupermarketItemsRequest
  ): Promise<SupermarketItemPage> {
    await this.admin.requireAdmin(req);

    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as
      | SupermarketItemCursor
      | undefined;

    const qb = this.supermarketItems
      .createQueryBuilder('si')
      .orderBy('si.createdAt', 'DESC')
      .addOrderBy('si.id', 'DESC')
      .take(limit + 1);
    if (req.itemId) {
      qb.andWhere('si."itemId" = :itemId', { itemId: req.itemId });
    }
    if (req.priceScopeId) {
      qb.andWhere('si."priceScopeId" = :scopeId', {
        scopeId: req.priceScopeId,
      });
    }
    if (req.priceSourceKind) {
      qb.andWhere('si."priceSourceKind" = :kind', {
        kind: req.priceSourceKind,
      });
    }
    if (req.available !== undefined) {
      qb.andWhere('si."available" = :available', { available: req.available });
    }
    if (cursor) {
      qb.andWhere('(si."createdAt", si.id) < (:cv, :cid)', {
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
        ? encodeCursor({ value: last.createdAt.toISOString(), id: last.id })
        : null;

    return { items: list.map(toSupermarketItemView), nextCursor };
  }

  private async page(
    column: 'itemId' | 'priceScopeId',
    value: string,
    cursorToken: string | undefined,
    limitInput: number | undefined
  ): Promise<SupermarketItemPage> {
    const limit = clampPageSize(limitInput);
    const cursor = decodeCursor(cursorToken) as
      | SupermarketItemCursor
      | undefined;

    const qb = this.supermarketItems
      .createQueryBuilder('si')
      .where(`si."${column}" = :value`, { value })
      .orderBy('si.createdAt', 'DESC')
      .addOrderBy('si.id', 'DESC')
      .take(limit + 1);
    if (cursor) {
      qb.andWhere('(si."createdAt", si.id) < (:cv, :cid)', {
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
        ? encodeCursor({ value: last.createdAt.toISOString(), id: last.id })
        : null;

    return { items: list.map(toSupermarketItemView), nextCursor };
  }

  private async requireItemAndScope(
    itemId: string,
    priceScopeId: string
  ): Promise<void> {
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
  }

  private async requireScope(priceScopeId: string): Promise<void> {
    const scope = await this.scopes.findOne({ where: { id: priceScopeId } });
    if (!scope) {
      throw new NotFoundException('Price scope not found');
    }
  }
}

/**
 * Section 6.5, in one function so both the single and the batch path apply the
 * same rule. An automated source never writes over a price a person typed in; it
 * writes over its own kind, and over a row that has no price yet.
 */
function decidePriceWrite(
  existing: SupermarketItem,
  incoming: PriceSourceKind
): 'write' | 'skip' {
  if (incoming === PriceSourceKind.ADMIN) {
    return 'write';
  }
  if (existing.price === null) {
    return 'write';
  }
  return existing.priceSourceKind === PriceSourceKind.ADMIN ? 'skip' : 'write';
}

type PriceFields = Pick<
  SupermarketItemBatchEntry,
  | 'price'
  | 'currency'
  | 'unitPrice'
  | 'unitPriceLabel'
  | 'available'
  | 'priceObservedAt'
>;

function applyPriceFields(
  row: SupermarketItem,
  fields: PriceFields,
  sourceKind: PriceSourceKind
): void {
  if (fields.price !== undefined) {
    row.price = fields.price;
  }
  if (fields.currency !== undefined) {
    row.currency = fields.currency;
  }
  if (fields.unitPrice !== undefined) {
    row.unitPrice = fields.unitPrice;
  }
  if (fields.unitPriceLabel !== undefined) {
    row.unitPriceLabel = fields.unitPriceLabel;
  }
  if (fields.available !== undefined) {
    row.available = fields.available;
  }
  row.priceSourceKind = sourceKind;
  row.priceObservedAt = resolveObservedAt(fields);
}

/** The source's own observation time when it gave one, otherwise now. */
function resolveObservedAt(fields: PriceFields): Date {
  const stated = fields.priceObservedAt;
  if (stated) {
    const parsed = new Date(stated);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}

function isSamePrice(
  existing: SupermarketItem,
  entry: SupermarketItemBatchEntry
): boolean {
  const same = (a: number | string | null, b: number | null | undefined) => {
    if (b === undefined) {
      return true;
    }
    return (a === null ? null : Number(a)) === b;
  };
  return (
    same(existing.price, entry.price) &&
    same(existing.unitPrice, entry.unitPrice) &&
    (entry.available === undefined || existing.available === entry.available)
  );
}
