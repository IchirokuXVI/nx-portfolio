import { LIST_HOLDING_ITEM_LIMITS } from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import type { DataSource } from 'typeorm';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { ZoneAuthzService } from '../zones/zone-authz.service';
import type { ZoneCountsService } from '../zones/zone-counts.service';
import type { ListAccessService } from './list-access.service';
import {
  LISTS_HOLDING_ITEM_SQL,
  type ListHoldingItemRow,
} from './list-holding.sql';
import { ListService } from './list.service';
import type { SharedListGrantService } from './shared-list-grant.service';

/**
 * Which of the caller's other lists still want this product (plan 0053,
 * section 3).
 *
 * The read velista's line detail sheet had no endpoint for, so it computed
 * `alsoOn` from whatever lists the session happened to have loaded: it under
 * reported, and drew nothing when empty, which made "nobody asked" and "it is on
 * no other list" the same picture.
 *
 * What is asserted here is the boundary, not the SQL. The access filtering, the
 * `APPROVED`/`quantity > 0` predicate and the `DISTINCT ON` all live in Postgres
 * and are pinned by matching on the query constant, so a rewrite shows up as an
 * unmocked read. What this file owns is the four things the service decides: the
 * cap, whether the cap bit, what an item id that names nothing does, and what
 * gets passed down as the list to exclude.
 */

const CALLER = 'u-caller';
const ITEM = '11111111-2222-4333-8444-555555555555';
const FROM_LIST = '99999999-8888-4777-8666-555555555555';

function row(n: number): ListHoldingItemRow {
  return {
    listId: `l-${n}`,
    name: `List ${n}`,
    zoneId: `z-${n}`,
    zoneName: `Zone ${n}`,
    quantity: n,
  };
}

function build(rows: ListHoldingItemRow[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const lists = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (sql === LISTS_HOLDING_ITEM_SQL) {
        // The service asks for one past the cap, so Postgres's `LIMIT` is what
        // trims; the fake honours it rather than handing back everything.
        return rows.slice(0, params[3] as number);
      }
      throw new Error(`unmocked query: ${sql.slice(0, 60)}`);
    },
  } as never;

  // Only the list repository is reached: this read is one query and a cap, and
  // everything it is allowed to answer with is decided inside the SQL.
  const service = new ListService(
    { transaction: async () => undefined } as unknown as DataSource,
    lists,
    {} as never,
    {} as unknown as ZoneAuthzService,
    {} as unknown as ListAccessService,
    {} as unknown as SharedListGrantService,
    {} as unknown as ZoneCountsService,
    { emit: () => undefined } as unknown as CoreEventsPublisher,
    // No operator write here, so nothing reaches the trail.
    {} as never
  );

  return { service, calls };
}

describe('which other lists hold this item (plan 0053, section 3)', () => {
  it('names the lists that still want it, with the zone each belongs to', async () => {
    const { service } = build([row(1), row(2)]);

    const result = await service.holdingItem({ userId: CALLER, itemId: ITEM });

    // Zone and list both, because the caption reads "Flat 3B - Weekly shop".
    expect(result.lists).toEqual([
      {
        listId: 'l-1',
        name: 'List 1',
        zoneId: 'z-1',
        zoneName: 'Zone 1',
        quantity: 1,
      },
      {
        listId: 'l-2',
        name: 'List 2',
        zoneId: 'z-2',
        zoneName: 'Zone 2',
        quantity: 2,
      },
    ]);
    expect(result.hasMore).toBe(false);
  });

  it('answers an empty list, which means no other list wants it', async () => {
    const { service } = build([]);

    const result = await service.holdingItem({ userId: CALLER, itemId: ITEM });

    // This is the answer velista could not previously tell apart from not having
    // asked, and it is why the read exists.
    expect(result).toEqual({ lists: [], hasMore: false });
  });

  it('refuses a caller with no item rather than answering nothing found', async () => {
    const { service, calls } = build([]);

    await expect(
      service.holdingItem({ userId: CALLER, itemId: '' })
    ).rejects.toBeInstanceOf(ValidationException);
    // "The line has no product" and "no other list has it" are drawn differently
    // and must be distinguishable, so the second is never used to answer the
    // first. Nothing reached the database either.
    expect(calls).toEqual([]);
  });

  it('refuses an id that is not an item reference at all', async () => {
    const { service } = build([]);

    await expect(
      service.holdingItem({ userId: CALLER, itemId: 'milk' })
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('caps the answer and says the cap bit', async () => {
    const cap = LIST_HOLDING_ITEM_LIMITS.maxLists;
    const { service, calls } = build(
      Array.from({ length: cap + 5 }, (_, index) => row(index))
    );

    const result = await service.holdingItem({ userId: CALLER, itemId: ITEM });

    expect(result.lists).toHaveLength(cap);
    // A caption says "and 3 more" and stops; it does not offer a cursor into
    // every readable list that happens to want milk.
    expect(result.hasMore).toBe(true);
    // One row past the cap, so the flag costs no second read.
    expect(calls[0].params[3]).toBe(cap + 1);
  });

  it('does not claim there is more when the answer is exactly the cap', async () => {
    const cap = LIST_HOLDING_ITEM_LIMITS.maxLists;
    const { service } = build(Array.from({ length: cap }, (_, i) => row(i)));

    expect(
      (await service.holdingItem({ userId: CALLER, itemId: ITEM })).hasMore
    ).toBe(false);
  });

  it('leaves out the list the caller is asking from', async () => {
    const { service, calls } = build([]);

    await service.holdingItem({
      userId: CALLER,
      itemId: ITEM,
      excludeListId: FROM_LIST,
    });

    expect(calls[0].params).toEqual([
      ITEM,
      CALLER,
      FROM_LIST,
      expect.any(Number),
    ]);
  });

  it('excludes nothing for a basket line, which belongs to no one list', async () => {
    const { service, calls } = build([]);

    await service.holdingItem({ userId: CALLER, itemId: ITEM });

    // Null rather than undefined: it reaches a `$3::uuid IS NULL` test.
    expect(calls[0].params[2]).toBeNull();
  });

  it('filters by the caller, in the query, at request time', async () => {
    const { service, calls } = build([]);

    await service.holdingItem({ userId: CALLER, itemId: ITEM });

    // A zone you have left takes its lists with it, so the caller is a parameter
    // of the read rather than something resolved once and cached.
    expect(calls[0].sql).toBe(LISTS_HOLDING_ITEM_SQL);
    expect(calls[0].params[1]).toBe(CALLER);
  });
});
