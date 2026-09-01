import {
  ParticipantKind,
  RealtimeEvent,
  SettlementOutcome,
  type LineView,
} from '@portfolio/luna-shopper/contracts';
import { DomainException } from '@portfolio/luna-shopper/platform';
import type { DataSource } from 'typeorm';
import {
  GeneratedListLine,
  LineSettlement,
  ListLine,
  ListLineItem,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { fakeLineSettlements } from '../lists/line-settlements.fake';
import {
  allocateOldestFirst,
  GeneratedListSettleService,
} from './generated-list-settle.service';
import type { GeneratedListSharingService } from './generated-list-sharing.service';
import type { GeneratedListService } from './generated-list.service';
import { fakeLineClaims, type FakeLineClaims } from './line-claims.fake';

/**
 * Settling a basket back to the lines it came from (plan 0051, section 6).
 *
 * Two halves, and they are tested differently on purpose. The allocation rule is
 * a pure function, so it is stated directly rather than reached through a mocked
 * database: a test that has to build a basket to assert "oldest origin first" is
 * describing the harness rather than the rule. Everything else needs the write
 * path, which is faked at the repository boundary in the style
 * `generated-list-run.spec.ts` established.
 *
 * The property this file exists to pin is section 6.4: **a settle is authorized
 * by the owner's access, never the actor's.** It is the reason a guest settling
 * is safe at all, and the only way it can break is quietly.
 */

const OWNER = 'u-owner';
const GUEST_PARTICIPANT = 'p-guest';
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
  service: GeneratedListSettleService;
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
    /** Captured so the zone event's own `LineView` can be asserted, not just its name. */
    payload?: unknown;
  }[];
  claims: FakeLineClaims;
}

function build(options: {
  quantity?: number;
  settledQuantity?: number;
  origins?: OriginSeed[];
  /** Which lists the **owner** may write, at request time (section 6.4). */
  ownerWritable?: string[];
  /** Origins whose zone line has been deleted underneath the basket. */
  missingZoneLines?: string[];
  itemId?: string | null;
  optionIds?: string[];
  /**
   * Whether the acting participant passes section 5.2, which decides what the
   * **response** carries rather than what the settle writes.
   *
   * Defaults to true, so the allocation tests describe a reader entitled to see
   * which lists their units landed on. The guest case is exercised explicitly in
   * "what a settle tells the person who made it", because a guest is told the
   * count and never the names.
   */
  actorSeesZoneData?: boolean;
}): Harness {
  const origins = options.origins ?? [
    {
      id: 'o-1',
      lineId: 'zl-1',
      listId: LIST_A,
      zoneId: ZONE_A,
      quantity: 2,
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
    quantity: options.quantity ?? 2,
    settledQuantity: options.settledQuantity ?? 0,
    itemId: options.itemId ?? null,
  };

  const zoneLines = new Map(
    origins
      .filter((origin) => !missing.has(origin.lineId))
      .map((origin) => [
        origin.lineId,
        {
          id: origin.lineId,
          listId: origin.listId,
          quantity: 5,
          version: 1,
          // `toLineView` reads these, and it takes the product set as an explicit
          // argument so a line with products is never reported as free text.
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

  // The shared fake rather than a save-only stub: the settle reads the table back
  // after each insert, to say how many times the zone line has now been bought
  // (plan 0047, section 5), which is what the zone event carries.
  const settlementRows = fakeLineSettlements();
  const settlements = settlementRows.rows;
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
          save: async (row: Partial<GeneratedListLine>) => {
            Object.assign(basketLine, row);
            return row;
          },
        };
      }
      throw new Error('unmocked repository in the settle transaction');
    },
  };

  const dataSource = {
    transaction: async (fn: (m: typeof manager) => Promise<unknown>) =>
      fn(manager),
  } as unknown as DataSource;

  const seesZoneData = options.actorSeesZoneData ?? true;

  const sharing = {
    livePresenceEntry: async () => ({
      participantId: GUEST_PARTICIPANT,
      kind: seesZoneData ? ParticipantKind.REGISTERED : ParticipantKind.GUEST,
      displayName: null,
      guestNumber: seesZoneData ? null : 1,
      userId: null,
    }),
    // Read again by id rather than taken from the request: section 5.2 is a
    // question about core's own access tables, asked at request time.
    liveParticipantById: async () => ({ id: GUEST_PARTICIPANT }),
    seesZoneData: async () => seesZoneData,
    // The whole of section 6.4 in one fake: this is asked about the **owner**,
    // and the service passes `list.ownerUserId` rather than the actor.
    writableAmong: async (userId: string, listIds: readonly string[]) => {
      expect(userId).toBe(OWNER);
      return new Set(listIds.filter((listId) => ownerWritable.has(listId)));
    },
  } as unknown as GeneratedListSharingService;

  // The names behind the skipped origins (plan 0053, section 4). `LIST_B` is the
  // one every skip case in this file names; `LIST_A` is here so the fake is not
  // shaped around the assertion, and an id it does not know drops out of the
  // answer exactly as a deleted list does.
  const shoppingLists = {
    find: async ({ where }: { where: { id: { _value: string[] } } }) =>
      [
        { id: LIST_A, name: 'Weekly shop', zone: { name: 'Flat 3B' } },
        { id: LIST_B, name: 'Parents', zone: { name: null } },
      ].filter((row) => where.id._value.includes(row.id)),
  } as never;

  const generated = {
    lineViewFor: async () => ({
      id: BASKET_LINE,
      quantity: basketLine.quantity,
      settledQuantity: basketLine.settledQuantity,
    }),
    // The projected line, which is what both the response and the basket room's
    // broadcast now carry (section 5.2).
    basketLineViewFor: async (_line: unknown, lineSeesZoneData: boolean) => ({
      id: BASKET_LINE,
      quantity: basketLine.quantity,
      settledQuantity: basketLine.settledQuantity,
      itemId: basketLine.itemId,
      lastEditedByParticipantId: GUEST_PARTICIPANT,
      ...(lineSeesZoneData ? { targetListId: null } : {}),
    }),
  } as unknown as GeneratedListService;

  // The basket line claims its origins until it is settled through (section
  // 3.3), which is what the release below is asserted against.
  const claims = fakeLineClaims({}, () =>
    origins.map((origin) => ({
      zoneId: origin.zoneId,
      listId: origin.listId,
      lineId: origin.lineId,
    }))
  );

  const service = new GeneratedListSettleService(
    dataSource,
    {
      findOne: async () => ({ id: BASKET, ownerUserId: OWNER }),
    } as never,
    { findOne: async () => basketLine } as never,
    {
      find: async () => [...origins].sort((a, b) => a.order - b.order),
    } as never,
    {
      findOne: async ({ where }: { where: { itemId: string } }) =>
        (options.optionIds ?? []).includes(where.itemId)
          ? { itemId: where.itemId }
          : null,
    } as never,
    shoppingLists,
    sharing,
    generated,
    claims.service,
    {
      emit: (
        event: RealtimeEvent,
        _zoneId: string,
        payload: unknown,
        listId?: string
      ) => events.push({ event, listId, payload }),
      emitToGeneratedList: (event: RealtimeEvent, generatedListId: string) =>
        events.push({ event, generatedListId }),
      // The owner's own sessions, which is a different audience from the room:
      // the owner is usually not in it, and velista 0045's dashboard card counts
      // settled lines while somebody else is doing the shopping.
      emitToUsers: (event: RealtimeEvent, userIds: string[]) =>
        events.push({ event, userIds }),
    } as unknown as CoreEventsPublisher
  );

  return {
    service,
    settlements,
    zoneLines: zoneLines as Harness['zoneLines'],
    basketLine,
    events,
    claims,
  };
}

function settle(harness: Harness, body: Record<string, unknown> = {}) {
  return harness.service.settle({
    generatedListId: BASKET,
    lineId: BASKET_LINE,
    participantId: GUEST_PARTICIPANT,
    outcome: SettlementOutcome.BOUGHT,
    ...body,
  } as never);
}

describe('the default allocation is oldest origin first (section 6.2)', () => {
  const origin = (id: string, quantity: number) => ({ id, quantity }) as never;

  it('is the obvious answer when a line has exactly one origin', () => {
    const only = origin('o-1', 3);
    expect([...allocateOldestFirst([only], 2)]).toEqual([[only, 2]]);
  });

  it('fills the oldest origin before the next one', () => {
    // The plan's own example: milk from the flat list (2) and the parents' list
    // (1) is one line of 3, and buying 2 lands entirely on the flat list.
    const flat = origin('o-flat', 2);
    const parents = origin('o-parents', 1);
    expect([...allocateOldestFirst([flat, parents], 2)]).toEqual([
      [flat, 2],
      [parents, 0],
    ]);
  });

  it('spills onto the next origin once the first is exhausted', () => {
    const flat = origin('o-flat', 2);
    const parents = origin('o-parents', 1);
    expect([...allocateOldestFirst([flat, parents], 3)]).toEqual([
      [flat, 2],
      [parents, 1],
    ]);
  });

  it('puts the excess on the last origin rather than clamping it', () => {
    // Plan 0047 section 4.2: buying more than was asked for is real, and a
    // settlement clamped to the demand would under report what a household goes
    // through.
    const flat = origin('o-flat', 2);
    expect([...allocateOldestFirst([flat], 5)]).toEqual([[flat, 5]]);
  });

  it('never produces a fraction, which is why proportional was rejected', () => {
    const a = origin('a', 1);
    const b = origin('b', 1);
    const c = origin('c', 1);
    for (const [, units] of allocateOldestFirst([a, b, c], 2)) {
      expect(Number.isInteger(units)).toBe(true);
    }
  });
});

describe('settling from the basket (section 6)', () => {
  it('settles the whole outstanding amount when no number is given', async () => {
    const harness = build({ quantity: 2 });
    const result = await settle(harness);

    expect(result.settlements).toHaveLength(1);
    expect(result.settlements[0].quantity).toBe(2);
    expect(harness.basketLine.settledQuantity).toBe(2);
    // The zone line is decremented by what was bought, floored at zero.
    expect(harness.zoneLines.get('zl-1')?.quantity).toBe(3);
  });

  it('is cumulative, so a second settle finishes a partly settled line', async () => {
    const harness = build({ quantity: 3, settledQuantity: 1 });
    await settle(harness, { quantity: 2 });
    expect(harness.basketLine.settledQuantity).toBe(3);
  });

  it('caps a number larger than what is outstanding rather than refusing it', async () => {
    // A shopper who taps settle twice on a line of three has bought three, not
    // six, and the second tap should finish the line rather than fail.
    const harness = build({ quantity: 2 });
    await settle(harness, { quantity: 99 });
    expect(harness.basketLine.settledQuantity).toBe(2);
  });

  it('refuses a line that is already finished', async () => {
    const harness = build({ quantity: 2, settledQuantity: 2 });
    await expect(settle(harness)).rejects.toBeInstanceOf(DomainException);
  });

  it('closes the outstanding amount for NOT_AVAILABLE and decrements nothing', async () => {
    const harness = build({ quantity: 2 });
    const result = await settle(harness, {
      outcome: SettlementOutcome.NOT_AVAILABLE,
    });

    expect(result.settlements[0].quantity).toBe(0);
    expect(harness.basketLine.settledQuantity).toBe(2);
    // The household still wants it; the shop simply did not have it.
    expect(harness.zoneLines.get('zl-1')?.quantity).toBe(5);
  });

  it('attributes the settlement to the participant and to no user', async () => {
    // Section 6 and the check constraint: always the participant on this path,
    // including for the owner, so "who got the bread" stays one question.
    const harness = build({});
    await settle(harness);

    expect(harness.settlements[0].settledByParticipantId).toBe(
      GUEST_PARTICIPANT
    );
    expect(harness.settlements[0].settledByUserId).toBeNull();
  });

  it('records which basket line it came off, for the audit', async () => {
    const harness = build({});
    await settle(harness);
    expect(harness.settlements[0].generatedListLineId).toBe(BASKET_LINE);
  });
});

describe('a line with no origins can still finish (plan 0055, section 6)', () => {
  /**
   * The line plan 0055 section 3 creates by the dozen and that plan 0051 could
   * not settle. `applied` is a sum over the origins the allocation reached, so a
   * line reaching none left it at zero: the units never landed, the line stayed
   * outstanding forever, and every settle on it wrote nothing at all.
   *
   * No such line existed before, because every line came from the run, which is
   * why this was latent rather than reported.
   */
  it('advances the basket line by what the settle asked for', async () => {
    const harness = build({ quantity: 2, origins: [] });
    await settle(harness);
    expect(harness.basketLine.settledQuantity).toBe(2);
  });

  it('writes no settlement, because there is no zone line to be a fact about', async () => {
    // A settlement is a **zone fact** (plan 0047, section 3.1). Nothing enters
    // any household's consumption history until plan 0058 binds the line.
    const harness = build({ quantity: 2, origins: [] });
    const result = await settle(harness);

    expect(harness.settlements).toHaveLength(0);
    expect(result.settlements).toEqual([]);
    expect(result.skippedCount).toBe(0);
  });

  it('is still capped at what is outstanding', async () => {
    const harness = build({ quantity: 2, settledQuantity: 1, origins: [] });
    await settle(harness, { quantity: 99 });
    expect(harness.basketLine.settledQuantity).toBe(2);
  });

  it('settles part of it when a smaller number is given', async () => {
    const harness = build({ quantity: 3, origins: [] });
    await settle(harness, { quantity: 1 });
    expect(harness.basketLine.settledQuantity).toBe(1);
  });

  it('closes the whole amount for NOT_AVAILABLE, as it always did', async () => {
    // The other branch needed no change: NOT_AVAILABLE is an outcome rather
    // than a quantity and has closed the outstanding amount all along.
    const harness = build({ quantity: 2, origins: [] });
    await settle(harness, { outcome: SettlementOutcome.NOT_AVAILABLE });
    expect(harness.basketLine.settledQuantity).toBe(2);
  });

  it('tells the shop and the owner, and tells no zone anything at all', async () => {
    const harness = build({ quantity: 2, origins: [] });
    await settle(harness);

    const settled = harness.events.filter(
      (entry) => entry.event === RealtimeEvent.GeneratedListLineSettled
    );
    // The basket's own room, so four people in a shop agree without a refetch.
    expect(
      settled.filter((entry) => entry.generatedListId === BASKET)
    ).toHaveLength(1);
    // And the owner's own sessions, who are usually not in that room.
    expect(settled.filter((entry) => entry.userIds?.length)).toHaveLength(1);
    // No zone heard anything, because no zone was touched. That is the whole
    // reason an ADDED line is safe to hand to a guest.
    expect(
      harness.events.some((entry) => entry.event === RealtimeEvent.LineSettled)
    ).toBe(false);
  });

  it('finishes a line whose every origin the owner may no longer write, and says so', async () => {
    // The same branch, reached the other way: the line has an origin and the
    // allocation reaches none of it. Before plan 0055 this line was stuck too,
    // and for a worse reason, because the shopper had bought the thing and
    // could do nothing about the access that moved last week.
    //
    // Plan 0051 section 6.4 already decided what to do about it: a partial
    // settle is a real outcome and is reported rather than swallowed. So the
    // units land on the basket line, no settlement is written, and the skip is
    // what tells the shopper an origin was missed.
    const harness = build({
      quantity: 2,
      origins: [
        {
          id: 'o-1',
          lineId: 'zl-1',
          listId: LIST_A,
          zoneId: ZONE_A,
          quantity: 2,
          order: 1,
        },
      ],
      ownerWritable: [],
    });
    const result = await settle(harness);

    expect(harness.basketLine.settledQuantity).toBe(2);
    expect(result.skippedCount).toBe(1);
    expect(harness.settlements).toHaveLength(0);
    // And the household's line is untouched, which is the point of the skip.
    expect(harness.zoneLines.get('zl-1')?.quantity).toBe(5);
  });
});

describe('a settle is authorized by the owner, never the actor (section 6.4)', () => {
  const twoOrigins: OriginSeed[] = [
    {
      id: 'o-1',
      lineId: 'zl-1',
      listId: LIST_A,
      zoneId: ZONE_A,
      quantity: 2,
      order: 1,
    },
    {
      id: 'o-2',
      lineId: 'zl-2',
      listId: LIST_B,
      zoneId: ZONE_B,
      quantity: 1,
      order: 2,
    },
  ];

  it('skips and reports an origin the owner may no longer write', async () => {
    const harness = build({
      quantity: 3,
      origins: twoOrigins,
      ownerWritable: [LIST_A],
    });
    const result = await settle(harness);

    expect(result.skipped).toEqual([
      {
        lineId: 'zl-2',
        listId: LIST_B,
        reason: 'ACCESS_GONE',
        // Named, because this reader passes section 5.2 (plan 0053, section 4).
        // The zone is null because this fixture's zone has no name, which is a
        // different thing from the reader not being allowed one.
        listName: 'Parents',
        zoneName: null,
      },
    ]);
    // Nothing was written to the list the owner lost.
    expect(harness.settlements.every((row) => row.listId === LIST_A)).toBe(
      true
    );
  });

  it('reports an origin whose zone line has been deleted', async () => {
    const harness = build({
      quantity: 3,
      origins: twoOrigins,
      missingZoneLines: ['zl-2'],
    });
    const result = await settle(harness);

    expect(result.skipped).toEqual([
      {
        lineId: 'zl-2',
        listId: LIST_B,
        reason: 'ORIGIN_DELETED',
        listName: 'Parents',
        zoneName: null,
      },
    ]);
  });

  it('still settles everything it may, rather than failing the whole act', async () => {
    // A partial settle is a real outcome: a shopper who has bought the thing
    // should not be told the act failed because one household's access moved.
    const harness = build({
      quantity: 3,
      origins: twoOrigins,
      ownerWritable: [LIST_A],
    });
    const result = await settle(harness);

    expect(result.settlements).toHaveLength(1);
    expect(result.settlements[0].listId).toBe(LIST_A);
  });
});

describe('the allocation sheet overrides the default (section 6.3)', () => {
  const twoOrigins: OriginSeed[] = [
    {
      id: 'o-1',
      lineId: 'zl-1',
      listId: LIST_A,
      zoneId: ZONE_A,
      quantity: 2,
      order: 1,
    },
    {
      id: 'o-2',
      lineId: 'zl-2',
      listId: LIST_B,
      zoneId: ZONE_B,
      quantity: 1,
      order: 2,
    },
  ];

  it('writes the same settlements with the allocation supplied', async () => {
    // "Two for us, one for my parents", said correctly rather than guessed.
    const harness = build({ quantity: 3, origins: twoOrigins });
    const result = await settle(harness, {
      quantity: 3,
      allocations: [
        { listId: LIST_A, quantity: 2 },
        { listId: LIST_B, quantity: 1 },
      ],
    });

    const byList = Object.fromEntries(
      result.settlements.map((row) => [row.listId, row.quantity])
    );
    expect(byList).toEqual({ [LIST_A]: 2, [LIST_B]: 1 });
  });

  it('can send everything to the list the default would have filled second', async () => {
    const harness = build({ quantity: 1, origins: twoOrigins });
    const result = await settle(harness, {
      quantity: 1,
      allocations: [{ listId: LIST_B, quantity: 1 }],
    });

    expect(result.settlements).toHaveLength(1);
    expect(result.settlements[0].listId).toBe(LIST_B);
  });

  it('refuses an allocation adding up to more than was settled', async () => {
    const harness = build({ quantity: 3, origins: twoOrigins });
    await expect(
      settle(harness, {
        quantity: 2,
        allocations: [
          { listId: LIST_A, quantity: 2 },
          { listId: LIST_B, quantity: 1 },
        ],
      })
    ).rejects.toBeInstanceOf(DomainException);
  });

  it('refuses an allocation naming a list the line does not come from', async () => {
    const harness = build({ quantity: 2, origins: twoOrigins });
    await expect(
      settle(harness, {
        quantity: 2,
        allocations: [{ listId: 'l-somebody-elses', quantity: 2 }],
      })
    ).rejects.toBeInstanceOf(DomainException);
  });
});

describe('swapping the product at the shelf (section 6.1)', () => {
  it('records the product actually bought, not the one planned', async () => {
    const harness = build({
      itemId: 'item-planned',
      optionIds: ['item-bought'],
    });
    await settle(harness, { itemId: 'item-bought' });

    expect(harness.settlements[0].itemId).toBe('item-bought');
    // And the basket's pick moves with it, so the next settle agrees.
    expect(harness.basketLine.itemId).toBe('item-bought');
  });

  it('refuses a product that is not one of the line’s own options', async () => {
    // A swap is a gesture at the shelf, not a way to write an arbitrary catalog
    // id into a household's purchase history.
    const harness = build({
      itemId: 'item-planned',
      optionIds: ['item-bought'],
    });
    await expect(
      settle(harness, { itemId: 'item-never-offered' })
    ).rejects.toBeInstanceOf(DomainException);
  });
});

describe('what the settle tells the rest of the system (section 10)', () => {
  it('tells each zone list, and the basket, and nothing else', async () => {
    const harness = build({});
    await settle(harness);

    expect(
      harness.events.map(({ event, listId, generatedListId, userIds }) => ({
        event,
        listId,
        generatedListId,
        userIds,
      }))
    ).toEqual([
      // The ordinary plan 0047 event: the household sees the bread was got.
      {
        event: RealtimeEvent.LineSettled,
        listId: LIST_A,
        generatedListId: undefined,
        userIds: undefined,
      },
      // The basket's own room, so four people in a shop agree.
      {
        event: RealtimeEvent.GeneratedListLineSettled,
        listId: undefined,
        generatedListId: BASKET,
        userIds: undefined,
      },
      // And the owner's own sessions, because the owner is usually **not** in
      // the room: they are at home on the dashboard while somebody else shops,
      // and velista 0045's dashboard card counts settled lines.
      {
        event: RealtimeEvent.GeneratedListLineSettled,
        listId: undefined,
        generatedListId: undefined,
        userIds: [OWNER],
      },
    ]);
  });

  /**
   * The zone event carries the line's two indicators, and this is the path that
   * normally moves them (plan 0047, section 5).
   *
   * A regression guard rather than a feature test. The event carries a **whole**
   * `LineView` and a phone at home reconciles off it, so announcing the zero
   * summary here would take the bought indicator off the household's line at the
   * exact moment somebody in a shop bought the thing. It is silent, it only shows
   * up on a second device, and it is one forgotten argument away at all times.
   */
  it('tells the zone that the line has now been bought', async () => {
    const harness = build({});
    await settle(harness);

    const zoneEvent = harness.events.find(
      (entry) => entry.event === RealtimeEvent.LineSettled
    );
    const { line } = zoneEvent?.payload as { line: LineView };

    expect(line.boughtCount).toBe(1);
    expect(line.lastSettlementOutcome).toBe(SettlementOutcome.BOUGHT);
  });

  it('tells the zone a trip found nothing, without counting a purchase', async () => {
    const harness = build({});
    await settle(harness, { outcome: SettlementOutcome.NOT_AVAILABLE });

    const zoneEvent = harness.events.find(
      (entry) => entry.event === RealtimeEvent.LineSettled
    );
    const { line } = zoneEvent?.payload as { line: LineView };

    // The indicator moves and the count does not, which is what draws "not in the
    // shop last time" on a line the household still wants.
    expect(line.boughtCount).toBe(0);
    expect(line.lastSettlementOutcome).toBe(SettlementOutcome.NOT_AVAILABLE);
  });
});

/**
 * Section 5.2 on the way **out**.
 *
 * The settle route is on the participant surface, so a guest reaches it, and
 * every field of a settlement ref, of a skip and of a line's origins names a zone
 * or a list. These are the assertions that stop the answer to a settle being the
 * disclosure the rest of the plan refuses.
 */
describe('what a settle tells the person who made it (section 5.2)', () => {
  const twoOrigins: OriginSeed[] = [
    {
      id: 'o-1',
      lineId: 'zl-1',
      listId: LIST_A,
      zoneId: ZONE_A,
      quantity: 2,
      order: 1,
    },
    {
      id: 'o-2',
      lineId: 'zl-2',
      listId: LIST_B,
      zoneId: ZONE_B,
      quantity: 1,
      order: 2,
    },
  ];

  it('names no list to a guest, in the settlements or in the skips', async () => {
    const harness = build({
      quantity: 3,
      origins: twoOrigins,
      ownerWritable: [LIST_A],
      actorSeesZoneData: false,
    });
    const result = await settle(harness);

    // Absent rather than empty: an empty array would read as "nothing was
    // missed", which is the opposite of what happened here.
    expect(result.settlements).toBeUndefined();
    expect(result.skipped).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(LIST_B);
  });

  it('still tells a guest that an origin was missed, without whose it was', async () => {
    // Section 6.4: a partial settle is a real outcome and has to be reported. The
    // count survives the redaction; only the names are gated.
    const harness = build({
      quantity: 3,
      origins: twoOrigins,
      ownerWritable: [LIST_A],
      actorSeesZoneData: false,
    });
    const result = await settle(harness);

    expect(result.skippedCount).toBe(1);
  });

  it('gives a reader who passes the rule both the count and the names', async () => {
    const harness = build({
      quantity: 3,
      origins: twoOrigins,
      ownerWritable: [LIST_A],
    });
    const result = await settle(harness);

    expect(result.skippedCount).toBe(1);
    expect(result.skipped).toEqual([
      {
        lineId: 'zl-2',
        listId: LIST_B,
        reason: 'ACCESS_GONE',
        // Named, because this reader passes section 5.2 (plan 0053, section 4).
        // The zone is null because this fixture's zone has no name, which is a
        // different thing from the reader not being allowed one.
        listName: 'Parents',
        zoneName: null,
      },
    ]);
    expect(result.settlements).toHaveLength(1);
  });

  it('settles the same units either way, because redaction is not authorization', async () => {
    // What a reader may be told and what an actor may do are different
    // questions. A guest settles exactly what anybody else would.
    const guest = build({ quantity: 2, actorSeesZoneData: false });
    const writer = build({ quantity: 2 });
    await settle(guest);
    await settle(writer);

    expect(guest.settlements).toHaveLength(1);
    expect(guest.settlements[0].quantity).toBe(2);
    expect(guest.basketLine.settledQuantity).toBe(
      writer.basketLine.settledQuantity
    );
  });
});

describe('settling releases the claim (plan 0052, section 3.3)', () => {
  it('releases every origin once the basket line is settled through', async () => {
    const w = build({ quantity: 2 });

    await w.service.settle({
      generatedListId: BASKET,
      participantId: GUEST_PARTICIPANT,
      lineId: BASKET_LINE,
      outcome: SettlementOutcome.BOUGHT,
      quantity: 2,
    });

    expect(w.claims.calls).toEqual([
      { claimed: false, claimedByUserId: null, lineIds: ['zl-1'] },
    ]);
  });

  it('keeps the claim while the line still has something outstanding', async () => {
    // Nothing about settling is terminal (plan 0047, section 4.1), so a line
    // bought two of three is still a line somebody is out buying.
    const w = build({ quantity: 3 });

    await w.service.settle({
      generatedListId: BASKET,
      participantId: GUEST_PARTICIPANT,
      lineId: BASKET_LINE,
      outcome: SettlementOutcome.BOUGHT,
      quantity: 2,
    });

    expect(w.claims.calls).toEqual([]);
  });

  it('releases on NOT_AVAILABLE, which closes the outstanding amount', async () => {
    const w = build({ quantity: 3 });

    await w.service.settle({
      generatedListId: BASKET,
      participantId: GUEST_PARTICIPANT,
      lineId: BASKET_LINE,
      outcome: SettlementOutcome.NOT_AVAILABLE,
    });

    expect(w.claims.calls).toEqual([
      { claimed: false, claimedByUserId: null, lineIds: ['zl-1'] },
    ]);
  });
});
