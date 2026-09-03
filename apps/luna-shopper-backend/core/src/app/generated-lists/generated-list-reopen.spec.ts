import {
  GeneratedListStatus,
  ParticipantKind,
  RealtimeEvent,
  SettlementOutcome,
  type LineSettlementResult,
} from '@portfolio/luna-shopper/contracts';
import { ConflictException } from '@portfolio/luna-shopper/platform';
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
import { GeneratedListReopenService } from './generated-list-reopen.service';
import type { GeneratedListSharingService } from './generated-list-sharing.service';
import type { GeneratedListService } from './generated-list.service';
import { fakeLineClaims, type FakeLineClaims } from './line-claims.fake';

/**
 * Taking a settled basket line back to outstanding (plan 0054, section 3).
 *
 * The property this file exists to pin is section 3.1: a settle does **three**
 * things and only one of them is on the basket, so undoing the basket half alone
 * would leave a line outstanding that the origin lists believe was bought. Every
 * test here is about one of the three moving with the other two, or about the
 * history surviving the act that undoes it.
 *
 * Faked at the repository boundary in the style `generated-list-settle.spec.ts`
 * established, and against the same shared settlements fake, which is what makes
 * "the row is marked rather than deleted" an assertion about rows rather than
 * about a call.
 */

const OWNER = 'u-owner';
const ACTOR = 'p-guest';
const BASKET = 'gl-1';
const BASKET_LINE = 'gll-1';
const LIST_A = 'l-flat';
const LIST_B = 'l-parents';
const ZONE_A = 'z-flat';
const ZONE_B = 'z-parents';

interface SettlementSeed {
  id: string;
  /** The zone line it landed on. */
  lineId: string;
  listId: string;
  quantity: number;
  outcome?: SettlementOutcome;
  /** Already taken back before this call, so this call must leave it alone. */
  revertedAt?: Date;
  /** A settlement of somebody else's, which this basket line must not touch. */
  generatedListLineId?: string | null;
}

interface Harness {
  service: GeneratedListReopenService;
  settlements: Partial<LineSettlement>[];
  zoneLines: Map<string, { id: string; quantity: number; version: number }>;
  basketLine: Partial<GeneratedListLine>;
  events: {
    event: RealtimeEvent;
    listId?: string;
    generatedListId?: string;
    userIds?: string[];
    payload?: unknown;
  }[];
  claims: FakeLineClaims;
}

function build(options: {
  quantity?: number;
  settledQuantity?: number;
  settlements?: SettlementSeed[];
  /** Origins whose zone line has been deleted underneath the basket. */
  missingZoneLines?: string[];
  /** Lists that have been deleted, so their room cannot be addressed. */
  missingLists?: string[];
  actorSeesZoneData?: boolean;
}): Harness {
  const seeds = options.settlements ?? [
    { id: 's-1', lineId: 'zl-1', listId: LIST_A, quantity: 2 },
  ];
  const missing = new Set(options.missingZoneLines ?? []);
  const missingLists = new Set(options.missingLists ?? []);

  const basketLine: Partial<GeneratedListLine> = {
    id: BASKET_LINE,
    generatedListId: BASKET,
    quantity: options.quantity ?? 2,
    settledQuantity: options.settledQuantity ?? 2,
    itemId: null,
  };

  const zoneLines = new Map(
    seeds
      .filter((seed) => !missing.has(seed.lineId))
      .map((seed) => [
        seed.lineId,
        {
          id: seed.lineId,
          listId: seed.listId,
          // Whatever the settle left, which is what the units go back onto.
          quantity: 3,
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
    seeds.map((seed, index) => ({
      id: seed.id,
      lineId: seed.lineId,
      listId: seed.listId,
      itemId: null,
      outcome: seed.outcome ?? SettlementOutcome.BOUGHT,
      quantity: seed.quantity,
      settledByUserId: null,
      settledByParticipantId: ACTOR,
      settledAt: new Date(2026, 0, 1, 0, index),
      revertedAt: seed.revertedAt ?? null,
      revertedByParticipantId: seed.revertedAt ? ACTOR : null,
      generatedListLineId:
        seed.generatedListLineId === undefined
          ? BASKET_LINE
          : seed.generatedListLineId,
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
          find: async () =>
            [
              { id: LIST_A, zoneId: ZONE_A },
              { id: LIST_B, zoneId: ZONE_B },
            ].filter((row) => !missingLists.has(row.id)),
        };
      }
      if (entity === GeneratedListLine) {
        return {
          save: async (row: Partial<GeneratedListLine>) => {
            Object.assign(basketLine, row);
            return row;
          },
        };
      }
      throw new Error('unmocked repository in the reopen transaction');
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
  } as unknown as GeneratedListSharingService;

  const generated = {
    basketLineViewFor: async (_line: unknown, lineSeesZoneData: boolean) => ({
      id: BASKET_LINE,
      quantity: basketLine.quantity,
      settledQuantity: basketLine.settledQuantity,
      ...(lineSeesZoneData ? { targetListId: null } : {}),
    }),
  } as unknown as GeneratedListService;

  const claims = fakeLineClaims({}, () =>
    seeds.map((seed) => ({
      zoneId: seed.listId === LIST_B ? ZONE_B : ZONE_A,
      listId: seed.listId,
      lineId: seed.lineId,
    }))
  );

  const service = new GeneratedListReopenService(
    dataSource,
    {
      findOne: async () => ({
        id: BASKET,
        ownerUserId: OWNER,
        status: GeneratedListStatus.ACTIVE,
      }),
    } as never,
    { findOne: async () => basketLine } as never,
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
      emitToUsers: (event: RealtimeEvent, userIds: string[]) =>
        events.push({ event, userIds }),
    } as unknown as CoreEventsPublisher
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

function reopen(harness: Harness) {
  return harness.service.reopen({
    generatedListId: BASKET,
    lineId: BASKET_LINE,
    participantId: ACTOR,
  });
}

describe('a reopen undoes all three halves of a settle (section 3.1)', () => {
  it('takes the basket line back to fully outstanding', async () => {
    const harness = build({ quantity: 2, settledQuantity: 2 });

    const result = await reopen(harness);

    expect(harness.basketLine.settledQuantity).toBe(0);
    expect(result.line.settledQuantity).toBe(0);
  });

  it('puts every unit back on the origin the settle took it off', async () => {
    const harness = build({
      quantity: 3,
      settledQuantity: 3,
      settlements: [
        { id: 's-1', lineId: 'zl-1', listId: LIST_A, quantity: 2 },
        { id: 's-2', lineId: 'zl-2', listId: LIST_B, quantity: 1 },
      ],
    });

    await reopen(harness);

    // Three, as each stood before this call, plus what this basket had taken.
    expect(harness.zoneLines.get('zl-1')?.quantity).toBe(5);
    expect(harness.zoneLines.get('zl-2')?.quantity).toBe(4);
  });

  it('adds to whatever the origin says now rather than restoring a remembered number', async () => {
    // Somebody edited the line, or another basket settled against it, between
    // the settle and this call (section 3.4). The units this basket took off are
    // the units it puts back, and everything else that happened stands.
    const harness = build({ quantity: 2, settledQuantity: 2 });
    const line = harness.zoneLines.get('zl-1');
    if (line) {
      harness.zoneLines.set('zl-1', { ...line, quantity: 9 });
    }

    await reopen(harness);

    expect(harness.zoneLines.get('zl-1')?.quantity).toBe(11);
  });

  it('bumps the origin version, so a client holding the old one reconciles', async () => {
    const harness = build({});

    await reopen(harness);

    expect(harness.zoneLines.get('zl-1')?.version).toBe(2);
  });
});

describe('one origin settled twice is one origin (section 3.1)', () => {
  // A line part settled and then finished has two standing settlements on the
  // same zone line, so the reverts are grouped by the origin they landed on
  // rather than walked one at a time.
  const twice = {
    quantity: 3,
    settledQuantity: 3,
    settlements: [
      { id: 's-1', lineId: 'zl-1', listId: LIST_A, quantity: 1 },
      { id: 's-2', lineId: 'zl-1', listId: LIST_A, quantity: 2 },
    ],
  };

  it('puts back the sum of both, in one write', async () => {
    const harness = build(twice);

    await reopen(harness);

    expect(harness.zoneLines.get('zl-1')?.quantity).toBe(6);
    // One version bump and not two: the line moved once.
    expect(harness.zoneLines.get('zl-1')?.version).toBe(2);
  });

  it('marks both rows', async () => {
    const harness = build(twice);

    await reopen(harness);

    expect(
      harness.settlements.every((row) => row.revertedAt instanceof Date)
    ).toBe(true);
  });

  it('tells the household once, about the line as this call leaves it', async () => {
    const harness = build(twice);

    await reopen(harness);

    const settled = harness.events.filter(
      (entry) => entry.event === RealtimeEvent.LineSettled
    );
    expect(settled).toHaveLength(1);
    expect((settled[0].payload as LineSettlementResult).line.quantity).toBe(6);
  });

  it('counts a deleted origin once however many settles it swallowed', async () => {
    const harness = build({ ...twice, missingZoneLines: ['zl-1'] });

    const result = await reopen(harness);

    // A skip is an origin this call could not put units on, and there is one
    // origin here.
    expect(result.skippedCount).toBe(1);
  });
});

describe('the history is marked and never deleted (section 3.3)', () => {
  it('keeps the settlement row and stamps who took it back', async () => {
    const harness = build({});

    await reopen(harness);

    expect(harness.settlements).toHaveLength(1);
    expect(harness.settlements[0].revertedAt).toBeInstanceOf(Date);
    expect(harness.settlements[0].revertedByParticipantId).toBe(ACTOR);
    // The purchase itself is untouched: what was bought stays what was bought.
    expect(harness.settlements[0].quantity).toBe(2);
  });

  it('writes no compensating row', async () => {
    // The rejected alternative (section 3.3). A negative quantity would keep the
    // ledger append only at the cost of making every existing sum wrong.
    const harness = build({});

    await reopen(harness);

    expect(harness.settlements.map((row) => row.quantity)).toEqual([2]);
  });

  it('leaves a settlement somebody already took back alone', async () => {
    const reverted = new Date('2026-01-01T00:00:00.000Z');
    const harness = build({
      settlements: [
        {
          id: 's-1',
          lineId: 'zl-1',
          listId: LIST_A,
          quantity: 2,
          revertedAt: reverted,
        },
      ],
      settledQuantity: 2,
    });

    await reopen(harness);

    // Neither re-stamped nor put back a second time: it was not standing, so it
    // is not this call's to undo.
    expect(harness.settlements[0].revertedAt).toBe(reverted);
    expect(harness.zoneLines.get('zl-1')?.quantity).toBe(3);
  });

  it('touches no settlement belonging to another basket line', async () => {
    const harness = build({
      settlements: [
        { id: 's-1', lineId: 'zl-1', listId: LIST_A, quantity: 2 },
        {
          id: 's-2',
          lineId: 'zl-1',
          listId: LIST_A,
          quantity: 1,
          generatedListLineId: 'gll-other',
        },
      ],
      settledQuantity: 2,
    });

    await reopen(harness);

    expect(harness.settlements[1].revertedAt).toBeNull();
    // Two units back and not three: the other basket's purchase stands.
    expect(harness.zoneLines.get('zl-1')?.quantity).toBe(5);
  });
});

describe('the three cases that are not errors (section 3.4)', () => {
  it('reports an origin whose line was deleted rather than failing', async () => {
    const harness = build({
      settlements: [
        { id: 's-1', lineId: 'zl-1', listId: LIST_A, quantity: 2 },
        { id: 's-2', lineId: 'zl-2', listId: LIST_B, quantity: 1 },
      ],
      quantity: 3,
      settledQuantity: 3,
      missingZoneLines: ['zl-2'],
    });

    const result = await reopen(harness);

    expect(result.skippedCount).toBe(1);
    // The line that is still there took its units back all the same.
    expect(harness.zoneLines.get('zl-1')?.quantity).toBe(5);
    // And the settlement with nowhere to go is marked anyway, so it stops
    // counting towards what the household has bought.
    expect(harness.settlements[1].revertedAt).toBeInstanceOf(Date);
  });

  it('marks a NOT_AVAILABLE settlement, which puts no units back', async () => {
    const harness = build({
      settlements: [
        {
          id: 's-1',
          lineId: 'zl-1',
          listId: LIST_A,
          quantity: 0,
          outcome: SettlementOutcome.NOT_AVAILABLE,
        },
      ],
    });

    const result = await reopen(harness);

    expect(harness.zoneLines.get('zl-1')?.quantity).toBe(3);
    expect(harness.zoneLines.get('zl-1')?.version).toBe(1);
    expect(harness.settlements[0].revertedAt).toBeInstanceOf(Date);
    expect(result.skippedCount).toBe(0);
  });

  it('stops the indicator saying the shop had none', async () => {
    // The reason a NOT_AVAILABLE is marked at all, even though it moved nothing
    // (section 3.4): plan 0047 section 5 derives an indicator from it, and the
    // zone event is what carries the recomputed one.
    const harness = build({
      settlements: [
        {
          id: 's-1',
          lineId: 'zl-1',
          listId: LIST_A,
          quantity: 0,
          outcome: SettlementOutcome.NOT_AVAILABLE,
        },
      ],
    });

    await reopen(harness);

    const settled = harness.events.find(
      (entry) => entry.event === RealtimeEvent.LineSettled
    );
    const payload = settled?.payload as LineSettlementResult;
    expect(payload.line.lastSettlementOutcome).toBeNull();
    expect(payload.line.boughtCount).toBe(0);
  });
});

describe('what a reopen announces (section 3.6)', () => {
  it('tells each touched zone list, on the event the household already handles', async () => {
    const harness = build({
      settlements: [
        { id: 's-1', lineId: 'zl-1', listId: LIST_A, quantity: 2 },
        { id: 's-2', lineId: 'zl-2', listId: LIST_B, quantity: 1 },
      ],
      quantity: 3,
      settledQuantity: 3,
    });

    await reopen(harness);

    const settled = harness.events.filter(
      (entry) => entry.event === RealtimeEvent.LineSettled
    );
    expect(settled.map((entry) => entry.listId)).toEqual([LIST_A, LIST_B]);
    // The restored line, so a phone looking at the household's list agrees
    // without a refetch.
    const payload = settled[0].payload as LineSettlementResult;
    expect(payload.line.quantity).toBe(5);
    expect(payload.settlement.revertedAt).not.toBeNull();
  });

  it('recomputes the bought count without the row it just took back', async () => {
    const harness = build({});

    await reopen(harness);

    const payload = harness.events.find(
      (entry) => entry.event === RealtimeEvent.LineSettled
    )?.payload as LineSettlementResult;
    // Bought once and reopened is back to never bought, which is exactly the
    // caption the household should see.
    expect(payload.line.boughtCount).toBe(0);
    expect(payload.line.lastSettlementOutcome).toBeNull();
  });

  it('tells the basket room and the owner, as a settle does', async () => {
    const harness = build({});

    await reopen(harness);

    const room = harness.events.find(
      (entry) => entry.generatedListId === BASKET
    );
    expect(room?.event).toBe(RealtimeEvent.GeneratedListLineSettled);
    // The owner is usually not in the room: they are at home while somebody
    // else shops, and the dashboard card counts settled lines.
    const owner = harness.events.find((entry) => entry.userIds !== undefined);
    expect(owner?.userIds).toEqual([OWNER]);
  });

  it('takes the claim back for a line that was finished', async () => {
    // A basket line settled all the way through released its origins (plan 0052,
    // section 3.3), so one that is outstanding again claims them.
    const harness = build({ quantity: 2, settledQuantity: 2 });

    await reopen(harness);

    expect(harness.claims.calls).toEqual([
      { claimed: true, claimedByUserId: OWNER, lineIds: ['zl-1'] },
    ]);
  });

  it('says nothing about the claim for a line that was only part settled', async () => {
    // It never released them, so there is nothing to take back, and an event
    // saying nothing changed is worse than no event.
    const harness = build({ quantity: 3, settledQuantity: 2 });

    await reopen(harness);

    expect(harness.claims.calls).toEqual([]);
  });
});

describe('who may, and what they are told (sections 3.2 and 3.5)', () => {
  it('refuses a line with nothing settled on it, as a conflict', async () => {
    const harness = build({ quantity: 2, settledQuantity: 0 });

    await expect(reopen(harness)).rejects.toBeInstanceOf(ConflictException);
  });

  it('answers a guest with the line and a count and no names', async () => {
    const harness = build({ actorSeesZoneData: false });

    const result = await reopen(harness);

    // The whole response, which is what lets the act sit outside the all or
    // nothing rule: there is nothing here to redact.
    expect(Object.keys(result).sort()).toEqual(['line', 'skippedCount']);
    expect(result.line).not.toHaveProperty('targetListId');
  });

  it('lets a guest reopen at all', async () => {
    // Section 3.5: the same authorization the settle has and no more. Refusing
    // it to the person who just made the mistake would leave the mistake
    // standing.
    const harness = build({ actorSeesZoneData: false });

    await reopen(harness);

    expect(harness.basketLine.settledQuantity).toBe(0);
    expect(harness.zoneLines.get('zl-1')?.quantity).toBe(5);
  });
});
