import {
  LineApprovalStatus,
  ListPermission,
  RealtimeEvent,
  ZoneRole,
  type ListCounts,
} from '@portfolio/luna-shopper/contracts';
import type { ListLine, ShoppingList } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { ZoneAuthzService } from '../zones/zone-authz.service';
import { LIST_COUNTS_COLUMN, LIST_COUNTS_SQL } from '../zones/zone-summary.sql';
import type { ListAccessService } from './list-access.service';
import { EMPTY_LIST_COUNTS, toLineView, toListView } from './list.mappers';
import { ListService } from './list.service';
import { SharedListGrantService } from './shared-list-grant.service';

/**
 * List and line counts (plan 0017, sections 3.4 and 4.2), plus the timestamps
 * of section 7.
 */

const LIST = {
  id: 'l1',
  zoneId: 'z1',
  name: 'Groceries',
  createdByUserId: 'u1',
  autoApproveLines: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-02-01T00:00:00.000Z'),
} as ShoppingList;

/** What the caller may do, for the mapper cases that are not about it. */
const READ_ONLY = new Set([ListPermission.READ]);

describe('list mappers (plan 0017, sections 3.4 and 7)', () => {
  it('carries the counts it was given and ISO 8601 timestamps', () => {
    const counts: ListCounts = { lineCount: 12, wantedCount: 7 };
    const view = toListView(LIST, counts, READ_ONLY);

    expect(view.counts).toEqual(counts);
    expect(view.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(view.updatedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('names its fields the same as the zone preview does', () => {
    // Deliberate: the frontend maps one shape whichever endpoint it came from.
    expect(
      Object.keys(toListView(LIST, EMPTY_LIST_COUNTS, READ_ONLY).counts).sort()
    ).toEqual(['lineCount', 'wantedCount']);
  });

  it('stamps a line view too', () => {
    const line = {
      id: 'li1',
      listId: 'l1',
      content: 'Milk',
      quantity: 1,
      itemSetHash: null,
      position: 1,
      approvalStatus: LineApprovalStatus.PENDING,
      createdByUserId: 'u1',
      approvedByUserId: null,
      version: 1,
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-02T00:00:00.000Z'),
    } as ListLine;

    const view = toLineView(line, []);
    expect(view.createdAt).toBe('2026-03-01T00:00:00.000Z');
    expect(view.updatedAt).toBe('2026-03-02T00:00:00.000Z');
    // A free text line, which is what most lines are: an empty set and a null
    // hash, said out loud rather than left absent (plan 0048, section 1.1).
    expect(view.itemIds).toEqual([]);
    expect(view.itemSetHash).toBeNull();
  });
});

describe('the line count aggregate (plan 0017, section 4.2)', () => {
  it('counts what is wanted, and ignores approvalStatus entirely', () => {
    // Plan 0047, section 2.3: the second count was "how many are ready", which
    // is a fact about somebody's shopping trip. "Four things needed" is the
    // number a card has always wanted to show. Moderation is still no part of
    // it: a line awaiting approval is still something the household wants.
    expect(LIST_COUNTS_SQL).toContain(`ll."quantity" > 0`);
    expect(LIST_COUNTS_SQL).not.toContain('approvalStatus');
  });

  it('counts lines rather than units', () => {
    // Section 9's open decision, settled: "4 things needed" is legible on a card
    // and "17 units needed" is not.
    expect(LIST_COUNTS_SQL).toContain(
      `count(*) FILTER (WHERE ll."quantity" > 0)`
    );
    expect(LIST_COUNTS_SQL).not.toContain('sum(');
  });

  it('counts every line for lineCount, whatever it holds', () => {
    expect(LIST_COUNTS_SQL).toContain(`'lineCount', count(*)`);
  });
});

function build(rows: ShoppingList[], counts: ListCounts) {
  const raw = rows.map((l) => ({ l_id: l.id, [LIST_COUNTS_COLUMN]: counts }));
  const qb: Record<string, unknown> = {};
  for (const method of [
    'addSelect',
    'where',
    'andWhere',
    'take',
    'orderBy',
    'addOrderBy',
  ]) {
    qb[method] = jest.fn(() => qb);
  }
  qb['getRawAndEntities'] = jest.fn(async () => ({ entities: rows, raw }));

  const lists = { createQueryBuilder: jest.fn(() => qb), delete: jest.fn() };
  // The caller's own permissions ride every ListView (plan 0036, section 7), and
  // for a non-staff caller they come from one extra query over the page's ids.
  const access = {
    find: jest.fn(async () =>
      rows.map((l) => ({
        listId: l.id,
        permissions: [ListPermission.READ, ListPermission.WRITE],
      }))
    ),
  };
  const authz = {
    requireApproved: jest.fn(async () => ({
      id: 'm1',
      role: ZoneRole.MEMBER,
    })),
  } as unknown as ZoneAuthzService;
  const listAccess = {
    requireManage: jest.fn(async () => LIST),
  } as unknown as ListAccessService;
  const zoneCounts = { emitZoneCounts: jest.fn(async () => undefined) };
  const events = { emit: jest.fn() } as unknown as CoreEventsPublisher;

  const svc = new ListService(
    {} as never,
    lists as never,
    access as never,
    authz,
    listAccess,
    new SharedListGrantService(),
    zoneCounts as never,
    events
  );
  return { svc, qb, lists, access, authz, zoneCounts, events };
}

describe('ListService.list', () => {
  it('attaches the counts to the listing query rather than fetching per row', async () => {
    const { svc, qb } = build([LIST], { lineCount: 12, wantedCount: 7 });

    const page = await svc.list({ userId: 'u1', zoneId: 'z1' });

    expect(qb['addSelect']).toHaveBeenCalledWith(
      LIST_COUNTS_SQL,
      LIST_COUNTS_COLUMN
    );
    // One round trip for the whole page, whatever its size.
    expect(qb['getRawAndEntities']).toHaveBeenCalledTimes(1);
    expect(page.items[0].counts).toEqual({ lineCount: 12, wantedCount: 7 });
  });

  it('fills myPermissions from one extra query for the whole page', async () => {
    // Plan 0036, section 7. It is per caller data on every row, which is exactly
    // the shape that becomes an N+1 if each row asks for it. The membership was
    // resolved once before the listing query, and the caller's access rows for
    // the page's ids are one more read whatever the page size.
    const { svc, access, authz } = build(
      [LIST, { ...LIST, id: 'l2' } as ShoppingList],
      EMPTY_LIST_COUNTS
    );

    const page = await svc.list({ userId: 'u1', zoneId: 'z1' });

    expect((authz.requireApproved as jest.Mock).mock.calls).toHaveLength(1);
    expect(access.find).toHaveBeenCalledTimes(1);
    expect(page.items[0].myPermissions).toEqual([
      ListPermission.READ,
      ListPermission.WRITE,
    ]);
  });

  it('gives a group admin all four with no access query at all', async () => {
    const { svc, access, authz } = build([LIST], EMPTY_LIST_COUNTS);
    (authz.requireApproved as jest.Mock).mockResolvedValue({
      id: 'm1',
      role: ZoneRole.ADMIN,
    });

    const page = await svc.list({ userId: 'u1', zoneId: 'z1' });

    expect(access.find).not.toHaveBeenCalled();
    expect(page.items[0].myPermissions).toEqual([
      ListPermission.READ,
      ListPermission.WRITE,
      ListPermission.DECIDE,
      ListPermission.MANAGE,
    ]);
  });

  it('falls back to zeroes rather than crashing on a missing raw row', async () => {
    const { svc, qb } = build([LIST], { lineCount: 5, wantedCount: 1 });
    (qb['getRawAndEntities'] as jest.Mock).mockResolvedValueOnce({
      entities: [LIST],
      raw: [],
    });

    const page = await svc.list({ userId: 'u1', zoneId: 'z1' });

    expect(page.items[0].counts).toEqual(EMPTY_LIST_COUNTS);
  });
});

describe('ListService republishes the zone counts (plan 0017, section 9)', () => {
  it('on delete, because the zone lost a list', async () => {
    const { svc, zoneCounts, events } = build([LIST], EMPTY_LIST_COUNTS);

    await svc.delete({ userId: 'u1', listId: 'l1' });

    expect((events.emit as jest.Mock).mock.calls.map((c) => c[0])).toContain(
      RealtimeEvent.ListDeleted
    );
    expect(zoneCounts.emitZoneCounts).toHaveBeenCalledWith('z1');
  });
});
