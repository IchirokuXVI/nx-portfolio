import {
  ParticipantKind,
  RealtimeEvent,
  SettlementOutcome,
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
import {
  allocateOldestFirst,
  GeneratedListSettleService,
} from './generated-list-settle.service';
import type { GeneratedListSharingService } from './generated-list-sharing.service';
import type { GeneratedListService } from './generated-list.service';

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
  zoneLines: Map<string, { id: string; listId: string; quantity: number; version: number }>;
  basketLine: Partial<GeneratedListLine>;
  events: { event: RealtimeEvent; listId?: string; generatedListId?: string }[];
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

  const settlements: Partial<LineSettlement>[] = [];
  const events: Harness['events'] = [];

  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === ListLine) {
        return {
          findOne: async ({ where }: { where: { id: string } }) =>
            zoneLines.get(where.id) ?? null,
          save: async (row: { id: string; quantity: number; version: number }) => {
            const existing = zoneLines.get(row.id);
            if (existing) {
              zoneLines.set(row.id, { ...existing, ...row });
            }
            return row;
          },
        };
      }
      if (entity === LineSettlement) {
        return {
          create: (data: Partial<LineSettlement>) => ({ ...data }),
          save: async (row: Partial<LineSettlement>) => {
            const saved = { ...row, id: `s-${settlements.length + 1}` };
            settlements.push(saved);
            return saved;
          },
        };
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
    transaction: async (fn: (m: typeof manager) => Promise<unknown>) => fn(manager),
  } as unknown as DataSource;

  const sharing = {
    livePresenceEntry: async () => ({
      participantId: GUEST_PARTICIPANT,
      kind: ParticipantKind.GUEST,
      displayName: null,
      guestNumber: 1,
      userId: null,
    }),
    // The whole of section 6.4 in one fake: this is asked about the **owner**,
    // and the service passes `list.ownerUserId` rather than the actor.
    writableAmong: async (userId: string, listIds: readonly string[]) => {
      expect(userId).toBe(OWNER);
      return new Set(listIds.filter((listId) => ownerWritable.has(listId)));
    },
  } as unknown as GeneratedListSharingService;

  const generated = {
    lineViewFor: async () => ({
      id: BASKET_LINE,
      quantity: basketLine.quantity,
      settledQuantity: basketLine.settledQuantity,
    }),
  } as unknown as GeneratedListService;

  const service = new GeneratedListSettleService(
    dataSource,
    {
      findOne: async () => ({ id: BASKET, ownerUserId: OWNER }),
    } as never,
    { findOne: async () => basketLine } as never,
    {
      find: async () =>
        [...origins].sort((a, b) => a.order - b.order),
    } as never,
    {
      findOne: async ({ where }: { where: { itemId: string } }) =>
        (options.optionIds ?? []).includes(where.itemId)
          ? { itemId: where.itemId }
          : null,
    } as never,
    sharing,
    generated,
    {
      emit: (event: RealtimeEvent, _zoneId: string, _payload: unknown, listId?: string) =>
        events.push({ event, listId }),
      emitToGeneratedList: (event: RealtimeEvent, generatedListId: string) =>
        events.push({ event, generatedListId }),
    } as unknown as CoreEventsPublisher
  );

  return {
    service,
    settlements,
    zoneLines: zoneLines as Harness['zoneLines'],
    basketLine,
    events,
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
  const origin = (id: string, quantity: number) =>
    ({ id, quantity }) as never;

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

    expect(harness.settlements[0].settledByParticipantId).toBe(GUEST_PARTICIPANT);
    expect(harness.settlements[0].settledByUserId).toBeNull();
  });

  it('records which basket line it came off, for the audit', async () => {
    const harness = build({});
    await settle(harness);
    expect(harness.settlements[0].generatedListLineId).toBe(BASKET_LINE);
  });
});

describe('a settle is authorized by the owner, never the actor (section 6.4)', () => {
  const twoOrigins: OriginSeed[] = [
    { id: 'o-1', lineId: 'zl-1', listId: LIST_A, zoneId: ZONE_A, quantity: 2, order: 1 },
    { id: 'o-2', lineId: 'zl-2', listId: LIST_B, zoneId: ZONE_B, quantity: 1, order: 2 },
  ];

  it('skips and reports an origin the owner may no longer write', async () => {
    const harness = build({
      quantity: 3,
      origins: twoOrigins,
      ownerWritable: [LIST_A],
    });
    const result = await settle(harness);

    expect(result.skipped).toEqual([
      { lineId: 'zl-2', listId: LIST_B, reason: 'ACCESS_GONE' },
    ]);
    // Nothing was written to the list the owner lost.
    expect(
      harness.settlements.every((row) => row.listId === LIST_A)
    ).toBe(true);
  });

  it('reports an origin whose zone line has been deleted', async () => {
    const harness = build({
      quantity: 3,
      origins: twoOrigins,
      missingZoneLines: ['zl-2'],
    });
    const result = await settle(harness);

    expect(result.skipped).toEqual([
      { lineId: 'zl-2', listId: LIST_B, reason: 'ORIGIN_DELETED' },
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
    { id: 'o-1', lineId: 'zl-1', listId: LIST_A, zoneId: ZONE_A, quantity: 2, order: 1 },
    { id: 'o-2', lineId: 'zl-2', listId: LIST_B, zoneId: ZONE_B, quantity: 1, order: 2 },
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
    const harness = build({ itemId: 'item-planned', optionIds: ['item-bought'] });
    await settle(harness, { itemId: 'item-bought' });

    expect(harness.settlements[0].itemId).toBe('item-bought');
    // And the basket's pick moves with it, so the next settle agrees.
    expect(harness.basketLine.itemId).toBe('item-bought');
  });

  it('refuses a product that is not one of the line’s own options', async () => {
    // A swap is a gesture at the shelf, not a way to write an arbitrary catalog
    // id into a household's purchase history.
    const harness = build({ itemId: 'item-planned', optionIds: ['item-bought'] });
    await expect(
      settle(harness, { itemId: 'item-never-offered' })
    ).rejects.toBeInstanceOf(DomainException);
  });
});

describe('what the settle tells the rest of the system (section 10)', () => {
  it('tells each zone list, and the basket, and nothing else', async () => {
    const harness = build({});
    await settle(harness);

    expect(harness.events).toEqual([
      // The ordinary plan 0047 event: the household sees the bread was got.
      { event: RealtimeEvent.LineSettled, listId: LIST_A },
      // And the basket's own room, so four people in a shop agree.
      { event: RealtimeEvent.GeneratedListLineSettled, generatedListId: BASKET },
    ]);
  });
});
