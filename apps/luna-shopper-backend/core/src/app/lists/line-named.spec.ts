import {
  LineApprovalStatus,
  LineItemSource,
  ListPermission,
  MembershipStatus,
  NO_LINE_CLAIM,
  NO_LINE_SETTLEMENTS,
  RealtimeEvent,
  ZoneRole,
  type LineView,
} from '@portfolio/luna-shopper/contracts';
import { ForbiddenException } from '@portfolio/luna-shopper/platform';
import type { DataSource, EntityManager } from 'typeorm';
import { fakeBasketAnnouncer } from '../baskets/basket-announcer.fake';
import { fakeLineClaims } from '../baskets/line-claims.fake';
import {
  LineSettlement,
  ListLineGroupRemoval,
  ListLineItem,
  type ListAccess,
  type ListLine,
  type ShoppingList,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { fakeLineChanges } from './changes/line-change.fake';
import { itemSetHash } from './item-set-hash';
import { lineItemSetOf } from './line-item-set';
import { fakeGroupRemovals, fakeLineItems } from './line-items.fake';
import { LineMergeService } from './line-merge.service';
import {
  mergedNamed,
  namedAfterEdit,
  namedOnAdd,
  namedOverSet,
} from './line-named';
import { fakeLineSettlements } from './line-settlements.fake';
import { LineService } from './line.service';
import { ListAccessService } from './list-access.service';
import { toLineView } from './list.mappers';

/**
 * A line says whether a person named it (plan 0207, section 1).
 *
 * The two rules of section 1.2 as functions, and then as `LineService` applies
 * them on an add, a batch add and an edit. A rename that collides, the sync of
 * a product group, the rename of a basket row, the basket add and what Postgres
 * stores are in `line-named.integration.spec.ts`: each of them needs a second
 * row or a real transaction, and a fake that answers one line proves neither.
 */

describe('the rules of the flag (plan 0207, section 1.2)', () => {
  describe('an add', () => {
    it('is named when the request says nothing', () => {
      expect(namedOnAdd(undefined, true)).toBe(true);
      expect(namedOnAdd(undefined, false)).toBe(true);
    });

    it('keeps false on a line that holds a product', () => {
      expect(namedOnAdd(false, true)).toBe(false);
    });

    it('is named on a line with no product, whatever the request says (rule 1)', () => {
      expect(namedOnAdd(false, false)).toBe(true);
    });

    it('reads a null as an absent flag', () => {
      expect(namedOnAdd(null as never, true)).toBe(true);
    });
  });

  describe('an edit', () => {
    it('names the line on a content with no flag (rule 2)', () => {
      expect(namedAfterEdit(false, { content: 'Milk' }, true)).toBe(true);
    });

    it('takes the name away on false beside a content', () => {
      expect(
        namedAfterEdit(true, { content: 'Whole milk', named: false }, true)
      ).toBe(false);
    });

    it('changes the flag alone on false alone', () => {
      expect(namedAfterEdit(true, { named: false }, true)).toBe(false);
      expect(namedAfterEdit(false, { named: true }, true)).toBe(true);
    });

    it('leaves the flag on an edit that names neither', () => {
      expect(namedAfterEdit(false, {}, true)).toBe(false);
      expect(namedAfterEdit(true, {}, true)).toBe(true);
    });

    it('is named on a line the edit leaves with no product, whatever it says (rule 1)', () => {
      expect(namedAfterEdit(false, {}, false)).toBe(true);
      expect(namedAfterEdit(false, { named: false }, false)).toBe(true);
      expect(
        namedAfterEdit(true, { content: 'Milk', named: false }, false)
      ).toBe(true);
    });

    it('reads a null as an absent flag and never answers it', () => {
      expect(namedAfterEdit(false, { named: null as never }, true)).toBe(false);
      expect(
        namedAfterEdit(false, { content: 'Milk', named: null as never }, true)
      ).toBe(true);
    });
  });

  it('names a line whose products a group took away, and leaves the others', () => {
    expect(namedOverSet(false, false)).toBe(true);
    expect(namedOverSet(false, true)).toBe(false);
    expect(namedOverSet(true, true)).toBe(true);
  });

  it('names the survivor of a merge when either line is named', () => {
    expect(mergedNamed({ named: false }, { named: false })).toBe(false);
    expect(mergedNamed({ named: true }, { named: false })).toBe(true);
    expect(mergedNamed({ named: false }, { named: true })).toBe(true);
  });
});

describe('toLineView carries the flag (plan 0207, section 1.5)', () => {
  const row = {
    id: 'li1',
    listId: 'l1',
    content: 'Milk',
    quantity: 1,
    itemSetHash: null,
    productGroupId: null,
    position: 1,
    approvalStatus: LineApprovalStatus.PENDING,
    createdByUserId: 'u1',
    approvedByUserId: null,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const view = (line: object) =>
    toLineView(
      line as ListLine,
      lineItemSetOf([]),
      NO_LINE_SETTLEMENTS,
      NO_LINE_CLAIM
    );

  it('answers what the row says', () => {
    expect(view({ ...row, named: false }).named).toBe(false);
    expect(view({ ...row, named: true }).named).toBe(true);
  });

  it('answers true, the default of the column, for a row built with no flag', () => {
    expect(view(row).named).toBe(true);
  });
});

const LIST_ID = 'l1';
const ZONE_ID = 'z1';
const ACTOR = 'u-actor';
const LINE_ID = 'li1';

/** Deterministic UUIDs, because the service checks the shape of every id. */
function itemId(n: number): string {
  return `3f1a0c5e-2b7d-4a6f-8c91-${String(n).padStart(12, '0')}`;
}

interface Options {
  items?: string[];
  named?: boolean;
  approvalStatus?: LineApprovalStatus;
  permissions?: ListPermission[];
  /** How many comments the count of the lines read finds on the line. */
  comments?: number;
}

const EVERYTHING = [
  ListPermission.READ,
  ListPermission.WRITE,
  ListPermission.DECIDE,
  ListPermission.MANAGE,
];

/**
 * One list that holds one line, `Milk`. The harness of
 * `line-favorite-and-supermarket.spec.ts`: an add here always creates, because
 * the read of the list answers no line.
 */
function build(options: Options = {}) {
  const list = {
    id: LIST_ID,
    zoneId: ZONE_ID,
    name: 'Groceries',
    createdByUserId: ACTOR,
    autoApproveLines: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as ShoppingList;

  const seeded = options.items ?? [];
  const line = {
    id: LINE_ID,
    listId: LIST_ID,
    content: 'Milk',
    named: options.named ?? true,
    quantity: 1,
    itemSetHash: itemSetHash(seeded),
    productGroupId: null,
    favoriteItemId: null,
    preferredSupermarketId: null,
    position: 10,
    approvalStatus: options.approvalStatus ?? LineApprovalStatus.PENDING,
    createdByUserId: ACTOR,
    approvedByUserId: null,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  } as ListLine;

  const saved: Partial<ListLine>[] = [];
  const events: { event: RealtimeEvent; line: LineView }[] = [];
  let created = 0;

  const lineRepo = {
    findOne: async () => line,
    find: async () => [],
    create: (data: Partial<ListLine>) => ({ ...data }),
    save: async (row: Partial<ListLine>) => {
      const stored = {
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        ...row,
        id: row.id ?? `li-new-${(created += 1)}`,
      };
      saved.push(stored);
      return stored;
    },
    createQueryBuilder: () => {
      const qb = {
        select: () => qb,
        where: () => qb,
        andWhere: () => qb,
        take: () => qb,
        orderBy: () => qb,
        addOrderBy: () => qb,
        getRawOne: async () => ({ max: 10 }),
        // The lines read (plan 0214), which answers the one line of the list.
        getMany: async () => [{ ...line }],
      };
      return qb;
    },
  };

  const listAccess = new ListAccessService(
    { findOne: async () => list } as never,
    {
      findOne: async () =>
        ({
          id: 'a1',
          listId: LIST_ID,
          membershipId: 'm1',
          permissions: options.permissions ?? EVERYTHING,
        }) as ListAccess,
    } as never,
    lineRepo as never,
    new ZoneAuthzService({
      findOne: async () =>
        ({
          id: 'm1',
          zoneId: ZONE_ID,
          userId: ACTOR,
          role: ZoneRole.MEMBER,
          status: MembershipStatus.APPROVED,
        }) as never,
    } as never)
  );

  const lineItems = fakeLineItems(
    seeded.map((id, position) => ({
      lineId: LINE_ID,
      itemId: id,
      position,
      source: LineItemSource.USER,
    }))
  );
  const groupRemovals = fakeGroupRemovals();
  const settlements = fakeLineSettlements();

  // The raw reads of a page (plan 0214, section 2): the comment count answers
  // what `options.comments` says, and the settlement summary answers nothing.
  const queries: { sql: string; parameters: unknown[] }[] = [];
  const dataSource = {
    query: async (sql: string, parameters: unknown[]) => {
      queries.push({ sql, parameters });
      if (sql.includes('"line_comments"')) {
        return options.comments === undefined
          ? []
          : [{ lineId: LINE_ID, count: options.comments }];
      }
      return [];
    },
    transaction: async <T>(run: (m: EntityManager) => Promise<T>) =>
      run({
        getRepository: (entity: unknown) => {
          if (entity === ListLineItem) {
            return lineItems.repo;
          }
          if (entity === ListLineGroupRemoval) {
            return groupRemovals.repo;
          }
          if (entity === LineSettlement) {
            return settlements.repo;
          }
          return lineRepo;
        },
      } as unknown as EntityManager),
  } as unknown as DataSource;

  const changes = fakeLineChanges();
  const service = new LineService(
    dataSource,
    lineRepo as never,
    lineItems.repo as never,
    groupRemovals.repo as never,
    settlements.repo as never,
    listAccess,
    fakeLineClaims().service,
    {
      emit: (event: RealtimeEvent, _zoneId: string, payload: LineView) =>
        events.push({ event, line: payload }),
    } as unknown as CoreEventsPublisher,
    {} as never,
    new LineMergeService(changes.recorder),
    changes.recorder,
    fakeBasketAnnouncer()
  );

  const add = (
    fields: Omit<Parameters<LineService['add']>[0], 'userId' | 'listId'>
  ) => service.add({ userId: ACTOR, listId: LIST_ID, ...fields });
  const update = (
    fields: Omit<Parameters<LineService['update']>[0], 'userId' | 'lineId'>
  ) => service.update({ userId: ACTOR, lineId: LINE_ID, ...fields });

  const read = () => service.list({ userId: ACTOR, listId: LIST_ID });

  return { service, add, update, read, saved, events, queries };
}

describe('LineService.add writes the flag (plan 0207, section 1.3)', () => {
  it('names a line when the request says nothing, with a product or with none', async () => {
    const w = build();

    const typed = await w.add({ content: 'Bread' });
    const picked = await w.add({ content: 'Oat drink', itemIds: [itemId(1)] });

    expect(typed.line.named).toBe(true);
    expect(picked.line.named).toBe(true);
    expect(w.saved.map((row) => row.named)).toEqual([true, true]);
  });

  it('keeps false on a line made from a product, and tells the room', async () => {
    const w = build();

    const { line } = await w.add({
      content: 'Oat drink',
      itemIds: [itemId(1)],
      named: false,
    });

    expect(line).toMatchObject({ content: 'Oat drink', named: false });
    expect(w.saved[0].named).toBe(false);
    expect(w.events).toEqual([
      { event: RealtimeEvent.LineAdded, line: expect.objectContaining(line) },
    ]);
  });

  it('names a line with no product although the request says false (rule 1)', async () => {
    const w = build();

    const absent = await w.add({ content: 'Bread', named: false });
    const empty = await w.add({ content: 'Eggs', itemIds: [], named: false });

    expect(absent.line.named).toBe(true);
    expect(empty.line.named).toBe(true);
  });
});

describe('LineService.addMany writes the flag of each item (plan 0207, section 1.3)', () => {
  it('decides each item by itself', async () => {
    const w = build();

    const results = await w.service.addMany({
      userId: ACTOR,
      listId: LIST_ID,
      items: [
        { content: 'Bread' },
        { content: 'Oat drink', itemIds: [itemId(1)], named: false },
        { content: 'Eggs', named: false },
        { content: 'Whole milk', itemIds: [itemId(2)], named: true },
      ],
    });

    expect(results.map((result) => result.line.named)).toEqual([
      true,
      false,
      true,
      true,
    ]);
    expect(w.saved.map((row) => row.named)).toEqual([true, false, true, true]);
  });

  it('folds two unnamed items of one product into one line, whatever their names', async () => {
    // Since plan 0214 a line that is not named is met by its products alone,
    // so two items fold only when their flags agree, and the line keeps it.
    const w = build();

    const results = await w.service.addMany({
      userId: ACTOR,
      listId: LIST_ID,
      items: [
        { content: 'Oat drink', itemIds: [itemId(1)], named: false },
        { content: 'Bebida de avena', itemIds: [itemId(1)], named: false },
      ],
    });

    expect(w.saved).toHaveLength(1);
    expect(results.map((result) => result.line.named)).toEqual([false, false]);
    expect(results[0].line).toMatchObject({
      content: 'Oat drink',
      quantity: 2,
    });
  });

  it('keeps a named item apart from an unnamed one of the same product (plan 0214)', async () => {
    const w = build();

    const results = await w.service.addMany({
      userId: ACTOR,
      listId: LIST_ID,
      items: [
        { content: 'Oat drink', itemIds: [itemId(1)], named: false },
        { content: 'oat drink', itemIds: [itemId(1)] },
      ],
    });

    expect(w.saved).toHaveLength(2);
    expect(results.map((result) => result.line.named)).toEqual([false, true]);
  });
});

describe('the lines read counts the comments of each line (plan 0214, section 2)', () => {
  it('answers the count the batched query finds', async () => {
    const w = build({ comments: 2 });

    const page = await w.read();

    expect(page.items.map((item) => [item.id, item.commentCount])).toEqual([
      [LINE_ID, 2],
    ]);
    const counts = w.queries.filter((q) => q.sql.includes('"line_comments"'));
    expect(counts).toHaveLength(1);
    expect(counts[0].sql).toContain('GROUP BY');
    expect(counts[0].parameters).toEqual([[LINE_ID]]);
  });

  it('answers 0 for a line with no comment, and never null', async () => {
    const w = build();

    const page = await w.read();

    expect(page.items[0].commentCount).toBe(0);
  });

  it('answers null on the payload of a write, which pays for no count', async () => {
    const w = build({ comments: 2 });

    const view = await w.update({ quantity: 3 });

    expect(view.commentCount).toBeNull();
    expect(w.events.map((e) => e.line.commentCount)).toEqual([null]);
    expect(w.queries.filter((q) => q.sql.includes('"line_comments"'))).toEqual(
      []
    );
  });
});

describe('LineService.update writes the flag (plan 0207, section 1.3)', () => {
  it('names the line on a content alone (rule 2), with or without a new name', async () => {
    const sameName = build({ items: [itemId(1)], named: false });
    const newName = build({ items: [itemId(1)], named: false });

    // A change of case does not take the path of a rename, and a new name does.
    const first = await sameName.update({ content: 'MILK' });
    const second = await newName.update({ content: 'The good milk' });

    expect(first).toMatchObject({ content: 'MILK', named: true });
    expect(second).toMatchObject({ content: 'The good milk', named: true });
  });

  it('takes the name away on false beside a content', async () => {
    const w = build({ items: [itemId(1)], named: true });

    const view = await w.update({ content: 'Whole milk 1 L', named: false });

    expect(view).toMatchObject({ content: 'Whole milk 1 L', named: false });
    expect(w.saved[0].named).toBe(false);
  });

  it('changes the flag and leaves the name on false alone', async () => {
    const w = build({ items: [itemId(1)], named: true });

    const view = await w.update({ named: false });

    expect(view).toMatchObject({ content: 'Milk', named: false, version: 2 });
    expect(w.events).toEqual([
      { event: RealtimeEvent.LineUpdated, line: view },
    ]);
  });

  it('leaves the flag on an edit that names neither the content nor the flag', async () => {
    const w = build({ items: [itemId(1)], named: false });

    expect((await w.update({ quantity: 4 })).named).toBe(false);
    expect((await w.update({ itemIds: [itemId(1), itemId(2)] })).named).toBe(
      false
    );
  });

  it('names a line whose products the edit takes away (rule 1), and keeps its name', async () => {
    const w = build({ items: [itemId(1)], named: false });

    const view = await w.update({ itemIds: [] });

    expect(view).toMatchObject({ content: 'Milk', named: true, itemIds: [] });
  });

  it('names a line with no product although the edit says false (rule 1)', async () => {
    const free = build({ named: true });
    const emptied = build({ items: [itemId(1)], named: true });

    expect((await free.update({ named: false })).named).toBe(true);
    expect((await emptied.update({ itemIds: [], named: false })).named).toBe(
      true
    );
  });

  it('keeps false when the same edit gives the line its first product', async () => {
    const w = build({ named: true });

    const view = await w.update({
      content: 'Oat drink',
      itemIds: [itemId(1)],
      named: false,
    });

    expect(view).toMatchObject({ content: 'Oat drink', named: false });
  });

  it('asks WRITE of an edit of the flag alone, as it does of a content', async () => {
    // DECIDE alone reaches the quantity of an approved line and nothing else.
    const w = build({
      items: [itemId(1)],
      approvalStatus: LineApprovalStatus.APPROVED,
      permissions: [ListPermission.READ, ListPermission.DECIDE],
    });

    await expect(w.update({ named: false })).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(w.saved).toHaveLength(0);
  });
});
