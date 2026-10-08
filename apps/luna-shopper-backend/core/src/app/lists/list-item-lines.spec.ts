import {
  LineApprovalStatus,
  ListPermission,
  LISTS_WITH_ITEM_LINES_LIMITS,
} from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import type { DataSource } from 'typeorm';
import { fakeBasketAnnouncer } from '../baskets/basket-announcer.fake';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { ZoneAuthzService } from '../zones/zone-authz.service';
import type { ZoneCountsService } from '../zones/zone-counts.service';
import type { ListAccessService } from './list-access.service';
import {
  LINES_HOLDING_ITEM_SQL,
  READABLE_LISTS_WITH_PERMISSIONS_SQL,
  type LineHoldingItemRow,
  type ReadableListRow,
} from './list-item-lines.sql';
import { ListService } from './list.service';
import type { SharedListGrantService } from './shared-list-grant.service';

/**
 * Every readable list with its lines that hold a product (plan 0196,
 * section 3).
 *
 * What is asserted here is the boundary and not the SQL, as in
 * `list-holding-item.spec.ts`. The access test, what "holds" means, the cap
 * for each list and both orders live in Postgres, and
 * `list-item-lines.integration.spec.ts` proves them there. This file owns
 * what the service decides: the refusal, the cap on lists and its flag, what
 * staff hold, the order of the permissions, and how the lines meet their
 * lists.
 */

const CALLER = 'u-caller';
const ITEM = '11111111-2222-4333-8444-555555555555';

function list(
  n: number,
  extra: Partial<ReadableListRow> = {}
): ReadableListRow {
  return {
    listId: `l-${n}`,
    name: `List ${n}`,
    zoneId: 'z-1',
    zoneName: 'Flat 3B',
    autoApproveLines: false,
    staff: false,
    permissions: ['READ'],
    ...extra,
  };
}

function build(readable: ReadableListRow[], lines: LineHoldingItemRow[] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const lists = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (sql === READABLE_LISTS_WITH_PERMISSIONS_SQL) {
        // The service asks for one past the cap, and `LIMIT` is what trims.
        return readable.slice(0, params[1] as number);
      }
      if (sql === LINES_HOLDING_ITEM_SQL) {
        const asked = new Set(params[1] as string[]);
        return lines.filter((line) => asked.has(line.listId));
      }
      throw new Error(`unmocked query: ${sql.slice(0, 60)}`);
    },
  } as never;

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
    {} as never,
    fakeBasketAnnouncer()
  );

  return { service, calls };
}

describe('the lists and the lines that hold a product (plan 0196, section 3)', () => {
  it('puts each line under its list, and leaves a list with none empty', async () => {
    const { service } = build(
      [list(1), list(2)],
      [
        {
          id: 'li-1',
          listId: 'l-2',
          content: 'Milk',
          quantity: 2,
          approvalStatus: 'APPROVED',
        },
        {
          id: 'li-2',
          listId: 'l-2',
          content: 'More milk',
          quantity: 0,
          approvalStatus: 'PENDING',
        },
      ]
    );

    const result = await service.linesHoldingItem({
      userId: CALLER,
      itemId: ITEM,
    });

    expect(result).toEqual({
      lists: [
        {
          listId: 'l-1',
          name: 'List 1',
          zoneId: 'z-1',
          zoneName: 'Flat 3B',
          autoApproveLines: false,
          myPermissions: [ListPermission.READ],
          lines: [],
        },
        {
          listId: 'l-2',
          name: 'List 2',
          zoneId: 'z-1',
          zoneName: 'Flat 3B',
          autoApproveLines: false,
          myPermissions: [ListPermission.READ],
          lines: [
            {
              id: 'li-1',
              content: 'Milk',
              quantity: 2,
              approvalStatus: LineApprovalStatus.APPROVED,
            },
            {
              id: 'li-2',
              content: 'More milk',
              quantity: 0,
              approvalStatus: LineApprovalStatus.PENDING,
            },
          ],
        },
      ],
      hasMore: false,
    });
  });

  it('gives staff all four, whatever the row says', async () => {
    const { service } = build([list(1, { staff: true, permissions: [] })]);

    const result = await service.linesHoldingItem({
      userId: CALLER,
      itemId: ITEM,
    });

    expect(result.lists[0].myPermissions).toEqual([
      ListPermission.READ,
      ListPermission.WRITE,
      ListPermission.DECIDE,
      ListPermission.MANAGE,
    ]);
  });

  it('answers a stored set in the order ListView uses', async () => {
    const { service } = build([
      list(1, { permissions: ['DECIDE', 'WRITE', 'READ'] }),
    ]);

    const result = await service.linesHoldingItem({
      userId: CALLER,
      itemId: ITEM,
    });

    expect(result.lists[0].myPermissions).toEqual([
      ListPermission.READ,
      ListPermission.WRITE,
      ListPermission.DECIDE,
    ]);
  });

  it('caps the lists, says the cap cut, and reads lines for the kept lists alone', async () => {
    const cap = LISTS_WITH_ITEM_LINES_LIMITS.maxLists;
    const { service, calls } = build(
      Array.from({ length: cap + 5 }, (_, index) => list(index))
    );

    const result = await service.linesHoldingItem({
      userId: CALLER,
      itemId: ITEM,
    });

    expect(result.lists).toHaveLength(cap);
    expect(result.hasMore).toBe(true);
    // One row past the cap, so the flag costs no second read.
    expect(calls[0].params).toEqual([CALLER, cap + 1]);
    expect(calls[1].params[0]).toBe(ITEM);
    expect(calls[1].params[1]).toHaveLength(cap);
    expect(calls[1].params[2]).toBe(
      LISTS_WITH_ITEM_LINES_LIMITS.maxLinesPerList
    );
  });

  it('does not claim there is more when the answer is exactly the cap', async () => {
    const cap = LISTS_WITH_ITEM_LINES_LIMITS.maxLists;
    const { service } = build(Array.from({ length: cap }, (_, i) => list(i)));

    expect(
      (await service.linesHoldingItem({ userId: CALLER, itemId: ITEM })).hasMore
    ).toBe(false);
  });

  it('reads no line for a caller who reads no list', async () => {
    const { service, calls } = build([]);

    const result = await service.linesHoldingItem({
      userId: CALLER,
      itemId: ITEM,
    });

    expect(result).toEqual({ lists: [], hasMore: false });
    expect(calls.map((call) => call.sql)).toEqual([
      READABLE_LISTS_WITH_PERMISSIONS_SQL,
    ]);
  });

  it('refuses an id that is not an item reference, before any read', async () => {
    const { service, calls } = build([list(1)]);

    await expect(
      service.linesHoldingItem({ userId: CALLER, itemId: 'milk' })
    ).rejects.toBeInstanceOf(ValidationException);
    await expect(
      service.linesHoldingItem({ userId: CALLER, itemId: '' })
    ).rejects.toBeInstanceOf(ValidationException);
    expect(calls).toEqual([]);
  });
});
