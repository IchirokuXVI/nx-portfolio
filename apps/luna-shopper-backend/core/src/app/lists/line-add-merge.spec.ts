import {
  LINE_ADD_CHOICE_MAX,
  LINE_QUANTITY_MAX,
  LineApprovalStatus,
  LineItemSource,
  ListPermission,
  MembershipStatus,
  RealtimeEvent,
  SettlementOutcome,
  ZoneRole,
  type LineAddNeedsChoiceDetails,
  type LineView,
} from '@portfolio/luna-shopper/contracts';
import {
  ERROR_CODES,
  LineAddNeedsChoiceException,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type { DataSource, EntityManager } from 'typeorm';
import { fakeBasketAnnouncer } from '../baskets/basket-announcer.fake';
import { fakeLineClaims } from '../baskets/line-claims.fake';
import type { ListAccess, ShoppingList } from '../entities';
import {
  LineSettlement,
  ListLine,
  ListLineGroupRemoval,
  ListLineItem,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { fakeLineChanges } from './changes/line-change.fake';
import { itemSetHash } from './item-set-hash';
import { fakeGroupRemovals, fakeLineItems } from './line-items.fake';
import { LineMergeService } from './line-merge.service';
import { fakeLineSettlements } from './line-settlements.fake';
import { LineService } from './line.service';
import { ListAccessService } from './list-access.service';

/**
 * Plan 0139 gave this service a basket announcer, and the last describe in this
 * file is what it announces. Fresh per test, because the assertions there are
 * about how many announcements one write makes.
 */
let announcer = fakeBasketAnnouncer();
beforeEach(() => {
  announcer = fakeBasketAnnouncer();
});

/**
 * A zone list holds one line per name and product combination (plan 0091, and
 * the rule under "a name shared by two products is two lines" below).
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

/** Two products that share the name "Milk", and two groups a line may follow. */
const WHOLE = '3f1a0c5e-2b7d-4a6f-8c91-000000000001';
const OAT = '3f1a0c5e-2b7d-4a6f-8c91-000000000002';
const GROUP = '7c2b4d1a-8e35-4f90-b6a2-1d4c7e9b0f52';
const OTHER_GROUP = '7c2b4d1a-8e35-4f90-b6a2-1d4c7e9b0f53';

/**
 * Line ids that `intoLineId` names (plan 0228), as uuids, because core refuses
 * any other shape before it reads.
 */
const WHOLE_LINE = '5d8e2a14-6c3b-4f71-9a0e-00000000000a';
const OAT_LINE = '5d8e2a14-6c3b-4f71-9a0e-00000000000b';
const ELSEWHERE_LINE = '5d8e2a14-6c3b-4f71-9a0e-00000000000c';
const REJECTED_LINE = '5d8e2a14-6c3b-4f71-9a0e-00000000000d';
const GONE_LINE = '5d8e2a14-6c3b-4f71-9a0e-00000000000e';

interface Seed {
  id: string;
  content: string;
  quantity?: number;
  position?: number;
  approvalStatus?: LineApprovalStatus;
  productGroupId?: string | null;
  /** The flag of plan 0207. Named when absent, as the column defaults. */
  named?: boolean;
  /** Another list's line, which an add to this one must never reach. */
  listId?: string;
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
  /**
   * Lines that a read with no lock still finds and a locked read no longer
   * does, as a delete between the two leaves them.
   */
  goneBeforeLock?: string[];
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
        listId: seed.listId ?? LIST_ID,
        content: seed.content,
        named: seed.named ?? true,
        quantity: seed.quantity ?? 1,
        // The digest of the products seeded onto the line, as the service
        // stamps it, since it is half of what an add compares.
        itemSetHash: itemSetHash(
          (options.products ?? [])
            .filter((row) => row.lineId === seed.id)
            .map((row) => row.itemId)
        ),
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
    findOne: async ({
      where,
      lock,
    }: {
      where: { id: string };
      lock?: unknown;
    }) =>
      lock !== undefined && options.goneBeforeLock?.includes(where.id)
        ? null
        : (held.find((row) => row.id === where.id) ?? null),
    // What the add folds over to decide whether the name is already on the list.
    // By position, as the query asks for, which is what decides the target when
    // the list already holds two lines of one name.
    find: async ({ where }: { where: { listId: string } }) =>
      held
        .filter((row) => row.listId === where.listId)
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

  const changes = fakeLineChanges();
  const service = new LineService(
    dataSource,
    lineRepo as never,
    items.repo as never,
    groupRemovals.repo as never,
    settlements.repo as never,
    listAccess,
    fakeLineClaims().service,
    publisher,
    {} as never,
    new LineMergeService(changes.recorder),
    // What the add records (plan 0138). A stand in, because this file is about
    // which line an add lands on; the rows it writes are proven against Postgres.
    changes.recorder,
    announcer
  );

  return { service, saved, events, items, recorded: changes.recorded };
}

function add(
  harness: Harness,
  content: string,
  extra: {
    quantity?: number;
    itemIds?: string[];
    productGroupId?: string;
    named?: boolean;
    askIfAmbiguous?: boolean;
    intoLineId?: string;
    newLine?: boolean;
  } = {}
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

/**
 * The name is half of what a line is, and what it means by the name is the other
 * half.
 *
 * Two products can carry one name and differ in brand or in format. An add that
 * raised the line of the first when somebody picked the second lost a purchase
 * without saying so, which is the failure the fold was written to avoid. So an
 * add lands on a line only when the name **and** the products agree: the same
 * product group, or the same product set, or free text on both sides.
 */
describe('a name shared by two products is two lines', () => {
  it('creates beside a line of the same name that holds another product', async () => {
    const w = build({
      holds: [{ id: 'li1', content: 'Milk', quantity: 2 }],
      products: [{ lineId: 'li1', itemId: WHOLE, position: 0 }],
    });

    const result = await add(w, 'Milk', { itemIds: [OAT] });

    expect(result.merged).toBe(false);
    expect(result.line.id).not.toBe('li1');
    expect(result.line.itemIds).toEqual([OAT]);
    expect(result.line.quantity).toBe(1);
    expect(w.events.map((e) => e.event)).toEqual([RealtimeEvent.LineAdded]);
  });

  it('raises the line that holds the same name and the same product', async () => {
    const w = build({
      holds: [
        { id: 'li-whole', content: 'Milk', quantity: 2, position: 1 },
        { id: 'li-oat', content: 'Milk', quantity: 1, position: 2 },
      ],
      products: [
        { lineId: 'li-whole', itemId: WHOLE, position: 0 },
        { lineId: 'li-oat', itemId: OAT, position: 0 },
      ],
    });

    // The later of the two, because the earlier one is another product.
    const result = await add(w, 'milk', { itemIds: [OAT] });

    expect(result.merged).toBe(true);
    expect(result.line.id).toBe('li-oat');
    expect(result.line.quantity).toBe(2);
  });

  it('lands free text on the one line of its name that names a product (plan 0228)', async () => {
    // Plan 0091 kept the two apart, and plan 0228 joins them: a typed name
    // that one product line holds is that line. The line keeps its product.
    const w = build({
      holds: [{ id: 'li1', content: 'Milk' }],
      products: [{ lineId: 'li1', itemId: WHOLE, position: 0 }],
    });

    const typed = await add(w, 'milk');

    expect(typed.merged).toBe(true);
    expect(typed.line.id).toBe('li1');
    expect(typed.line.itemIds).toEqual([WHOLE]);
  });

  it('keeps a product apart from the free text line of its name', async () => {
    const w = build({ holds: [{ id: 'li1', content: 'Milk' }] });

    const picked = await add(w, 'Milk', { itemIds: [WHOLE] });

    expect(picked.merged).toBe(false);
    expect(picked.line.itemIds).toEqual([WHOLE]);
  });

  it('meets a line on its group, whatever products the group has since given it', async () => {
    // A line that follows a group takes the group's products as the catalog
    // syncs, so its set a week later is not the set the suggestion sent.
    const w = build({
      holds: [{ id: 'li1', content: 'Milk', productGroupId: GROUP }],
      products: [
        { lineId: 'li1', itemId: WHOLE, position: 0 },
        { lineId: 'li1', itemId: OAT, position: 1 },
      ],
    });

    const same = await add(w, 'Milk', {
      itemIds: [WHOLE],
      productGroupId: GROUP,
    });
    const other = await add(w, 'Milk', {
      itemIds: [WHOLE],
      productGroupId: OTHER_GROUP,
    });

    expect(same.merged).toBe(true);
    expect(same.line.id).toBe('li1');
    // Another group and another set, so neither way of meeting it holds.
    expect(other.merged).toBe(false);
  });

  it('meets a line that follows a group on the products alone', async () => {
    // A basket's add names products and never a group, so the same suggestion
    // picked on a shopping list has to meet the line a list page made from it.
    const w = build({
      holds: [{ id: 'li1', content: 'Milk', productGroupId: GROUP }],
      products: [
        { lineId: 'li1', itemId: WHOLE, position: 0 },
        { lineId: 'li1', itemId: OAT, position: 1 },
      ],
    });

    const result = await add(w, 'Milk', { itemIds: [OAT, WHOLE] });

    expect(result.merged).toBe(true);
    expect(result.line.id).toBe('li1');
    expect(result.line.productGroupId).toBe(GROUP);
  });

  it('lands free text on the one group line of its name, even with no product (plan 0228)', async () => {
    // The identities still keep the two apart; the second lookup of plan 0228
    // counts a line that follows a group as a line that holds a product.
    const w = build({
      holds: [{ id: 'li1', content: 'Milk', productGroupId: GROUP }],
    });

    const typed = await add(w, 'milk');

    expect(typed.merged).toBe(true);
    expect(typed.line.id).toBe('li1');
    expect(typed.line.productGroupId).toBe(GROUP);
  });

  it('holds a batch to the same rule', async () => {
    const w = build({});

    const results = await w.service.addMany({
      userId: ADDER,
      listId: LIST_ID,
      items: [
        { content: 'Milk', itemIds: [WHOLE] },
        { content: 'Milk', itemIds: [OAT] },
        { content: 'milk', itemIds: [WHOLE], quantity: 2 },
      ],
    });

    // Two lines: the whole milk asked for twice, and the oat one.
    expect(results.map((entry) => entry.merged)).toEqual([false, false, true]);
    expect(results[0].line.id).toBe(results[2].line.id);
    expect(results[0].line.id).not.toBe(results[1].line.id);
    expect(results[0].line.quantity).toBe(3);
  });
});

describe('a product add merges by product (plan 0214, section 1)', () => {
  it('lands an unnamed add in English on the unnamed line made in Spanish', async () => {
    const w = build({
      holds: [{ id: 'li1', content: 'Huevos', quantity: 2, named: false }],
      products: [{ lineId: 'li1', itemId: WHOLE, position: 0 }],
    });

    const result = await add(w, 'Eggs', { itemIds: [WHOLE], named: false });

    expect(result.merged).toBe(true);
    expect(result.line).toMatchObject({
      id: 'li1',
      content: 'Huevos',
      named: false,
      quantity: 3,
    });
    expect(w.saved.filter((row) => row.id !== 'li1')).toEqual([]);
  });

  it('lands an unnamed add on an unnamed line that follows the same group', async () => {
    const w = build({
      holds: [
        {
          id: 'li1',
          content: 'Leche',
          productGroupId: GROUP,
          named: false,
        },
      ],
      products: [
        { lineId: 'li1', itemId: WHOLE, position: 0 },
        { lineId: 'li1', itemId: OAT, position: 1 },
      ],
    });

    const result = await add(w, 'Milk', {
      itemIds: [WHOLE],
      productGroupId: GROUP,
      named: false,
    });

    expect(result.merged).toBe(true);
    expect(result.line.id).toBe('li1');
  });

  it('never lands an unnamed add on a line somebody named, even with the same set', async () => {
    const w = build({
      holds: [{ id: 'li1', content: 'Eggs', named: true }],
      products: [{ lineId: 'li1', itemId: WHOLE, position: 0 }],
    });

    const result = await add(w, 'Eggs', { itemIds: [WHOLE], named: false });

    expect(result.merged).toBe(false);
    expect(result.line.id).not.toBe('li1');
    expect(result.line.named).toBe(false);
  });

  it('never lands a named add on an unnamed line of the same set', async () => {
    const w = build({
      holds: [{ id: 'li1', content: 'Eggs', named: false }],
      products: [{ lineId: 'li1', itemId: WHOLE, position: 0 }],
    });

    const result = await add(w, 'Eggs', { itemIds: [WHOLE] });

    expect(result.merged).toBe(false);
    expect(result.line.id).not.toBe('li1');
  });

  it('still merges a text add by its folded name', async () => {
    const w = build({ holds: [{ id: 'li1', content: 'jamon' }] });

    const result = await add(w, '  JAMÓN ', { named: false });

    expect(result.merged).toBe(true);
    expect(result.line.id).toBe('li1');
  });

  it('folds two unnamed items of one set in two languages in a batch', async () => {
    const w = build({});

    const results = await w.service.addMany({
      userId: ADDER,
      listId: LIST_ID,
      items: [
        { content: 'Eggs', itemIds: [WHOLE], named: false },
        { content: 'Huevos', itemIds: [WHOLE], named: false },
        { content: 'Eggs', itemIds: [WHOLE] },
      ],
    });

    // One unnamed line at two, and the named Eggs beside it.
    expect(results.map((entry) => entry.merged)).toEqual([false, true, false]);
    expect(results[0].line.id).toBe(results[1].line.id);
    expect(results[0].line).toMatchObject({ content: 'Eggs', quantity: 2 });
    expect(results[2].line.id).not.toBe(results[0].line.id);
  });
});

describe('the comment count of an add (plan 0214, section 2)', () => {
  it('carries commentCount null on the line.added payload', async () => {
    const w = build({});

    const { line } = await add(w, 'Eggs', { itemIds: [WHOLE] });

    expect(line.commentCount).toBeNull();
    expect(w.events).toEqual([
      {
        event: RealtimeEvent.LineAdded,
        line: expect.objectContaining({ commentCount: null }),
      },
    ]);
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

  it('leaves the products of the line it raises exactly as they were', async () => {
    // A raise only happens onto a line that already means what the request
    // means, so there is nothing of the request's to write onto it.
    const w = build({
      holds: [{ id: 'li1', content: 'milk', productGroupId: null }],
      products: [
        { lineId: 'li1', itemId: WHOLE, position: 0 },
        { lineId: 'li1', itemId: OAT, position: 1 },
      ],
    });

    // The same set in another order, which is the same set.
    const result = await add(w, 'milk', { itemIds: [OAT, WHOLE] });

    expect(result.merged).toBe(true);
    expect(result.line.itemIds).toEqual([WHOLE, OAT]);
    expect(result.line.productGroupId).toBeNull();
    expect(w.items.rows.map((row) => row.itemId)).toEqual([WHOLE, OAT]);
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

/**
 * Who hears an add, beyond the list room (plan 0139, section 3).
 *
 * Every write to a list line is a write to every basket that covers the list,
 * because since plan 0136 a basket stores no lines and reads the lines of the
 * lists it covers. Which baskets those are is `BasketAnnouncer`'s question and
 * is proven in its own spec; what is asserted here is that this service asks it,
 * once per write, naming the lines the write touched.
 */
describe('what an add tells the baskets', () => {
  it('announces once, naming the list and the line it created', async () => {
    const w = build({});

    const result = await add(w, 'Milk');

    expect(announcer.calls.linesChanged).toEqual([
      { listId: LIST_ID, lineIds: [result.line.id] },
    ]);
  });

  it('announces once for an add that folded into a line already there', async () => {
    const w = build({ holds: [{ id: 'li1', content: 'milk', quantity: 1 }] });

    const result = await add(w, 'Milk', { quantity: 2 });

    // A merge is an update of a line already on the screen, and the basket that
    // holds that row needs telling exactly once either way.
    expect(result.merged).toBe(true);
    expect(announcer.calls.linesChanged).toEqual([
      { listId: LIST_ID, lineIds: ['li1'] },
    ]);
  });

  it('tells nobody when the write was refused', async () => {
    const w = build({ permissions: [ListPermission.READ] });

    await expect(add(w, 'Milk')).rejects.toThrow(/write access/);

    // The announcement follows the commit, so a write that never happened
    // announces nothing.
    expect(announcer.calls.linesChanged).toEqual([]);
  });

  it('announces once for a whole batch, naming every line', async () => {
    const w = build({});

    const results = await w.service.addMany({
      userId: ADDER,
      listId: LIST_ID,
      items: [{ content: 'Milk' }, { content: 'Bread' }, { content: 'Eggs' }],
    });

    // Three `line.added` events, because each carries a whole line and a client
    // applies them one at a time. One basket announcement, because a basket
    // reads again whatever it is told and three nudges would be three reads of
    // the same basket for one write.
    expect(w.events).toHaveLength(3);
    expect(announcer.calls.linesChanged).toEqual([
      { listId: LIST_ID, lineIds: results.map((entry) => entry.line.id) },
    ]);
  });

  it('announces nothing for a reorder', async () => {
    const w = build({
      holds: [
        { id: 'li1', content: 'milk' },
        { id: 'li2', content: 'bread' },
      ],
    });

    await w.service.reorder({
      userId: ADDER,
      listId: LIST_ID,
      orderedLineIds: ['li2', 'li1'],
    });

    // A basket computes its own order (plan 0141), so the order a list is drawn
    // in is not a fact any basket reads.
    expect(announcer.calls.linesChanged).toEqual([]);
  });
});

/**
 * A typed name meets the line that holds that product (plan 0228).
 *
 * The identities of plan 0091 keep a free text add apart from every line that
 * holds a product. Plan 0228 adds a second lookup after them, for a free text
 * add alone: the lines that hold a product or a group under the typed name. One
 * is raised, two or more are a question when the caller can ask one, and the
 * caller answers with the line it chose or with a new line.
 */
describe('a typed name meets the line that holds that product (plan 0228)', () => {
  /** Two lines called "Leche entera", one per product. */
  const twoMilks = {
    holds: [
      { id: WHOLE_LINE, content: 'Leche entera', quantity: 2, position: 1 },
      {
        id: OAT_LINE,
        content: 'Leche entera',
        quantity: 1,
        position: 2,
        named: false,
        approvalStatus: LineApprovalStatus.PENDING,
      },
    ],
    products: [
      { lineId: WHOLE_LINE, itemId: WHOLE, position: 0 },
      { lineId: OAT_LINE, itemId: OAT, position: 0 },
    ],
  };

  it('raises the one product line of that name, and announces an update', async () => {
    const w = build({
      holds: [{ id: 'li1', content: 'Leche entera', quantity: 2 }],
      products: [{ lineId: 'li1', itemId: WHOLE, position: 0 }],
    });

    const result = await add(w, '  leche ENTERA ', { quantity: 3 });

    expect(result.merged).toBe(true);
    expect(result.line).toMatchObject({
      id: 'li1',
      quantity: 5,
      itemIds: [WHOLE],
      content: 'Leche entera',
    });
    expect(w.saved.filter((row) => row.id !== 'li1')).toEqual([]);
    expect(w.events.map((e) => e.event)).toEqual([RealtimeEvent.LineUpdated]);
  });

  it('meets a line that is not named by the name it holds', async () => {
    const w = build({
      holds: [{ id: 'li1', content: 'Huevos', named: false }],
      products: [{ lineId: 'li1', itemId: WHOLE, position: 0 }],
    });

    const result = await add(w, 'huevos');

    expect(result.merged).toBe(true);
    expect(result.line).toMatchObject({ id: 'li1', named: false });
  });

  it('raises a bought line from zero to the amount added (D2)', async () => {
    const w = build({
      holds: [{ id: 'li1', content: 'Leche entera', quantity: 0 }],
      products: [{ lineId: 'li1', itemId: WHOLE, position: 0 }],
      settled: [{ lineId: 'li1', quantity: 2 }],
    });

    const result = await add(w, 'Leche entera');

    expect(result.merged).toBe(true);
    expect(result.line.id).toBe('li1');
    expect(result.line.quantity).toBe(1);
  });

  it('passes over a rejected product line', async () => {
    const w = build({
      holds: [
        {
          id: REJECTED_LINE,
          content: 'Leche entera',
          position: 1,
          approvalStatus: LineApprovalStatus.REJECTED,
        },
        { id: 'li1', content: 'Leche entera', position: 2 },
      ],
      products: [
        { lineId: REJECTED_LINE, itemId: OAT, position: 0 },
        { lineId: 'li1', itemId: WHOLE, position: 0 },
      ],
    });

    // One candidate, so no question although two rows carry the name.
    const result = await add(w, 'Leche entera', { askIfAmbiguous: true });

    expect(result.merged).toBe(true);
    expect(result.line.id).toBe('li1');
  });

  it('lets the free text line of the name win, as plan 0091 decided (D3)', async () => {
    const w = build({
      holds: [
        { id: 'li-product', content: 'Leche entera', position: 1 },
        { id: 'li-text', content: 'leche entera', quantity: 1, position: 2 },
      ],
      products: [{ lineId: 'li-product', itemId: WHOLE, position: 0 }],
    });

    const result = await add(w, 'Leche entera', { askIfAmbiguous: true });

    expect(result.merged).toBe(true);
    expect(result.line.id).toBe('li-text');
    expect(result.line.quantity).toBe(2);
  });

  it('lets the free text line of the name take a newLine answer too', async () => {
    // Somebody added the free text line between the question and the answer
    // (section 3): a list holds one free text line per name, so it takes it.
    const w = build({
      holds: [
        ...twoMilks.holds,
        { id: 'li-text', content: 'Leche entera', quantity: 1, position: 3 },
      ],
      products: twoMilks.products,
    });

    const result = await add(w, 'Leche entera', { newLine: true });

    expect(result.merged).toBe(true);
    expect(result.line.id).toBe('li-text');
  });

  it('creates a line on a newLine answer, beside the one product line', async () => {
    const w = build({
      holds: [{ id: 'li1', content: 'Leche entera' }],
      products: [{ lineId: 'li1', itemId: WHOLE, position: 0 }],
    });

    const result = await add(w, 'Leche entera', { newLine: true });

    expect(result.merged).toBe(false);
    expect(result.line.id).not.toBe('li1');
    expect(result.line.itemIds).toEqual([]);
    expect(w.events.map((e) => e.event)).toEqual([RealtimeEvent.LineAdded]);
  });

  it('asks which line, with the lines in details, when two hold a product and the caller can ask', async () => {
    const w = build({
      ...twoMilks,
      holds: [
        ...twoMilks.holds,
        {
          id: 'li-group',
          content: 'LECHE ENTERA',
          quantity: 0,
          position: 3,
          productGroupId: GROUP,
        },
      ],
    });

    const refused = await add(w, 'leche entera', {
      askIfAmbiguous: true,
    }).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(LineAddNeedsChoiceException);
    const exception = refused as LineAddNeedsChoiceException;
    expect(exception.code).toBe(ERROR_CODES.LINE_ADD_NEEDS_CHOICE);
    expect(exception.exposesDetails).toBe(true);
    expect(exception.messageArgs).toEqual({ content: 'leche entera' });
    expect(exception.details).toEqual({
      lines: [
        {
          lineId: WHOLE_LINE,
          content: 'Leche entera',
          named: true,
          quantity: 2,
          itemIds: [WHOLE],
          productGroupId: null,
          approvalStatus: LineApprovalStatus.APPROVED,
        },
        {
          lineId: OAT_LINE,
          content: 'Leche entera',
          named: false,
          quantity: 1,
          itemIds: [OAT],
          productGroupId: null,
          approvalStatus: LineApprovalStatus.PENDING,
        },
        {
          lineId: 'li-group',
          content: 'LECHE ENTERA',
          named: true,
          quantity: 0,
          itemIds: [],
          productGroupId: GROUP,
          approvalStatus: LineApprovalStatus.APPROVED,
        },
      ],
    });
    // Nothing written and nothing announced.
    expect(w.saved).toEqual([]);
    expect(w.events).toEqual([]);
    expect(announcer.calls.linesChanged).toEqual([]);
  });

  it('names the lines in list position order, at most LINE_ADD_CHOICE_MAX of them', async () => {
    const count = LINE_ADD_CHOICE_MAX + 2;
    const ids = Array.from({ length: count }, (_, i) => `li-${100 + i}`);
    const seeds = ids.map((id, i) => ({
      id,
      content: 'Leche',
      position: i + 1,
    }));
    const w = build({
      // Seeded in reverse, so the order of the answer is the positions' own.
      holds: [...seeds].reverse(),
      products: ids.map((id) => ({ lineId: id, itemId: WHOLE, position: 0 })),
    });

    const refused = (await add(w, 'leche', { askIfAmbiguous: true }).catch(
      (error: unknown) => error
    )) as LineAddNeedsChoiceException;

    expect(refused).toBeInstanceOf(LineAddNeedsChoiceException);
    const details = refused.details as unknown as LineAddNeedsChoiceDetails;
    expect(details.lines.map((line) => line.lineId)).toEqual(
      ids.slice(0, LINE_ADD_CHOICE_MAX)
    );
  });

  it('creates a line, as before, when two hold a product and the caller cannot ask', async () => {
    const w = build(twoMilks);

    const result = await add(w, 'Leche entera');

    expect(result.merged).toBe(false);
    expect([WHOLE_LINE, OAT_LINE]).not.toContain(result.line.id);
    expect(result.line.itemIds).toEqual([]);
  });

  it('creates a line when no line holds the name', async () => {
    const w = build({
      holds: [{ id: 'li1', content: 'Leche desnatada' }],
      products: [{ lineId: 'li1', itemId: WHOLE, position: 0 }],
    });

    const result = await add(w, 'Leche entera', { askIfAmbiguous: true });

    expect(result.merged).toBe(false);
  });

  it('creates a line when the one candidate is deleted before it is locked', async () => {
    // The candidate read takes no lock and a delete does not take the list
    // lock, so the only line of the name can be gone by the locked read.
    const w = build({
      holds: [{ id: 'li1', content: 'Leche entera', quantity: 2 }],
      products: [{ lineId: 'li1', itemId: WHOLE, position: 0 }],
      goneBeforeLock: ['li1'],
    });

    const result = await add(w, 'Leche entera');

    expect(result.merged).toBe(false);
    expect(result.line.id).not.toBe('li1');
    expect(result.line).toMatchObject({ content: 'Leche entera', itemIds: [] });
    expect(w.saved.map((row) => row.id)).toEqual([result.line.id]);
    expect(w.events.map((e) => e.event)).toEqual([RealtimeEvent.LineAdded]);
  });

  it('raises the line the person chose, whatever its name', async () => {
    const w = build({
      ...twoMilks,
      holds: [
        ...twoMilks.holds,
        { id: 'li-text', content: 'Leche entera', quantity: 1, position: 3 },
      ],
    });

    // Chosen over the free text line of the name, because the person picked
    // it (target 1.1).
    const result = await add(w, 'Leche', {
      intoLineId: OAT_LINE,
      quantity: 2,
    });

    expect(result.merged).toBe(true);
    expect(result.line).toMatchObject({ id: OAT_LINE, quantity: 3 });
    expect(w.saved.map((row) => row.id)).toEqual([OAT_LINE]);
  });

  it('refuses a chosen line of another list, and never creates instead', async () => {
    const w = build({
      holds: [
        ...twoMilks.holds,
        { id: ELSEWHERE_LINE, content: 'Leche entera', listId: 'l2' },
      ],
      products: twoMilks.products,
    });

    await expect(
      add(w, 'Leche entera', { intoLineId: ELSEWHERE_LINE })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(w.saved).toEqual([]);
    expect(w.events).toEqual([]);
  });

  it('refuses a chosen line that is rejected, or that does not exist', async () => {
    const w = build({
      holds: [
        {
          id: REJECTED_LINE,
          content: 'Leche entera',
          approvalStatus: LineApprovalStatus.REJECTED,
        },
      ],
    });

    await expect(
      add(w, 'Leche entera', { intoLineId: REJECTED_LINE })
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      add(w, 'Leche entera', { intoLineId: GONE_LINE })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(w.saved).toEqual([]);
  });

  it('refuses intoLineId beside newLine true as a validation error', async () => {
    const w = build(twoMilks);

    await expect(
      add(w, 'Leche entera', { intoLineId: OAT_LINE, newLine: true })
    ).rejects.toBeInstanceOf(ValidationException);
    expect(w.saved).toEqual([]);
  });

  it('refuses an intoLineId that is not a uuid as a validation error', async () => {
    const w = build(twoMilks);

    await expect(
      add(w, 'Leche entera', { intoLineId: 'li-oat' })
    ).rejects.toMatchObject({
      constructor: ValidationException,
      messageArgs: { field: 'intoLineId' },
    });
    expect(w.saved).toEqual([]);
  });

  it('leaves a product add as it was, whatever the three fields say', async () => {
    const w = build(twoMilks);

    // Two product lines of the name and a third product: the add creates,
    // with no question and with no regard for the chosen line.
    const third = await add(w, 'Leche entera', {
      itemIds: [GROUP],
      askIfAmbiguous: true,
      intoLineId: WHOLE_LINE,
    });
    // The product of a line of the name, met by plan 0091's identities.
    const same = await add(w, 'Leche entera', {
      itemIds: [WHOLE],
      askIfAmbiguous: true,
      newLine: false,
    });

    expect(third.merged).toBe(false);
    expect(third.line.itemIds).toEqual([GROUP]);
    expect(same.merged).toBe(true);
    expect(same.line.id).toBe(WHOLE_LINE);
  });

  it('leaves a batch as it was: a typed name beside a product line creates', async () => {
    const w = build({
      holds: [{ id: 'li1', content: 'Leche entera' }],
      products: [{ lineId: 'li1', itemId: WHOLE, position: 0 }],
    });

    const [result] = await w.service.addMany({
      userId: ADDER,
      listId: LIST_ID,
      items: [{ content: 'Leche entera' }],
    });

    expect(result.merged).toBe(false);
    expect(result.line.id).not.toBe('li1');
  });
});
