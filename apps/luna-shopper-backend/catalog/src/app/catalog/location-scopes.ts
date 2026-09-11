import { Injectable } from '@nestjs/common';
import { In, type EntityManager } from 'typeorm';
import { SupermarketLocationPriceScope } from '../entities';

/**
 * A shop's price scopes, ranked (plan 0105, section 3).
 *
 * Plain functions over the caller's `EntityManager`, the way
 * `effective-price.service.ts` is written and for the same reason: three
 * services and a resolver need the same ranking, two of them inside a
 * transaction somebody else opened, and a ranking written four times is a
 * ranking that will disagree with itself.
 *
 * **The order is the answer, everywhere.** Most specific first, which is
 * ascending `priority`, and the scope id breaks a tie so that two scopes at one
 * priority do not swap places between two reads of the same shop.
 */

/** One tier of a shop's stack. */
export interface ScopeInStack {
  priceScopeId: string;
  /** Lower is more specific (plan 0105, section 2.1). */
  priority: number;
}

/** The scope ids of a stack, most specific first. */
export function idsOf(stack: readonly ScopeInStack[] | undefined): string[] {
  return (stack ?? []).map((entry) => entry.priceScopeId);
}

/**
 * The stacks of these shops, most specific first, keyed by shop.
 *
 * A shop with no rows is absent rather than present and empty, which is a state
 * nothing creates: the import path gives a location a STORE scope when it names
 * none, and that is the floor of every stack.
 */
export async function stacksFor(
  manager: EntityManager,
  supermarketLocationIds: readonly string[]
): Promise<Map<string, ScopeInStack[]>> {
  const stacks = new Map<string, ScopeInStack[]>();
  if (supermarketLocationIds.length === 0) {
    return stacks;
  }
  const rows = await manager
    .createQueryBuilder(SupermarketLocationPriceScope, 'ls')
    .innerJoin('price_scopes', 's', 's."id" = ls."priceScopeId"')
    .select('ls."supermarketLocationId"', 'locationId')
    .addSelect('ls."priceScopeId"', 'priceScopeId')
    .addSelect('s."priority"', 'priority')
    .where('ls."supermarketLocationId" IN (:...ids)', {
      ids: [...new Set(supermarketLocationIds)],
    })
    .orderBy('ls."supermarketLocationId"', 'ASC')
    .addOrderBy('s."priority"', 'ASC')
    .addOrderBy('ls."priceScopeId"', 'ASC')
    .getRawMany<{
      locationId: string;
      priceScopeId: string;
      priority: number;
    }>();

  for (const row of rows) {
    const entry: ScopeInStack = {
      priceScopeId: row.priceScopeId,
      // `integer` comes back as a number through node-postgres, but a driver
      // that ever hands it over as a string must not turn a comparison into a
      // string comparison, where 1000 sorts before 300.
      priority: Number(row.priority),
    };
    const held = stacks.get(row.locationId);
    if (held) {
      held.push(entry);
    } else {
      stacks.set(row.locationId, [entry]);
    }
  }
  return stacks;
}

/**
 * The one scope a shop is quoted from: the most specific of its stack.
 *
 * Its materialized rows already answer for the whole stack, because a scope
 * inherits from everything it falls through to (plan 0080, section 6), so a
 * read handed this id alone quotes what this till charges for every product.
 * Null for a shop with no stack, which no writer creates.
 */
export async function quotedScopeOf(
  manager: EntityManager,
  supermarketLocationId: string
): Promise<string | null> {
  const stacks = await stacksFor(manager, [supermarketLocationId]);
  return stacks.get(supermarketLocationId)?.[0]?.priceScopeId ?? null;
}

/** The shops that sell at one scope, whatever else they also sell at. */
export async function locationsHolding(
  manager: EntityManager,
  priceScopeId: string
): Promise<string[]> {
  const rows = await manager.find(SupermarketLocationPriceScope, {
    where: { priceScopeId },
    select: { supermarketLocationId: true },
  });
  return rows.map((row) => row.supermarketLocationId);
}

/**
 * Set a shop's stack to exactly these scopes, and answer with what changed.
 *
 * A replacement rather than a merge: a caller stating a stack is stating the
 * whole of it, and a merge would make removing a tier impossible to express.
 * Rows that are already right are left alone, so a re-stated stack writes
 * nothing and the `RESTRICT` on the scope side is never provoked by a delete
 * and re-insert of the same pair.
 *
 * The added scopes are returned because attaching one changes what the shop's
 * more specific scopes inherit, and the caller is the one holding the
 * transaction that has to recompute them (plan 0105, section 3).
 */
export async function setStack(
  manager: EntityManager,
  supermarketLocationId: string,
  priceScopeIds: readonly string[]
): Promise<{ added: string[]; removed: string[] }> {
  const wanted = [...new Set(priceScopeIds)];
  const held = (await stacksFor(manager, [supermarketLocationId])).get(
    supermarketLocationId
  );
  const before = new Set(idsOf(held));
  const after = new Set(wanted);

  const added = wanted.filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !after.has(id));

  if (removed.length > 0) {
    await manager.delete(SupermarketLocationPriceScope, {
      supermarketLocationId,
      priceScopeId: In(removed),
    });
  }
  if (added.length > 0) {
    await manager.insert(
      SupermarketLocationPriceScope,
      added.map((priceScopeId) => ({ supermarketLocationId, priceScopeId }))
    );
  }
  return { added, removed };
}

/**
 * The Nest face of the functions above, so a service can inject one thing and
 * a spec can replace it. Every method takes the caller's manager: nothing here
 * opens a transaction of its own, and the two writers call it from inside the
 * transaction that made the change necessary.
 *
 * The same arrangement `EffectivePriceService` uses, for the same reason. It
 * is also the seam the specs need: a stack is one raw query with a join, and a
 * double for a query builder proves nothing about the ranking, while a double
 * for this proves everything the caller does with the answer.
 */
@Injectable()
export class LocationScopeService {
  stacksFor(manager: EntityManager, supermarketLocationIds: readonly string[]) {
    return stacksFor(manager, supermarketLocationIds);
  }

  quotedScopeOf(manager: EntityManager, supermarketLocationId: string) {
    return quotedScopeOf(manager, supermarketLocationId);
  }

  locationsHolding(manager: EntityManager, priceScopeId: string) {
    return locationsHolding(manager, priceScopeId);
  }

  setStack(
    manager: EntityManager,
    supermarketLocationId: string,
    priceScopeIds: readonly string[]
  ) {
    return setStack(manager, supermarketLocationId, priceScopeIds);
  }
}
