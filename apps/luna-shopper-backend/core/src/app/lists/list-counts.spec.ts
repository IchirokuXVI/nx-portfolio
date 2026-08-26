import {
  LineApprovalStatus,
  LineStatus,
  RealtimeEvent,
  ZoneRole,
  type ListCounts,
} from '@portfolio/luna-shopper/contracts';
import type { ListLine, ShoppingList } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { ZoneAuthzService } from '../zones/zone-authz.service';
import {
  LIST_COUNTS_COLUMN,
  LIST_COUNTS_SQL,
} from '../zones/zone-summary.sql';
import type { ListAccessService } from './list-access.service';
import { EMPTY_LIST_COUNTS, toLineView, toListView } from './list.mappers';
import { ListService } from './list.service';

/**
 * List and line counts (plan 0017, sections 3.4 and 4.2), plus the timestamps
 * of section 7.
 */

const LIST = {
  id: 'l1',
  zoneId: 'z1',
  name: 'Groceries',
  createdByUserId: 'u1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-02-01T00:00:00.000Z'),
} as ShoppingList;

describe('list mappers (plan 0017, sections 3.4 and 7)', () => {
  it('carries the counts it was given and ISO 8601 timestamps', () => {
    const counts: ListCounts = { lineCount: 12, readyCount: 7 };
    const view = toListView(LIST, counts);

    expect(view.counts).toEqual(counts);
    expect(view.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(view.updatedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('names its fields the same as the zone preview does', () => {
    // Deliberate: the frontend maps one shape whichever endpoint it came from.
    expect(Object.keys(toListView(LIST, EMPTY_LIST_COUNTS).counts).sort()).toEqual(
      ['lineCount', 'readyCount']
    );
  });

  it('stamps a line view too', () => {
    const line = {
      id: 'li1',
      listId: 'l1',
      content: 'Milk',
      quantity: 1,
      itemId: null,
      position: 1,
      approvalStatus: LineApprovalStatus.PENDING,
      status: LineStatus.READY,
      createdByUserId: 'u1',
      approvedByUserId: null,
      version: 1,
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-02T00:00:00.000Z'),
    } as ListLine;

    const view = toLineView(line);
    expect(view.createdAt).toBe('2026-03-01T00:00:00.000Z');
    expect(view.updatedAt).toBe('2026-03-02T00:00:00.000Z');
  });
});

describe('the line count aggregate (plan 0017, section 4.2)', () => {
  it('counts READY only, and ignores approvalStatus entirely', () => {
    // The two state machines are independent by 0007's design, and the mock's
    // "7 of 12 ready" is about shopping progress, not moderation.
    expect(LIST_COUNTS_SQL).toContain(`ll.status = 'READY'`);
    expect(LIST_COUNTS_SQL).not.toContain('approvalStatus');
  });

  it('counts every line for lineCount, whatever its status', () => {
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
    {} as never,
    authz,
    listAccess,
    zoneCounts as never,
    events
  );
  return { svc, qb, lists, zoneCounts, events };
}

describe('ListService.list', () => {
  it('attaches the counts to the listing query rather than fetching per row', async () => {
    const { svc, qb } = build([LIST], { lineCount: 12, readyCount: 7 });

    const page = await svc.list({ userId: 'u1', zoneId: 'z1' });

    expect(qb['addSelect']).toHaveBeenCalledWith(
      LIST_COUNTS_SQL,
      LIST_COUNTS_COLUMN
    );
    // One round trip for the whole page, whatever its size.
    expect(qb['getRawAndEntities']).toHaveBeenCalledTimes(1);
    expect(page.items[0].counts).toEqual({ lineCount: 12, readyCount: 7 });
  });

  it('falls back to zeroes rather than crashing on a missing raw row', async () => {
    const { svc, qb } = build([LIST], { lineCount: 5, readyCount: 1 });
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

    expect(
      (events.emit as jest.Mock).mock.calls.map((c) => c[0])
    ).toContain(RealtimeEvent.ListDeleted);
    expect(zoneCounts.emitZoneCounts).toHaveBeenCalledWith('z1');
  });
});
