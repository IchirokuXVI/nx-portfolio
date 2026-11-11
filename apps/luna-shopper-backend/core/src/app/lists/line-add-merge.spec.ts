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
  type LineUnit,
  type LineView,
} from '@portfolio/luna-shopper/contracts';
import {
  ERROR_CODES,
  LineAddNeedsChoiceException,
  LineUnitDiffersException,
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
  /** What its quantity counts (plan 0246). `UNIT` when absent. */
  unit?: LineUnit;
}

interface Harness {
  service: LineService;
  saved: Partial<ListLine>[];
  events: { event: RealtimeEvent; line: LineView }[];
  items: ReturnType<typeof fakeLineItems>;
  /** The change records the add wrote (plan 0138). */
  recorded: ReturnType<typeof fakeLineChanges>['recorded'];
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
        unit: seed.unit ?? 'UNIT',
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
    unit?: LineUnit;
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

describe('an add states the unit of the line (plan 0246, sections 3.2 and 3.3)', () => {
  it('creates a line in the unit it names, and in UNIT without one', async () => {
    const w = build({});

    const weighed = await add(w, 'Bananas', {
      itemIds: [WHOLE],
      unit: 'GRAM',
      quantity: 1000,
    });
    const counted = await add(w, 'Bread');

    expect(weighed.merged).toBe(false);
    expect(weighed.line).toMatchObject({ unit: 'GRAM', quantity: 1000 });
    expect(counted.line).toMatchObject({ unit: 'UNIT', quantity: 1 });
    expect(w.saved.map((row) => row.unit)).toEqual(['GRAM', 'UNIT']);
  });

  it('refuses a unit that is not one of the three', async () => {
    const w = build({});

    await expect(
      add(w, 'Bananas', { unit: 'KILOGRAM' as LineUnit })
    ).rejects.toBeInstanceOf(ValidationException);
    expect(w.saved).toHaveLength(0);
  });

  it('meets a free text line of another unit by name and writes nothing (plan 0260 R4)', async () => {
    // Changed on purpose by plan 0260: this was the duplicate question of
    // plan 0228 naming the one line. A typed name is never refused or asked
    // about for a unit now, and the wanted line is left as it was.
    const w = build({
      holds: [{ id: 'li1', content: 'bananas', quantity: 500, unit: 'GRAM' }],
    });

    const result = await add(w, 'Bananas', { quantity: 2 });

    expect(result).toMatchObject({
      merged: true,
      outcome: 'ALREADY_ON_LIST',
      line: { id: 'li1', quantity: 500, unit: 'GRAM', version: 4 },
    });
    expect(result.alreadyOnList.map((line) => line.id)).toEqual(['li1']);
    expect(w.saved).toHaveLength(0);
    expect(w.events).toHaveLength(0);
    expect(w.recorded).toHaveLength(0);
  });

  it('meets the one product line of a typed name in another unit the same way (plan 0260 R4)', async () => {
    // Changed on purpose by plan 0260: this was the question too.
    const w = build({
      holds: [
        { id: WHOLE_LINE, content: 'Bananas', quantity: 750, unit: 'GRAM' },
      ],
      products: [{ lineId: WHOLE_LINE, itemId: WHOLE, position: 0 }],
    });

    const result = await add(w, 'bananas');

    expect(result).toMatchObject({
      outcome: 'ALREADY_ON_LIST',
      line: { id: WHOLE_LINE, quantity: 750, itemIds: [WHOLE] },
    });
    expect(w.saved).toHaveLength(0);
  });

  it('refuses a product add that meets only a line of another unit, whatever newLine says (plan 0260 U2)', async () => {
    // Changed on purpose by plan 0260: this was the question, and `newLine:
    // true` then created a second line of one product in another unit.
    const w = build({
      holds: [
        { id: WHOLE_LINE, content: 'Bananas', quantity: 750, unit: 'GRAM' },
      ],
      products: [{ lineId: WHOLE_LINE, itemId: WHOLE, position: 0 }],
    });
    const asks = jest.spyOn(
      w.service as unknown as { needsChoice: () => unknown },
      'needsChoice'
    );

    const refused = await add(w, 'Bananas', { itemIds: [WHOLE] }).catch(
      (error: unknown) => error
    );
    const answered = await add(w, 'Bananas', {
      itemIds: [WHOLE],
      newLine: true,
    }).catch((error: unknown) => error);

    for (const error of [refused, answered]) {
      expect(error).toBeInstanceOf(LineUnitDiffersException);
      const exception = error as LineUnitDiffersException;
      expect(exception.code).toBe(ERROR_CODES.LINE_UNIT_DIFFERS);
      expect(exception.exposesDetails).toBe(true);
      expect(exception.messageArgs).toEqual({ content: 'Bananas' });
      expect(exception.details).toEqual({
        line: {
          lineId: WHOLE_LINE,
          content: 'Bananas',
          unit: 'GRAM',
          quantity: 750,
        },
        unit: 'UNIT',
        index: null,
      });
    }
    expect(asks).not.toHaveBeenCalled();
    expect(w.saved).toHaveLength(0);
    expect(w.events).toHaveLength(0);
    expect(w.recorded).toHaveLength(0);
  });

  it('raises a chosen kept line of another unit by one step of its unit, and meets a wanted one (plan 0260 R2, R4)', async () => {
    // Changed on purpose by plan 0260: a chosen line of another unit was
    // `line_unit_differs`.
    const w = build({
      holds: [
        { id: WHOLE_LINE, content: 'Bananas', quantity: 0, unit: 'GRAM' },
        { id: OAT_LINE, content: 'Bananas', quantity: 750, unit: 'GRAM' },
      ],
      products: [
        { lineId: WHOLE_LINE, itemId: WHOLE, position: 0 },
        { lineId: OAT_LINE, itemId: OAT, position: 0 },
      ],
    });

    const raised = await add(w, 'Bananas', {
      intoLineId: WHOLE_LINE,
      quantity: 2,
    });
    const met = await add(w, 'Bananas', { intoLineId: OAT_LINE, quantity: 2 });

    expect(raised).toMatchObject({
      outcome: 'RAISED',
      merged: true,
      line: { id: WHOLE_LINE, quantity: 25, unit: 'GRAM' },
      alreadyOnList: [],
    });
    expect(met).toMatchObject({
      outcome: 'ALREADY_ON_LIST',
      line: { id: OAT_LINE, quantity: 750 },
    });
    expect(w.saved.map((row) => row.id)).toEqual([WHOLE_LINE]);
  });

  it('starts an add with no quantity at one step of its unit (plan 0260 A2)', async () => {
    // Changed on purpose by plan 0260: 1000 g and 1000 ml (plan 0246 M4).
    const w = build({});

    const weighed = await add(w, 'Bananas', {
      itemIds: [WHOLE],
      unit: 'GRAM',
    });
    const poured = await add(w, 'Milk', {
      itemIds: [OAT],
      unit: 'MILLILITER',
    });
    const counted = await add(w, 'Bread');

    expect(weighed).toMatchObject({
      outcome: 'CREATED',
      merged: false,
      alreadyOnList: [],
      line: { unit: 'GRAM', quantity: 25 },
    });
    expect(poured.line).toMatchObject({ unit: 'MILLILITER', quantity: 25 });
    expect(counted.line).toMatchObject({ unit: 'UNIT', quantity: 1 });
  });

  it('raises a kept weight line by one step when the add names no quantity (plan 0260 R2)', async () => {
    // Changed on purpose by plan 0260: a wanted line was raised by 1000.
    const w = build({
      holds: [{ id: 'li1', content: 'bananas', quantity: 0, unit: 'GRAM' }],
    });

    const result = await add(w, 'Bananas', { unit: 'GRAM' });

    expect(result.outcome).toBe('RAISED');
    expect(result.line).toMatchObject({ unit: 'GRAM', quantity: 25 });
  });

  it('starts a batch item with no quantity at one step of its unit (plan 0260 A2)', async () => {
    const w = build({});

    const results = await w.service.addMany({
      userId: ADDER,
      listId: LIST_ID,
      items: [
        { content: 'Cheese', itemIds: [WHOLE], unit: 'GRAM' },
        { content: 'Bread' },
      ],
    });

    expect(results[0].line).toMatchObject({ unit: 'GRAM', quantity: 25 });
    expect(results[1].line).toMatchObject({ unit: 'UNIT', quantity: 1 });
    expect(results.map((entry) => entry.outcome)).toEqual([
      'CREATED',
      'CREATED',
    ]);
  });

  it('leaves a wanted line of the same unit as it was, whatever the add states (plan 0260 A1)', async () => {
    // Changed on purpose by plan 0260: the line was raised to 750.
    const w = build({
      holds: [{ id: 'li1', content: 'bananas', quantity: 500, unit: 'GRAM' }],
    });

    const result = await add(w, 'Bananas', { unit: 'GRAM', quantity: 250 });

    expect(result.outcome).toBe('ALREADY_ON_LIST');
    expect(result.line).toMatchObject({ unit: 'GRAM', quantity: 500 });
    expect(w.saved).toHaveLength(0);
  });

  it('refuses two items of one product in two units as a validation error (plan 0260 R7)', async () => {
    // Changed on purpose by plan 0260: the two made two lines.
    const w = build({});

    await expect(
      w.service.addMany({
        userId: ADDER,
        listId: LIST_ID,
        items: [
          {
            content: 'Cheese',
            itemIds: [WHOLE, OAT],
            unit: 'GRAM',
            quantity: 300,
          },
          {
            content: 'Cheese',
            itemIds: [WHOLE, OAT],
            unit: 'UNIT',
            quantity: 2,
          },
        ],
      })
    ).rejects.toMatchObject({
      constructor: ValidationException,
      messageArgs: { field: 'items' },
    });
    expect(w.saved).toHaveLength(0);
    expect(w.events).toHaveLength(0);
  });

  it('refuses a rename onto a line of another unit with line_unit_differs', async () => {
    // Even with the merge confirmed: converting needs a product, and a merge
    // has none to prefer. The two lines stay.
    const w = build({
      holds: [
        { id: 'li1', content: 'Bananas', quantity: 500, unit: 'GRAM' },
        { id: 'li2', content: 'Plátanos', quantity: 2, unit: 'UNIT' },
      ],
    });

    await expect(
      w.service.update({
        userId: ADDER,
        lineId: 'li2',
        content: 'bananas',
        confirmMerge: true,
      })
    ).rejects.toMatchObject({ code: ERROR_CODES.LINE_UNIT_DIFFERS });
    expect(w.saved).toHaveLength(0);
    expect(w.events).toHaveLength(0);
  });

  it('meets the line of the add unit beside an earlier line of another unit, and writes nothing', async () => {
    // A (GRAM) sits first and B (UNIT) is a line of the add's unit made
    // before plan 0260. The add meets B and is not refused.
    const w = build({
      holds: [
        { id: WHOLE_LINE, content: 'Bananas', quantity: 750, unit: 'GRAM' },
        { id: OAT_LINE, content: 'Bananas', quantity: 1, unit: 'UNIT' },
      ],
      products: [
        { lineId: WHOLE_LINE, itemId: WHOLE, position: 0 },
        { lineId: OAT_LINE, itemId: WHOLE, position: 0 },
      ],
    });

    const result = await add(w, 'Bananas', { itemIds: [WHOLE], quantity: 2 });

    expect(result).toMatchObject({
      merged: true,
      outcome: 'ALREADY_ON_LIST',
      line: { id: OAT_LINE, unit: 'UNIT', quantity: 1 },
    });
    expect(w.saved).toHaveLength(0);
    expect(w.events).toHaveLength(0);
  });

  it('meets the GRAM line beside an earlier UNIT line of the same products', async () => {
    const w = build({
      holds: [
        { id: OAT_LINE, content: 'Bananas', quantity: 1, unit: 'UNIT' },
        { id: WHOLE_LINE, content: 'Bananas', quantity: 750, unit: 'GRAM' },
      ],
      products: [
        { lineId: OAT_LINE, itemId: WHOLE, position: 0 },
        { lineId: WHOLE_LINE, itemId: WHOLE, position: 0 },
      ],
    });

    const result = await add(w, 'Bananas', {
      itemIds: [WHOLE],
      unit: 'GRAM',
      quantity: 250,
    });

    expect(result.outcome).toBe('ALREADY_ON_LIST');
    expect(result.line).toMatchObject({ id: WHOLE_LINE, quantity: 750 });
    expect(w.saved).toHaveLength(0);
  });

  it('meets a free text line of another unit with a free text batch item, and writes nothing (plan 0260 R4, R6)', async () => {
    // Changed on purpose by plan 0260: the item made a UNIT line beside the
    // weight line.
    const w = build({
      holds: [{ id: 'li1', content: 'bananas', quantity: 500, unit: 'GRAM' }],
    });

    const [result] = await w.service.addMany({
      userId: ADDER,
      listId: LIST_ID,
      items: [{ content: 'Bananas', quantity: 3 }],
    });

    expect(result).toMatchObject({
      merged: true,
      outcome: 'ALREADY_ON_LIST',
      line: { id: 'li1', unit: 'GRAM', quantity: 500 },
    });
    expect(result.alreadyOnList.map((line) => line.id)).toEqual(['li1']);
    expect(w.saved).toHaveLength(0);
    expect(w.events).toHaveLength(0);
    expect(announcer.calls.linesChanged).toEqual([]);
  });

  it('raises the earliest kept free text line of the name for a batch item, of any unit (plan 0260 R4)', async () => {
    const w = build({
      holds: [
        { id: 'li1', content: 'bananas', quantity: 0, unit: 'GRAM' },
        { id: 'li2', content: 'Bananas', quantity: 2, unit: 'UNIT' },
      ],
    });

    const [result] = await w.service.addMany({
      userId: ADDER,
      listId: LIST_ID,
      items: [{ content: 'Bananas', quantity: 3 }],
    });

    // The earliest line of the name is li1, at zero, so it is raised by one
    // step of its own unit: the 3 was said in pieces.
    expect(result).toMatchObject({
      merged: true,
      outcome: 'RAISED',
      line: { id: 'li1', quantity: 25 },
    });
    expect(w.saved.map((row) => row.id)).toEqual(['li1']);
  });
});

describe('which line an add lands on (plan 0091, sections 1 and 3.1)', () => {
  it('meets the line already holding the name, and announces nothing (plan 0260 A1)', async () => {
    const w = build({ holds: [{ id: 'li1', content: 'milk', quantity: 2 }] });

    const result = await add(w, 'Milk');

    expect(result).toMatchObject({
      merged: true,
      outcome: 'ALREADY_ON_LIST',
      line: { id: 'li1', quantity: 2 },
    });
    expect(w.events).toEqual([]);
  });

  it('raises the line at zero holding the name, and announces an update', async () => {
    const w = build({ holds: [{ id: 'li1', content: 'milk', quantity: 0 }] });

    const result = await add(w, 'Milk');

    expect(result.merged).toBe(true);
    expect(result.outcome).toBe('RAISED');
    expect(result.line.id).toBe('li1');
    expect(result.line.quantity).toBe(1);
    // `line.updated`, never `line.added`: a raise is the existing row moving,
    // and an `added` would put a second row in front of every client drawing it.
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

  it('meets the line that holds the same name and the same product', async () => {
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
    expect(result.outcome).toBe('ALREADY_ON_LIST');
    expect(result.line.id).toBe('li-oat');
    expect(result.line.quantity).toBe(1);
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
    // Changed on purpose by plan 0260 R5: another group and another set, so
    // neither identity holds, and the line still holds the product.
    expect(other).toMatchObject({
      outcome: 'ALREADY_ON_LIST',
      line: { id: 'li1' },
    });
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

  it('holds a batch to the same rule, and never sums (plan 0260 R6)', async () => {
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

    // Two lines: the whole milk asked for twice, at the first item's amount,
    // and the oat one. Changed on purpose by plan 0260: the sum was 3.
    expect(results.map((entry) => entry.merged)).toEqual([false, false, true]);
    expect(results.map((entry) => entry.outcome)).toEqual([
      'CREATED',
      'CREATED',
      'ALREADY_ON_LIST',
    ]);
    expect(results[0].line.id).toBe(results[2].line.id);
    expect(results[0].line.id).not.toBe(results[1].line.id);
    expect(results[0].line.quantity).toBe(1);
    expect(results[2].alreadyOnList.map((line) => line.id)).toEqual([
      results[0].line.id,
    ]);
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
      quantity: 2,
    });
    expect(w.saved).toEqual([]);
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

  it('meets a line somebody named with an unnamed add of its products (plan 0260 R5)', async () => {
    // Changed on purpose by plan 0260 R5: the identities of plan 0214 still
    // keep the two apart, and the line holds every product of the add, so
    // the product is already on the list.
    const w = build({
      holds: [{ id: 'li1', content: 'Eggs', named: true }],
      products: [{ lineId: 'li1', itemId: WHOLE, position: 0 }],
    });

    const result = await add(w, 'Eggs', { itemIds: [WHOLE], named: false });

    expect(result).toMatchObject({
      outcome: 'ALREADY_ON_LIST',
      line: { id: 'li1', named: true },
    });
    expect(w.saved).toEqual([]);
  });

  it('meets an unnamed line of the same set with a named add (plan 0260 R5)', async () => {
    // Changed on purpose by plan 0260 R5, as above.
    const w = build({
      holds: [{ id: 'li1', content: 'Eggs', named: false }],
      products: [{ lineId: 'li1', itemId: WHOLE, position: 0 }],
    });

    const result = await add(w, 'Eggs', { itemIds: [WHOLE] });

    expect(result).toMatchObject({
      outcome: 'ALREADY_ON_LIST',
      line: { id: 'li1' },
    });
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

    // One unnamed line at one, and the named Eggs beside it: a batch meets
    // the lines the list held before it by their products (R5), not a line
    // the batch makes.
    expect(results.map((entry) => entry.merged)).toEqual([false, true, false]);
    expect(results[0].line.id).toBe(results[1].line.id);
    expect(results[0].line).toMatchObject({ content: 'Eggs', quantity: 1 });
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
          quantity: 0,
          approvalStatus: LineApprovalStatus.PENDING,
        },
      ],
    });

    const result = await add(w, 'milk');

    expect(result.line.approvalStatus).toBe(LineApprovalStatus.PENDING);
    expect(result.line.quantity).toBe(1);
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
          quantity: 0,
          approvalStatus: LineApprovalStatus.APPROVED,
        },
      ],
      permissions: [ListPermission.READ, ListPermission.WRITE],
    });

    const result = await add(w, 'milk', { quantity: 4 });

    expect(result.line.approvalStatus).toBe(LineApprovalStatus.APPROVED);
    expect(result.line.approvedByUserId).toBe(AUTHOR);
    expect(result.line.quantity).toBe(4);
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

  it('leaves a line at the ceiling as it was instead of refusing the add', async () => {
    // A wanted line is never raised now (plan 0260 A1), so the add that used
    // to be capped here writes nothing.
    const w = build({
      holds: [{ id: 'li1', content: 'milk', quantity: LINE_QUANTITY_MAX }],
    });

    const result = await add(w, 'milk', { quantity: 5 });

    expect(result.outcome).toBe('ALREADY_ON_LIST');
    expect(result.line.quantity).toBe(LINE_QUANTITY_MAX);
  });

  it('bumps the version of a raise, as every quantity write does', async () => {
    const w = build({ holds: [{ id: 'li1', content: 'milk', quantity: 0 }] });

    const result = await add(w, 'milk');

    expect(result.line.version).toBe(5);
  });

  it('keeps the version of a line it only met (plan 0260, section 2)', async () => {
    const w = build({ holds: [{ id: 'li1', content: 'milk', quantity: 1 }] });

    const result = await add(w, 'milk');

    expect(result.line.version).toBe(4);
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

  it('announces once for an add that raised a line already there', async () => {
    const w = build({ holds: [{ id: 'li1', content: 'milk', quantity: 0 }] });

    const result = await add(w, 'Milk', { quantity: 2 });

    // A raise is an update of a line already on the screen, and the basket
    // that holds that row needs telling exactly once either way.
    expect(result.merged).toBe(true);
    expect(announcer.calls.linesChanged).toEqual([
      { listId: LIST_ID, lineIds: ['li1'] },
    ]);
  });

  it('tells nobody about an add that met a wanted line (plan 0260 A1)', async () => {
    const w = build({ holds: [{ id: 'li1', content: 'milk', quantity: 1 }] });

    await add(w, 'Milk', { quantity: 2 });
    await w.service.addMany({
      userId: ADDER,
      listId: LIST_ID,
      items: [{ content: 'milk' }],
    });

    expect(announcer.calls.linesChanged).toEqual([]);
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
  /** The same two at zero, the first counting grams (plan 0260 R3). */
  const keptMilks = {
    holds: [
      { ...twoMilks.holds[0], quantity: 0, unit: 'GRAM' as LineUnit },
      { ...twoMilks.holds[1], quantity: 0 },
    ],
    products: twoMilks.products,
  };

  it('raises the one kept product line of that name, and announces an update', async () => {
    const w = build({
      holds: [{ id: 'li1', content: 'Leche entera', quantity: 0 }],
      products: [{ lineId: 'li1', itemId: WHOLE, position: 0 }],
    });

    const result = await add(w, '  leche ENTERA ', { quantity: 3 });

    expect(result.merged).toBe(true);
    expect(result.outcome).toBe('RAISED');
    expect(result.line).toMatchObject({
      id: 'li1',
      quantity: 3,
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
    expect(result.alreadyOnList.map((line) => line.id)).toEqual(['li-text']);
    expect(result.line.quantity).toBe(1);
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

  it('asks which line, with the lines in details, when two kept lines hold a product and the caller can ask', async () => {
    const w = build({
      ...keptMilks,
      holds: [
        ...keptMilks.holds,
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
          quantity: 0,
          unit: 'GRAM',
          itemIds: [WHOLE],
          productGroupId: null,
          approvalStatus: LineApprovalStatus.APPROVED,
        },
        {
          lineId: OAT_LINE,
          content: 'Leche entera',
          named: false,
          quantity: 0,
          unit: 'UNIT',
          itemIds: [OAT],
          productGroupId: null,
          approvalStatus: LineApprovalStatus.PENDING,
        },
        {
          lineId: 'li-group',
          content: 'LECHE ENTERA',
          named: true,
          quantity: 0,
          unit: 'UNIT',
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
      quantity: 0,
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

  it('meets every wanted line of the name, with no question, when two hold a product (plan 0260 R3)', async () => {
    // Changed on purpose by plan 0260: without `askIfAmbiguous` this created
    // a line, and with it the add asked.
    for (const askIfAmbiguous of [false, true]) {
      const w = build(twoMilks);

      const result = await add(w, 'Leche entera', { askIfAmbiguous });

      expect(result).toMatchObject({
        merged: true,
        outcome: 'ALREADY_ON_LIST',
        line: { id: WHOLE_LINE },
      });
      expect(result.alreadyOnList.map((line) => line.id)).toEqual([
        WHOLE_LINE,
        OAT_LINE,
      ]);
      expect(w.saved).toEqual([]);
      expect(w.events).toEqual([]);
    }
  });

  it('meets the one wanted line among kept ones, with no question (plan 0260 R3)', async () => {
    const w = build({
      ...twoMilks,
      holds: [{ ...twoMilks.holds[0], quantity: 0 }, twoMilks.holds[1]],
    });

    const result = await add(w, 'Leche entera', { askIfAmbiguous: true });

    expect(result.outcome).toBe('ALREADY_ON_LIST');
    expect(result.alreadyOnList.map((line) => line.id)).toEqual([OAT_LINE]);
    expect(w.saved).toEqual([]);
  });

  it('raises the earliest of two kept lines when the caller cannot ask (plan 0260 R3)', async () => {
    const w = build(keptMilks);

    const result = await add(w, 'Leche entera', { quantity: 2 });

    // The earliest counts grams and the 2 was said in pieces: one step.
    expect(result).toMatchObject({
      outcome: 'RAISED',
      line: { id: WHOLE_LINE, quantity: 25, unit: 'GRAM' },
    });
    expect(w.saved.map((row) => row.id)).toEqual([WHOLE_LINE]);
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
      holds: [{ id: 'li1', content: 'Leche entera', quantity: 0 }],
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

  it('raises the kept line the person chose, whatever its name', async () => {
    const w = build({
      ...twoMilks,
      holds: [
        twoMilks.holds[0],
        { ...twoMilks.holds[1], quantity: 0 },
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
    expect(result).toMatchObject({
      outcome: 'RAISED',
      line: { id: OAT_LINE, quantity: 2 },
    });
    expect(w.saved.map((row) => row.id)).toEqual([OAT_LINE]);
  });

  it('meets the wanted line the person chose, and writes nothing (plan 0260)', async () => {
    const w = build(twoMilks);

    const result = await add(w, 'Leche', { intoLineId: OAT_LINE });

    expect(result).toMatchObject({
      outcome: 'ALREADY_ON_LIST',
      line: { id: OAT_LINE, quantity: 1 },
    });
    expect(w.saved).toEqual([]);
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

  it('meets the product line of a typed name in a batch too (plan 0260, section 4)', async () => {
    // Changed on purpose by plan 0260: a batch item created beside it.
    const w = build({
      holds: [{ id: 'li1', content: 'Leche entera' }],
      products: [{ lineId: 'li1', itemId: WHOLE, position: 0 }],
    });

    const [result] = await w.service.addMany({
      userId: ADDER,
      listId: LIST_ID,
      items: [{ content: 'Leche entera' }],
    });

    expect(result).toMatchObject({
      merged: true,
      outcome: 'ALREADY_ON_LIST',
      line: { id: 'li1' },
    });
    expect(w.saved).toEqual([]);
  });
});

/**
 * An add that meets a line already on the list adds nothing (plan 0260).
 *
 * The cases of section 7.1 not already asserted above, where the describes of
 * plans 0091, 0228 and 0246 now read the new rule.
 */
describe('an add that meets a line already on the list adds nothing (plan 0260)', () => {
  /** A line of several products (velista 0183) that holds WHOLE and OAT. */
  const several = (quantity: number, unit: LineUnit) => ({
    holds: [{ id: 'li-mix', content: 'Leche', quantity, unit }],
    products: [
      { lineId: 'li-mix', itemId: WHOLE, position: 0 },
      { lineId: 'li-mix', itemId: OAT, position: 1 },
    ],
  });

  it('writes nothing, records nothing and emits nothing for a product add of its wanted line', async () => {
    const w = build({
      holds: [{ id: 'li1', content: 'Plátanos', quantity: 750, unit: 'GRAM' }],
      products: [{ lineId: 'li1', itemId: WHOLE, position: 0 }],
    });

    const result = await add(w, 'Plátanos', {
      itemIds: [WHOLE],
      unit: 'GRAM',
    });

    expect(result).toEqual({
      line: expect.objectContaining({
        id: 'li1',
        quantity: 750,
        unit: 'GRAM',
        version: 4,
        itemIds: [WHOLE],
      }),
      merged: true,
      outcome: 'ALREADY_ON_LIST',
      alreadyOnList: [expect.objectContaining({ id: 'li1', version: 4 })],
    });
    // `saved` is every call of the repository's `save`.
    expect(w.saved).toEqual([]);
    expect(w.recorded).toEqual([]);
    expect(w.events).toEqual([]);
    expect(announcer.calls.linesChanged).toEqual([]);
  });

  it('raises the same line at zero to one step, 25 in GRAM and 1 in UNIT, and answers RAISED', async () => {
    const weighed = build({
      holds: [{ id: 'li1', content: 'Plátanos', quantity: 0, unit: 'GRAM' }],
      products: [{ lineId: 'li1', itemId: WHOLE, position: 0 }],
    });
    const counted = build({
      holds: [{ id: 'li1', content: 'Plátanos', quantity: 0 }],
      products: [{ lineId: 'li1', itemId: WHOLE, position: 0 }],
    });

    const grams = await add(weighed, 'Plátanos', {
      itemIds: [WHOLE],
      unit: 'GRAM',
    });
    const pieces = await add(counted, 'Plátanos', { itemIds: [WHOLE] });

    expect(grams).toMatchObject({
      outcome: 'RAISED',
      merged: true,
      alreadyOnList: [],
      line: { id: 'li1', quantity: 25, version: 5 },
    });
    expect(pieces).toMatchObject({
      outcome: 'RAISED',
      line: { id: 'li1', quantity: 1 },
    });
    expect(weighed.recorded.map((entry) => entry.kind)).toEqual(['edited']);
    expect(weighed.events.map((entry) => entry.event)).toEqual([
      RealtimeEvent.LineUpdated,
    ]);
  });

  it('meets a wanted line of several products that holds the product (R5)', async () => {
    const w = build(several(500, 'GRAM'));

    const result = await add(w, 'Leche entera', {
      itemIds: [WHOLE],
      unit: 'GRAM',
    });

    expect(result).toMatchObject({
      outcome: 'ALREADY_ON_LIST',
      line: { id: 'li-mix', quantity: 500, itemIds: [WHOLE, OAT] },
    });
    expect(w.saved).toEqual([]);
  });

  it('raises a kept line of several products that holds the product (R5)', async () => {
    const w = build(several(0, 'GRAM'));

    const result = await add(w, 'Leche entera', {
      itemIds: [OAT],
      unit: 'GRAM',
    });

    expect(result).toMatchObject({
      outcome: 'RAISED',
      line: { id: 'li-mix', quantity: 25, itemIds: [WHOLE, OAT] },
    });
    // The line keeps its products: nothing of the add's is written onto it.
    expect(w.items.rows.map((row) => row.itemId)).toEqual([WHOLE, OAT]);
  });

  it('refuses a product held only by a line of several products in another unit (R5)', async () => {
    const w = build(several(3, 'UNIT'));

    const refused = await add(w, 'Leche entera', {
      itemIds: [WHOLE],
      unit: 'GRAM',
    }).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(LineUnitDiffersException);
    expect((refused as LineUnitDiffersException).details).toEqual({
      line: { lineId: 'li-mix', content: 'Leche', unit: 'UNIT', quantity: 3 },
      unit: 'GRAM',
      index: null,
    });
    expect(w.saved).toEqual([]);
    expect(w.events).toEqual([]);
  });

  it('creates beside a line of several products that does not hold every product', async () => {
    const w = build({
      holds: [{ id: 'li-mix', content: 'Leche', quantity: 1 }],
      products: [{ lineId: 'li-mix', itemId: WHOLE, position: 0 }],
    });

    const result = await add(w, 'Leche', { itemIds: [WHOLE, OAT] });

    expect(result.outcome).toBe('CREATED');
    expect(result.line.id).not.toBe('li-mix');
  });

  it('raises the one kept GRAM candidate of a typed name to 25, whatever the add stated (R4)', async () => {
    for (const extra of [{}, { quantity: 3, unit: 'UNIT' as LineUnit }]) {
      const w = build({
        holds: [{ id: 'li1', content: 'Plátanos', quantity: 0, unit: 'GRAM' }],
        products: [{ lineId: 'li1', itemId: WHOLE, position: 0 }],
      });
      const asks = jest.spyOn(
        w.service as unknown as { needsChoice: () => unknown },
        'needsChoice'
      );

      const result = await add(w, 'plátanos', extra);

      expect(result).toMatchObject({
        outcome: 'RAISED',
        line: { id: 'li1', quantity: 25, unit: 'GRAM' },
      });
      expect(asks).not.toHaveBeenCalled();
    }
  });

  it('meets a wanted line in a batch, and writes nothing for that item', async () => {
    const w = build({
      holds: [{ id: 'li1', content: 'Plátanos', quantity: 750, unit: 'GRAM' }],
      products: [{ lineId: 'li1', itemId: WHOLE, position: 0 }],
    });

    const results = await w.service.addMany({
      userId: ADDER,
      listId: LIST_ID,
      items: [
        { content: 'Plátanos', itemIds: [WHOLE], unit: 'GRAM' },
        { content: 'Bread' },
      ],
    });

    expect(results[0]).toMatchObject({
      merged: true,
      outcome: 'ALREADY_ON_LIST',
      line: { id: 'li1', quantity: 750, version: 4 },
    });
    expect(results[1].outcome).toBe('CREATED');
    expect(w.saved.map((row) => row.content)).toEqual(['Bread']);
    expect(w.events.map((entry) => entry.line.id)).toEqual([
      results[1].line.id,
    ]);
    expect(announcer.calls.linesChanged).toEqual([
      { listId: LIST_ID, lineIds: [results[1].line.id] },
    ]);
  });

  it('meets a line an earlier item of the batch raised, and adds nothing more (R6)', async () => {
    const w = build({ holds: [{ id: 'li1', content: 'milk', quantity: 0 }] });

    const results = await w.service.addMany({
      userId: ADDER,
      listId: LIST_ID,
      items: [
        { content: 'Milk', quantity: 2 },
        { content: 'MILK', quantity: 5 },
      ],
    });

    expect(results.map((entry) => entry.outcome)).toEqual([
      'RAISED',
      'ALREADY_ON_LIST',
    ]);
    expect(results.map((entry) => entry.line.quantity)).toEqual([2, 2]);
    expect(w.saved).toHaveLength(1);
  });

  it('refuses the whole batch with details.index for a product item met only in another unit (R7)', async () => {
    const w = build({
      holds: [{ id: 'li1', content: 'Plátanos', quantity: 3 }],
      products: [{ lineId: 'li1', itemId: WHOLE, position: 0 }],
    });

    const refused = await w.service
      .addMany({
        userId: ADDER,
        listId: LIST_ID,
        items: [
          { content: 'Bread' },
          { content: 'Plátanos', itemIds: [WHOLE], unit: 'GRAM' },
        ],
      })
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(LineUnitDiffersException);
    expect((refused as LineUnitDiffersException).details).toEqual({
      line: {
        lineId: 'li1',
        content: 'Plátanos',
        unit: 'UNIT',
        quantity: 3,
      },
      unit: 'GRAM',
      index: 1,
    });
    expect(w.saved).toEqual([]);
    expect(w.recorded).toEqual([]);
    expect(w.events).toEqual([]);
    expect(announcer.calls.linesChanged).toEqual([]);
  });
});
