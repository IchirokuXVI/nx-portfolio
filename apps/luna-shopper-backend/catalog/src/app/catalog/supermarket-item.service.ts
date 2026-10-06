import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  WITHDRAW_MAX_SCOPES,
  type AdminListSupermarketItemsRequest,
  type AdminSupermarketItemPage,
  type GetSupermarketItemRequest,
  type ListSupermarketItemsByItemRequest,
  type ListSupermarketItemsByLocationRequest,
  type ListSupermarketItemsByScopeRequest,
  type SetSupermarketItemAvailabilityRequest,
  type SetSupermarketItemAvailabilityResult,
  type SupermarketItemPage,
  type SupermarketItemView,
  type WithdrawSupermarketItemsRequest,
  type WithdrawSupermarketItemsResult,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  isUuid,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { In, Repository } from 'typeorm';
import {
  AuditActorKind,
  CatalogAudit,
  Item,
  ItemPrice,
  PriceScope,
  SupermarketItem,
  SupermarketLocation,
  SupermarketLocationItem,
} from '../entities';
import {
  CatalogAuditService,
  type AuditedWrite,
} from './catalog-audit.service';
import { toSupermarketItemView } from './catalog.mappers';
import { lessSpecificScopesOf } from './effective-price.service';
import {
  dryRunnable,
  requireWithdrawablePrices,
  withdrawRunWrittenPrices,
} from './item-price.service';
import { LocationScopeService } from './location-scopes';
import {
  PlatformAdminService,
  type CatalogActor,
} from './platform-admin.service';
import { withdrawHarvestedShopRows } from './supermarket-location-item.service';

interface SupermarketItemCursor {
  value: string;
  id: string;
}

/**
 * The materialized row: the price a shopper sees for one item in one scope
 * (plan 0038, section 5.2, sharpened by plan 0080, section 7). Reads are open.
 *
 * **Nothing here writes a price.** Every price a source gives is a row in
 * `item_prices`, written through `ItemPriceService`, and the row this service
 * reads is recomputed inside that write. Plan 0038 section 6.5's rule, that an
 * automated fetch never overwrites a price a person typed in, is gone with the
 * overwriting: an automated row and an `ADMIN` row now coexist, and section 4
 * of plan 0080 decides between them on every read.
 *
 * The one write left is availability, because it is a fact about stock and
 * not about price: a 404 from a detail call sets it and states no price.
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
    private readonly audit: CatalogAuditService,
    private readonly stacks: LocationScopeService
  ) {}

  /**
   * Whether a scope carries each of these products (plan 0080, section 9).
   *
   * A row that does not exist yet is created with no price: the scope has an
   * opinion about stock and none about price, and the materialized row can
   * hold exactly that. A row already saying so is left alone and counts for
   * nothing, so a run that re-reports the same 404s writes no audit rows.
   *
   * **`onlyIfMissing` creates and never changes** (plan 0182). The harvester's
   * offer with no price says that a chain lists a product, and it says so at
   * the end of every run. The flag of a row that exists is derived from the
   * shops of the scope (`SupermarketLocationItemService`), so a plain write of
   * `true` would flip a derived `false` back on every run. With the option a
   * row that exists is left alone and counts for nothing. That path is
   * {@link createMissing}, which is one statement and not a read then a write.
   */
  async setAvailability(
    req: SetSupermarketItemAvailabilityRequest
  ): Promise<SetSupermarketItemAvailabilityResult> {
    const actor = await this.admin.requireAdmin(req);
    await this.requireScope(req.priceScopeId);
    if (req.entries.length === 0) {
      return { updated: 0 };
    }

    const wanted = new Map(req.entries.map((e) => [e.itemId, e.available]));
    if (req.onlyIfMissing === true) {
      return this.createMissing(actor, req.priceScopeId, wanted);
    }
    const itemIds = [...wanted.keys()];
    const existing = await this.supermarketItems.find({
      where: itemIds.map((itemId) => ({
        itemId,
        priceScopeId: req.priceScopeId,
      })),
    });
    const byItem = new Map(existing.map((row) => [row.itemId, row]));

    const fresh: SupermarketItem[] = [];
    const changed: { before: SupermarketItem; row: SupermarketItem }[] = [];
    for (const [itemId, available] of wanted) {
      const held = byItem.get(itemId);
      if (!held) {
        fresh.push(
          this.supermarketItems.create({
            itemId,
            priceScopeId: req.priceScopeId,
            available,
            priceSourceKind: null,
          })
        );
        continue;
      }
      if (held.available === available) {
        continue;
      }
      const before = { ...held };
      held.available = available;
      changed.push({ before, row: held });
    }
    if (fresh.length === 0 && changed.length === 0) {
      return { updated: 0 };
    }

    await this.audit.write(actor, async (tx) => {
      const rows = [...fresh, ...changed.map((c) => c.row)];
      await tx.manager.save(SupermarketItem, rows, { chunk: 200 });
      for (const row of fresh) {
        await tx.recordCreate(SupermarketItem, row);
      }
      for (const { before, row } of changed) {
        await tx.recordUpdate(SupermarketItem, before, row);
      }
    });
    return { updated: fresh.length + changed.length };
  }

  /**
   * Create the row of every product the scope has none for, and change no row
   * that exists (plan 0182, `onlyIfMissing`).
   *
   * **One `INSERT ... ON CONFLICT DO NOTHING`, and not a read then a write.**
   * A bind and the shop derivation insert the same row at the same moment the
   * end of a run offers it. A read that found no row followed by an insert
   * then breaks `uq_supermarket_item_scope`, and one such row failed a batch
   * of five hundred. Here the row that got there first simply wins.
   *
   * **A product catalog does not hold is left out, and fails nothing.** The
   * insert selects from `items`, so a product deleted since the harvester
   * bound its row creates no row and breaks no foreign key for the others. An
   * id that is not a uuid is dropped before the statement for the same
   * reason: the cast would fail the whole batch.
   *
   * Answers the rows it created, each recorded in the trail as a create.
   */
  private async createMissing(
    actor: CatalogActor,
    priceScopeId: string,
    wanted: ReadonlyMap<string, boolean>
  ): Promise<SetSupermarketItemAvailabilityResult> {
    const itemIds = [...wanted.keys()].filter(isUuid);
    if (itemIds.length === 0) {
      return { updated: 0 };
    }
    return this.audit.write(actor, async (tx) => {
      const inserted: { id: string }[] = await tx.manager.query(
        `
        INSERT INTO "supermarket_items" ("itemId", "priceScopeId", "available")
        SELECT i."id", $1::uuid, w."available"
          FROM unnest($2::uuid[], $3::boolean[]) AS w("itemId", "available")
          JOIN "items" i ON i."id" = w."itemId"
        ON CONFLICT ("itemId", "priceScopeId") DO NOTHING
        RETURNING "id"
        `,
        [priceScopeId, itemIds, itemIds.map((itemId) => wanted.get(itemId))]
      );
      if (inserted.length === 0) {
        return { updated: 0 };
      }
      const rows = await tx.manager.find(SupermarketItem, {
        where: { id: In(inserted.map((row) => row.id)) },
      });
      for (const row of rows) {
        await tx.recordCreate(SupermarketItem, row);
      }
      return { updated: rows.length };
    });
  }

  /**
   * Take a product's offers out of the scopes of one chain, with the shop rows
   * a harvest run wrote for it there (plan 0191).
   *
   * The harvester sends it after it moved or dropped the last row of a chain
   * that named the product. `recomputeEffectivePrices` leaves a held row in
   * place with no price when its last price row goes, and creates none for a
   * product nothing prices. So a row that is left with no price and no source
   * says something nothing stands behind, and no later run takes it back: a
   * run states availability only for the products its bound rows name.
   *
   * **The caller answers one condition, and this answers the rest.** That no
   * bound row of the chain names the product is the harvester's to know.
   * Here, per offer, in this order:
   *
   * 1. The shop rows a run wrote for the product at the shops of the chain go
   *    first ({@link withdrawHarvestedShopRows}). A row a person wrote stays.
   * 2. An offer is kept as `PRICED` when a price row of the product exists at
   *    its scope or at a scope it falls through to. An `ADMIN` price is such a
   *    row, and so is a price that is not valid yet.
   * 3. It is kept as `SHOP_ROW` when a shop that holds the scope still says
   *    whether it stocks the product. After step 1 only a person says so.
   * 4. It is kept as `PERSON` when the trail records an operator writing the
   *    row. `supermarket_items` carries no provenance of its own, and the back
   *    office can set this flag, so the trail is what tells a typed "not sold
   *    here" from a leftover.
   * 5. Otherwise it is removed, whatever `available` says.
   *
   * `dryRun` runs the same statements in a transaction that is rolled back.
   * With `assumePricesWithdrawn` it removes the run written prices of those
   * kinds in that transaction first, which is what a dry run of the two calls
   * in a row has to answer.
   */
  async withdraw(
    req: WithdrawSupermarketItemsRequest
  ): Promise<WithdrawSupermarketItemsResult> {
    const actor = await this.admin.requireAdmin(req);
    const scopeIds = [...new Set(req.priceScopeIds)];
    if (scopeIds.length > WITHDRAW_MAX_SCOPES) {
      throw new ValidationException(
        `A withdraw names at most ${WITHDRAW_MAX_SCOPES} price scopes, and ` +
          `this one names ${scopeIds.length}.`,
        { details: { priceScopeIds: `at most ${WITHDRAW_MAX_SCOPES}` } }
      );
    }
    const dryRun = req.dryRun === true;
    const assumed = dryRun ? (req.assumePricesWithdrawn ?? []) : [];
    if (assumed.length > 0) {
      requireWithdrawablePrices({
        itemId: req.itemId,
        priceScopeIds: scopeIds,
        sourceKinds: assumed,
      });
    }
    const scopes =
      scopeIds.length === 0 || !scopeIds.every(isUuid)
        ? []
        : await this.scopes.find({ where: { id: In(scopeIds) } });
    const foreign = scopeIds.filter(
      (id) =>
        !scopes.some(
          (scope) =>
            scope.id === id && scope.supermarketId === req.supermarketId
        )
    );
    if (foreign.length > 0) {
      // Refused whole. An offer is removed on the caller's word that no row
      // of *this* chain names the product, and that word covers no other.
      throw new ValidationException(
        `These price scopes are not scopes of the chain ${req.supermarketId}: ` +
          `${foreign.join(', ')}.`,
        { details: { priceScopeIds: 'must be scopes of supermarketId' } }
      );
    }

    return dryRunnable(dryRun, (rollback) =>
      this.audit.write(actor, async (tx) => {
        if (assumed.length > 0) {
          await withdrawRunWrittenPrices(tx, {
            itemId: req.itemId,
            priceScopeIds: scopeIds,
            sourceKinds: assumed,
          });
        }
        return rollback(await this.withdrawOffers(tx, req, scopes));
      })
    );
  }

  /** Steps 1 to 5 of {@link withdraw}, inside its transaction. */
  private async withdrawOffers(
    tx: AuditedWrite,
    req: WithdrawSupermarketItemsRequest,
    scopes: readonly PriceScope[]
  ): Promise<WithdrawSupermarketItemsResult> {
    const manager = tx.manager;
    const shops = await manager.find(SupermarketLocation, {
      where: { supermarketId: req.supermarketId },
      select: { id: true },
    });
    const shopRows = await withdrawHarvestedShopRows(
      tx,
      req.itemId,
      shops.map((shop) => shop.id)
    );
    const result: WithdrawSupermarketItemsResult = {
      offersRemoved: [],
      offersKept: [],
      shopRowsRemoved: shopRows.removed,
      shopRowsCleared: shopRows.cleared,
      conflicts: shopRows.conflicts,
    };
    if (scopes.length === 0) {
      return result;
    }

    const offers = await manager.find(SupermarketItem, {
      where: { itemId: req.itemId, priceScopeId: In(scopes.map((s) => s.id)) },
      order: { priceScopeId: 'ASC' },
    });
    const scopeById = new Map(scopes.map((scope) => [scope.id, scope]));
    for (const offer of offers) {
      const scope = scopeById.get(offer.priceScopeId) as PriceScope;
      const stack = [
        scope.id,
        ...(await lessSpecificScopesOf(manager, scope)).map((row) => row.id),
      ];
      const priced = await manager.exists(ItemPrice, {
        where: { itemId: req.itemId, priceScopeId: In(stack) },
      });
      if (priced) {
        result.offersKept.push({ priceScopeId: scope.id, reason: 'PRICED' });
        continue;
      }
      const holders = await this.stacks.locationsHolding(manager, scope.id);
      const backed =
        holders.length > 0 &&
        (await manager
          .createQueryBuilder(SupermarketLocationItem, 'li')
          .where('li."itemId" = :itemId', { itemId: req.itemId })
          .andWhere('li."supermarketLocationId" IN (:...holders)', { holders })
          .andWhere('li."available" IS NOT NULL')
          .getExists());
      if (backed) {
        result.offersKept.push({ priceScopeId: scope.id, reason: 'SHOP_ROW' });
        continue;
      }
      const typed = await manager.exists(CatalogAudit, {
        where: {
          entity: manager.getRepository(SupermarketItem).metadata.tableName,
          entityId: offer.id,
          actorKind: AuditActorKind.ADMIN,
        },
      });
      if (typed) {
        result.offersKept.push({ priceScopeId: scope.id, reason: 'PERSON' });
        continue;
      }
      await tx.delete(SupermarketItem, offer);
      result.offersRemoved.push(scope.id);
    }
    return result;
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
    // The one scope the shop is quoted from (plan 0105, section 4). Its rows
    // already answer for the whole stack, so the subject of this read, "what
    // does this shop charge", survived the stack exactly as it survived the
    // re-keying that made it a scope.
    const priceScopeId = await this.stacks.quotedScopeOf(
      this.locations.manager,
      location.id
    );
    if (priceScopeId === null) {
      return { items: [], nextCursor: null };
    }
    return this.page('priceScopeId', priceScopeId, req.cursor, req.limit);
  }

  async listByScope(
    req: ListSupermarketItemsByScopeRequest
  ): Promise<SupermarketItemPage> {
    return this.page('priceScopeId', req.priceScopeId, req.cursor, req.limit);
  }

  /**
   * The back office's effective price list (plan 0073, section 4; plan 0080,
   * section 10).
   *
   * Gated, unlike the three lists above it, and gated for what it returns rather
   * than for what it changes: with no filter at all it pages the entire price
   * table, which is not a shape any user facing screen has a use for. The gate
   * is also what makes `sourceKind` and `stale` answerable: "what have I
   * overridden" and "what is shown on sufferance" are questions about the
   * operator's own catalog.
   */
  async adminList(
    req: AdminListSupermarketItemsRequest
  ): Promise<AdminSupermarketItemPage> {
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
    if (req.itemIds?.length) {
      // Admin plan 0043: the price of every product on one page of the product
      // list. Empty is the same as absent, as a filter left out is. Beside a
      // scope it is planned on the unique index of the pair.
      qb.andWhere('si."itemId" IN (:...itemIds)', { itemIds: req.itemIds });
    }
    if (req.priceScopeId) {
      qb.andWhere('si."priceScopeId" = :scopeId', {
        scopeId: req.priceScopeId,
      });
    }
    if (req.sourceKind) {
      qb.andWhere('si."priceSourceKind" = :kind', { kind: req.sourceKind });
    }
    if (req.stale !== undefined) {
      qb.andWhere('si."stale" = :stale', { stale: req.stale });
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

    // The product's name, joined onto the admin read and only onto it (admin
    // plan 0023, section 3): a page of prices is a page of distinct products,
    // so resolving the name client side would cost a request per row. One
    // batched read per page here instead, by distinct id. A price whose item
    // is gone keeps a null name and the row still lists.
    const itemIds = [...new Set(list.map((row) => row.itemId))];
    const named =
      itemIds.length === 0
        ? []
        : await this.items.find({ where: { id: In(itemIds) } });
    const names = new Map(named.map((item) => [item.id, item.name]));

    return {
      items: list.map((row) => ({
        ...toSupermarketItemView(row),
        itemName: names.get(row.itemId) ?? null,
      })),
      nextCursor,
    };
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

  private async requireScope(priceScopeId: string): Promise<void> {
    const scope = await this.scopes.findOne({ where: { id: priceScopeId } });
    if (!scope) {
      throw new NotFoundException('Price scope not found');
    }
  }

  /** Kept for the item existence check the availability write does not need; the item repository stays injected for it. */
  protected async requireItem(itemId: string): Promise<void> {
    const item = await this.items.findOne({ where: { id: itemId } });
    if (!item) {
      throw new NotFoundException('Item not found');
    }
  }
}
