import { Injectable } from '@nestjs/common';
import { PriceScopeKind } from '@portfolio/luna-shopper/contracts';
import { In, type EntityManager } from 'typeorm';
import {
  ItemPrice,
  PricePolicy,
  PriceScope,
  SupermarketItem,
} from '../entities';
import { resolveEffectivePrice, type PolicyRow } from './effective-price';

/** One materialized row's address. */
export interface PriceKey {
  itemId: string;
  priceScopeId: string;
}

/** How many keys one `recomputeMany` pass loads at a time. */
const KEY_CHUNK = 500;

/**
 * The current row per (item, scope, kind) among these items at these scopes:
 * the newest `observedAt` wins, which is what `ix_item_prices_current` serves.
 *
 * Exported for the price writer, which reads the same rows to compare a new
 * value against and to take an `ADMIN` row's snapshot from (section 4.2), so
 * the write and the read agree about what "current" means.
 */
export async function currentPriceRows(
  manager: EntityManager,
  itemIds: readonly string[],
  priceScopeIds: readonly string[]
): Promise<ItemPrice[]> {
  if (itemIds.length === 0 || priceScopeIds.length === 0) {
    return [];
  }
  return manager
    .createQueryBuilder(ItemPrice, 'p')
    .distinctOn(['p."itemId"', 'p."priceScopeId"', 'p."sourceKind"'])
    .where('p."itemId" IN (:...itemIds)', { itemIds: [...itemIds] })
    .andWhere('p."priceScopeId" IN (:...scopeIds)', {
      scopeIds: [...priceScopeIds],
    })
    .orderBy('p."itemId"', 'ASC')
    .addOrderBy('p."priceScopeId"', 'ASC')
    .addOrderBy('p."sourceKind"', 'ASC')
    .addOrderBy('p."observedAt"', 'DESC')
    .addOrderBy('p."id"', 'DESC')
    .getMany();
}

/**
 * The chain's NATIONAL scope, for a scope that is not it (plan 0080, section
 * 6). Null for a NATIONAL scope itself and for a chain without one.
 */
export async function nationalScopeOf(
  manager: EntityManager,
  scope: PriceScope
): Promise<PriceScope | null> {
  if (scope.kind === PriceScopeKind.NATIONAL) {
    return null;
  }
  return manager.findOne(PriceScope, {
    where: {
      supermarketId: scope.supermarketId,
      kind: PriceScopeKind.NATIONAL,
    },
  });
}

/**
 * Run section 4 for these keys and write the answer onto `supermarket_items`
 * (plan 0080, section 7).
 *
 * A plain function over the caller's `EntityManager` rather than a method that
 * opens its own transaction, because it runs **inside** the write that made it
 * necessary: a price row committed without its materialized row is a price a
 * shopper cannot see, and a materialized row committed without its price row
 * is one they should not. The reference seed, which has a manager and no Nest
 * injector, calls it the same way.
 *
 * Idempotent: running it twice writes nothing the second time, which is what
 * lets two sweep replicas meet on a row and waste work rather than disagree.
 */
export async function recomputeEffectivePrices(
  manager: EntityManager,
  keys: readonly PriceKey[],
  now: Date = new Date()
): Promise<void> {
  if (keys.length === 0) {
    return;
  }
  const policies: PolicyRow[] = await manager.find(PricePolicy);

  const byScope = new Map<string, Set<string>>();
  for (const key of keys) {
    let items = byScope.get(key.priceScopeId);
    if (!items) {
      items = new Set();
      byScope.set(key.priceScopeId, items);
    }
    items.add(key.itemId);
  }

  for (const [priceScopeId, itemSet] of byScope) {
    const scope = await manager.findOne(PriceScope, {
      where: { id: priceScopeId },
    });
    if (!scope) {
      // The scope went away under a cascade; its rows went with it.
      continue;
    }
    const national = await nationalScopeOf(manager, scope);
    const scopeIds = national ? [scope.id, national.id] : [scope.id];
    const itemIds = [...itemSet];

    for (let i = 0; i < itemIds.length; i += KEY_CHUNK) {
      const chunk = itemIds.slice(i, i + KEY_CHUNK);
      const [rows, existing] = await Promise.all([
        currentPriceRows(manager, chunk, scopeIds),
        manager.find(SupermarketItem, {
          where: { priceScopeId: scope.id, itemId: In(chunk) },
        }),
      ]);
      const rowsByItem = new Map<string, ItemPrice[]>();
      for (const row of rows) {
        const held = rowsByItem.get(row.itemId) ?? [];
        held.push(row);
        rowsByItem.set(row.itemId, held);
      }
      const existingByItem = new Map(existing.map((row) => [row.itemId, row]));

      const toSave: SupermarketItem[] = [];
      for (const itemId of chunk) {
        const candidates = rowsByItem.get(itemId) ?? [];
        const resolved = resolveEffectivePrice({
          rows: candidates,
          priceScopeId: scope.id,
          policies,
          now,
        });
        // The resolution answers with the structural row it was handed, which
        // is one of the entities above: find it again by id to keep the type.
        const effective = {
          row: resolved.row
            ? (candidates.find((c) => c.id === resolved.row?.id) ?? null)
            : null,
          stale: resolved.stale,
          nextBoundaryAt: resolved.nextBoundaryAt,
        };
        const held = existingByItem.get(itemId);
        if (!held && effective.row === null) {
          // Nothing prices it and nothing says whether the scope carries it:
          // there is no row to write and none to create.
          continue;
        }
        const target =
          held ??
          manager.create(SupermarketItem, {
            itemId,
            priceScopeId: scope.id,
            available: true,
          });
        if (
          applyEffective(
            target,
            effective.row,
            effective.stale,
            effective.nextBoundaryAt
          )
        ) {
          toSave.push(target);
        }
      }
      if (toSave.length > 0) {
        await manager.save(SupermarketItem, toSave, { chunk: 200 });
      }
    }
  }
}

/** Write the answer onto the row. True when something moved. */
function applyEffective(
  target: SupermarketItem,
  row: ItemPrice | null,
  stale: boolean,
  nextBoundaryAt: Date | null
): boolean {
  const next = {
    price: row ? toNumber(row.price) : null,
    currency: row ? row.currency : null,
    unitPrice: row ? toNumber(row.unitPrice) : null,
    unitPriceLabel: row ? row.unitPriceLabel : null,
    priceObservedAt: row ? row.lastObservedAt : null,
    priceSourceKind: row ? row.sourceKind : null,
    itemPriceId: row ? row.id : null,
    stale,
    validUntil: row ? row.validUntil : null,
    nextBoundaryAt,
  };
  const same =
    toNumber(target.price) === next.price &&
    (target.currency ?? null) === next.currency &&
    toNumber(target.unitPrice) === next.unitPrice &&
    (target.unitPriceLabel ?? null) === next.unitPriceLabel &&
    sameInstant(target.priceObservedAt, next.priceObservedAt) &&
    (target.priceSourceKind ?? null) === next.priceSourceKind &&
    (target.itemPriceId ?? null) === next.itemPriceId &&
    (target.stale ?? false) === next.stale &&
    sameInstant(target.validUntil, next.validUntil) &&
    sameInstant(target.nextBoundaryAt, next.nextBoundaryAt) &&
    target.id !== undefined;
  if (same) {
    return false;
  }
  Object.assign(target, next);
  return true;
}

function sameInstant(a: Date | null | undefined, b: Date | null): boolean {
  if (!a && !b) {
    return true;
  }
  return !!a && !!b && a.getTime() === b.getTime();
}

function toNumber(value: number | string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * The keys a write at (items, scope) makes stale.
 *
 * The keys themselves, and, for a NATIONAL scope, the same items at every
 * scope of the chain (plan 0080, section 6): a national price reaches every
 * scope of its chain, so writing one recomputes them all.
 */
export async function affectedPriceKeys(
  manager: EntityManager,
  itemIds: readonly string[],
  priceScopeId: string
): Promise<PriceKey[]> {
  const scope = await manager.findOne(PriceScope, {
    where: { id: priceScopeId },
  });
  if (!scope) {
    return [];
  }
  const scopeIds = [scope.id];
  if (scope.kind === PriceScopeKind.NATIONAL) {
    const siblings = await manager.find(PriceScope, {
      where: { supermarketId: scope.supermarketId },
      select: { id: true },
    });
    for (const sibling of siblings) {
      if (sibling.id !== scope.id) {
        scopeIds.push(sibling.id);
      }
    }
  }
  const keys: PriceKey[] = [];
  for (const scopeId of scopeIds) {
    for (const itemId of itemIds) {
      keys.push({ itemId, priceScopeId: scopeId });
    }
  }
  return keys;
}

/**
 * A scope made later inherits on arrival (plan 0080, section 6): every item
 * with a row at the chain's NATIONAL scope is recomputed for the new scope.
 */
export async function inheritNationalPrices(
  manager: EntityManager,
  scope: PriceScope,
  now: Date = new Date()
): Promise<void> {
  const national = await nationalScopeOf(manager, scope);
  if (!national) {
    return;
  }
  const priced = await manager
    .createQueryBuilder(ItemPrice, 'p')
    .select('DISTINCT p."itemId"', 'itemId')
    .where('p."priceScopeId" = :scopeId', { scopeId: national.id })
    .getRawMany<{ itemId: string }>();
  await recomputeEffectivePrices(
    manager,
    priced.map((row) => ({ itemId: row.itemId, priceScopeId: scope.id })),
    now
  );
}

/**
 * Every materialized row, for a policy change (plan 0080, section 3). A full
 * pass, chunked, and rare enough to be a synchronous loop behind the update.
 */
export async function recomputeAllEffectivePrices(
  manager: EntityManager,
  now: Date = new Date()
): Promise<number> {
  let total = 0;
  // Paged by id alone. A timestamp cursor loses the microseconds Postgres
  // keeps, so the last row of one page comes back as the first of the next
  // and the loop never ends; a uuid compares exactly.
  let after: string | null = null;
  for (;;) {
    const qb = manager
      .createQueryBuilder(SupermarketItem, 'si')
      .select(['si.id', 'si.itemId', 'si.priceScopeId'])
      .orderBy('si.id', 'ASC')
      .take(KEY_CHUNK);
    if (after !== null) {
      qb.where('si.id > :after', { after });
    }
    const page = await qb.getMany();
    if (page.length === 0) {
      return total;
    }
    await recomputeEffectivePrices(
      manager,
      page.map((row) => ({
        itemId: row.itemId,
        priceScopeId: row.priceScopeId,
      })),
      now
    );
    total += page.length;
    after = page[page.length - 1].id;
  }
}

/**
 * The Nest face of the functions above, so a service can inject one thing and
 * a spec can replace it. Every method takes the caller's manager: nothing here
 * opens a transaction of its own.
 */
@Injectable()
export class EffectivePriceService {
  recompute(manager: EntityManager, keys: readonly PriceKey[], now?: Date) {
    return recomputeEffectivePrices(manager, keys, now);
  }

  affectedKeys(
    manager: EntityManager,
    itemIds: readonly string[],
    priceScopeId: string
  ) {
    return affectedPriceKeys(manager, itemIds, priceScopeId);
  }

  inheritNational(manager: EntityManager, scope: PriceScope, now?: Date) {
    return inheritNationalPrices(manager, scope, now);
  }

  recomputeAll(manager: EntityManager, now?: Date) {
    return recomputeAllEffectivePrices(manager, now);
  }
}
