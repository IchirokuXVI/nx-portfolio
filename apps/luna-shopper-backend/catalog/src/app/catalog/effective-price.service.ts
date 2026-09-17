import { Injectable } from '@nestjs/common';
import { PriceScopeKind } from '@portfolio/luna-shopper/contracts';
import { In, type EntityManager } from 'typeorm';
import {
  ItemPrice,
  PricePolicy,
  PriceScope,
  SupermarketItem,
} from '../entities';
import {
  resolveEffectivePrice,
  type PolicyRow,
  type PriceRow,
} from './effective-price';

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

/** The columns of a row the resolution and the materialized row read. */
export interface CandidatePriceRow extends PriceRow {
  itemId: string;
  currency: string | null;
  unitPriceLabel: string | null;
}

/** What {@link effectivePriceCandidates} hands the resolution for one item. */
export interface PriceCandidates {
  rows: CandidatePriceRow[];
  /** The earliest `validFrom` still ahead among the item's enabled current rows. */
  nextValidFrom: Date | null;
}

/**
 * The current row per (item, scope, kind) whose kind is enabled, with the
 * scope's priority read from the table as it is now and the item's earliest
 * future `validFrom` computed before anything is filtered. `$1` items, `$2`
 * scopes, `$3` now.
 *
 * The `DISTINCT ON` runs first and alone, which is what `ix_item_prices_current`
 * serves, and it is also the rule of plan 0117 section 2: current is decided
 * before eligibility, so an older row never stands in for a newer one that is
 * not valid yet.
 */
const CURRENT_ENABLED = `
  current AS (
    SELECT DISTINCT ON (p."itemId", p."priceScopeId", p."sourceKind")
           p."id", p."itemId", p."priceScopeId", p."sourceKind", p."price",
           p."currency", p."unitPrice", p."unitPriceLabel", p."lastObservedAt",
           p."validFrom", p."validUntil", p."overrides", p."protectedUntil"
      FROM "item_prices" p
     WHERE p."itemId" = ANY($1::uuid[]) AND p."priceScopeId" = ANY($2::uuid[])
     ORDER BY p."itemId", p."priceScopeId", p."sourceKind", p."observedAt" DESC, p."id" DESC
  ), current_enabled AS (
    SELECT c.*, s."priority" AS "scopePriority", pol."maxAgeDays",
           MIN(c."validFrom") FILTER (WHERE c."validFrom" > $3::timestamptz)
             OVER (PARTITION BY c."itemId") AS "nextValidFrom"
      FROM current c
      JOIN "price_policies" pol ON pol."sourceKind" = c."sourceKind" AND pol."enabled"
      JOIN "price_scopes" s ON s."id" = c."priceScopeId"
  )`;

/**
 * Steps 2 and 3 of plan 0117 section 2 in SQL: at most one row per (item,
 * kind), the narrowest eligible one. `$4` is the scope being computed, which
 * wins a tie of priority exactly as `narrowestPerKind` decides it.
 */
const NARROWEST_ELIGIBLE_SQL = `
  WITH ${CURRENT_ENABLED}
  SELECT DISTINCT ON (e."itemId", e."sourceKind") e.*
    FROM current_enabled e
   WHERE (e."validFrom" IS NULL OR e."validFrom" <= $3::timestamptz)
     AND (e."validUntil" IS NULL OR e."validUntil" > $3::timestamptz)
     AND (e."maxAgeDays" IS NULL
          OR e."lastObservedAt" > $3::timestamptz - make_interval(days => e."maxAgeDays"))
   ORDER BY e."itemId", e."sourceKind", e."scopePriority",
            (e."priceScopeId" = $4::uuid) DESC, e."lastObservedAt" DESC, e."id" DESC`;

/**
 * The stale tier of plan 0117 section 3: the newest enabled current row per
 * item, of any age, for the items the first query priced nothing for. Ties go
 * to the narrower scope, as in the resolution.
 */
const NEWEST_ENABLED_SQL = `
  WITH ${CURRENT_ENABLED}
  SELECT DISTINCT ON (e."itemId") e.*
    FROM current_enabled e
   ORDER BY e."itemId", e."lastObservedAt" DESC, e."scopePriority",
            (e."priceScopeId" = $4::uuid) DESC, e."id" DESC`;

/**
 * The rows the resolution needs for these items at this stack, and nothing
 * else (plan 0117, section 5).
 *
 * One query for the narrowest eligible row per (item, kind). The items with
 * none get a second query for their newest enabled current row, which the
 * resolution flags stale. A chunk whose items are all priced therefore costs
 * one query, and an expired row is never loaded only to be thrown away.
 */
export async function effectivePriceCandidates(
  manager: EntityManager,
  itemIds: readonly string[],
  priceScopeIds: readonly string[],
  priceScopeId: string,
  now: Date
): Promise<Map<string, PriceCandidates>> {
  const byItem = new Map<string, PriceCandidates>();
  if (itemIds.length === 0 || priceScopeIds.length === 0) {
    return byItem;
  }
  const collect = (rows: RawCandidate[]) => {
    for (const raw of rows) {
      const held = byItem.get(raw.itemId) ?? {
        rows: [],
        nextValidFrom: raw.nextValidFrom,
      };
      held.rows.push(toCandidate(raw));
      byItem.set(raw.itemId, held);
    }
  };

  collect(
    await manager.query<RawCandidate[]>(NARROWEST_ELIGIBLE_SQL, [
      [...itemIds],
      [...priceScopeIds],
      now,
      priceScopeId,
    ])
  );
  const unpriced = itemIds.filter((itemId) => !byItem.has(itemId));
  if (unpriced.length > 0) {
    collect(
      await manager.query<RawCandidate[]>(NEWEST_ENABLED_SQL, [
        unpriced,
        [...priceScopeIds],
        now,
        priceScopeId,
      ])
    );
  }
  return byItem;
}

/** A row as `manager.query` returns it: `numeric` as a string, the helper columns beside it. */
interface RawCandidate extends CandidatePriceRow {
  scopePriority: number;
  maxAgeDays: number | null;
  nextValidFrom: Date | null;
}

function toCandidate(raw: RawCandidate): CandidatePriceRow {
  return {
    id: raw.id,
    itemId: raw.itemId,
    priceScopeId: raw.priceScopeId,
    sourceKind: raw.sourceKind,
    price: raw.price,
    currency: raw.currency,
    unitPrice: raw.unitPrice,
    unitPriceLabel: raw.unitPriceLabel,
    lastObservedAt: raw.lastObservedAt,
    validFrom: raw.validFrom,
    validUntil: raw.validUntil,
    overrides: raw.overrides,
    protectedUntil: raw.protectedUntil,
  };
}

/** The shops that hold a scope, as a subquery, for the two functions below. */
const SHOPS_HOLDING = `
  SELECT mine."supermarketLocationId"
    FROM "supermarket_location_price_scopes" mine
   WHERE mine."priceScopeId" = :scopeId`;

/** The scopes those shops also hold. */
const SCOPES_SHARED_WITH = `
  SELECT other."priceScopeId"
    FROM "supermarket_location_price_scopes" other
   WHERE other."supermarketLocationId" IN (${SHOPS_HOLDING})`;

/**
 * The scopes this one falls through to: the chain's scopes less specific than
 * it that a shop holding it also holds (plan 0080, section 6; widened by plan
 * 0105, section 4).
 *
 * **The stack and not merely the chain.** LIDL has 59 REGION scopes, and a shop
 * in Madrid must not inherit Barcelona's price. What makes a scope reachable
 * from another is a shop that holds both, which is exactly what the join table
 * records.
 *
 * The chain's NATIONAL is always included, whatever holds it. That is the rule
 * this function had before there was a stack, and it is what keeps a scope no
 * shop has been attached to yet inheriting on the day it is created.
 *
 * Empty for a scope with nothing less specific than it, which is what the
 * NATIONAL scope of a chain with no wider tier gets.
 */
export async function lessSpecificScopesOf(
  manager: EntityManager,
  scope: PriceScope
): Promise<PriceScope[]> {
  return manager
    .createQueryBuilder(PriceScope, 's')
    .where('s."supermarketId" = :chain', { chain: scope.supermarketId })
    .andWhere('s."priority" > :priority', { priority: scope.priority })
    .andWhere(`(s."kind" = :national OR s."id" IN (${SCOPES_SHARED_WITH}))`, {
      national: PriceScopeKind.NATIONAL,
      scopeId: scope.id,
    })
    .orderBy('s."priority"', 'ASC')
    .getMany();
}

/**
 * The reverse of {@link lessSpecificScopesOf}: the scopes that fall through to
 * this one, and whose materialized rows a write here therefore changes.
 */
export async function moreSpecificScopesOf(
  manager: EntityManager,
  scope: PriceScope
): Promise<PriceScope[]> {
  const qb = manager
    .createQueryBuilder(PriceScope, 's')
    .where('s."supermarketId" = :chain', { chain: scope.supermarketId })
    .andWhere('s."priority" < :priority', { priority: scope.priority });
  // A national price reaches every scope of its chain, held by a shop or not,
  // because every scope falls through to it (plan 0080, section 6).
  if (scope.kind !== PriceScopeKind.NATIONAL) {
    qb.andWhere(`s."id" IN (${SCOPES_SHARED_WITH})`, { scopeId: scope.id });
  }
  return qb.getMany();
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
    const inherited = await lessSpecificScopesOf(manager, scope);
    const scopeIds = [scope.id, ...inherited.map((row) => row.id)];
    // The ranking the resolution reads, built once per scope rather than once
    // per product: every scope whose rows were loaded, against its priority.
    const scopePriorities = new Map<string, number>([
      [scope.id, scope.priority],
      ...inherited.map((row): [string, number] => [row.id, row.priority]),
    ]);
    const itemIds = [...itemSet];

    for (let i = 0; i < itemIds.length; i += KEY_CHUNK) {
      const chunk = itemIds.slice(i, i + KEY_CHUNK);
      const [candidatesByItem, existing] = await Promise.all([
        effectivePriceCandidates(manager, chunk, scopeIds, scope.id, now),
        manager.find(SupermarketItem, {
          where: { priceScopeId: scope.id, itemId: In(chunk) },
        }),
      ]);
      const existingByItem = new Map(existing.map((row) => [row.itemId, row]));

      const toSave: SupermarketItem[] = [];
      for (const itemId of chunk) {
        const loaded = candidatesByItem.get(itemId);
        const candidates = loaded?.rows ?? [];
        const resolved = resolveEffectivePrice({
          rows: candidates,
          priceScopeId: scope.id,
          scopePriorities,
          policies,
          now,
          nextValidFrom: loaded?.nextValidFrom ?? null,
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
  row: CandidatePriceRow | null,
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
 * The keys themselves, and the same items at every scope that falls through to
 * this one (plan 0080, section 6; plan 0105, section 4): a price written at a
 * region reaches the shops of that region, and a national price still reaches
 * every scope of its chain.
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
  for (const dependent of await moreSpecificScopesOf(manager, scope)) {
    if (dependent.id !== scope.id) {
      scopeIds.push(dependent.id);
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
 * A scope inherits on arrival (plan 0080, section 6): every item with a row at
 * a scope this one falls through to is recomputed for it.
 *
 * Called when a scope is created, and again whenever a shop's stack changes,
 * because attaching a shop to a region is what makes that region reachable
 * from the shop's own scope (plan 0105, section 3).
 */
export async function inheritLessSpecificPrices(
  manager: EntityManager,
  scope: PriceScope,
  now: Date = new Date()
): Promise<void> {
  const inherited = await lessSpecificScopesOf(manager, scope);
  if (inherited.length === 0) {
    return;
  }
  const priced = await manager
    .createQueryBuilder(ItemPrice, 'p')
    .select('DISTINCT p."itemId"', 'itemId')
    .where('p."priceScopeId" IN (:...scopeIds)', {
      scopeIds: inherited.map((row) => row.id),
    })
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

  inheritLessSpecific(manager: EntityManager, scope: PriceScope, now?: Date) {
    return inheritLessSpecificPrices(manager, scope, now);
  }

  recomputeAll(manager: EntityManager, now?: Date) {
    return recomputeAllEffectivePrices(manager, now);
  }
}
