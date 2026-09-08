import {
  GeneratedLineOrigin,
  GeneratedListStatus,
  ParticipantKind,
  RealtimeEvent,
  SettlementOutcome,
  type GeneratedListBasketLineView,
} from '@portfolio/luna-shopper/contracts';
import {
  StaleQuantityException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type { DataSource, EntityManager } from 'typeorm';
import type {
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOption,
  GeneratedListLineOrigin,
  LineSettlement,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { GeneratedListSharingService } from './generated-list-sharing.service';
import { GeneratedListSplitService } from './generated-list-split.service';
import type { GeneratedListService } from './generated-list.service';

/**
 * A line split by the product that was got (plan 0094).
 *
 * The property every test here circles is section 1's rule: **a basket line
 * holds one product, before and after any split.** Everything downstream of a
 * settlement assumes it, so the way this feature breaks is not a crash but a row
 * that names two milks and a purchase history that cannot say which one was
 * bought.
 *
 * The second property, and the one that is easy to lose while getting the first
 * right: **nothing here is a purchase.** No settlement is written, no
 * `settledQuantity` moves, and no zone line is touched, so the households still
 * want exactly what they wanted and no zone event is emitted at all.
 */

const OWNER = 'u-owner';
const BASKET = 'gl-1';
const ACTOR = 'p-actor';
const AUTHOR = 'p-author';
const LINE = 'gll-1';

const SKIMMED = 'item-skimmed';
const WHOLE = 'item-whole';
const LACTOSE_FREE = 'item-lactose-free';

const FLAT = { zoneId: 'z-flat', listId: 'l-flat', lineId: 'zl-flat' };
const PARENTS = { zoneId: 'z-par', listId: 'l-par', lineId: 'zl-par' };

interface Store {
  lines: GeneratedListLine[];
  origins: GeneratedListLineOrigin[];
  options: GeneratedListLineOption[];
  settlements: LineSettlement[];
}

interface Harness {
  service: GeneratedListSplitService;
  store: Store;
  events: { event: RealtimeEvent; lineId?: string }[];
  /** The line as it now stands, by id, so an assertion reads the row not a view. */
  lineOf(id: string): GeneratedListLine | undefined;
  /** This line's provenance rows, oldest first. */
  originsOf(id: string): GeneratedListLineOrigin[];
}

interface LineSeed {
  id: string;
  content?: string;
  itemId?: string | null;
  quantity: number;
  settledQuantity?: number;
  position: number;
  origins?: { at: string; quantity: number; version?: number }[];
  options?: string[];
  createdByParticipantId?: string | null;
}

/**
 * A basket held in four arrays, and the repository surface the service reaches
 * for, over the manager and over its own injected repositories alike.
 *
 * Written by hand rather than mocked per call, because the questions this file
 * asks are about the rows afterwards: which line holds which units, which
 * origin row moved, which row is gone. A spy on `save` cannot answer any of
 * them, and a fake with a catch-all return would answer them wrongly.
 */
function build(
  seeds: LineSeed[],
  options: { status?: GeneratedListStatus; asGuest?: boolean } = {}
): Harness {
  const list = {
    id: BASKET,
    ownerUserId: OWNER,
    name: null,
    status: options.status ?? GeneratedListStatus.ACTIVE,
    generatedAt: new Date('2026-09-01T10:00:00.000Z'),
    sourceSnapshot: { profileId: null, pricingProfileId: null, sources: [] },
    defaultTargetListId: null,
    idempotencyKey: null,
  } as GeneratedList;

  const store: Store = { lines: [], origins: [], options: [], settlements: [] };
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}-${(sequence += 1)}`;

  for (const seed of seeds) {
    store.lines.push({
      id: seed.id,
      generatedListId: BASKET,
      content: seed.content ?? 'Milk',
      quantity: seed.quantity,
      settledQuantity: seed.settledQuantity ?? 0,
      itemId: seed.itemId === undefined ? SKIMMED : seed.itemId,
      origin: GeneratedLineOrigin.DERIVED,
      targetListId: null,
      position: seed.position,
      createdByParticipantId:
        seed.createdByParticipantId === undefined
          ? AUTHOR
          : seed.createdByParticipantId,
      lastEditedByParticipantId: null,
      lastEditedAt: null,
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
      updatedAt: new Date('2026-09-01T10:00:00.000Z'),
    } as GeneratedListLine);

    (seed.origins ?? []).forEach((origin, index) => {
      const at = origin.at === 'flat' ? FLAT : PARENTS;
      store.origins.push({
        id: nextId('glo'),
        generatedListLineId: seed.id,
        zoneId: at.zoneId,
        listId: at.listId,
        lineId: at.lineId,
        quantity: origin.quantity,
        lineVersion: origin.version ?? 1,
        // Ordered by the seed's own order, which is the "oldest first" the
        // allocation rule walks.
        createdAt: new Date(Date.UTC(2026, 8, 1, 10, index)),
      } as GeneratedListLineOrigin);
    });

    (seed.options ?? [SKIMMED, WHOLE, LACTOSE_FREE]).forEach(
      (itemId, position) => {
        store.options.push({
          id: nextId('gopt'),
          generatedListLineId: seed.id,
          itemId,
          position,
          createdAt: new Date('2026-09-01T10:00:00.000Z'),
        } as GeneratedListLineOption);
      }
    );
  }

  const matches = (
    row: Record<string, unknown>,
    where: Record<string, unknown>
  ) =>
    Object.entries(where).every(([key, value]) => {
      const held = row[key];
      if (value && typeof value === 'object' && '_value' in (value as object)) {
        // TypeORM's `In(...)`, which is the only operator this file uses.
        return ((value as { _value: unknown[] })._value as unknown[]).includes(
          held
        );
      }
      return held === value;
    });

  const table = <T extends { id: string }>(rows: T[], prefix: string) => ({
    find: async (query?: { where?: Record<string, unknown> }) =>
      rows.filter((row) => matches(row as never, query?.where ?? {})) as T[],
    findOne: async (query: { where: Record<string, unknown> }) =>
      rows.find((row) => matches(row as never, query.where)) ?? null,
    create: (data: Partial<T>) => ({ ...data }) as T,
    save: async (input: T | T[]) => {
      const many = Array.isArray(input) ? input : [input];
      for (const row of many) {
        row.id = row.id ?? nextId(prefix);
        // What `@CreateDateColumn` does, and it is load bearing rather than
        // cosmetic: the allocation rule walks provenance rows oldest first, so a
        // row inserted with no timestamp would sort wherever the engine felt.
        const stamped = row as { createdAt?: Date };
        stamped.createdAt = stamped.createdAt ?? new Date(Date.UTC(2026, 8, 2));
        const at = rows.findIndex((held) => held.id === row.id);
        if (at === -1) {
          rows.push(row);
        } else {
          rows[at] = row;
        }
      }
      return input;
    },
    insert: async (values: Partial<T>[]) => {
      for (const value of values) {
        rows.push({ ...value, id: nextId(prefix) } as T);
      }
    },
    update: async (
      where: Record<string, unknown>,
      patch: Record<string, unknown>
    ) => {
      for (const row of rows) {
        if (matches(row as never, where)) {
          Object.assign(row, patch);
        }
      }
    },
    delete: async (where: Record<string, unknown>) => {
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (matches(rows[index] as never, where)) {
          rows.splice(index, 1);
        }
      }
    },
  });

  const lineRepo = table(store.lines, 'gll');
  const originRepo = table(store.origins, 'glo');
  const optionRepo = table(store.options, 'gopt');
  const settlementRepo = table(store.settlements, 'ls');

  const manager = {
    getRepository: (entity: { name: string }) => {
      switch (entity.name) {
        case 'GeneratedListLine':
          return lineRepo;
        case 'GeneratedListLineOrigin':
          return originRepo;
        case 'GeneratedListLineOption':
          return optionRepo;
        case 'LineSettlement':
          return settlementRepo;
        default:
          // Never a catch-all row set: a repository this file did not mean to
          // hand out is a test that passes for the wrong reason.
          throw new Error(`no fake repository for ${entity.name}`);
      }
    },
  } as unknown as EntityManager;

  const dataSource = {
    transaction: async <T>(work: (m: EntityManager) => Promise<T>) =>
      work(manager),
  } as unknown as DataSource;

  const events: Harness['events'] = [];
  const publisher = {
    emitToGeneratedList: (
      event: RealtimeEvent,
      _id: string,
      payload: { line?: { id: string } }
    ) => {
      events.push({ event, lineId: payload?.line?.id });
    },
    emitToUsers: (event: RealtimeEvent) => {
      events.push({ event });
    },
  } as unknown as CoreEventsPublisher;

  const generated = {
    basketLineViewFor: async (
      row: GeneratedListLine,
      seesZoneData: boolean
    ) => {
      const origins = store.origins.filter(
        (origin) => origin.generatedListLineId === row.id
      );
      return {
        id: row.id,
        content: row.content,
        quantity: row.quantity,
        settledQuantity: row.settledQuantity,
        itemId: row.itemId,
        // The redaction the whole participant surface turns on: a reader who
        // does not pass plan 0051 section 5.2 is handed no origins at all.
        origins: seesZoneData
          ? origins.map((origin) => ({ lineId: origin.lineId }))
          : undefined,
      } as unknown as GeneratedListBasketLineView;
    },
    viewFor: async () => ({ id: BASKET }),
  } as unknown as GeneratedListService;

  const guest = options.asGuest === true;
  const sharing = {
    liveParticipantById: async () => ({
      id: ACTOR,
      generatedListId: BASKET,
      kind: guest ? ParticipantKind.GUEST : ParticipantKind.OWNER,
      userId: guest ? null : OWNER,
      revokedAt: null,
    }),
    seesZoneData: async () => !guest,
  } as unknown as GeneratedListSharingService;

  const service = new GeneratedListSplitService(
    dataSource,
    { findOne: async () => list } as never,
    lineRepo as never,
    optionRepo as never,
    settlementRepo as never,
    sharing,
    generated,
    publisher
  );

  return {
    service,
    store,
    events,
    lineOf: (id) => store.lines.find((row) => row.id === id),
    originsOf: (id) =>
      store.origins
        .filter((row) => row.generatedListLineId === id)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
  };
}

function split(
  harness: Harness,
  from: number,
  shares: { itemId: string; quantity: number }[],
  lineId = LINE
) {
  return harness.service.split({
    generatedListId: BASKET,
    lineId,
    participantId: ACTOR,
    from,
    shares,
  });
}

describe('choosing several products splits the line (sections 1 to 3)', () => {
  it('reassigns the original and creates one sibling when nothing is left over', async () => {
    // Milk 5, skimmed, and the shopper took three whole and two lactose free.
    // The original keeps its id and its place; it is not deleted and recreated,
    // so "who put this here" and anything hanging off the row survive.
    const harness = build([
      {
        id: LINE,
        quantity: 5,
        position: 1,
        origins: [{ at: 'flat', quantity: 5 }],
      },
    ]);

    const result = await split(harness, 5, [
      { itemId: WHOLE, quantity: 3 },
      { itemId: LACTOSE_FREE, quantity: 2 },
    ]);

    const original = harness.lineOf(LINE);
    expect(original).toMatchObject({ itemId: WHOLE, quantity: 3 });
    expect(result.created).toHaveLength(1);
    expect(result.removed).toEqual([]);

    const sibling = harness.lineOf(result.created[0].id);
    expect(sibling).toMatchObject({
      content: 'Milk',
      itemId: LACTOSE_FREE,
      quantity: 2,
      settledQuantity: 0,
      // The person who put milk here put this milk here.
      createdByParticipantId: AUTHOR,
      lastEditedByParticipantId: ACTOR,
    });
  });

  it('keeps the balance on the original and puts the sibling directly under it', async () => {
    const harness = build([
      {
        id: LINE,
        quantity: 5,
        position: 1,
        origins: [{ at: 'flat', quantity: 5 }],
      },
      {
        id: 'gll-bread',
        content: 'Bread',
        quantity: 1,
        position: 2,
        itemId: null,
      },
    ]);

    const result = await split(harness, 5, [{ itemId: WHOLE, quantity: 1 }]);

    expect(harness.lineOf(LINE)).toMatchObject({
      itemId: SKIMMED,
      quantity: 4,
    });
    const sibling = harness.lineOf(result.created[0].id);
    // The midpoint, so the sibling sits between the original and the bread and
    // nothing else has to move.
    expect(sibling?.position).toBe(1.5);
    expect(harness.lineOf('gll-bread')?.position).toBe(2);
  });

  it('copies the options onto the sibling, so it can be split again', async () => {
    const harness = build([
      {
        id: LINE,
        quantity: 5,
        position: 1,
        origins: [{ at: 'flat', quantity: 5 }],
      },
    ]);
    const result = await split(harness, 5, [{ itemId: WHOLE, quantity: 1 }]);

    const copied = harness.store.options
      .filter((row) => row.generatedListLineId === result.created[0].id)
      .map((row) => row.itemId);
    expect(copied).toEqual([SKIMMED, WHOLE, LACTOSE_FREE]);
  });

  it('leaves a group added line with no product exactly that (section 2.2)', async () => {
    // The case where "which one did you get?" is answered by the split itself.
    const harness = build([
      {
        id: LINE,
        itemId: null,
        quantity: 4,
        position: 1,
        origins: [{ at: 'flat', quantity: 4 }],
      },
    ]);

    await split(harness, 4, [{ itemId: WHOLE, quantity: 1 }]);

    expect(harness.lineOf(LINE)).toMatchObject({ itemId: null, quantity: 3 });
  });
});

describe('the origins split with the units (section 3.1)', () => {
  it('gives them oldest first, and moves no zone line', async () => {
    // Flat 2 (older) and parents 3, and three units go to whole: whole takes the
    // flat's two and one of the parents', and the original keeps parents 2.
    const harness = build([
      {
        id: LINE,
        quantity: 5,
        position: 1,
        origins: [
          { at: 'flat', quantity: 2 },
          { at: 'parents', quantity: 3 },
        ],
      },
    ]);

    const result = await split(harness, 5, [{ itemId: WHOLE, quantity: 3 }]);

    expect(
      harness
        .originsOf(result.created[0].id)
        .map((row) => [row.lineId, row.quantity])
    ).toEqual([
      [FLAT.lineId, 2],
      [PARENTS.lineId, 1],
    ]);
    // The flat's row is gone from the original: it reached zero with nothing
    // settled against it.
    expect(
      harness.originsOf(LINE).map((row) => [row.lineId, row.quantity])
    ).toEqual([[PARENTS.lineId, 2]]);
    // The lists asked for what they asked for. Nothing in this file may write a
    // zone line, and no zone event may leave it.
    expect(harness.events.map((entry) => entry.event)).not.toContain(
      RealtimeEvent.LineUpdated
    );
  });

  it('carries the zone, the list and the version onto the row it writes', async () => {
    const harness = build([
      {
        id: LINE,
        quantity: 3,
        position: 1,
        origins: [{ at: 'parents', quantity: 3, version: 7 }],
      },
    ]);

    const result = await split(harness, 3, [{ itemId: WHOLE, quantity: 2 }]);

    expect(harness.originsOf(result.created[0].id)[0]).toMatchObject({
      zoneId: PARENTS.zoneId,
      listId: PARENTS.listId,
      lineId: PARENTS.lineId,
      quantity: 2,
      lineVersion: 7,
    });
  });

  it('splits only the outstanding units, and an origin keeps its settled floor', async () => {
    // Five asked for, two already bought against the flat. The outstanding three
    // are what may move, and the flat's row cannot go below the two it bought.
    const harness = build([
      {
        id: LINE,
        quantity: 5,
        settledQuantity: 2,
        position: 1,
        origins: [{ at: 'flat', quantity: 5 }],
      },
    ]);
    harness.store.settlements.push({
      id: 'ls-1',
      generatedListLineId: LINE,
      lineId: FLAT.lineId,
      listId: FLAT.listId,
      outcome: SettlementOutcome.BOUGHT,
      quantity: 2,
      revertedAt: null,
    } as LineSettlement);

    const result = await split(harness, 3, [{ itemId: WHOLE, quantity: 3 }]);

    // The settled units stay on the original, with the product they were
    // settled as: history is not rewritten because a later unit was a different
    // milk.
    expect(harness.lineOf(LINE)).toMatchObject({
      itemId: SKIMMED,
      quantity: 2,
      settledQuantity: 2,
    });
    expect(harness.originsOf(LINE).map((row) => row.quantity)).toEqual([2]);
    expect(
      harness.originsOf(result.created[0].id).map((row) => row.quantity)
    ).toEqual([3]);
    expect(result.removed).toEqual([]);
  });
});

describe('a share for a product that already has a row (section 5)', () => {
  it('raises the sibling rather than creating a second one', async () => {
    const harness = build([
      {
        id: LINE,
        quantity: 5,
        position: 1,
        origins: [{ at: 'flat', quantity: 5 }],
      },
      {
        id: 'gll-whole',
        itemId: WHOLE,
        quantity: 1,
        position: 1.5,
        origins: [{ at: 'flat', quantity: 1 }],
      },
    ]);

    const result = await split(harness, 5, [{ itemId: WHOLE, quantity: 2 }]);

    expect(result.created).toEqual([]);
    expect(result.merged.map((row) => row.id)).toEqual(['gll-whole']);
    expect(harness.lineOf('gll-whole')).toMatchObject({ quantity: 3 });
    expect(harness.lineOf(LINE)).toMatchObject({ quantity: 3 });
    // Origin rows on the same zone line sum rather than colliding: the unique
    // constraint is per basket line.
    expect(harness.originsOf('gll-whole').map((row) => row.quantity)).toEqual([
      3,
    ]);
  });

  it('lands a second share for one product on the row the first made', async () => {
    // A request naming a product twice says one thing about it, and the rule
    // that keeps a product on one row is the same one whether the row was there
    // before this act or was made by it.
    const harness = build([
      {
        id: LINE,
        quantity: 5,
        position: 1,
        origins: [{ at: 'flat', quantity: 5 }],
      },
    ]);

    const result = await split(harness, 5, [
      { itemId: WHOLE, quantity: 2 },
      { itemId: WHOLE, quantity: 1 },
    ]);

    expect(result.created).toHaveLength(1);
    expect(harness.lineOf(result.created[0].id)).toMatchObject({ quantity: 3 });
    expect(harness.lineOf(LINE)).toMatchObject({ quantity: 2 });
  });

  it('lands one on the reassigned original too, rather than making its twin', async () => {
    // The original is taken by the first share, so it is an ordinary row naming
    // that product by the time the second one is placed.
    const harness = build([
      {
        id: LINE,
        quantity: 4,
        position: 1,
        origins: [{ at: 'flat', quantity: 4 }],
      },
    ]);

    const result = await split(harness, 4, [
      { itemId: WHOLE, quantity: 3 },
      { itemId: WHOLE, quantity: 1 },
    ]);

    expect(result.created).toEqual([]);
    expect(result.merged).toEqual([]);
    expect(harness.store.lines).toHaveLength(1);
    expect(harness.lineOf(LINE)).toMatchObject({ itemId: WHOLE, quantity: 4 });
    expect(harness.originsOf(LINE).map((row) => row.quantity)).toEqual([4]);
  });

  it('folds a sibling away when every unit goes back, with its rows on the survivor', async () => {
    const harness = build([
      {
        id: LINE,
        quantity: 3,
        position: 1,
        origins: [{ at: 'flat', quantity: 3 }],
      },
      {
        id: 'gll-whole',
        itemId: WHOLE,
        quantity: 2,
        position: 1.5,
        origins: [{ at: 'flat', quantity: 2 }],
      },
    ]);
    // A purchase taken back sits on the sibling: it has no units left and still
    // holds history, which must come home to the survivor so a reopen finds it.
    harness.store.settlements.push({
      id: 'ls-1',
      generatedListLineId: 'gll-whole',
      lineId: FLAT.lineId,
      listId: FLAT.listId,
      outcome: SettlementOutcome.BOUGHT,
      quantity: 1,
      revertedAt: new Date('2026-09-02T10:00:00.000Z'),
    } as LineSettlement);

    const result = await split(
      harness,
      2,
      [{ itemId: SKIMMED, quantity: 2 }],
      'gll-whole'
    );

    expect(result.removed).toEqual(['gll-whole']);
    expect(harness.lineOf('gll-whole')).toBeUndefined();
    expect(harness.lineOf(LINE)).toMatchObject({ quantity: 5 });
    expect(harness.originsOf(LINE).map((row) => row.quantity)).toEqual([5]);
    expect(harness.store.settlements[0].generatedListLineId).toBe(LINE);
  });
});

describe('what a split refuses, and writes nothing when it does (section 2.1)', () => {
  const seed = (): LineSeed[] => [
    {
      id: LINE,
      quantity: 5,
      position: 1,
      origins: [{ at: 'flat', quantity: 5 }],
    },
  ];

  it('refuses a stale `from`, naming the amount as it now stands', async () => {
    const harness = build(seed());
    await expect(
      split(harness, 4, [{ itemId: WHOLE, quantity: 1 }])
    ).rejects.toBeInstanceOf(StaleQuantityException);
    expect(harness.store.lines).toHaveLength(1);
  });

  it('refuses a product that is not one of the line’s options', async () => {
    const harness = build(seed());
    await expect(
      split(harness, 5, [{ itemId: 'item-goat', quantity: 1 }])
    ).rejects.toBeInstanceOf(ValidationException);
    expect(harness.store.lines).toHaveLength(1);
  });

  it('refuses the line’s own product, which is the balance', async () => {
    const harness = build(seed());
    await expect(
      split(harness, 5, [{ itemId: SKIMMED, quantity: 1 }])
    ).rejects.toBeInstanceOf(ValidationException);
    expect(harness.store.lines).toHaveLength(1);
  });

  it('refuses shares that sum to more than is outstanding', async () => {
    const harness = build(seed());
    await expect(
      split(harness, 5, [
        { itemId: WHOLE, quantity: 4 },
        { itemId: LACTOSE_FREE, quantity: 2 },
      ])
    ).rejects.toBeInstanceOf(ValidationException);
    expect(harness.store.lines).toHaveLength(1);
  });

  it('folds a share of zero out rather than refusing it', async () => {
    const harness = build(seed());
    const result = await split(harness, 5, [
      { itemId: WHOLE, quantity: 0 },
      { itemId: LACTOSE_FREE, quantity: 2 },
    ]);

    expect(result.created).toHaveLength(1);
    expect(result.created[0].itemId).toBe(LACTOSE_FREE);
    expect(harness.lineOf(LINE)).toMatchObject({ quantity: 3 });
  });

  it('writes and says nothing at all when every share is zero', async () => {
    const harness = build(seed());
    const result = await split(harness, 5, [{ itemId: WHOLE, quantity: 0 }]);

    expect(result).toMatchObject({ created: [], merged: [], removed: [] });
    expect(harness.lineOf(LINE)).toMatchObject({ quantity: 5 });
    expect(harness.events).toEqual([]);
  });
});

describe('what the room hears, and what a guest is handed (sections 6 and 8)', () => {
  it('appends the siblings and updates the original, and emits no zone event', async () => {
    const harness = build([
      {
        id: LINE,
        quantity: 5,
        position: 1,
        origins: [{ at: 'flat', quantity: 5 }],
      },
    ]);

    await split(harness, 5, [{ itemId: WHOLE, quantity: 1 }]);

    expect(harness.events.map((entry) => entry.event)).toEqual([
      RealtimeEvent.GeneratedListLineAdded,
      RealtimeEvent.GeneratedListLineUpdated,
    ]);
  });

  it('lets a guest split, and hands them an answer with no origins', async () => {
    // The products are catalog data and the origins that move with them are
    // never shown to anybody who could not see them already, so the write is
    // open and only the answer is redacted.
    const harness = build(
      [
        {
          id: LINE,
          quantity: 5,
          position: 1,
          origins: [{ at: 'flat', quantity: 5 }],
        },
      ],
      { asGuest: true }
    );

    const result = await split(harness, 5, [{ itemId: WHOLE, quantity: 2 }]);

    expect(result.line.origins).toBeUndefined();
    expect(result.created[0].origins).toBeUndefined();
    // The write itself happened: the guest is refused nothing here.
    expect(
      harness.originsOf(result.created[0].id).map((row) => row.quantity)
    ).toEqual([2]);
  });
});
