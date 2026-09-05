import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  PriceSourceKind,
  type GetSupermarketLocationItemRequest,
  type ListSupermarketLocationItemsRequest,
  type SetSupermarketLocationItemAvailabilityRequest,
  type SetSupermarketLocationItemAvailabilityResult,
  type SupermarketLocationItemAvailabilityConflict,
  type SupermarketLocationItemPage,
  type SupermarketLocationItemView,
  type UpsertSupermarketLocationItemRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { In, Repository, type EntityManager } from 'typeorm';
import {
  Item,
  SupermarketItem,
  SupermarketLocation,
  SupermarketLocationItem,
} from '../entities';
import { AuditedWrite, CatalogAuditService } from './catalog-audit.service';
import { toSupermarketLocationItemView } from './catalog.mappers';
import { PlatformAdminService } from './platform-admin.service';

interface LocationItemCursor {
  value: string;
  id: string;
}

/**
 * How many item ids one `IN (...)` carries. A DEZA shop answers for the whole
 * assortment, so the batch that reaches here is thousands of entries and the
 * queries behind it have to be bounded rather than as long as the caller.
 */
const CHUNK = 500;

/**
 * The per store half of a product's presence in a chain (plan 0038, section 5.2):
 * where it sits in *this* shop, and whether this shop carries it.
 *
 * It exists as its own surface because the price moving to the scope would
 * otherwise have made `positionInStore` unreachable: it left `SupermarketItem`
 * and nothing else could set it. A warehouse cannot answer which aisle a product
 * is in, so the question needed somewhere to live rather than nowhere.
 *
 * **Since plan 0084 an automated source writes `available` here too**, and the
 * row records which writer did. `upsert` is the operator's route for the rest of
 * the row and no longer touches that column at all: a value written with no
 * provenance is a person's claim that no automated writer could tell from an
 * unwritten one, so a person goes through {@link setAvailability} with
 * `sourceKind: ADMIN` like everything else.
 */
@Injectable()
export class SupermarketLocationItemService {
  constructor(
    @InjectRepository(SupermarketLocationItem)
    private readonly rows: Repository<SupermarketLocationItem>,
    @InjectRepository(Item) private readonly items: Repository<Item>,
    @InjectRepository(SupermarketLocation)
    private readonly locations: Repository<SupermarketLocation>,
    private readonly admin: PlatformAdminService,
    private readonly audit: CatalogAuditService
  ) {}

  /**
   * Where the product sits in this shop. **Not whether it is stocked**: that
   * moved to {@link setAvailability} with plan 0084, section 4.
   */
  async upsert(
    req: UpsertSupermarketLocationItemRequest
  ): Promise<SupermarketLocationItemView> {
    const actor = await this.admin.requireAdmin(req);
    await this.requireItemAndLocation(req.itemId, req.supermarketLocationId);

    const existing = await this.rows.findOne({
      where: {
        itemId: req.itemId,
        supermarketLocationId: req.supermarketLocationId,
      },
    });
    const row =
      existing ??
      this.rows.create({
        itemId: req.itemId,
        supermarketLocationId: req.supermarketLocationId,
      });
    const before = existing ? { ...existing } : null;

    if (req.positionInStore !== undefined) {
      row.positionInStore = req.positionInStore;
    }

    const saved = await this.audit.write(actor, (tx) =>
      before
        ? tx.update(SupermarketLocationItem, before, row)
        : tx.create(SupermarketLocationItem, row)
    );
    return toSupermarketLocationItemView(saved);
  }

  /**
   * Whether this shop carries each of these products (plan 0084, section 4).
   *
   * **A batch, because the caller has one shop and thousands of products.** A
   * crawl of DEZA is ten calls, one per shop. Per item calls would be tens of
   * thousands of NATS round trips for one run, which is the mistake
   * `ItemMatchIndex` exists to avoid on the read side.
   *
   * **Absence is a claim**: a shop missing from a product's list of shops does
   * not stock it, so `entries` carries `available: false` rows and a caller is
   * expected to send a value for every product it resolved.
   *
   * ## The ladder (section 3)
   *
   * - kind is `ADMIN`: an automated writer **skips the row** and reports the
   *   disagreement. It does not overwrite and it does not clear.
   * - kind is null **and** `available` is not null: treated as `ADMIN`, because
   *   only a person ever wrote it. Nothing else did, before this plan.
   * - kind is null and `available` is null: free.
   * - any automated kind: the newer observation wins, whatever kind it is. Two
   *   crawls of one chain need no priority ladder between them.
   *
   * **A person always wins and there is no protection window.** Plan 0080 gave
   * the `ADMIN` price a `protectedUntil` because a typed price goes stale and
   * the automated value eventually deserves to return. Availability does not go
   * stale that way: an owner who marked a product absent from one shop marked a
   * fact about that shop, and a crawl that disagrees is either wrong or is news
   * the owner wants to see rather than have applied.
   *
   * **A confirmation writes nothing.** A run that restates a value the row
   * already holds, with the kind it already holds, leaves the row untouched and
   * counts as `skipped`. Plan 0080 gave `item_prices` a `lastObservedAt` for
   * exactly this; here there is one row and no history to append to, so moving a
   * timestamp on every unchanged row would write one audit row per product per
   * shop per run and say nothing anybody will ever ask about. The consequence,
   * stated because it is real: `availabilitySourceRunId` names the run that last
   * **changed** the value, not the last run that saw it.
   */
  async setAvailability(
    req: SetSupermarketLocationItemAvailabilityRequest
  ): Promise<SetSupermarketLocationItemAvailabilityResult> {
    const actor = await this.admin.requireAdmin(req);
    const location = await this.locations.findOne({
      where: { id: req.supermarketLocationId },
    });
    if (!location) {
      throw new NotFoundException('Supermarket location not found');
    }
    if (req.entries.length === 0) {
      return { written: 0, skipped: 0, conflicts: [] };
    }

    // Last entry wins on a duplicated item, which is the only reading that does
    // not depend on the order rows come back from the database in.
    const wanted = new Map(req.entries.map((e) => [e.itemId, e.available]));
    const observedAt = req.observedAt ? new Date(req.observedAt) : new Date();
    const runId = req.sourceRunId ?? null;
    const byPerson = req.sourceKind === PriceSourceKind.ADMIN;

    const held = await this.heldRows(
      [...wanted.keys()],
      req.supermarketLocationId
    );

    const fresh: SupermarketLocationItem[] = [];
    const changed: {
      before: SupermarketLocationItem;
      row: SupermarketLocationItem;
    }[] = [];
    const conflicts: SupermarketLocationItemAvailabilityConflict[] = [];
    let skipped = 0;

    for (const [itemId, available] of wanted) {
      const row = held.get(itemId);
      if (!row) {
        fresh.push(
          this.rows.create({
            itemId,
            supermarketLocationId: req.supermarketLocationId,
            available,
            availabilitySourceKind: req.sourceKind,
            availabilityObservedAt: observedAt,
            availabilitySourceRunId: runId,
          })
        );
        continue;
      }
      if (!byPerson && ownedByAPerson(row)) {
        conflicts.push({ itemId, held: row.available, offered: available });
        skipped++;
        continue;
      }
      if (
        row.available === available &&
        row.availabilitySourceKind === req.sourceKind
      ) {
        skipped++;
        continue;
      }
      const before = { ...row };
      row.available = available;
      row.availabilitySourceKind = req.sourceKind;
      row.availabilityObservedAt = observedAt;
      row.availabilitySourceRunId = runId;
      changed.push({ before, row });
    }

    const touched = [...fresh, ...changed.map((c) => c.row)];
    if (touched.length === 0) {
      return { written: 0, skipped, conflicts };
    }

    await this.audit.write(actor, async (tx) => {
      await tx.manager.save(SupermarketLocationItem, touched, { chunk: 200 });
      for (const row of fresh) {
        await tx.recordCreate(SupermarketLocationItem, row);
      }
      for (const { before, row } of changed) {
        await tx.recordUpdate(SupermarketLocationItem, before, row);
      }
      await this.deriveScopeFlags(
        tx,
        location.priceScopeId,
        touched.map((row) => row.itemId)
      );
    });

    return { written: touched.length, skipped, conflicts };
  }

  async get(
    req: GetSupermarketLocationItemRequest
  ): Promise<SupermarketLocationItemView> {
    const row = await this.rows.findOne({
      where: {
        itemId: req.itemId,
        supermarketLocationId: req.supermarketLocationId,
      },
    });
    if (!row) {
      throw new NotFoundException(
        'No store specific entry for that item at that location'
      );
    }
    return toSupermarketLocationItemView(row);
  }

  async listByLocation(
    req: ListSupermarketLocationItemsRequest
  ): Promise<SupermarketLocationItemPage> {
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as LocationItemCursor | undefined;

    const qb = this.rows
      .createQueryBuilder('li')
      .where('li."supermarketLocationId" = :lid', {
        lid: req.supermarketLocationId,
      })
      .orderBy('li.createdAt', 'DESC')
      .addOrderBy('li.id', 'DESC')
      .take(limit + 1);
    if (cursor) {
      qb.andWhere('(li."createdAt", li.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const found = await qb.getMany();
    const hasMore = found.length > limit;
    const page = found.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toSupermarketLocationItemView),
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  /**
   * The scope wide flag follows from the shops (plan 0084, section 5).
   *
   * `SupermarketItem.available` is "whether the scope carries this product at
   * all", and once the shops of a scope have answers that is derivable: true
   * when any location in the scope says true, false when every location that has
   * an opinion says false, unchanged when none has one.
   *
   * **Catalog derives it, not the caller.** Both tables belong here, the
   * relation between them is an invariant rather than a policy, and a harvester
   * that computed it would become a second place the rule lives. A source with
   * no per shop signal keeps writing `supermarketItem.setAvailability` directly,
   * and the two writers do not collide because they write different scopes of
   * different chains.
   *
   * The derivation obeys section 3 at its own level: a materialized row whose
   * `priceSourceKind` a person set is left alone.
   */
  private async deriveScopeFlags(
    tx: AuditedWrite,
    priceScopeId: string,
    itemIds: string[]
  ): Promise<void> {
    const manager: EntityManager = tx.manager;
    const locations = await manager.find(SupermarketLocation, {
      where: { priceScopeId },
      select: { id: true },
    });
    const locationIds = locations.map((l) => l.id);
    if (locationIds.length === 0) {
      return;
    }

    for (const chunk of chunks(unique(itemIds), CHUNK)) {
      const opinions = await manager.find(SupermarketLocationItem, {
        where: {
          itemId: In(chunk),
          supermarketLocationId: In(locationIds),
        },
        select: { itemId: true, available: true },
      });

      // "Any true wins" collapses to one boolean per item, so the whole scope's
      // answer for a product fits in a map rather than a second query per item.
      const derived = new Map<string, boolean>();
      for (const row of opinions) {
        if (row.available === null) {
          continue;
        }
        derived.set(
          row.itemId,
          (derived.get(row.itemId) ?? false) || row.available
        );
      }
      if (derived.size === 0) {
        continue;
      }

      const scopeRows = await manager.find(SupermarketItem, {
        where: { priceScopeId, itemId: In([...derived.keys()]) },
      });
      const byItem = new Map(scopeRows.map((row) => [row.itemId, row]));

      for (const [itemId, available] of derived) {
        const row = byItem.get(itemId);
        if (!row) {
          const created = manager.create(SupermarketItem, {
            itemId,
            priceScopeId,
            available,
            priceSourceKind: null,
          });
          await manager.save(SupermarketItem, created);
          await tx.recordCreate(SupermarketItem, created);
          continue;
        }
        // A person's row is not recomputed from shops, which is section 3 read
        // one level up.
        if (row.priceSourceKind === PriceSourceKind.ADMIN) {
          continue;
        }
        if (row.available === available) {
          continue;
        }
        const before = { ...row };
        row.available = available;
        await manager.save(SupermarketItem, row);
        await tx.recordUpdate(SupermarketItem, before, row);
      }
    }
  }

  /** The rows this shop already holds for these products, keyed by item. */
  private async heldRows(
    itemIds: string[],
    supermarketLocationId: string
  ): Promise<Map<string, SupermarketLocationItem>> {
    const held = new Map<string, SupermarketLocationItem>();
    for (const chunk of chunks(itemIds, CHUNK)) {
      const rows = await this.rows.find({
        where: { supermarketLocationId, itemId: In(chunk) },
      });
      for (const row of rows) {
        held.set(row.itemId, row);
      }
    }
    return held;
  }

  private async requireItemAndLocation(
    itemId: string,
    supermarketLocationId: string
  ): Promise<void> {
    const [item, location] = await Promise.all([
      this.items.findOne({ where: { id: itemId } }),
      this.locations.findOne({ where: { id: supermarketLocationId } }),
    ]);
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    if (!location) {
      throw new NotFoundException('Supermarket location not found');
    }
  }
}

/**
 * Whether a person owns this row's availability (plan 0084, section 3).
 *
 * The second clause is the one worth reading twice: a null kind beside a non
 * null `available` is a row from before provenance existed, and only a person
 * ever wrote that column, so it is treated as `ADMIN` rather than as free.
 */
function ownedByAPerson(row: SupermarketLocationItem): boolean {
  if (row.availabilitySourceKind === PriceSourceKind.ADMIN) {
    return true;
  }
  return row.availabilitySourceKind === null && row.available !== null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function* chunks<T>(values: T[], size: number): Generator<T[]> {
  for (let i = 0; i < values.length; i += size) {
    yield values.slice(i, i + size);
  }
}
