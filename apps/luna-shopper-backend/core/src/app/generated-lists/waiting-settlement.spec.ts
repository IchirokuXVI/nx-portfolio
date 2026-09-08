import {
  RealtimeEvent,
  SettlementOutcome,
  type GeneratedListBasketLineView,
  type LineView,
} from '@portfolio/luna-shopper/contracts';
import type { DataSource, EntityManager } from 'typeorm';
import {
  GeneratedListLine,
  GeneratedListLineOrigin,
  LineSettlement,
  ListLine,
  ListLineItem,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { fakeLineSettlements } from '../lists/line-settlements.fake';
import type { ProfileService } from '../profiles/profile.service';
import { GeneratedListService } from './generated-list.service';
import { fakeLineClaims } from './line-claims.fake';
import { WaitingSettlementService } from './waiting-settlement.service';

/**
 * A purchase made before the basket line reached any list (plan 0093).
 *
 * Somebody adds "batteries" in the shop, buys four, and at home sends the line
 * to the flat's list. Before this plan the flat got a line asking for nothing
 * and a history saying batteries were never bought, because a settle on a line
 * with no origins wrote no row at all (plan 0058, section 4.1). Now the purchase
 * is written when it happens and comes home when the line reaches a list.
 *
 * Faked at the repository boundary in the style `generated-list-settle.spec.ts`
 * established. The one thing worth saying about the harness is that re-homing
 * lowers the zone line with a raw `UPDATE`, so the fake manager answers `query`
 * as well as `getRepository`: that statement is the write, not an optimisation
 * around one.
 */

const BASKET_LINE = 'gll-1';
const PARTICIPANT = 'p-guest';
const LIST_A = 'l-flat';
const LIST_B = 'l-parents';
const ZONE_A = 'z-flat';
const ZONE_B = 'z-parents';

interface OriginSeed {
  lineId: string;
  listId: string;
  zoneId: string;
  /** What this list contributed to the basket line. */
  quantity: number;
  /** What the list itself is still asking for. */
  listQuantity?: number;
}

interface WaitingSeed {
  quantity: number;
  outcome?: SettlementOutcome;
  /** Minutes past the hour, so the order of two purchases is stated. */
  minute?: number;
  reverted?: boolean;
  itemId?: string | null;
}

/** A settlement already home on one of the origins, for the room it takes up. */
interface HomedSeed {
  lineId: string;
  listId: string;
  quantity: number;
  outcome?: SettlementOutcome;
}

interface Harness {
  service: WaitingSettlementService;
  manager: EntityManager;
  /** Every settlement row, in the order it was written. */
  settlements: Partial<LineSettlement>[];
  zoneLines: Map<string, { id: string; quantity: number; version: number }>;
  events: { event: RealtimeEvent; listId?: string; payload?: unknown }[];
}

function build(options: {
  origins?: OriginSeed[];
  waiting?: WaitingSeed[];
  homed?: HomedSeed[];
  /** Origins whose zone line has been deleted underneath the basket. */
  missingZoneLines?: string[];
}): Harness {
  const origins = options.origins ?? [];
  const missing = new Set(options.missingZoneLines ?? []);

  const zoneLines = new Map(
    origins
      .filter((origin) => !missing.has(origin.lineId))
      .map((origin) => [
        origin.lineId,
        {
          id: origin.lineId,
          listId: origin.listId,
          quantity: origin.listQuantity ?? origin.quantity,
          version: 1,
          content: 'batteries',
          position: 0,
          approvalStatus: 'APPROVED',
          createdByUserId: 'u-owner',
          approvedByUserId: 'u-owner',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ])
  );

  // Seeded oldest first, which is the order the allocation walks them in.
  const seeded: Partial<LineSettlement>[] = [
    ...(options.homed ?? []).map((row, index) => ({
      id: `h${index + 1}`,
      lineId: row.lineId,
      listId: row.listId,
      itemId: null,
      outcome: row.outcome ?? SettlementOutcome.BOUGHT,
      quantity: row.quantity,
      settledByUserId: null,
      settledByParticipantId: PARTICIPANT,
      settledAt: new Date('2026-01-02T09:00:00.000Z'),
      revertedAt: null,
      revertedByParticipantId: null,
      generatedListLineId: BASKET_LINE,
      pricePaidCents: null,
      supermarketLocationId: null,
    })),
    ...(options.waiting ?? []).map((row, index) => ({
      id: `w${index + 1}`,
      // The pair that makes it a waiting row.
      lineId: null,
      listId: null,
      itemId: row.itemId ?? 'i-batteries',
      outcome: row.outcome ?? SettlementOutcome.BOUGHT,
      quantity: row.quantity,
      settledByUserId: null,
      settledByParticipantId: PARTICIPANT,
      settledAt: new Date(
        `2026-01-02T10:${String(row.minute ?? index).padStart(2, '0')}:00.000Z`
      ),
      revertedAt: row.reverted ? new Date('2026-01-02T11:00:00.000Z') : null,
      revertedByParticipantId: row.reverted ? PARTICIPANT : null,
      generatedListLineId: BASKET_LINE,
      pricePaidCents: null,
      supermarketLocationId: null,
    })),
  ];

  const settlementRows = fakeLineSettlements(seeded);
  const events: Harness['events'] = [];

  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === LineSettlement) {
        return settlementRows.repo;
      }
      if (entity === GeneratedListLineOrigin) {
        return { find: async () => origins };
      }
      if (entity === ListLine) {
        return {
          find: async ({ where }: { where: { id: { _value: string[] } } }) =>
            [...zoneLines.values()].filter((row) =>
              where.id._value.includes(row.id)
            ),
          findOne: async ({ where }: { where: { id: string } }) =>
            zoneLines.get(where.id) ?? null,
        };
      }
      if (entity === ListLineItem) {
        return { find: async () => [] };
      }
      throw new Error('unmocked repository in the re-homing pass');
    },
    // The decrement itself. It is a raw statement because one of the two callers
    // writes outside a transaction, where a read, a subtraction and a save can
    // lose an update.
    query: async (sql: string, parameters: unknown[]) => {
      expect(sql).toContain('UPDATE "list_lines"');
      const [id, units] = parameters as [string, number];
      const row = zoneLines.get(id);
      if (row) {
        row.quantity = Math.max(0, row.quantity - units);
        row.version += 1;
      }
      return [];
    },
  } as unknown as EntityManager;

  const service = new WaitingSettlementService(fakeLineClaims({}).service, {
    emit: (
      event: RealtimeEvent,
      _zoneId: string,
      payload: unknown,
      listId?: string
    ) => events.push({ event, listId, payload }),
  } as unknown as CoreEventsPublisher);

  return {
    service,
    manager,
    settlements: settlementRows.rows,
    zoneLines: zoneLines as Harness['zoneLines'],
    events,
  };
}

/** Re-home and announce, which is what both callers do around a commit. */
async function rehome(harness: Harness) {
  const moved = await harness.service.rehome(BASKET_LINE, harness.manager);
  harness.service.announce(moved);
  return moved;
}

/** The waiting rows still standing, which is what the next list would get. */
function stillWaiting(harness: Harness) {
  return harness.settlements.filter(
    (row) => row.lineId === null && !row.revertedAt
  );
}

/** Every row that has come home to one zone line. */
function homedOn(harness: Harness, lineId: string) {
  return harness.settlements.filter((row) => row.lineId === lineId);
}

describe('a list that receives a line receives its purchases (section 3)', () => {
  it('re-homes the whole row when the list asks for enough', async () => {
    // The plan's own sentence: a list that asked for four and receives four
    // lands at zero with a BOUGHT row, which is plan 0047 section 5's bought
    // indicator.
    const harness = build({
      origins: [
        { lineId: 'zl-a', listId: LIST_A, zoneId: ZONE_A, quantity: 4 },
      ],
      waiting: [{ quantity: 4 }],
    });

    await rehome(harness);

    expect(homedOn(harness, 'zl-a')).toHaveLength(1);
    expect(homedOn(harness, 'zl-a')[0]).toMatchObject({
      listId: LIST_A,
      quantity: 4,
      // Everything else is kept: a purchase re-homed later is still a purchase
      // made when it was made, by whom it was made, of what was bought.
      itemId: 'i-batteries',
      settledByParticipantId: PARTICIPANT,
      settledAt: new Date('2026-01-02T10:00:00.000Z'),
    });
    expect(stillWaiting(harness)).toHaveLength(0);
    expect(harness.zoneLines.get('zl-a')?.quantity).toBe(0);
  });

  it('splits a row that fits partly and leaves the rest waiting', async () => {
    // Four bought, a list asking for three: three come home as a new row and
    // one waits for the next list, still dated and attributed as it was.
    const harness = build({
      origins: [
        { lineId: 'zl-a', listId: LIST_A, zoneId: ZONE_A, quantity: 3 },
      ],
      waiting: [{ quantity: 4 }],
    });

    await rehome(harness);

    expect(homedOn(harness, 'zl-a')).toHaveLength(1);
    expect(homedOn(harness, 'zl-a')[0]).toMatchObject({
      quantity: 3,
      settledAt: new Date('2026-01-02T10:00:00.000Z'),
      settledByParticipantId: PARTICIPANT,
    });
    expect(stillWaiting(harness)).toHaveLength(1);
    expect(stillWaiting(harness)[0]).toMatchObject({
      id: 'w1',
      quantity: 1,
      listId: null,
    });
    expect(harness.zoneLines.get('zl-a')?.quantity).toBe(0);
  });

  it('gives the next list the units the first one could not take', async () => {
    // The second half of the same story, reached by re-homing twice: the first
    // list took three of four, and a second list asking for two gets the last
    // one and stays at one.
    const first = build({
      origins: [
        { lineId: 'zl-a', listId: LIST_A, zoneId: ZONE_A, quantity: 3 },
      ],
      waiting: [{ quantity: 4 }],
    });
    await rehome(first);

    const second = build({
      origins: [
        { lineId: 'zl-a', listId: LIST_A, zoneId: ZONE_A, quantity: 3 },
        {
          lineId: 'zl-b',
          listId: LIST_B,
          zoneId: ZONE_B,
          quantity: 2,
          listQuantity: 2,
        },
      ],
      // What the first pass left: three already home on the flat's line, one
      // still waiting.
      homed: [{ lineId: 'zl-a', listId: LIST_A, quantity: 3 }],
      waiting: [{ quantity: 1 }],
    });
    await rehome(second);

    expect(homedOn(second, 'zl-b')).toHaveLength(1);
    expect(homedOn(second, 'zl-b')[0]).toMatchObject({ quantity: 1 });
    expect(stillWaiting(second)).toHaveLength(0);
    // The parents' list asked for two, got one, and still asks for one.
    expect(second.zoneLines.get('zl-b')?.quantity).toBe(1);
    // And the flat's line is untouched: it had no room left.
    expect(second.zoneLines.get('zl-a')?.quantity).toBe(3);
  });

  it('gives an origin only its own room, not the whole purchase', async () => {
    // Room is what this list contributed less what this basket already bought
    // against it (section 3, rule 3). Two of the flat's three are already home,
    // so it can take one more and the rest waits.
    const harness = build({
      origins: [
        { lineId: 'zl-a', listId: LIST_A, zoneId: ZONE_A, quantity: 3 },
      ],
      homed: [{ lineId: 'zl-a', listId: LIST_A, quantity: 2 }],
      waiting: [{ quantity: 3 }],
    });

    await rehome(harness);

    expect(homedOn(harness, 'zl-a').map((row) => row.quantity)).toEqual([2, 1]);
    expect(stillWaiting(harness)[0]).toMatchObject({ quantity: 2 });
  });

  it('places the oldest purchase first', async () => {
    // The allocation rule applied to the past, and the order is the purchases'
    // own: the earlier tap fills the list before the later one.
    const harness = build({
      origins: [
        { lineId: 'zl-a', listId: LIST_A, zoneId: ZONE_A, quantity: 1 },
      ],
      waiting: [
        { quantity: 1, minute: 5 },
        { quantity: 1, minute: 30 },
      ],
    });

    await rehome(harness);

    expect(homedOn(harness, 'zl-a')[0]).toMatchObject({
      settledAt: new Date('2026-01-02T10:05:00.000Z'),
    });
    expect(stillWaiting(harness)[0]).toMatchObject({
      settledAt: new Date('2026-01-02T10:30:00.000Z'),
    });
  });

  it('floors the list at zero rather than below it', async () => {
    // A settle from the list page may already have taken the line below what
    // this basket bought (plan 0047, section 4.2), and the purchase is still
    // recorded in full.
    const harness = build({
      origins: [
        {
          lineId: 'zl-a',
          listId: LIST_A,
          zoneId: ZONE_A,
          quantity: 3,
          listQuantity: 1,
        },
      ],
      waiting: [{ quantity: 3 }],
    });

    await rehome(harness);

    expect(harness.zoneLines.get('zl-a')?.quantity).toBe(0);
    expect(homedOn(harness, 'zl-a')[0]).toMatchObject({ quantity: 3 });
  });

  it('leaves units waiting when the line reaches no list at all', async () => {
    const harness = build({ origins: [], waiting: [{ quantity: 2 }] });

    expect(await rehome(harness)).toEqual([]);
    expect(stillWaiting(harness)).toHaveLength(1);
  });

  it('places nothing on an origin whose line has been deleted', async () => {
    // The basket outliving what it drew from is an ordinary thing to have in a
    // history rather than an error (plan 0050, section 1).
    const harness = build({
      origins: [
        { lineId: 'zl-a', listId: LIST_A, zoneId: ZONE_A, quantity: 2 },
      ],
      waiting: [{ quantity: 2 }],
      missingZoneLines: ['zl-a'],
    });

    expect(await rehome(harness)).toEqual([]);
    expect(stillWaiting(harness)).toHaveLength(1);
  });
});

describe('not available goes to the first list, whole (section 3.1)', () => {
  it('lands whole on the first origin and moves no units', async () => {
    // It says the shop had none, about the product and not about units, so the
    // list still asks for what it asked for and its indicator changes.
    const harness = build({
      origins: [
        { lineId: 'zl-a', listId: LIST_A, zoneId: ZONE_A, quantity: 2 },
      ],
      waiting: [{ quantity: 0, outcome: SettlementOutcome.NOT_AVAILABLE }],
    });

    await rehome(harness);

    expect(homedOn(harness, 'zl-a')).toHaveLength(1);
    expect(homedOn(harness, 'zl-a')[0]).toMatchObject({
      outcome: SettlementOutcome.NOT_AVAILABLE,
      quantity: 0,
      listId: LIST_A,
    });
    expect(harness.zoneLines.get('zl-a')?.quantity).toBe(2);
  });

  it('never reaches the second list, because it is home after the first', async () => {
    // Never split and never copied: after one pass the basket line has no
    // waiting row of that outcome left for a later list to receive.
    const harness = build({
      origins: [
        { lineId: 'zl-a', listId: LIST_A, zoneId: ZONE_A, quantity: 2 },
      ],
      waiting: [{ quantity: 0, outcome: SettlementOutcome.NOT_AVAILABLE }],
    });
    await rehome(harness);

    const later = build({
      origins: [
        { lineId: 'zl-a', listId: LIST_A, zoneId: ZONE_A, quantity: 2 },
        { lineId: 'zl-b', listId: LIST_B, zoneId: ZONE_B, quantity: 2 },
      ],
      homed: [
        {
          lineId: 'zl-a',
          listId: LIST_A,
          quantity: 0,
          outcome: SettlementOutcome.NOT_AVAILABLE,
        },
      ],
    });

    expect(await rehome(later)).toEqual([]);
    expect(homedOn(later, 'zl-b')).toHaveLength(0);
  });
});

describe('a purchase somebody took back never comes home (section 3.2)', () => {
  it('leaves a reverted waiting row where it is', async () => {
    // It is history, and not a fact about any list. A reverted row is excluded
    // from every consumption total (plan 0054, section 3.3), and re-homing it
    // would put one back into a household's.
    const harness = build({
      origins: [
        { lineId: 'zl-a', listId: LIST_A, zoneId: ZONE_A, quantity: 4 },
      ],
      waiting: [{ quantity: 4, reverted: true }],
    });

    expect(await rehome(harness)).toEqual([]);
    expect(harness.settlements[0]).toMatchObject({
      lineId: null,
      listId: null,
    });
    expect(harness.zoneLines.get('zl-a')?.quantity).toBe(4);
  });
});

describe('what the household hears (section 3)', () => {
  it('says line.settled on the zone room, once per re-homed row', async () => {
    const harness = build({
      origins: [
        { lineId: 'zl-a', listId: LIST_A, zoneId: ZONE_A, quantity: 4 },
      ],
      waiting: [
        { quantity: 2, minute: 5 },
        { quantity: 2, minute: 30 },
      ],
    });

    await rehome(harness);

    const settled = harness.events.filter(
      (entry) => entry.event === RealtimeEvent.LineSettled
    );
    expect(settled).toHaveLength(2);
    expect(settled[0].listId).toBe(LIST_A);
    // The line as it now stands, which is what makes the row on the list move.
    const payload = settled[1].payload as { line: LineView };
    expect(payload.line.quantity).toBe(0);
    expect(payload.line.boughtCount).toBe(2);
  });

  it('says nothing until the caller announces', async () => {
    // The write and the announcement are two calls, so a caller inside a
    // transaction can hold the news until it commits: an event for a write that
    // then rolled back is a client showing something that never happened.
    const harness = build({
      origins: [
        { lineId: 'zl-a', listId: LIST_A, zoneId: ZONE_A, quantity: 1 },
      ],
      waiting: [{ quantity: 1 }],
    });

    const moved = await harness.service.rehome(BASKET_LINE, harness.manager);

    expect(moved).toHaveLength(1);
    expect(harness.events).toEqual([]);
  });

  it('says nothing at all when there is nothing to place', async () => {
    const harness = build({
      origins: [
        { lineId: 'zl-a', listId: LIST_A, zoneId: ZONE_A, quantity: 1 },
      ],
    });

    expect(await rehome(harness)).toEqual([]);
    expect(harness.events).toEqual([]);
  });
});

/**
 * The number the shopper reads while the units are still nobody's (section 2.2).
 *
 * Through the service that builds the view rather than the mapper alone, because
 * the question this answers is which rows count, and that is the query.
 */
describe('waitingSettled on the basket line', () => {
  function view(
    rows: Partial<LineSettlement>[],
    seesZoneData = true
  ): Promise<GeneratedListBasketLineView> {
    const service = new GeneratedListService(
      { transaction: async () => undefined } as unknown as DataSource,
      {} as never,
      {} as never,
      { find: async () => [] } as never,
      { find: async () => [] } as never,
      { find: async () => rows } as never,
      {} as unknown as ProfileService,
      fakeLineClaims({}).service,
      { emitToUsers: () => undefined } as unknown as CoreEventsPublisher
    );
    return service.basketLineViewFor(
      { id: BASKET_LINE } as GeneratedListLine,
      seesZoneData
    );
  }

  const waitingRow = (
    over: Partial<LineSettlement> = {}
  ): Partial<LineSettlement> => ({
    id: 'w1',
    lineId: null,
    listId: null,
    outcome: SettlementOutcome.BOUGHT,
    quantity: 4,
    generatedListLineId: BASKET_LINE,
    settledAt: new Date('2026-01-02T10:00:00.000Z'),
    revertedAt: null,
    ...over,
  });

  it('counts the units bought before the line reached any list', async () => {
    expect((await view([waitingRow()])).waitingSettled).toBe(4);
  });

  it('is zero for a line whose purchases are all home', async () => {
    const homed = waitingRow({ lineId: 'zl-a', listId: LIST_A });
    expect((await view([homed])).waitingSettled).toBe(0);
  });

  it('does not count a shop that had none, which moved no units', async () => {
    const none = waitingRow({
      outcome: SettlementOutcome.NOT_AVAILABLE,
      quantity: 0,
    });
    expect((await view([none])).waitingSettled).toBe(0);
    // And it is still the newest thing that happened to the line, which is the
    // caption the basket row draws.
    expect((await view([none])).lastOutcome).toBe(
      SettlementOutcome.NOT_AVAILABLE
    );
  });

  it('is told to a guest, because it names no list', async () => {
    // Section 5.2 redacts by absence, and this field has nothing to redact: it
    // counts this basket's own purchases and names no household.
    const line = await view([waitingRow()], false);
    expect(line.waitingSettled).toBe(4);
    expect(line.origins).toBeUndefined();
  });
});
