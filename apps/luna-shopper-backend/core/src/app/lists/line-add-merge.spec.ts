import {
  LINE_QUANTITY_MAX,
  LineApprovalStatus,
  LineItemSource,
  ListPermission,
  MembershipStatus,
  RealtimeEvent,
  SettlementOutcome,
  ZoneRole,
  type LineView,
} from '@portfolio/luna-shopper/contracts';
import type { DataSource, EntityManager } from 'typeorm';
import type { ListAccess, ShoppingList } from '../entities';
import {
  LineSettlement,
  ListLine,
  ListLineGroupRemoval,
  ListLineItem,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { fakeLineClaims } from '../generated-lists/line-claims.fake';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { fakeGroupRemovals, fakeLineItems } from './line-items.fake';
import { fakeLineSettlements } from './line-settlements.fake';
import { LineService } from './line.service';
import { ListAccessService } from './list-access.service';

/**
 * A zone list holds one line per normalized name (plan 0091).
 *
 * Somebody types "Milk" into a list that already has a Milk and the list gets a
 * second one, from the list page, from the assistant and from a basket sending a
 * line home. The household then has two quantities, two histories and two things
 * to delete for one thing they buy. So an add of a name the list already carries
 * raises that line and creates nothing.
 *
 * Two halves are asserted here and they are equally load bearing: **which line an
 * add lands on**, which is the fold and the rejected line it skips, and **what a
 * merge is allowed to change**, which is the quantity and nothing else. The
 * second is where the plan spends its argument, because a merge that also wrote
 * the request's products or reopened the line's approval would be a change
 * nobody asked for, made on the strength of a name.
 *
 * The one thing this file cannot prove is that two adds in the same second
 * produce one line, because a mocked repository has no row to lock. That is
 * `line-quantity-delta.integration.spec.ts`, against real Postgres.
 */

const LIST_ID = 'l1';
const ZONE_ID = 'z1';
const ADDER = 'u-adder';
const AUTHOR = 'u-author';

interface Seed {
  id: string;
  content: string;
  quantity?: number;
  position?: number;
  approvalStatus?: LineApprovalStatus;
  productGroupId?: string | null;
}

interface Harness {
  service: LineService;
  saved: Partial<ListLine>[];
  events: { event: RealtimeEvent; line: LineView }[];
  items: ReturnType<typeof fakeLineItems>;
}

function build(options: {
  /** What the list already holds. */
  holds?: Seed[];
  permissions?: ListPermission[];
  autoApproveLines?: boolean;
  /** Products already on a held line, which a merge must leave alone. */
  products?: { lineId: string; itemId: string; position: number }[];
  /** Purchases already recorded against a held line. */
  settled?: { lineId: string; quantity: number }[];
}): Harness {
  const list = {
    id: LIST_ID,
    zoneId: ZONE_ID,
    name: 'Groceries',
    createdByUserId: AUTHOR,
    autoApproveLines: options.autoApproveLines ?? false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as ShoppingList;

  const held = (options.holds ?? []).map(
    (seed, index) =>
      ({
        id: seed.id,
        listId: LIST_ID,
        content: seed.content,
        quantity: seed.quantity ?? 1,
        itemSetHash: null,
        productGroupId: seed.productGroupId ?? null,
        position: seed.position ?? index + 1,
        approvalStatus: seed.approvalStatus ?? LineApprovalStatus.APPROVED,
        createdByUserId: AUTHOR,
        approvedByUserId:
          (seed.approvalStatus ?? LineApprovalStatus.APPROVED) ===
          LineApprovalStatus.APPROVED
            ? AUTHOR
            : null,
        version: 4,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }) as ListLine
  );

  const saved: Partial<ListLine>[] = [];
  const events: { event: RealtimeEvent; line: LineView }[] = [];

  const lineRepo = {
    // By id, because a merge reads its target back whole and locked, and more
    // than one line is held in most cases here.
    findOne: async ({ where }: { where: { id: string } }) =>
      held.find((row) => row.id === where.id) ?? null,
    // What the add folds over to decide whether the name is already on the list.
    // By position, as the query asks for, which is what decides the target when
    // the list already holds two lines of one name.
    find: async () =>
      [...held]
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
        .map((row) => ({ ...row })),
    create: (data: Partial<ListLine>) => ({ ...data }),
    save: async (row: Partial<ListLine>) => {
      const stored = {
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        ...row,
        id: row.id ?? `li-new-${saved.length}`,
      } as ListLine;
      saved.push(stored);
      return stored;
    },
    createQueryBuilder: () => {
      const qb = {
        select: () => qb,
        where: () => qb,
        andWhere: () => qb,
        getRawOne: async () => ({
          max: held.reduce((max, row) => Math.max(max, row.position), 0),
        }),
      };
      return qb;
    },
  };

  const memberships = {
    findOne: async () =>
      ({
        id: 'm1',
        zoneId: ZONE_ID,
        userId: ADDER,
        role: ZoneRole.MEMBER,
        status: MembershipStatus.APPROVED,
      }) as never,
  };

  const accessRepo = {
    findOne: async () =>
      ({
        id: 'a1',
        listId: LIST_ID,
        membershipId: 'm1',
        permissions: options.permissions ?? [
          ListPermission.READ,
          ListPermission.WRITE,
        ],
      }) as ListAccess,
  };

  const listAccess = new ListAccessService(
    { findOne: async () => list } as never,
    accessRepo as never,
    lineRepo as never,
    new ZoneAuthzService(memberships as never)
  );

  const items = fakeLineItems(
    (options.products ?? []).map((row) => ({
      ...row,
      source: LineItemSource.USER,
    }))
  );
  const groupRemovals = fakeGroupRemovals();
  const settlements = fakeLineSettlements(
    (options.settled ?? []).map((row, index) => ({
      id: `s${index}`,
      lineId: row.lineId,
      listId: LIST_ID,
      quantity: row.quantity,
      outcome: SettlementOutcome.BOUGHT,
      settledByUserId: AUTHOR,
      settledAt: new Date('2026-01-02T00:00:00.000Z'),
      revertedAt: null,
    }))
  );

  const dataSource = {
    transaction: async <T>(run: (m: EntityManager) => Promise<T>) =>
      run({
        getRepository: (entity: unknown) => {
          if (entity === ListLineGroupRemoval) {
            return groupRemovals.repo;
          }
          if (entity === ListLineItem) {
            return items.repo;
          }
          if (entity === LineSettlement) {
            return settlements.repo;
          }
          if (entity === ListLine) {
            return lineRepo;
          }
          // The list's own row, which the add locks for the length of its
          // transaction so that two adds of one name cannot both create.
          return { findOne: async () => list };
        },
      } as unknown as EntityManager),
  } as unknown as DataSource;

  const publisher = {
    emit: (event: RealtimeEvent, _zoneId: string, payload: LineView) =>
      events.push({ event, line: payload }),
  } as unknown as CoreEventsPublisher;

  const service = new LineService(
    dataSource,
    lineRepo as never,
    items.repo as never,
    groupRemovals.repo as never,
    settlements.repo as never,
    listAccess,
    fakeLineClaims().service,
    publisher,
    {} as never
  );

  return { service, saved, events, items };
}

function add(
  harness: Harness,
  content: string,
  extra: { quantity?: number; itemIds?: string[]; productGroupId?: string } = {}
) {
  return harness.service.add({
    userId: ADDER,
    listId: LIST_ID,
    content,
    ...extra,
  });
}

describe('which line an add lands on (plan 0091, sections 1 and 3.1)', () => {
  it('raises the line already holding the name, and announces an update', async () => {
    const w = build({ holds: [{ id: 'li1', content: 'milk', quantity: 2 }] });

    const result = await add(w, 'Milk');

    expect(result.merged).toBe(true);
    expect(result.line.id).toBe('li1');
    expect(result.line.quantity).toBe(3);
    // `line.updated`, never `line.added`: a merge is the existing row moving, and
    // an `added` would put a second row in front of every client drawing it.
    expect(w.events.map((e) => e.event)).toEqual([RealtimeEvent.LineUpdated]);
    expect(w.events[0].line.id).toBe('li1');
  });

  it('folds case and accents, and nothing else', async () => {
    // "Jamón" and "jamon" are one name. "milk" and "whole milk" are two, because
    // merging two things somebody meant separately is the worse failure: it loses
    // a purchase silently, where a duplicate is visible and takes one gesture.
    const w = build({
      holds: [
        { id: 'li1', content: 'jamon', quantity: 1, position: 1 },
        { id: 'li2', content: 'milk', quantity: 1, position: 2 },
      ],
    });

    const jamon = await add(w, '  JAMÓN  ');
    const whole = await add(w, 'whole milk');

    expect(jamon.merged).toBe(true);
    expect(jamon.line.id).toBe('li1');
    expect(whole.merged).toBe(false);
    expect(whole.line.content).toBe('whole milk');
  });

  it('creates beside a rejected line rather than raising it', async () => {
    // A rejection is a decision the household made. Asking again is a new
    // request they get to decide again, and merging into the rejected line would
    // raise a quantity on a line the list will never buy.
    const w = build({
      holds: [
        {
          id: 'li1',
          content: 'milk',
          approvalStatus: LineApprovalStatus.REJECTED,
        },
      ],
    });

    const result = await add(w, 'Milk');

    expect(result.merged).toBe(false);
    expect(result.line.id).not.toBe('li1');
    expect(w.events.map((e) => e.event)).toEqual([RealtimeEvent.LineAdded]);
  });

  it('lands on the earliest of two duplicates the list already held', async () => {
    // Plan 0091 section 5 migrates nothing: summing two existing lines would have
    // to pick a survivor and take the loser's settlements, comments and products
    // with it. So the next add lands on the earliest and the household deletes
    // the other when it notices.
    const w = build({
      holds: [
        { id: 'li-late', content: 'Milk', quantity: 1, position: 9 },
        { id: 'li-early', content: 'milk', quantity: 1, position: 2 },
      ],
    });

    const result = await add(w, 'MILK');

    expect(result.line.id).toBe('li-early');
  });
});

describe('what a merge may change (plan 0091, section 3)', () => {
  it('keeps the line pending, and does not ask for approval again', async () => {
    // Plan 0047 section 7: a quantity change never re-triggers approval. Asking
    // for more of a thing has not changed what the household agreed to.
    const w = build({
      holds: [
        {
          id: 'li1',
          content: 'milk',
          quantity: 1,
          approvalStatus: LineApprovalStatus.PENDING,
        },
      ],
    });

    const result = await add(w, 'milk');

    expect(result.line.approvalStatus).toBe(LineApprovalStatus.PENDING);
    expect(result.line.quantity).toBe(2);
  });

  it('lets a plain writer raise an approved line, which an edit would refuse', async () => {
    // The add is authorized as an add. Routing the raise through the edit check
    // instead would refuse a writer adding milk to a list whose Milk is approved,
    // for a reason no screen could explain: they did not ask to change a number.
    const w = build({
      holds: [
        {
          id: 'li1',
          content: 'milk',
          quantity: 1,
          approvalStatus: LineApprovalStatus.APPROVED,
        },
      ],
      permissions: [ListPermission.READ, ListPermission.WRITE],
    });

    const result = await add(w, 'milk', { quantity: 4 });

    expect(result.line.approvalStatus).toBe(LineApprovalStatus.APPROVED);
    expect(result.line.approvedByUserId).toBe(AUTHOR);
    expect(result.line.quantity).toBe(5);
  });

  it('ignores the products and the group the request named', async () => {
    // Somebody who types "milk" onto a list whose Milk names two products has
    // said nothing about products, and writing the request's set over the line's
    // would put products into a household's list on the strength of a name.
    const w = build({
      holds: [{ id: 'li1', content: 'milk', productGroupId: null }],
      products: [
        { lineId: 'li1', itemId: 'item-a', position: 0 },
        { lineId: 'li1', itemId: 'item-b', position: 1 },
      ],
    });

    const result = await add(w, 'milk', {
      itemIds: ['3f1a0c5e-2b7d-4a6f-8c91-000000000001'],
      productGroupId: '7c2b4d1a-8e35-4f90-b6a2-1d4c7e9b0f52',
    });

    expect(result.line.itemIds).toEqual(['item-a', 'item-b']);
    expect(result.line.productGroupId).toBeNull();
    expect(w.items.rows.map((row) => row.itemId)).toEqual(['item-a', 'item-b']);
  });

  it('raises a line at zero back off it, keeping what was bought', async () => {
    // Plan 0047 section 2.2: zero is "known about, not currently wanted", and a
    // line drawn as bought is a line whose purchases cover its quantity. Raising
    // it wants some again, and the count of what was bought is untouched, so the
    // indicator clears itself where it is drawn rather than being cleared here.
    const w = build({
      holds: [{ id: 'li1', content: 'milk', quantity: 0 }],
      settled: [{ lineId: 'li1', quantity: 2 }],
    });

    const result = await add(w, 'Milk', { quantity: 2 });

    expect(result.line.quantity).toBe(2);
    // One purchase still standing, reported exactly as a read would report it.
    expect(result.line.boughtCount).toBe(1);
    expect(result.line.lastSettlementOutcome).toBe(SettlementOutcome.BOUGHT);
  });

  it('holds the quantity under the ceiling instead of refusing the add', async () => {
    // An add is a request for a thing rather than a request to write a number, so
    // an arithmetic result the caller never named is not theirs to be refused
    // over.
    const w = build({
      holds: [{ id: 'li1', content: 'milk', quantity: LINE_QUANTITY_MAX }],
    });

    const result = await add(w, 'milk', { quantity: 5 });

    expect(result.line.quantity).toBe(LINE_QUANTITY_MAX);
  });

  it('bumps the version, as every quantity write does', async () => {
    const w = build({ holds: [{ id: 'li1', content: 'milk', quantity: 1 }] });

    const result = await add(w, 'milk');

    expect(result.line.version).toBe(5);
  });
});

describe('an add that creates still creates (plan 0091, section 4)', () => {
  it('says so, and announces the new line', async () => {
    const w = build({ holds: [{ id: 'li1', content: 'bread', position: 3 }] });

    const result = await add(w, 'Milk', { quantity: 2 });

    expect(result.merged).toBe(false);
    expect(result.line.content).toBe('Milk');
    expect(result.line.quantity).toBe(2);
    expect(result.line.position).toBe(4);
    expect(w.events.map((e) => e.event)).toEqual([RealtimeEvent.LineAdded]);
  });

  it('refuses a quantity outside the bounds before it looks for a match', async () => {
    const w = build({ holds: [{ id: 'li1', content: 'milk' }] });

    await expect(add(w, 'milk', { quantity: -1 })).rejects.toThrow(
      /at least 0/
    );
    expect(w.saved).toHaveLength(0);
    expect(w.events).toHaveLength(0);
  });

  it('refuses a caller who cannot write the list', async () => {
    const w = build({
      holds: [{ id: 'li1', content: 'milk' }],
      permissions: [ListPermission.READ],
    });

    await expect(add(w, 'milk')).rejects.toThrow(/write access/);
    expect(w.saved).toHaveLength(0);
  });
});
