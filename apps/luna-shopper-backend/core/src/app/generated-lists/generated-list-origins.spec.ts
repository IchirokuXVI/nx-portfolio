import {
  LineApprovalStatus,
  OriginUnavailableReason,
  ParticipantKind,
  RealtimeEvent,
  SettlementOutcome,
} from '@portfolio/luna-shopper/contracts';
import { DomainException } from '@portfolio/luna-shopper/platform';
import type { DataSource } from 'typeorm';
import {
  GeneratedListLine,
  GeneratedListLineOrigin,
  LineSettlement,
  ListLine,
  ListLineItem,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { GeneratedListOriginsService } from './generated-list-origins.service';
import type { GeneratedListSharingService } from './generated-list-sharing.service';
import type { GeneratedListService } from './generated-list.service';
import {
  ACTIVE_OVERLAP_SQL,
  SHEET_CANDIDATE_LINES_SQL,
  WRITABLE_LISTS_SQL,
} from './generated-list.sql';
import { fakeLineClaims, type FakeLineClaims } from './line-claims.fake';

/**
 * Editing an origin, and adopting a new one (plan 0057).
 *
 * The property this file exists to pin is section 1, and it is asserted on every
 * write case rather than once: **lowering what a list asked for is not buying
 * it.** No `LineSettlement` is written, `settledQuantity` never moves, and the
 * event is `line.updated` and never `line.settled`. It is the thing most likely
 * to be got wrong by somebody implementing beside the settle service, and the
 * only way it can break is quietly.
 *
 * Faked at the repository boundary in the style `generated-list-settle.spec.ts`
 * established, with the three raw queries routed by the constant they were given
 * so a test states which read it is answering rather than matching on SQL text.
 */

const OWNER = 'u-owner';
const CO_SHOPPER = 'u-marc';
const OWNER_PARTICIPANT = 'p-owner';
const BASKET = 'gl-1';
const BASKET_LINE = 'gll-1';

const LIST_A = 'l-flat';
const ZONE_A = 'z-flat';
const LINE_A = 'zl-flat';

const LIST_B = 'l-parents';
const ZONE_B = 'z-parents';
const LINE_B = 'zl-parents';

const LIST_C = 'l-office';
const ZONE_C = 'z-office';
const LINE_C = 'zl-office';

/** The product set two households typing different words still merge on. */
const MILK = 'h-milk';

interface ZoneLineSeed {
  id: string;
  listId: string;
  quantity: number;
  content?: string;
  itemSetHash?: string | null;
  approvalStatus?: LineApprovalStatus;
}

interface OriginSeed {
  id: string;
  lineId: string;
  listId: string;
  zoneId: string;
  quantity: number;
}

interface SettlementSeed {
  lineId: string;
  quantity: number;
  outcome?: SettlementOutcome;
}

interface Harness {
  service: GeneratedListOriginsService;
  basketLine: Partial<GeneratedListLine>;
  zoneLines: Map<string, ZoneLineSeed & { version: number }>;
  origins: OriginSeed[];
  settlements: SettlementSeed[];
  claims: FakeLineClaims;
  events: { event: RealtimeEvent; listId?: string; payload?: unknown }[];
}

function build(
  options: {
    quantity?: number;
    settledQuantity?: number;
    origins?: OriginSeed[];
    zoneLines?: ZoneLineSeed[];
    settlements?: SettlementSeed[];
    /** Which lists each user may write, at request time (section 4.1). */
    writable?: Record<string, string[]>;
    /** Lines an ACTIVE basket of the owner's is already carrying (plan 0050, section 3). */
    carried?: string[];
    actorUserId?: string;
    actorKind?: ParticipantKind;
    seesZoneData?: boolean;
  } = {}
): Harness {
  const seeds: ZoneLineSeed[] = options.zoneLines ?? [
    { id: LINE_A, listId: LIST_A, quantity: 5, itemSetHash: MILK },
    { id: LINE_B, listId: LIST_B, quantity: 1, itemSetHash: MILK },
    { id: LINE_C, listId: LIST_C, quantity: 3, itemSetHash: 'h-bread' },
  ];
  const zoneLines = new Map(
    seeds.map((seed) => [
      seed.id,
      {
        ...seed,
        content: seed.content ?? 'milk',
        itemSetHash: seed.itemSetHash ?? null,
        approvalStatus: seed.approvalStatus ?? LineApprovalStatus.APPROVED,
        version: 1,
        position: 0,
        createdByUserId: OWNER,
        approvedByUserId: OWNER,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])
  );

  const origins: OriginSeed[] = options.origins ?? [
    { id: 'o-1', lineId: LINE_A, listId: LIST_A, zoneId: ZONE_A, quantity: 2 },
  ];
  const settlements: SettlementSeed[] = options.settlements ?? [];

  const basketLine: Partial<GeneratedListLine> = {
    id: BASKET_LINE,
    generatedListId: BASKET,
    content: 'milk',
    quantity: options.quantity ?? 2,
    settledQuantity: options.settledQuantity ?? 0,
    itemId: null,
  };

  const writable = options.writable ?? {
    [OWNER]: [LIST_A, LIST_B, LIST_C],
    [CO_SHOPPER]: [LIST_A, LIST_B, LIST_C],
  };
  const zoneOfList: Record<string, string> = {
    [LIST_A]: ZONE_A,
    [LIST_B]: ZONE_B,
    [LIST_C]: ZONE_C,
  };
  const carried = new Set(options.carried ?? []);
  const events: Harness['events'] = [];

  /**
   * The three raw reads, routed by the constant rather than by matching SQL
   * text, so a case says which question it is answering.
   */
  const query = async (
    sql: string,
    parameters: unknown[]
  ): Promise<unknown> => {
    if (sql === WRITABLE_LISTS_SQL) {
      const userId = parameters[0] as string;
      return (writable[userId] ?? []).map((listId) => ({
        listId,
        zoneId: zoneOfList[listId],
      }));
    }
    if (sql === SHEET_CANDIDATE_LINES_SQL) {
      const listIds = parameters[0] as string[];
      return [...zoneLines.values()]
        .filter((row) => listIds.includes(row.listId))
        .map((row) => ({
          id: row.id,
          listId: row.listId,
          content: row.content,
          quantity: row.quantity,
          version: row.version,
          itemSetHash: row.itemSetHash,
          approvalStatus: row.approvalStatus,
        }));
    }
    if (sql === ACTIVE_OVERLAP_SQL) {
      const lineIds = parameters[1] as string[];
      return lineIds
        .filter((lineId) => carried.has(lineId))
        .map((lineId) => ({ lineId, generatedListId: 'gl-other' }));
    }
    throw new Error('unmocked raw query');
  };

  // One object answering both shapes the service asks of `line_settlements`: the
  // per origin sum outside the transaction, and the two indicators inside it.
  const settlementRepo = {
    find: async ({
      where,
    }: {
      where: { generatedListLineId: string; outcome?: SettlementOutcome };
    }) =>
      settlements
        .filter(
          (row) =>
            (row.outcome ?? SettlementOutcome.BOUGHT) ===
            (where.outcome ?? SettlementOutcome.BOUGHT)
        )
        .map((row) => ({
          ...row,
          generatedListLineId: where.generatedListLineId,
        })),
    count: async ({
      where,
    }: {
      where: { lineId: string; outcome?: SettlementOutcome };
    }) =>
      settlements.filter(
        (row) =>
          row.lineId === where.lineId &&
          (where.outcome === undefined ||
            (row.outcome ?? SettlementOutcome.BOUGHT) === where.outcome)
      ).length,
    findOne: async ({ where }: { where: { lineId: string } }) => {
      const found = settlements.filter((row) => row.lineId === where.lineId);
      return found.length > 0 ? found[found.length - 1] : null;
    },
    // Present so a settle written from here would be visible, and asserted on:
    // nothing in this plan may ever call it.
    save: async () => {
      throw new Error('plan 0057 must never write a settlement');
    },
  };

  const originRepo = {
    find: async () => [...origins],
    findOne: async ({
      where,
    }: {
      where: { generatedListLineId: string; lineId: string };
    }) => origins.find((row) => row.lineId === where.lineId) ?? null,
    create: (row: OriginSeed) => ({ ...row, id: `o-${origins.length + 1}` }),
    save: async (row: OriginSeed) => {
      const index = origins.findIndex((existing) => existing.id === row.id);
      if (index >= 0) {
        origins[index] = { ...origins[index], ...row };
        return origins[index];
      }
      origins.push(row);
      return row;
    },
    delete: async ({ id }: { id: string }) => {
      const index = origins.findIndex((row) => row.id === id);
      if (index >= 0) {
        origins.splice(index, 1);
      }
    },
  };

  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === ListLine) {
        return {
          findOne: async ({ where }: { where: { id: string } }) =>
            zoneLines.get(where.id) ?? null,
          save: async (row: { id: string }) => {
            zoneLines.set(row.id, {
              ...(zoneLines.get(row.id) as never),
              ...row,
            });
            return row;
          },
        };
      }
      if (entity === GeneratedListLineOrigin) {
        return originRepo;
      }
      if (entity === GeneratedListLine) {
        return {
          save: async (row: Partial<GeneratedListLine>) => {
            Object.assign(basketLine, row);
            return row;
          },
        };
      }
      if (entity === ListLineItem) {
        return { find: async () => [] };
      }
      if (entity === LineSettlement) {
        return settlementRepo;
      }
      throw new Error('unmocked repository in the origins transaction');
    },
  };

  const dataSource = {
    transaction: async (fn: (m: typeof manager) => Promise<unknown>) =>
      fn(manager),
  } as unknown as DataSource;

  const sees = options.seesZoneData ?? true;
  const actorUserId = options.actorUserId ?? OWNER;
  const sharing = {
    liveParticipantById: async () => ({
      id: OWNER_PARTICIPANT,
      kind: options.actorKind ?? ParticipantKind.OWNER,
      userId: sees ? actorUserId : null,
    }),
    seesZoneData: async () => sees,
    writableAmong: async (userId: string, listIds: readonly string[]) =>
      new Set(
        listIds.filter((listId) => (writable[userId] ?? []).includes(listId))
      ),
  } as unknown as GeneratedListSharingService;

  const generated = {
    basketLineViewFor: async (
      _line: unknown,
      seesZoneData: boolean
    ): Promise<unknown> => ({
      id: BASKET_LINE,
      quantity: basketLine.quantity,
      settledQuantity: basketLine.settledQuantity,
      ...(seesZoneData ? { targetListId: null } : {}),
    }),
  } as unknown as GeneratedListService;

  const claims = fakeLineClaims();

  const service = new GeneratedListOriginsService(
    dataSource,
    {
      findOne: async () => ({ id: BASKET, ownerUserId: OWNER }),
      query,
    } as never,
    { findOne: async () => basketLine } as never,
    originRepo as never,
    {
      findOne: async ({ where }: { where: { id: string } }) =>
        zoneLines.get(where.id) ?? null,
      find: async ({ where }: { where: { id: { _value: string[] } } }) =>
        [...zoneLines.values()].filter((row) =>
          where.id._value.includes(row.id)
        ),
    } as never,
    settlementRepo as never,
    {
      findOne: async ({ where }: { where: { id: string } }) =>
        zoneOfList[where.id]
          ? { id: where.id, zoneId: zoneOfList[where.id], name: where.id }
          : null,
      find: async ({ where }: { where: { id: { _value: string[] } } }) =>
        Object.keys(zoneOfList)
          .filter((id) => where.id._value.includes(id))
          .map((id) => ({ id, name: `${id} list`, zone: { name: id } })),
    } as never,
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
      emitToGeneratedList: (event: RealtimeEvent) => events.push({ event }),
      emitToUsers: (event: RealtimeEvent) => events.push({ event }),
    } as unknown as CoreEventsPublisher
  );

  return {
    service,
    basketLine,
    zoneLines: zoneLines as Harness['zoneLines'],
    origins,
    settlements,
    claims,
    events,
  };
}

function read(harness: Harness) {
  return harness.service.lineOrigins({
    generatedListId: BASKET,
    lineId: BASKET_LINE,
    participantId: OWNER_PARTICIPANT,
  });
}

function set(
  harness: Harness,
  body: { listId: string; lineId: string; quantity: number; from: number }
) {
  return harness.service.setOriginQuantity({
    generatedListId: BASKET,
    lineId: BASKET_LINE,
    participantId: OWNER_PARTICIPANT,
    sourceListId: body.listId,
    sourceLineId: body.lineId,
    quantity: body.quantity,
    from: body.from,
  });
}

/** The code a refusal carried, which is what the client branches on. */
async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as DomainException).code;
  }
  throw new Error('expected a refusal');
}

describe('reading what a basket line is made of (section 3)', () => {
  it('says what each list contributed, what it asks for now, and what was settled', async () => {
    const harness = build({
      settlements: [{ lineId: LINE_A, quantity: 1 }],
    });

    const result = await read(harness);

    expect(result.origins).toHaveLength(1);
    const [origin] = result.origins;
    // Three numbers that are not each other. The contribution is the provenance
    // row; the list quantity is what the household wants now and has moved since
    // the run; the settled amount is this basket's own floor.
    expect(origin.contributed).toBe(2);
    expect(origin.listQuantity).toBe(5);
    expect(origin.settledHere).toBe(1);
    expect(origin.writable).toBe(true);
    expect(origin.listName).toBe(`${LIST_A} list`);
    expect(origin.zoneName).toBe(LIST_A);
  });

  it('draws a row it cannot move when the owner lost write access to the list', async () => {
    // The **owner's** standing, not the reader's, because that is what
    // authorizes every settle (plan 0051, section 6.4).
    const harness = build({
      writable: { [OWNER]: [LIST_B], [CO_SHOPPER]: [LIST_A, LIST_B] },
    });

    const [origin] = (await read(harness)).origins;

    expect(origin.writable).toBe(false);
  });

  it('offers every list in scope holding a line the run would have merged, and nothing else', async () => {
    const result = await read(build());

    // The parents' milk merges on the product set; the office bread does not
    // meet the key at all, and the flat's own line is already an origin.
    expect(result.candidates.map((row) => row.lineId)).toEqual([LINE_B]);
    expect(result.candidates[0]).toMatchObject({
      listId: LIST_B,
      zoneId: ZONE_B,
      listQuantity: 1,
      matchedOnText: false,
    });
    expect(result.candidates[0].unavailable).toBeUndefined();
  });

  it('flags a text only match rather than hiding it or offering it silently', async () => {
    // The run merges on normalized text as its last resort and is deliberately
    // conservative about it, so the sheet offers the match and says how it was
    // made (section 8).
    const harness = build({
      zoneLines: [
        { id: LINE_A, listId: LIST_A, quantity: 5, content: 'Café' },
        { id: LINE_B, listId: LIST_B, quantity: 1, content: 'cafe' },
      ],
    });

    const [candidate] = (await read(harness)).candidates;

    expect(candidate.lineId).toBe(LINE_B);
    expect(candidate.matchedOnText).toBe(true);
  });

  it('shows a candidate another active basket carries, marked, rather than hiding it', async () => {
    // The one place this codebase deliberately serves something the caller
    // cannot act on: "somebody else is already buying it" is worth knowing while
    // standing in a dairy aisle.
    const result = await read(build({ carried: [LINE_B] }));

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].unavailable).toBe(
      OriginUnavailableReason.CLAIMED
    );
  });

  it('marks a line the run would not have taken rather than dropping it', async () => {
    const pending = build({
      zoneLines: [
        { id: LINE_A, listId: LIST_A, quantity: 5, itemSetHash: MILK },
        {
          id: LINE_B,
          listId: LIST_B,
          quantity: 1,
          itemSetHash: MILK,
          approvalStatus: LineApprovalStatus.PENDING,
        },
      ],
    });
    const spent = build({
      zoneLines: [
        { id: LINE_A, listId: LIST_A, quantity: 5, itemSetHash: MILK },
        { id: LINE_B, listId: LIST_B, quantity: 0, itemSetHash: MILK },
      ],
    });

    expect((await read(pending)).candidates[0].unavailable).toBe(
      OriginUnavailableReason.NOT_APPROVED
    );
    expect((await read(spent)).candidates[0].unavailable).toBe(
      OriginUnavailableReason.SETTLED
    );
  });

  it('narrows the scope to the lists the owner and the actor can both write', async () => {
    // Section 4.1. A co-shopper adopting from a zone the owner is not in would
    // leave the basket carrying an origin every settle skips and reports.
    const harness = build({
      actorUserId: CO_SHOPPER,
      actorKind: ParticipantKind.REGISTERED,
      writable: { [OWNER]: [LIST_A], [CO_SHOPPER]: [LIST_A, LIST_B] },
    });

    expect((await read(harness)).candidates).toEqual([]);
  });
});

describe('who may read it (plan 0051, section 5.2)', () => {
  it('refuses a participant who does not hold write access on every source list', async () => {
    // A guest fails it having no account at all, and so does a registered
    // participant holding only READ on one source list: the rule is all or
    // nothing, and there is nothing left of this read after the redaction.
    const harness = build({ seesZoneData: false });

    expect(await codeOf(read(harness))).toBe('forbidden');
    expect(
      await codeOf(
        set(harness, { listId: LIST_A, lineId: LINE_A, quantity: 3, from: 2 })
      )
    ).toBe('forbidden');
  });
});

describe('raising and lowering a contribution (section 5)', () => {
  it('raises the household’s own line and the basket line by the same number', async () => {
    const harness = build();

    const result = await set(harness, {
      listId: LIST_A,
      lineId: LINE_A,
      quantity: 4,
      from: 2,
    });

    expect(harness.zoneLines.get(LINE_A)?.quantity).toBe(7);
    expect(harness.basketLine.quantity).toBe(4);
    expect(harness.origins[0].quantity).toBe(4);
    expect(result.listQuantity).toBe(7);
    expect(result.origin?.contributed).toBe(4);
  });

  it('writes no settlement, moves no bought indicator, and never says line.settled', async () => {
    // Section 1, and the reason this file exists. The same gesture one screen up
    // means "bought"; this one does not.
    const harness = build();

    await set(harness, {
      listId: LIST_A,
      lineId: LINE_A,
      quantity: 1,
      from: 2,
    });

    expect(harness.settlements).toEqual([]);
    expect(harness.basketLine.settledQuantity).toBe(0);
    expect(harness.events.map((entry) => entry.event)).toEqual([
      RealtimeEvent.LineUpdated,
      RealtimeEvent.GeneratedListLineUpdated,
    ]);
  });

  it('answers with neither settlement refs nor a skip report (section 6)', async () => {
    const result = await set(build(), {
      listId: LIST_A,
      lineId: LINE_A,
      quantity: 3,
      from: 2,
    });

    // A client that drew "got it" from this response would be drawing something
    // the server never said, so there is nowhere for it to draw it from.
    expect(Object.keys(result).sort()).toEqual([
      'line',
      'listQuantity',
      'origin',
    ]);
  });

  it('lowers the zone line to zero rather than deleting it', async () => {
    // Plan 0047's "known about, not currently wanted", floored rather than
    // removed.
    const harness = build({
      quantity: 6,
      origins: [
        {
          id: 'o-1',
          lineId: LINE_A,
          listId: LIST_A,
          zoneId: ZONE_A,
          quantity: 6,
        },
      ],
    });

    await set(harness, {
      listId: LIST_A,
      lineId: LINE_A,
      quantity: 1,
      from: 6,
    });

    expect(harness.zoneLines.get(LINE_A)?.quantity).toBe(0);
    expect(harness.zoneLines.has(LINE_A)).toBe(true);
  });

  it('keeps what a shopper added above the sum of the origins', async () => {
    // Plan 0056 lets a basket line be raised above what the households asked
    // for, and the delta preserves it where a recompute from `sum(origins)`
    // would silently throw it away (section 5.1).
    const harness = build({ quantity: 9 });

    await set(harness, {
      listId: LIST_A,
      lineId: LINE_A,
      quantity: 3,
      from: 2,
    });

    expect(harness.origins[0].quantity).toBe(3);
    // 9 was 2 asked for plus 7 the shopper added; one more asked for is 10.
    expect(harness.basketLine.quantity).toBe(10);
  });
});

describe('the floor and the stale read (sections 5 and 5.2)', () => {
  it('refuses a contribution below what this basket has already bought, and names it', async () => {
    const harness = build({
      settlements: [{ lineId: LINE_A, quantity: 2 }],
    });

    let thrown: DomainException | undefined;
    try {
      await set(harness, {
        listId: LIST_A,
        lineId: LINE_A,
        quantity: 1,
        from: 2,
      });
    } catch (error) {
      thrown = error as DomainException;
    }

    expect(thrown?.code).toBe('below_settled');
    // The number, so the client can say it rather than only that it failed.
    expect(thrown?.messageArgs).toEqual({ floor: 2 });
    expect(harness.zoneLines.get(LINE_A)?.quantity).toBe(5);
  });

  it('refuses a stale `from` and writes nothing', async () => {
    const harness = build();

    let thrown: DomainException | undefined;
    try {
      await set(harness, {
        listId: LIST_A,
        lineId: LINE_A,
        quantity: 4,
        from: 3,
      });
    } catch (error) {
      thrown = error as DomainException;
    }

    expect(thrown?.code).toBe('stale_quantity');
    expect(thrown?.messageArgs).toEqual({ current: 2 });
    expect(harness.zoneLines.get(LINE_A)?.quantity).toBe(5);
    expect(harness.basketLine.quantity).toBe(2);
    expect(harness.origins[0].quantity).toBe(2);
    expect(harness.events).toEqual([]);
  });

  it('writes nothing and does not fail when the number did not move', async () => {
    const harness = build();

    const result = await set(harness, {
      listId: LIST_A,
      lineId: LINE_A,
      quantity: 2,
      from: 2,
    });

    expect(result.origin?.contributed).toBe(2);
    expect(harness.zoneLines.get(LINE_A)?.version).toBe(1);
    expect(harness.events).toEqual([]);
  });
});

describe('zero takes the list off the line (section 5.3)', () => {
  it('drops the origin, lowers the zone line and releases the claim', async () => {
    const harness = build();

    const result = await set(harness, {
      listId: LIST_A,
      lineId: LINE_A,
      quantity: 0,
      from: 2,
    });

    expect(harness.origins).toEqual([]);
    expect(result.origin).toBeNull();
    expect(harness.zoneLines.get(LINE_A)?.quantity).toBe(3);
    expect(harness.basketLine.quantity).toBe(0);
    expect(harness.claims.announced).toEqual([
      {
        zoneId: ZONE_A,
        listId: LIST_A,
        lineId: LINE_A,
        claimed: false,
        claimedByUserId: null,
      },
    ]);
    // Still not a purchase, even though the line is now at zero on both sides.
    expect(harness.settlements).toEqual([]);
  });
});

describe('adopting a list that was not in the run (section 5)', () => {
  it('adds an origin, raises its zone line, claims it and raises the basket line', async () => {
    const harness = build();

    const result = await set(harness, {
      listId: LIST_B,
      lineId: LINE_B,
      quantity: 1,
      from: 0,
    });

    expect(harness.origins).toHaveLength(2);
    expect(harness.origins[1]).toMatchObject({
      listId: LIST_B,
      lineId: LINE_B,
      zoneId: ZONE_B,
      quantity: 1,
    });
    expect(harness.zoneLines.get(LINE_B)?.quantity).toBe(2);
    expect(harness.basketLine.quantity).toBe(3);
    expect(result.origin?.contributed).toBe(1);
    // The other household's list now says somebody is out buying it, named as
    // the basket's owner rather than as the actor (plan 0051, section 5.3).
    expect(harness.claims.announced).toEqual([
      {
        zoneId: ZONE_B,
        listId: LIST_B,
        lineId: LINE_B,
        claimed: true,
        claimedByUserId: OWNER,
      },
    ]);
    expect(harness.settlements).toEqual([]);
  });

  it('refuses a line another active basket already carries', async () => {
    // The sheet marks it and the write refuses it: a projection is not the
    // authority, and a client holding a stale sheet meets the same rule.
    const harness = build({ carried: [LINE_B] });

    expect(
      await codeOf(
        set(harness, { listId: LIST_B, lineId: LINE_B, quantity: 1, from: 0 })
      )
    ).toBe('validation_failed');
    expect(harness.origins).toHaveLength(1);
  });

  it('refuses a line the run’s own rule would not have merged', async () => {
    const harness = build();

    expect(
      await codeOf(
        set(harness, { listId: LIST_C, lineId: LINE_C, quantity: 1, from: 0 })
      )
    ).toBe('validation_failed');
    expect(harness.origins).toHaveLength(1);
  });

  it('refuses a list the owner may no longer write', async () => {
    const harness = build({
      writable: { [OWNER]: [LIST_A], [CO_SHOPPER]: [LIST_A, LIST_B] },
    });

    expect(
      await codeOf(
        set(harness, { listId: LIST_B, lineId: LINE_B, quantity: 1, from: 0 })
      )
    ).toBe('forbidden');
  });

  it('refuses a list the actor may not write, even when the owner may', async () => {
    // Section 4.2: the actor necessarily has access of their own here, and it is
    // checked as well as the owner's rather than instead of it.
    const harness = build({
      actorUserId: CO_SHOPPER,
      actorKind: ParticipantKind.REGISTERED,
      writable: { [OWNER]: [LIST_A, LIST_B], [CO_SHOPPER]: [LIST_A] },
    });

    expect(
      await codeOf(
        set(harness, { listId: LIST_B, lineId: LINE_B, quantity: 1, from: 0 })
      )
    ).toBe('forbidden');
  });
});
