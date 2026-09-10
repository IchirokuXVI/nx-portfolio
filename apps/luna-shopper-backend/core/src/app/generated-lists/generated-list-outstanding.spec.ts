import {
  GeneratedListStatus,
  ParticipantKind,
  RealtimeEvent,
  SettlementOutcome,
  type SettleGeneratedListLineRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  GeneratedListFinishedException,
  StaleQuantityException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type { DataSource } from 'typeorm';
import {
  GeneratedListLine,
  LineSettlement,
  ListLine,
  ListLineItem,
  ShoppingList,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { fakeLineSettlements } from '../lists/line-settlements.fake';
import { GeneratedListOutstandingService } from './generated-list-outstanding.service';
import { GeneratedListReopenService } from './generated-list-reopen.service';
import { GeneratedListSettleService } from './generated-list-settle.service';
import type { GeneratedListSharingService } from './generated-list-sharing.service';
import type { GeneratedListService } from './generated-list.service';
import { fakeLineClaims, type FakeLineClaims } from './line-claims.fake';

/**
 * What is outstanding is a number you can move (plan 0056, rewritten by plan
 * 0104).
 *
 * ## The real settle and the real revert sit behind this, on purpose
 *
 * The harness wires an actual {@link GeneratedListSettleService} and an actual
 * {@link GeneratedListReopenService} into the service under test rather than
 * mocks of them, because the plan's whole claim about both directions is that
 * they **are** those operations: the same allocation, the same owner access
 * check, the same settlement rows, the same split, the same events. A mock would
 * assert that a call was made and would keep passing on the day the two paths
 * started disagreeing about who bought a tin, which is the failure the plan is
 * written against.
 *
 * The requests that reach the settle are recorded as well as delegated, which is
 * what lets one test state a negative the rows cannot: `NOT_AVAILABLE` is not
 * expressible from this control at all (plan 0056, section 6).
 *
 * Faked at the repository boundary in the style `generated-list-settle.spec.ts`
 * established, and against the same settlements fake, so "the row was marked
 * rather than deleted" is an assertion about rows rather than about a call.
 */

const OWNER = 'u-owner';
const ACTOR = 'p-guest';
const BASKET = 'gl-1';
const BASKET_LINE = 'gll-1';
const LIST_A = 'l-flat';
const LIST_B = 'l-parents';
const ZONE_A = 'z-flat';
const ZONE_B = 'z-parents';

interface OriginSeed {
  id: string;
  lineId: string;
  listId: string;
  zoneId: string;
  quantity: number;
  /** Lower sorts first, standing in for `createdAt`. */
  order: number;
}

interface SettlementSeed {
  id: string;
  /**
   * The zone line it landed on, or null for a **waiting** purchase: one made
   * before this basket line reached any list (plan 0093, section 2).
   */
  lineId: string | null;
  listId: string | null;
  quantity: number;
  outcome?: SettlementOutcome;
  /** Lower is older, which is what a revert walks backwards through. */
  order: number;
}

interface Harness {
  service: GeneratedListOutstandingService;
  reopenService: GeneratedListReopenService;
  settlements: Partial<LineSettlement>[];
  zoneLines: Map<
    string,
    { id: string; listId: string; quantity: number; version: number }
  >;
  basketLine: Partial<GeneratedListLine>;
  events: {
    event: RealtimeEvent;
    listId?: string;
    generatedListId?: string;
    userIds?: string[];
  }[];
  /** Every request that reached the settle, in order. */
  settleCalls: SettleGeneratedListLineRequest[];
  claims: FakeLineClaims;
}

function build(
  options: {
    quantity?: number;
    settledQuantity?: number;
    origins?: OriginSeed[];
    /** What this basket line has already settled, for a revert to walk. */
    settlements?: SettlementSeed[];
    /** The zone line's own quantity, which a purchase comes off. */
    zoneQuantity?: number;
    /** Origins whose zone line has been deleted underneath the basket. */
    missingZoneLines?: string[];
    /** Which lists the **owner** may write, at request time (plan 0051, 6.4). */
    ownerWritable?: string[];
    status?: GeneratedListStatus;
    actorSeesZoneData?: boolean;
  } = {}
): Harness {
  const origins = options.origins ?? [
    {
      id: 'o-1',
      lineId: 'zl-1',
      listId: LIST_A,
      zoneId: ZONE_A,
      quantity: 5,
      order: 1,
    },
  ];
  const ownerWritable = new Set(
    options.ownerWritable ?? origins.map((origin) => origin.listId)
  );
  const missing = new Set(options.missingZoneLines ?? []);

  const basketLine: Partial<GeneratedListLine> = {
    id: BASKET_LINE,
    generatedListId: BASKET,
    quantity: options.quantity ?? 5,
    settledQuantity: options.settledQuantity ?? 0,
    itemId: null,
  };

  const zoneLines = new Map(
    origins
      .filter((origin) => !missing.has(origin.lineId))
      .map((origin) => [
        origin.lineId,
        {
          id: origin.lineId,
          listId: origin.listId,
          quantity: options.zoneQuantity ?? 5,
          version: 1,
          content: 'milk',
          position: 0,
          approvalStatus: 'APPROVED',
          createdByUserId: OWNER,
          approvedByUserId: OWNER,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ])
  );

  const settlementRows = fakeLineSettlements(
    (options.settlements ?? []).map((seed) => ({
      id: seed.id,
      lineId: seed.lineId,
      listId: seed.listId,
      itemId: null,
      outcome: seed.outcome ?? SettlementOutcome.BOUGHT,
      quantity: seed.quantity,
      settledByUserId: null,
      settledByParticipantId: ACTOR,
      settledAt: new Date(2026, 0, 1, 0, seed.order),
      revertedAt: null,
      revertedByParticipantId: null,
      generatedListLineId: BASKET_LINE,
      pricePaidCents: null,
      supermarketLocationId: null,
    }))
  );
  const events: Harness['events'] = [];

  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === ListLine) {
        return {
          findOne: async ({ where }: { where: { id: string } }) =>
            zoneLines.get(where.id) ?? null,
          save: async (row: {
            id: string;
            quantity: number;
            version: number;
          }) => {
            const existing = zoneLines.get(row.id);
            if (existing) {
              zoneLines.set(row.id, { ...existing, ...row });
            }
            return row;
          },
        };
      }
      if (entity === LineSettlement) {
        return settlementRows.repo;
      }
      if (entity === ListLineItem) {
        return { find: async () => [] };
      }
      if (entity === ShoppingList) {
        return {
          find: async () => [
            { id: LIST_A, zoneId: ZONE_A },
            { id: LIST_B, zoneId: ZONE_B },
          ],
        };
      }
      if (entity === GeneratedListLine) {
        return {
          // A **copy**, as a second read of the same row is in production: the
          // revert locks its own instance and has to carry what it wrote back
          // onto the one the response is composed from. Handing the same object
          // out twice would hide a missing write back.
          findOne: async () => ({ ...basketLine }),
          save: async (row: Partial<GeneratedListLine>) => {
            Object.assign(basketLine, row);
            return row;
          },
        };
      }
      throw new Error('unmocked repository in the transaction');
    },
  };

  const dataSource = {
    transaction: async (fn: (m: typeof manager) => Promise<unknown>) =>
      fn(manager),
  } as unknown as DataSource;

  const seesZoneData = options.actorSeesZoneData ?? true;

  const sharing = {
    livePresenceEntry: async () => ({
      participantId: ACTOR,
      kind: seesZoneData ? ParticipantKind.REGISTERED : ParticipantKind.GUEST,
      displayName: null,
      guestNumber: seesZoneData ? null : 1,
      userId: null,
    }),
    liveParticipantById: async () => ({ id: ACTOR }),
    seesZoneData: async () => seesZoneData,
    // Section 6.4 in one fake: asked about the **owner**, never the actor, which
    // is what makes a guest lowering the number safe at all.
    writableAmong: async (userId: string, listIds: readonly string[]) => {
      expect(userId).toBe(OWNER);
      return new Set(listIds.filter((listId) => ownerWritable.has(listId)));
    },
  } as unknown as GeneratedListSharingService;

  const shoppingLists = {
    find: async ({ where }: { where: { id: { _value: string[] } } }) =>
      [
        { id: LIST_A, name: 'Weekly shop', zone: { name: 'Flat 3B' } },
        { id: LIST_B, name: 'Parents', zone: { name: 'Parents’ house' } },
      ].filter((row) => where.id._value.includes(row.id)),
  } as never;

  const generated = {
    // Read off the **line it is handed** rather than off the seed row, so a
    // revert that failed to carry its write back would answer with the old
    // number and be caught here rather than in a shop.
    basketLineViewFor: async (
      line: Partial<GeneratedListLine>,
      lineSeesZoneData: boolean
    ) => ({
      id: line.id,
      quantity: line.quantity,
      settledQuantity: line.settledQuantity,
      itemId: line.itemId,
      lastEditedByParticipantId: line.lastEditedByParticipantId,
      ...(lineSeesZoneData ? { targetListId: null } : {}),
    }),
  } as unknown as GeneratedListService;

  const claims = fakeLineClaims({}, () =>
    origins.map((origin) => ({
      zoneId: origin.zoneId,
      listId: origin.listId,
      lineId: origin.lineId,
    }))
  );

  const publisher = {
    emit: (
      event: RealtimeEvent,
      _zoneId: string,
      _payload: unknown,
      listId?: string
    ) => events.push({ event, listId }),
    emitToGeneratedList: (event: RealtimeEvent, generatedListId: string) =>
      events.push({ event, generatedListId }),
    emitToUsers: (event: RealtimeEvent, userIds: string[]) =>
      events.push({ event, userIds }),
  } as unknown as CoreEventsPublisher;

  const lists = {
    findOne: async () => ({
      id: BASKET,
      ownerUserId: OWNER,
      status: options.status ?? GeneratedListStatus.ACTIVE,
    }),
  } as never;
  const lines = { findOne: async () => basketLine } as never;

  const settle = new GeneratedListSettleService(
    dataSource,
    lists,
    lines,
    {
      find: async () => [...origins].sort((a, b) => a.order - b.order),
    } as never,
    { findOne: async () => null } as never,
    shoppingLists,
    sharing,
    generated,
    claims.service,
    publisher
  );

  const reopenService = new GeneratedListReopenService(
    dataSource,
    lists,
    lines,
    sharing,
    generated,
    claims.service,
    publisher
  );

  const settleCalls: SettleGeneratedListLineRequest[] = [];
  const recording = {
    settle: (req: SettleGeneratedListLineRequest) => {
      settleCalls.push(req);
      return settle.settle(req);
    },
  } as unknown as GeneratedListSettleService;

  const service = new GeneratedListOutstandingService(
    lists,
    lines,
    sharing,
    generated,
    recording,
    reopenService
  );

  return {
    service,
    reopenService,
    settlements: settlementRows.rows,
    zoneLines: zoneLines as Harness['zoneLines'],
    basketLine,
    events,
    settleCalls,
    claims,
  };
}

function move(harness: Harness, outstanding: number, from: number) {
  return harness.service.setOutstanding({
    generatedListId: BASKET,
    lineId: BASKET_LINE,
    participantId: ACTOR,
    outstanding,
    from,
  });
}

/** Two origins, three units bought off the older one and two off the newer. */
function twoOrigins(): Parameters<typeof build>[0] {
  return {
    quantity: 5,
    settledQuantity: 5,
    zoneQuantity: 0,
    origins: [
      {
        id: 'o-1',
        lineId: 'zl-1',
        listId: LIST_A,
        zoneId: ZONE_A,
        quantity: 3,
        order: 1,
      },
      {
        id: 'o-2',
        lineId: 'zl-2',
        listId: LIST_B,
        zoneId: ZONE_B,
        quantity: 2,
        order: 2,
      },
    ],
    settlements: [
      { id: 's-1', lineId: 'zl-1', listId: LIST_A, quantity: 3, order: 1 },
      { id: 's-2', lineId: 'zl-2', listId: LIST_B, quantity: 2, order: 2 },
    ],
  };
}

describe('raising takes purchases back, newest first (section 3.1)', () => {
  it('reverts exactly the units asked for and puts them back where they came from', async () => {
    const harness = build(twoOrigins());

    const result = await move(harness, 2, 0);

    // The newest purchase is the parents' two, so those are the ones undone.
    expect(harness.basketLine.settledQuantity).toBe(3);
    expect(result.line.settledQuantity).toBe(3);
    expect(harness.zoneLines.get('zl-2')?.quantity).toBe(2);
    expect(harness.zoneLines.get('zl-1')?.quantity).toBe(0);
  });

  it('never writes quantity, so the basket cannot buy more than was asked for', async () => {
    // Section 2.1: the raise branch that moved this number is gone.
    const harness = build(twoOrigins());

    await move(harness, 2, 0);

    expect(harness.basketLine.quantity).toBe(5);
  });

  it('marks the row it took back rather than deleting it', async () => {
    const harness = build(twoOrigins());

    await move(harness, 2, 0);

    const taken = harness.settlements.find((row) => row.id === 's-2');
    expect(taken?.revertedAt).toBeInstanceOf(Date);
    expect(taken?.revertedByParticipantId).toBe(ACTOR);
    expect(
      harness.settlements.find((row) => row.id === 's-1')?.revertedAt
    ).toBe(null);
  });

  it('walks past the newest purchase when one is not enough', async () => {
    const harness = build(twoOrigins());

    await move(harness, 4, 0);

    // Two off the parents' list and two of the flat's three, which is the walk
    // reaching into the older purchase after exhausting the newer one.
    expect(harness.basketLine.settledQuantity).toBe(1);
    expect(harness.zoneLines.get('zl-2')?.quantity).toBe(2);
    expect(harness.zoneLines.get('zl-1')?.quantity).toBe(2);
  });

  it('tells each household and the basket room, on the events they already handle', async () => {
    const harness = build(twoOrigins());

    await move(harness, 5, 0);

    expect(harness.events).toEqual([
      { event: RealtimeEvent.LineSettled, listId: LIST_A },
      { event: RealtimeEvent.LineSettled, listId: LIST_B },
      {
        event: RealtimeEvent.GeneratedListLineSettled,
        generatedListId: BASKET,
      },
      { event: RealtimeEvent.GeneratedListLineSettled, userIds: [OWNER] },
    ]);
  });

  it('takes the claim back when a finished line becomes outstanding again', async () => {
    const harness = build(twoOrigins());

    await move(harness, 1, 0);

    expect(harness.claims.announced).toEqual([
      expect.objectContaining({ lineId: 'zl-1', claimed: true }),
      expect.objectContaining({ lineId: 'zl-2', claimed: true }),
    ]);
  });

  it('records who moved it', async () => {
    const harness = build(twoOrigins());

    await move(harness, 2, 0);

    expect(harness.basketLine.lastEditedByParticipantId).toBe(ACTOR);
  });

  it('answers the settle’s own shape, with nothing settled in it', async () => {
    const harness = build(twoOrigins());

    const result = await move(harness, 2, 0);

    // One response shape in both directions. A revert takes rows away, so there
    // is no settlement ref to name: a ref says where units landed.
    expect(result.skippedCount).toBe(0);
    expect(result.settlements).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('reports an origin whose zone line was deleted rather than failing', async () => {
    const harness = build({ ...twoOrigins(), missingZoneLines: ['zl-2'] });

    const result = await move(harness, 2, 0);

    // The units have nowhere to go back to, the row is marked all the same, and
    // the shopper is told something did not land (plan 0051, section 6.4).
    expect(result.skippedCount).toBe(1);
    expect(harness.basketLine.settledQuantity).toBe(3);
  });
});

describe('the number cannot go above what the lists asked for (section 2)', () => {
  it('refuses an outstanding above the line’s own quantity, and moves nothing', async () => {
    const harness = build(twoOrigins());

    await expect(move(harness, 6, 0)).rejects.toBeInstanceOf(
      ValidationException
    );
    expect(harness.basketLine.quantity).toBe(5);
    expect(harness.basketLine.settledQuantity).toBe(5);
    expect(harness.settlements.every((row) => row.revertedAt === null)).toBe(
      true
    );
  });

  it('allows the top itself, which is every purchase taken back', async () => {
    const harness = build(twoOrigins());

    const result = await move(harness, 5, 0);

    expect(result.line.settledQuantity).toBe(0);
  });

  it('refuses a negative outstanding', async () => {
    const harness = build({ quantity: 5 });

    await expect(move(harness, -1, 5)).rejects.toBeInstanceOf(
      ValidationException
    );
  });
});

describe('a take back that lands inside a purchase splits it (section 3.2)', () => {
  it('reverts the original in full and appends what still stands', async () => {
    const harness = build({
      quantity: 3,
      settledQuantity: 3,
      zoneQuantity: 0,
      origins: [
        {
          id: 'o-1',
          lineId: 'zl-1',
          listId: LIST_A,
          zoneId: ZONE_A,
          quantity: 3,
          order: 1,
        },
      ],
      settlements: [
        { id: 's-1', lineId: 'zl-1', listId: LIST_A, quantity: 3, order: 1 },
      ],
    });

    await move(harness, 1, 0);

    const original = harness.settlements.find((row) => row.id === 's-1');
    expect(original?.revertedAt).toBeInstanceOf(Date);
    expect(original?.quantity).toBe(3);

    const standing = harness.settlements.filter((row) => !row.revertedAt);
    expect(standing).toHaveLength(1);
    // The buyer and the time of the purchase it came out of, because that is
    // when the shopping happened and it has not changed.
    expect(standing[0]).toEqual(
      expect.objectContaining({
        quantity: 2,
        lineId: 'zl-1',
        listId: LIST_A,
        settledByParticipantId: ACTOR,
        settledAt: original?.settledAt,
        revertedAt: null,
      })
    );
    expect(standing[0].id).not.toBe('s-1');
  });

  it('leaves the consumption total at what still stands', async () => {
    const harness = build({
      quantity: 3,
      settledQuantity: 3,
      zoneQuantity: 0,
      settlements: [
        { id: 's-1', lineId: 'zl-1', listId: LIST_A, quantity: 3, order: 1 },
      ],
    });

    await move(harness, 1, 0);

    expect(harness.basketLine.settledQuantity).toBe(2);
    expect(harness.zoneLines.get('zl-1')?.quantity).toBe(1);
  });
});

describe('a close has no units to divide (section 3.3)', () => {
  it('takes the whole close back, and the answer says where the number landed', async () => {
    // Six asked for, two bought and four closed as unavailable, raised by one.
    const harness = build({
      quantity: 6,
      settledQuantity: 6,
      zoneQuantity: 0,
      origins: [
        {
          id: 'o-1',
          lineId: 'zl-1',
          listId: LIST_A,
          zoneId: ZONE_A,
          quantity: 6,
          order: 1,
        },
      ],
      settlements: [
        { id: 's-1', lineId: 'zl-1', listId: LIST_A, quantity: 2, order: 1 },
        {
          id: 's-2',
          lineId: 'zl-1',
          listId: LIST_A,
          quantity: 0,
          outcome: SettlementOutcome.NOT_AVAILABLE,
          order: 2,
        },
      ],
    });

    const result = await move(harness, 1, 0);

    // Four rather than three, which is the one case the number lands somewhere
    // other than where it was dragged. It errs toward "not bought".
    expect(result.line.settledQuantity).toBe(2);
    expect(harness.basketLine.settledQuantity).toBe(2);
    // The purchase underneath it stands, and the close moved no units, so the
    // household's line does not move either.
    expect(
      harness.settlements.find((row) => row.id === 's-1')?.revertedAt
    ).toBe(null);
    expect(harness.zoneLines.get('zl-1')?.quantity).toBe(0);
  });

  it('marks the close, so the indicator stops saying the shop had none', async () => {
    const harness = build({
      quantity: 2,
      settledQuantity: 2,
      zoneQuantity: 0,
      settlements: [
        {
          id: 's-1',
          lineId: 'zl-1',
          listId: LIST_A,
          quantity: 0,
          outcome: SettlementOutcome.NOT_AVAILABLE,
          order: 1,
        },
      ],
    });

    await move(harness, 1, 0);

    expect(harness.settlements[0].revertedAt).toBeInstanceOf(Date);
    expect(harness.basketLine.settledQuantity).toBe(0);
  });
});

describe('a waiting purchase is taken back and nothing else (section 3.1)', () => {
  it('reverts it and moves no zone line at all', async () => {
    const harness = build({
      quantity: 4,
      settledQuantity: 4,
      zoneQuantity: 5,
      settlements: [
        { id: 's-1', lineId: null, listId: null, quantity: 4, order: 1 },
      ],
    });

    const result = await move(harness, 1, 0);

    expect(harness.settlements[0].revertedAt).toBeInstanceOf(Date);
    expect(result.line.settledQuantity).toBe(3);
    // It names no list, so nothing goes back onto a zone line for it, and no
    // household is told anything.
    expect(harness.zoneLines.get('zl-1')?.quantity).toBe(5);
    expect(
      harness.events.filter(
        (entry) => entry.event === RealtimeEvent.LineSettled
      )
    ).toHaveLength(0);
  });
});

describe('a raise to the top is the reopen (section 3.4)', () => {
  it('leaves identical rows', async () => {
    const raised = build(twoOrigins());
    const reopened = build(twoOrigins());

    await move(raised, 5, 0);
    await reopened.reopenService.reopen({
      generatedListId: BASKET,
      lineId: BASKET_LINE,
      participantId: ACTOR,
    });

    const shape = (harness: Harness) =>
      harness.settlements.map((row) => ({
        id: row.id,
        quantity: row.quantity,
        reverted: row.revertedAt !== null,
      }));
    expect(shape(raised)).toEqual(shape(reopened));
    expect(raised.basketLine.settledQuantity).toBe(
      reopened.basketLine.settledQuantity
    );
    expect([...raised.zoneLines.values()]).toEqual([
      ...reopened.zoneLines.values(),
    ]);
    expect(raised.events).toEqual(reopened.events);
  });
});

describe('lowering means that many were bought (section 1)', () => {
  it('settles the difference through the settle path, oldest origin first', async () => {
    const harness = build({
      quantity: 5,
      origins: [
        {
          id: 'o-1',
          lineId: 'zl-1',
          listId: LIST_A,
          zoneId: ZONE_A,
          quantity: 3,
          order: 1,
        },
        {
          id: 'o-2',
          lineId: 'zl-2',
          listId: LIST_B,
          zoneId: ZONE_B,
          quantity: 2,
          order: 2,
        },
      ],
      zoneQuantity: 5,
    });

    const result = await move(harness, 3, 5);

    expect(harness.basketLine.settledQuantity).toBe(2);
    // Both units land on the older origin, which is the default allocation the
    // settle already owns rather than a rule restated here.
    expect(harness.zoneLines.get('zl-1')?.quantity).toBe(3);
    expect(harness.zoneLines.get('zl-2')?.quantity).toBe(5);
    expect(result.settlements).toEqual([
      expect.objectContaining({ lineId: 'zl-1', quantity: 2 }),
    ]);
  });

  it('is a BOUGHT settle of exactly the difference, and never anything else', async () => {
    const harness = build({ quantity: 5 });

    await move(harness, 3, 5);

    expect(harness.settleCalls).toEqual([
      expect.objectContaining({
        lineId: BASKET_LINE,
        participantId: ACTOR,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 2,
      }),
    ]);
  });

  it('emits everything a sheet settle emits, zone side included', async () => {
    const harness = build({ quantity: 5 });

    await move(harness, 3, 5);

    expect(harness.events).toEqual([
      // The household hears the ordinary plan 0047 event on the list's room.
      { event: RealtimeEvent.LineSettled, listId: LIST_A },
      {
        event: RealtimeEvent.GeneratedListLineSettled,
        generatedListId: BASKET,
      },
      // And the owner, who is usually at home rather than in the shop.
      {
        event: RealtimeEvent.GeneratedListLineSettled,
        userIds: [OWNER],
      },
    ]);
  });

  it('finishes the line at zero, exactly as “got all” does', async () => {
    const harness = build({ quantity: 5 });

    const result = await move(harness, 0, 5);

    expect(harness.basketLine.settledQuantity).toBe(5);
    expect(result.line.settledQuantity).toBe(5);
    // A finished line has left the basket in every sense a zone cares about, so
    // it stops claiming its origins (plan 0052, section 3.3).
    expect(harness.claims.announced).toEqual([
      expect.objectContaining({ lineId: 'zl-1', claimed: false }),
    ]);
  });
});

describe('a stale client is refused rather than inverted (section 3.2)', () => {
  it('refuses a lower whose from no longer matches, and writes nothing', async () => {
    const harness = build({ quantity: 5, settledQuantity: 2 });

    // The line stands at 3 outstanding; this client last saw 5.
    await expect(move(harness, 4, 5)).rejects.toBeInstanceOf(
      StaleQuantityException
    );
    expect(harness.settlements).toHaveLength(0);
    expect(harness.basketLine.quantity).toBe(5);
    expect(harness.basketLine.settledQuantity).toBe(2);
    expect(harness.events).toHaveLength(0);
  });

  it('carries the number as it now stands, which is the client’s only channel', async () => {
    const harness = build({ quantity: 5, settledQuantity: 2 });

    await expect(move(harness, 4, 5)).rejects.toMatchObject({
      messageArgs: { current: 3 },
    });
  });

  it('refuses the raise that would otherwise swallow somebody’s purchase', async () => {
    // The two phones of section 3.2: this one drags to 4 meaning "I got one",
    // against a line another phone has already settled down to 3.
    const harness = build({
      quantity: 5,
      settledQuantity: 2,
      settlements: [
        { id: 's-1', lineId: 'zl-1', listId: LIST_A, quantity: 2, order: 1 },
      ],
    });

    await expect(move(harness, 4, 5)).rejects.toBeInstanceOf(
      StaleQuantityException
    );
    // Had it been applied as a raise, somebody's purchase would have gone back.
    expect(harness.settlements[0].revertedAt).toBe(null);
  });

  it('accepts the same gesture once the client has looked again', async () => {
    const harness = build({
      quantity: 5,
      settledQuantity: 2,
      zoneQuantity: 0,
      settlements: [
        { id: 's-1', lineId: 'zl-1', listId: LIST_A, quantity: 2, order: 1 },
      ],
    });

    const result = await move(harness, 4, 3);

    expect(result.line.settledQuantity).toBe(1);
  });
});

describe('a drag that landed where it started (section 3)', () => {
  it('succeeds, writes nothing and announces nothing', async () => {
    const harness = build({ quantity: 5, settledQuantity: 1 });

    const result = await move(harness, 4, 4);

    expect(result.line.quantity).toBe(5);
    expect(result.skippedCount).toBe(0);
    expect(harness.settlements).toHaveLength(0);
    expect(harness.events).toHaveLength(0);
    expect(harness.basketLine.quantity).toBe(5);
  });
});

describe('a finished basket refuses both directions (section 5)', () => {
  it('refuses a raise and a lower alike', async () => {
    const raising = build({
      quantity: 5,
      settledQuantity: 5,
      status: GeneratedListStatus.COMPLETED,
      settlements: [
        { id: 's-1', lineId: 'zl-1', listId: LIST_A, quantity: 5, order: 1 },
      ],
    });
    const lowering = build({
      quantity: 5,
      status: GeneratedListStatus.ARCHIVED,
    });

    await expect(move(raising, 2, 0)).rejects.toBeInstanceOf(
      GeneratedListFinishedException
    );
    await expect(move(lowering, 3, 5)).rejects.toBeInstanceOf(
      GeneratedListFinishedException
    );
    expect(raising.settlements[0].revertedAt).toBe(null);
    expect(lowering.settlements).toHaveLength(0);
  });
});

describe('a guest may do all of it (section 3.3)', () => {
  it('lowers the number and is told the count of what was missed, not the names', async () => {
    const harness = build({
      quantity: 5,
      actorSeesZoneData: false,
      origins: [
        {
          id: 'o-1',
          lineId: 'zl-1',
          listId: LIST_A,
          zoneId: ZONE_A,
          quantity: 3,
          order: 1,
        },
        {
          id: 'o-2',
          lineId: 'zl-2',
          listId: LIST_B,
          zoneId: ZONE_B,
          quantity: 2,
          order: 2,
        },
      ],
      // The owner's access to the parents' list has gone since the basket was
      // made, which is a skip and not a failure (plan 0051, section 6.4).
      ownerWritable: [LIST_A],
    });

    const result = await move(harness, 3, 5);

    expect(result.skippedCount).toBe(1);
    expect(result.skipped).toBeUndefined();
    expect(result.settlements).toBeUndefined();
    // A partial settle is a real outcome rather than a failure: the reachable
    // origin still took the units, and the guest is told honestly that one
    // origin was missed without being told whose it was.
    expect(harness.zoneLines.get('zl-1')?.quantity).toBe(3);
    expect(harness.zoneLines.get('zl-2')?.quantity).toBe(5);
  });

  it('raises the number, which is the gesture the feature is named for', async () => {
    const harness = build({ ...twoOrigins(), actorSeesZoneData: false });

    const result = await move(harness, 2, 0);

    expect(harness.basketLine.settledQuantity).toBe(3);
    expect(result.skippedCount).toBe(0);
    // Redacted by absence, the same way the basket read is.
    expect(result.settlements).toBeUndefined();
  });
});

describe('what this control cannot say (section 6)', () => {
  it('never reaches the settle with NOT_AVAILABLE, at zero or anywhere else', async () => {
    const harness = build({ quantity: 5 });

    await move(harness, 0, 5);

    // Dragging a number to zero means the whole line was bought. "The shop had
    // none" is an outcome rather than a quantity, and it has no representation
    // on this control at all.
    expect(harness.settleCalls).toHaveLength(1);
    expect(harness.settleCalls[0].outcome).toBe(SettlementOutcome.BOUGHT);
    expect(
      harness.settlements.every(
        (row) => row.outcome === SettlementOutcome.BOUGHT
      )
    ).toBe(true);
  });
});
