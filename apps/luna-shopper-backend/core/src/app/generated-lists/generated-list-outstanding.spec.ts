import {
  GeneratedListStatus,
  LINE_QUANTITY_MAX,
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
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { fakeLineSettlements } from '../lists/line-settlements.fake';
import { GeneratedListOutstandingService } from './generated-list-outstanding.service';
import { GeneratedListSettleService } from './generated-list-settle.service';
import type { GeneratedListSharingService } from './generated-list-sharing.service';
import type { GeneratedListService } from './generated-list.service';
import { fakeLineClaims, type FakeLineClaims } from './line-claims.fake';

/**
 * What is outstanding is a number you can move (plan 0056).
 *
 * ## The real settle sits behind this, on purpose
 *
 * The harness wires an actual {@link GeneratedListSettleService} into the
 * service under test rather than a mock of it, because section 3's whole claim
 * about lowering is that it **is** the settle: the same allocation, the same
 * owner access check, the same settlement rows, the same events. A mock would
 * assert that a call was made and would keep passing on the day the two paths
 * started disagreeing about who bought a tin, which is the failure the plan is
 * written against.
 *
 * The requests that reach the settle are recorded as well as delegated, which is
 * what lets one test state a negative the rows cannot: `NOT_AVAILABLE` is not
 * expressible from this control at all (section 6).
 *
 * Faked at the repository boundary in the style `generated-list-settle.spec.ts`
 * established, and against the same settlements fake, so "no settlement was
 * written" is an assertion about rows rather than about a call that did not
 * happen.
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

interface Harness {
  service: GeneratedListOutstandingService;
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
    /** The zone line's own quantity, which a purchase comes off. */
    zoneQuantity?: number;
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

  const basketLine: Partial<GeneratedListLine> = {
    id: BASKET_LINE,
    generatedListId: BASKET,
    quantity: options.quantity ?? 5,
    settledQuantity: options.settledQuantity ?? 0,
    itemId: null,
  };

  const zoneLines = new Map(
    origins.map((origin) => [
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

  const settlementRows = fakeLineSettlements();
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
      if (entity === GeneratedListLine) {
        return {
          // A **copy**, as a second read of the same row is in production: the
          // raise locks its own instance and has to carry what it wrote back
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
    // raise that failed to carry its write back would answer with the old
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

  const settleCalls: SettleGeneratedListLineRequest[] = [];
  const recording = {
    settle: (req: SettleGeneratedListLineRequest) => {
      settleCalls.push(req);
      return settle.settle(req);
    },
  } as unknown as GeneratedListSettleService;

  const service = new GeneratedListOutstandingService(
    dataSource,
    lists,
    lines,
    sharing,
    generated,
    recording,
    publisher
  );

  return {
    service,
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

describe('raising means this basket will buy more (section 1)', () => {
  it('raises what the basket asks for and settles nothing', async () => {
    const harness = build({ quantity: 5, settledQuantity: 0 });

    const result = await move(harness, 20, 5);

    expect(harness.basketLine.quantity).toBe(20);
    expect(harness.basketLine.settledQuantity).toBe(0);
    expect(result.line.quantity).toBe(20);
    expect(harness.settlements).toHaveLength(0);
    expect(harness.settleCalls).toHaveLength(0);
  });

  it('leaves every zone list exactly where it was', async () => {
    const harness = build({ quantity: 5, zoneQuantity: 5 });

    await move(harness, 20, 5);

    // Nothing has been bought, no household has changed its mind, and no zone
    // list moves. The basket alone decided to carry more.
    expect(harness.zoneLines.get('zl-1')?.quantity).toBe(5);
    expect(harness.zoneLines.get('zl-1')?.version).toBe(1);
  });

  it('tells the basket room and no zone room at all (section 7)', async () => {
    const harness = build({ quantity: 5 });

    await move(harness, 6, 5);

    expect(harness.events).toEqual([
      {
        event: RealtimeEvent.GeneratedListLineUpdated,
        generatedListId: BASKET,
      },
    ]);
  });

  it('records who moved it', async () => {
    const harness = build({ quantity: 5 });

    await move(harness, 6, 5);

    expect(harness.basketLine.lastEditedByParticipantId).toBe(ACTOR);
  });

  it('answers the settle’s own shape, with nothing settled in it', async () => {
    const harness = build({ quantity: 5 });

    const result = await move(harness, 6, 5);

    // One response shape in both directions, and every number in it true of a
    // raise (section 7).
    expect(result.skippedCount).toBe(0);
    expect(result.settlements).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});

describe('raising a finished line is not reopening it (section 3.1)', () => {
  it('takes a done line back to partly settled without reverting anything', async () => {
    const harness = build({ quantity: 5, settledQuantity: 5 });

    const result = await move(harness, 3, 0);

    // It wants more than it has got, which is partly settled and not undone.
    expect(harness.basketLine.quantity).toBe(8);
    expect(harness.basketLine.settledQuantity).toBe(5);
    expect(result.line.settledQuantity).toBe(5);
    expect(harness.settlements).toHaveLength(0);
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

  it('records the real number when the basket bought more than was asked for', async () => {
    // Twenty on a line five were asked for: the raise, then the purchase.
    const harness = build({ quantity: 5, zoneQuantity: 5 });

    await move(harness, 20, 5);
    const result = await move(harness, 0, 20);

    // The zone line floors at zero and the settlement keeps the truth (plan
    // 0047, section 4.2, and section 4 here: the last origin carries the excess).
    expect(harness.zoneLines.get('zl-1')?.quantity).toBe(0);
    expect(result.settlements).toEqual([
      expect.objectContaining({ lineId: 'zl-1', quantity: 20 }),
    ]);
    expect(harness.basketLine.settledQuantity).toBe(20);
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

  it('refuses the raise that would otherwise swallow somebody’s purchase', async () => {
    // The two phones of section 3.2: this one drags to 4 meaning "I got one",
    // against a line another phone has already settled down to 3.
    const harness = build({ quantity: 5, settledQuantity: 2 });

    await expect(move(harness, 4, 5)).rejects.toBeInstanceOf(
      StaleQuantityException
    );
    // Had it been applied as a raise, the basket would ask for six.
    expect(harness.basketLine.quantity).toBe(5);
  });

  it('accepts the same gesture once the client has looked again', async () => {
    const harness = build({ quantity: 5, settledQuantity: 2 });

    const result = await move(harness, 4, 3);

    expect(harness.basketLine.quantity).toBe(6);
    expect(result.line.quantity).toBe(6);
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

describe('the floor, the ceiling and the finished basket (section 5)', () => {
  it('refuses a negative outstanding', async () => {
    const harness = build({ quantity: 5 });

    await expect(move(harness, -1, 5)).rejects.toBeInstanceOf(
      ValidationException
    );
  });

  it('caps the resulting quantity, not the number that was dragged', async () => {
    // Partly settled, so the resulting quantity is above the outstanding number
    // by everything already bought: the cap has to be applied to the sum.
    const harness = build({
      quantity: LINE_QUANTITY_MAX,
      settledQuantity: 10,
    });

    await expect(
      move(harness, LINE_QUANTITY_MAX - 10 + 1, LINE_QUANTITY_MAX - 10)
    ).rejects.toBeInstanceOf(ValidationException);
    expect(harness.basketLine.quantity).toBe(LINE_QUANTITY_MAX);
  });

  it('refuses both directions on a finished basket', async () => {
    const raising = build({
      quantity: 5,
      status: GeneratedListStatus.COMPLETED,
    });
    const lowering = build({
      quantity: 5,
      status: GeneratedListStatus.ARCHIVED,
    });

    await expect(move(raising, 6, 5)).rejects.toBeInstanceOf(
      GeneratedListFinishedException
    );
    await expect(move(lowering, 3, 5)).rejects.toBeInstanceOf(
      GeneratedListFinishedException
    );
    expect(raising.basketLine.quantity).toBe(5);
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
    const harness = build({ quantity: 5, actorSeesZoneData: false });

    const result = await move(harness, 20, 5);

    expect(harness.basketLine.quantity).toBe(20);
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
