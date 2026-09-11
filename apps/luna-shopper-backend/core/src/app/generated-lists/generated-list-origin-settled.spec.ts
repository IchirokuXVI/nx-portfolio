import {
  GeneratedListStatus,
  ParticipantKind,
  RealtimeEvent,
  SettlementOutcome,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
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
import { GeneratedListOriginSettledService } from './generated-list-origin-settled.service';
import { GeneratedListOriginsService } from './generated-list-origins.service';
import { GeneratedListReopenService } from './generated-list-reopen.service';
import { GeneratedListSettleService } from './generated-list-settle.service';
import type { GeneratedListSharingService } from './generated-list-sharing.service';
import type { GeneratedListService } from './generated-list.service';
import { fakeLineClaims, type FakeLineClaims } from './line-claims.fake';

/**
 * What one list got (plan 0104, section 4).
 *
 * ## The property this file exists to pin
 *
 * **Both directions touch one origin and leave every other one alone.** A
 * settle's default allocation reaches for the oldest origin first and a revert
 * reaches for the newest purchase, so a route that named a list and then let
 * either of those choose for itself would move somebody else's household and be
 * indistinguishable from working.
 *
 * The real settle, the real revert and the real origin reader sit behind the
 * service, for the reason `generated-list-outstanding.spec.ts` wires the same
 * two in: the plan's claim is that this route **is** those operations with one
 * list named, and a mock would keep passing on the day they stopped agreeing.
 */

const OWNER = 'u-owner';
const ACTOR = 'p-owner';
const BASKET = 'gl-1';
const BASKET_LINE = 'gll-1';
const LIST_A = 'l-flat';
const LIST_B = 'l-parents';
const ZONE_A = 'z-flat';
const ZONE_B = 'z-parents';
const LINE_A = 'zl-1';
const LINE_B = 'zl-2';

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
  lineId: string | null;
  listId: string | null;
  quantity: number;
  outcome?: SettlementOutcome;
  /** Lower is older, which is what a revert walks backwards through. */
  order: number;
}

interface Harness {
  service: GeneratedListOriginSettledService;
  settlements: Partial<LineSettlement>[];
  zoneLines: Map<
    string,
    { id: string; listId: string; quantity: number; version: number }
  >;
  basketLine: Partial<GeneratedListLine>;
  events: { event: RealtimeEvent; listId?: string }[];
  claims: FakeLineClaims;
}

const TWO_ORIGINS: OriginSeed[] = [
  {
    id: 'o-1',
    lineId: LINE_A,
    listId: LIST_A,
    zoneId: ZONE_A,
    quantity: 3,
    order: 1,
  },
  {
    id: 'o-2',
    lineId: LINE_B,
    listId: LIST_B,
    zoneId: ZONE_B,
    quantity: 2,
    order: 2,
  },
];

function build(
  options: {
    quantity?: number;
    settledQuantity?: number;
    origins?: OriginSeed[];
    settlements?: SettlementSeed[];
    zoneQuantity?: number;
    ownerWritable?: string[];
    actorSeesZoneData?: boolean;
  } = {}
): Harness {
  const origins = options.origins ?? TWO_ORIGINS;
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
      userId: seesZoneData ? OWNER : null,
    }),
    liveParticipantById: async () => ({
      id: ACTOR,
      userId: seesZoneData ? OWNER : null,
    }),
    seesZoneData: async () => seesZoneData,
    writableAmong: async (_userId: string, listIds: readonly string[]) =>
      new Set(listIds.filter((listId) => ownerWritable.has(listId))),
  } as unknown as GeneratedListSharingService;

  const shoppingLists = {
    find: async ({ where }: { where: { id: { _value: string[] } } }) =>
      [
        { id: LIST_A, name: 'Weekly shop', zone: { name: 'Flat 3B' } },
        { id: LIST_B, name: 'Parents', zone: { name: 'Parents’ house' } },
      ].filter((row) => where.id._value.includes(row.id)),
  } as never;

  const generated = {
    basketLineViewFor: async (
      line: Partial<GeneratedListLine>,
      lineSeesZoneData: boolean
    ) => ({
      id: line.id,
      quantity: line.quantity,
      settledQuantity: line.settledQuantity,
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
    emitToGeneratedList: (event: RealtimeEvent) => events.push({ event }),
    emitToUsers: (event: RealtimeEvent) => events.push({ event }),
  } as unknown as CoreEventsPublisher;

  const list = {
    id: BASKET,
    ownerUserId: OWNER,
    status: GeneratedListStatus.ACTIVE,
    sourceSnapshot: { profileId: null, pricingProfileId: null, sources: [] },
  };
  const lists = { findOne: async () => list } as never;
  // A copy per read, as TypeORM answers one: the service's own read of the line
  // must not see a settle or a revert that wrote through a different entity, or
  // the spec passes on an answer the real repository never gives.
  const lines = { findOne: async () => ({ ...basketLine }) } as never;
  const originRows = {
    find: async () => [...origins].sort((a, b) => a.order - b.order),
    findOne: async ({ where }: { where: { lineId?: string; id?: string } }) =>
      origins.find(
        (origin) => origin.lineId === where.lineId || origin.id === where.id
      ) ?? null,
  } as never;
  const zoneLineRepo = {
    findOne: async ({ where }: { where: { id: string } }) =>
      zoneLines.get(where.id) ?? null,
    find: async () => [...zoneLines.values()],
  } as never;

  const settle = new GeneratedListSettleService(
    dataSource,
    lists,
    lines,
    originRows,
    { findOne: async () => null } as never,
    shoppingLists,
    sharing,
    generated,
    claims.service,
    publisher
  );

  const reopen = new GeneratedListReopenService(
    dataSource,
    lists,
    lines,
    sharing,
    generated,
    claims.service,
    publisher
  );

  const originsService = new GeneratedListOriginsService(
    dataSource,
    lists,
    lines,
    originRows,
    zoneLineRepo,
    settlementRows.repo as never,
    shoppingLists,
    sharing,
    generated,
    {} as never,
    claims.service,
    {} as never,
    publisher
  );

  const service = new GeneratedListOriginSettledService(
    lists,
    lines,
    originRows,
    zoneLineRepo,
    shoppingLists,
    sharing,
    generated,
    originsService,
    settle,
    reopen
  );

  return {
    service,
    settlements: settlementRows.rows,
    zoneLines: zoneLines as Harness['zoneLines'],
    basketLine,
    events,
    claims,
  };
}

function set(
  harness: Harness,
  sourceLineId: string,
  settled: number,
  from: number
) {
  return harness.service.setOriginSettled({
    generatedListId: BASKET,
    lineId: BASKET_LINE,
    participantId: ACTOR,
    sourceLineId,
    settled,
    from,
  });
}

describe('raising settles against that list alone (section 4)', () => {
  it('writes the settlement on the named origin and nowhere else', async () => {
    const harness = build({ quantity: 5, zoneQuantity: 5 });

    await set(harness, LINE_B, 2, 0);

    // The default allocation would have reached for the flat first, because it
    // is the older origin. Naming the list is what stops it.
    expect(harness.zoneLines.get(LINE_B)?.quantity).toBe(3);
    expect(harness.zoneLines.get(LINE_A)?.quantity).toBe(5);
    expect(
      harness.settlements.map((row) => ({
        lineId: row.lineId,
        quantity: row.quantity,
      }))
    ).toEqual([{ lineId: LINE_B, quantity: 2 }]);
  });

  it('moves the basket line by the same amount', async () => {
    const harness = build({ quantity: 5 });

    const result = await set(harness, LINE_B, 2, 0);

    expect(harness.basketLine.settledQuantity).toBe(2);
    expect(result.line.settledQuantity).toBe(2);
  });

  it('answers both numbers on the row, read back rather than computed', async () => {
    const harness = build({ quantity: 5, zoneQuantity: 5 });

    const result = await set(harness, LINE_A, 3, 0);

    expect(result.origin).toEqual(
      expect.objectContaining({
        lineId: LINE_A,
        listId: LIST_A,
        // What the list asked for, which this write does not touch.
        contributed: 3,
        // And what it got, which is what this write set.
        settledHere: 3,
        listQuantity: 2,
      })
    );
    expect(result.skipped).toEqual([]);
    expect(result.skippedCount).toBe(0);
  });

  it('tells the household on the event the settle already emits', async () => {
    const harness = build({ quantity: 5 });

    await set(harness, LINE_A, 1, 0);

    expect(
      harness.events.filter(
        (entry) => entry.event === RealtimeEvent.LineSettled
      )
    ).toEqual([{ event: RealtimeEvent.LineSettled, listId: LIST_A }]);
  });
});

describe('an origin the write cannot reach is reported (section 4)', () => {
  it('names it rather than refusing the whole request', async () => {
    // The owner's access to the parents' list has gone since the basket was
    // made, which is a skip and not a failure (plan 0051, section 6.4).
    const harness = build({ quantity: 5, ownerWritable: [LIST_A] });

    const result = await set(harness, LINE_B, 2, 0);

    expect(result.skipped).toEqual([
      {
        lineId: LINE_B,
        listId: LIST_B,
        reason: 'ACCESS_GONE',
        listName: 'Parents',
        zoneName: 'Parents’ house',
      },
    ]);
    expect(result.skippedCount).toBe(1);
    // Nothing was bought, because there was nowhere to buy it for.
    expect(harness.settlements).toHaveLength(0);
    expect(harness.basketLine.settledQuantity).toBe(0);
  });
});

describe('lowering reverts that list’s newest purchases (section 4)', () => {
  const bothBought = {
    quantity: 5,
    settledQuantity: 5,
    zoneQuantity: 0,
    settlements: [
      { id: 's-1', lineId: LINE_A, listId: LIST_A, quantity: 3, order: 1 },
      { id: 's-2', lineId: LINE_B, listId: LIST_B, quantity: 2, order: 2 },
    ],
  };

  it('takes units back off the named origin and leaves the other standing', async () => {
    const harness = build(bothBought);

    await set(harness, LINE_A, 1, 3);

    // Two of the flat's three go back. The parents' purchase is newer, so a walk
    // that ignored the named list would have reached for it first.
    expect(harness.zoneLines.get(LINE_A)?.quantity).toBe(2);
    expect(harness.zoneLines.get(LINE_B)?.quantity).toBe(0);
    expect(
      harness.settlements.find((row) => row.id === 's-2')?.revertedAt
    ).toBe(null);
  });

  it('splits the purchase it lands inside, keeping the buyer and the time', async () => {
    const harness = build(bothBought);

    await set(harness, LINE_A, 1, 3);

    const original = harness.settlements.find((row) => row.id === 's-1');
    expect(original?.revertedAt).toBeInstanceOf(Date);
    const standing = harness.settlements.filter(
      (row) => !row.revertedAt && row.lineId === LINE_A
    );
    expect(standing).toEqual([
      expect.objectContaining({
        quantity: 1,
        settledByParticipantId: ACTOR,
        settledAt: original?.settledAt,
      }),
    ]);
  });

  it('moves the basket line down by what went back', async () => {
    const harness = build(bothBought);

    const result = await set(harness, LINE_A, 1, 3);

    expect(harness.basketLine.settledQuantity).toBe(3);
    expect(result.line.settledQuantity).toBe(3);
    expect(result.origin?.settledHere).toBe(1);
  });

  it('never takes a close back, because a close bought nothing', async () => {
    const harness = build({
      quantity: 5,
      settledQuantity: 5,
      zoneQuantity: 0,
      settlements: [
        { id: 's-1', lineId: LINE_A, listId: LIST_A, quantity: 3, order: 1 },
        {
          id: 's-2',
          lineId: LINE_A,
          listId: LIST_A,
          quantity: 0,
          outcome: SettlementOutcome.NOT_AVAILABLE,
          order: 2,
        },
      ],
    });

    await set(harness, LINE_A, 2, 3);

    // The close is newer than the purchase, so a walk that saw it would have
    // taken it first and moved a number that is no part of what this list got.
    expect(
      harness.settlements.find((row) => row.id === 's-2')?.revertedAt
    ).toBe(null);
    expect(
      harness.settlements.find((row) => row.id === 's-1')?.revertedAt
    ).toBeInstanceOf(Date);
  });
});

describe('the bounds and the bargain (sections 4 and 6)', () => {
  it('refuses more than that list asked for, and writes nothing', async () => {
    const harness = build({ quantity: 5 });

    // The parents' list asks for two through this basket.
    await expect(set(harness, LINE_B, 3, 0)).rejects.toBeInstanceOf(
      ValidationException
    );
    expect(harness.settlements).toHaveLength(0);
    expect(harness.basketLine.settledQuantity).toBe(0);
  });

  it('allows exactly what that list asked for', async () => {
    const harness = build({ quantity: 5 });

    const result = await set(harness, LINE_B, 2, 0);

    expect(result.origin?.settledHere).toBe(2);
  });

  it('refuses a stale from, and says what the number now is', async () => {
    const harness = build({
      quantity: 5,
      settledQuantity: 3,
      settlements: [
        { id: 's-1', lineId: LINE_A, listId: LIST_A, quantity: 3, order: 1 },
      ],
    });

    await expect(set(harness, LINE_A, 1, 0)).rejects.toMatchObject({
      code: 'stale_quantity',
      messageArgs: { current: 3 },
    });
    expect(harness.settlements[0].revertedAt).toBe(null);
  });

  it('leaves a reverted purchase out of the number it is checked against', async () => {
    // Plan 0054 section 3.3: a settlement somebody took back is excluded from
    // every consumption total, and this number is one.
    const harness = build({ quantity: 5, settledQuantity: 0 });
    harness.settlements.push({
      id: 's-old',
      lineId: LINE_A,
      listId: LIST_A,
      outcome: SettlementOutcome.BOUGHT,
      quantity: 2,
      settledAt: new Date(2026, 0, 1),
      revertedAt: new Date(2026, 0, 2),
      generatedListLineId: BASKET_LINE,
    });

    const result = await set(harness, LINE_A, 1, 0);

    expect(result.origin?.settledHere).toBe(1);
  });

  it('writes nothing when the number lands where it started', async () => {
    const harness = build({ quantity: 5 });

    const result = await set(harness, LINE_A, 0, 0);

    expect(harness.settlements).toHaveLength(0);
    expect(harness.events).toHaveLength(0);
    expect(result.origin?.settledHere).toBe(0);
  });

  it('refuses a list this line does not come from', async () => {
    const harness = build({ quantity: 5 });

    await expect(set(harness, 'zl-9', 1, 0)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('a guest is refused this route (section 4.1)', () => {
  it('is refused, and told what the rule is about', async () => {
    const harness = build({ quantity: 5, actorSeesZoneData: false });

    await expect(set(harness, LINE_A, 1, 0)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(harness.settlements).toHaveLength(0);
  });
});
