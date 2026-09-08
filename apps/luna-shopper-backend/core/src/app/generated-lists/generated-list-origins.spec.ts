import {
  GeneratedListStatus,
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
import type { GeneratedListLineService } from './generated-list-line.service';
import { GeneratedListOriginsService } from './generated-list-origins.service';
import type { GeneratedListSharingService } from './generated-list-sharing.service';
import type { GeneratedListService } from './generated-list.service';
import {
  LIVE_OVERLAP_SQL,
  SHEET_CANDIDATE_LINES_SQL,
  WRITABLE_LISTS_SQL,
} from './generated-list.sql';
import { fakeLineClaims, type FakeLineClaims } from './line-claims.fake';
import { WaitingSettlementService } from './waiting-settlement.service';

/**
 * Editing an origin, adopting one, and creating one (plan 0057, widened by plan
 * 0092).
 *
 * The property this file exists to pin is section 1, and it is asserted on every
 * write case rather than once: **lowering what a list asked for is not buying
 * it.** No `LineSettlement` is written, `settledQuantity` never moves, and the
 * event is `line.updated` and never `line.settled`. It is the thing most likely
 * to be got wrong by somebody implementing beside the settle service, and the
 * only way it can break is quietly.
 *
 * Plan 0092 added the second property worth stating up front: **there is one
 * write**, and which of the three things it does is decided by what exists
 * rather than by which route was called. It replaced plan 0058's bind service,
 * and `generated-list-bind.spec.ts` went with it.
 *
 * Faked at the repository boundary in the style `generated-list-settle.spec.ts`
 * established, with the three raw queries routed by the constant they were given
 * so a test states which read it is answering rather than matching on SQL text.
 */

const OWNER = 'u-owner';
const CO_SHOPPER = 'u-marc';
const OWNER_PARTICIPANT = 'p-owner';
const BASKET = 'gl-1';
/** Another live basket of the owner's, which is what a claim refuses. */
const OTHER_BASKET = 'gl-other';
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

/** Which zone each list belongs to, which every collection reports beside it. */
const ZONE_OF: Record<string, string> = {
  [LIST_A]: ZONE_A,
  [LIST_B]: ZONE_B,
  [LIST_C]: ZONE_C,
};

function zoneOf(listId: string): string {
  return ZONE_OF[listId];
}

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
  /**
   * The zone line it landed on, or null for a **waiting** purchase: one made
   * before this basket line reached any list (plan 0093, section 2).
   */
  lineId: string | null;
  quantity: number;
  outcome?: SettlementOutcome;
}

/** What a promotion was asked to do, so a creation can assert the call. */
interface PromotionCall {
  userId: string;
  listId: string;
  quantity: number;
}

interface Harness {
  service: GeneratedListOriginsService;
  basketLine: Partial<GeneratedListLine>;
  zoneLines: Map<string, ZoneLineSeed & { version: number }>;
  origins: OriginSeed[];
  settlements: SettlementSeed[];
  claims: FakeLineClaims;
  events: { event: RealtimeEvent; listId?: string; payload?: unknown }[];
  /** Every `promote` this write made, which is how a line reaches a new list. */
  promotions: PromotionCall[];
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
    /** Lines another live basket of the owner's is carrying (plan 0050, section 3). */
    carried?: string[];
    /** The same, naming the basket, so a seed can say "this one carries it". */
    carriedBy?: Record<string, string>;
    /**
     * The zone line a promotion into this list lands on, when the list already
     * holds the name (plan 0091, section 4). Absent means the add creates one.
     */
    promoteLandsOn?: Record<string, string>;
    /** The approval a created line starts with (plan 0058, section 4.3). */
    promoteApproval?: LineApprovalStatus;
    /** The run's own source lists, which every row reports as `fromRun`. */
    runLists?: string[];
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
  const zoneOfList = ZONE_OF;
  // Which live basket carries each line. The sugar names another basket, which
  // is the ordinary case; a seed may name this one, which must not refuse
  // anything (plan 0092, section 3.2).
  const carriedBy = new Map<string, string>([
    ...(options.carried ?? []).map(
      (lineId) => [lineId, OTHER_BASKET] as [string, string]
    ),
    ...Object.entries(options.carriedBy ?? {}),
  ]);
  const events: Harness['events'] = [];
  const promotions: PromotionCall[] = [];

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
    if (sql === LIVE_OVERLAP_SQL) {
      const lineIds = parameters[1] as string[];
      // The query excludes the asking basket on its fourth parameter (plan
      // 0092, section 3.2), and the fake honours it rather than ignoring it, so
      // a line this basket itself carries answers nothing.
      const excluded = parameters[3] as string | null;
      return lineIds
        .filter((lineId) => carriedBy.has(lineId))
        .map((lineId) => ({
          lineId,
          generatedListId: carriedBy.get(lineId) as string,
        }))
        .filter((row) => row.generatedListId !== excluded);
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
    // Both shapes the service asks for: by the zone line, which is the edit and
    // the adoption, and by the **list**, which is the creation's stale check
    // (plan 0092, section 4.2).
    findOne: async ({
      where,
    }: {
      where: { generatedListLineId: string; lineId?: string; listId?: string };
    }) =>
      origins.find(
        (row) =>
          (where.lineId === undefined || row.lineId === where.lineId) &&
          (where.listId === undefined || row.listId === where.listId)
      ) ?? null,
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
    // The candidate scope, shared with plan 0058's target picker so the two
    // pickers cannot disagree about which lists qualify. Faked here rather than
    // routed through WRITABLE_LISTS_SQL, because the raw query now belongs to
    // the sharing service and this file fakes that service whole.
    writableIntersection: async (ownerUserId: string, actorUserId: string) => {
      const owned = writable[ownerUserId] ?? [];
      const actors = new Set(writable[actorUserId] ?? []);
      return owned
        .filter((listId) => ownerUserId === actorUserId || actors.has(listId))
        .map((listId) => ({ listId, zoneId: zoneOfList[listId] }));
    },
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

  /**
   * The write back, faked at the same boundary the service uses it: it adds a
   * zone line through the ordinary add and writes the provenance row, and it
   * answers which line it landed on (plan 0091, section 4).
   *
   * Faked rather than real because `promote` reaches `LineService.add`, whose
   * own merge rule has its own spec. What this file owns is what the origins
   * write does with the answer.
   */
  const lineWrites = {
    promote: async (
      userId: string,
      _line: unknown,
      targetListId: string,
      promoteOptions: { quantity?: number } = {}
    ) => {
      const quantity = promoteOptions.quantity ?? 0;
      promotions.push({ userId, listId: targetListId, quantity });
      const landsOn = options.promoteLandsOn?.[targetListId];
      const createdId = landsOn ?? `zl-new-${targetListId}`;
      const existing = zoneLines.get(createdId);
      if (existing) {
        existing.quantity += quantity;
        existing.version += 1;
      } else {
        zoneLines.set(createdId, {
          id: createdId,
          listId: targetListId,
          quantity,
          content: basketLine.content as string,
          itemSetHash: MILK,
          approvalStatus: options.promoteApproval ?? LineApprovalStatus.PENDING,
          version: 1,
        } as never);
      }
      const already = origins.find((row) => row.lineId === createdId);
      if (!already) {
        origins.push({
          id: `o-${origins.length + 1}`,
          lineId: createdId,
          listId: targetListId,
          zoneId: zoneOfList[targetListId],
          quantity,
        });
      }
      return {
        line: {
          id: createdId,
          version: zoneLines.get(createdId)?.version ?? 1,
        },
        zoneId: zoneOfList[targetListId],
        quantity,
        merged: landsOn !== undefined,
        originCreated: already === undefined,
      };
    },
  } as unknown as GeneratedListLineService;

  const publisher = {
    emit: (
      event: RealtimeEvent,
      _zoneId: string,
      payload: unknown,
      listId?: string
    ) => events.push({ event, listId, payload }),
    emitToGeneratedList: (event: RealtimeEvent) => events.push({ event }),
    emitToUsers: (event: RealtimeEvent) => events.push({ event }),
  } as unknown as CoreEventsPublisher;

  const service = new GeneratedListOriginsService(
    dataSource,
    {
      findOne: async () => ({
        id: BASKET,
        ownerUserId: OWNER,
        status: GeneratedListStatus.ACTIVE,
        sourceSnapshot: {
          profileId: null,
          pricingProfileId: null,
          sources: (options.runLists ?? [LIST_A]).map((listId) => ({
            zoneId: zoneOfList[listId],
            listId,
          })),
        },
      }),
      query,
    } as never,
    {
      findOne: async () => basketLine,
      // Saved outside the transaction on the creation path, because `promote`
      // commits its own (plan 0092, section 4.2).
      save: async (row: Partial<GeneratedListLine>) => {
        Object.assign(basketLine, row);
        return row;
      },
    } as never,
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
    lineWrites,
    claims.service,
    // Plan 0092's seam, filled by plan 0093, and real rather than stubbed: no
    // line in this file has a waiting purchase, so it must answer nothing. It
    // shares the publisher, so a purchase it did announce would land in the same
    // list of events every other assertion here reads.
    new WaitingSettlementService(claims.service, publisher),
    publisher
  );

  return {
    service,
    basketLine,
    zoneLines: zoneLines as Harness['zoneLines'],
    origins,
    settlements,
    claims,
    events,
    promotions,
  };
}

function read(harness: Harness) {
  return harness.service.lineOrigins({
    generatedListId: BASKET,
    lineId: BASKET_LINE,
    participantId: OWNER_PARTICIPANT,
  });
}

/**
 * One write. `lineId` is omitted for a list that holds no matching line, which
 * is the creation case (plan 0092, section 4.2).
 */
function set(
  harness: Harness,
  body: { listId: string; lineId?: string; quantity: number; from: number }
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

  it('serves a candidate it cannot offer rather than hiding it', async () => {
    // The one place this codebase deliberately serves something the caller
    // cannot act on: "somebody else is already buying it" is worth knowing while
    // standing in a dairy aisle.
    const result = await read(build({ carried: [LINE_B] }));

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].unavailable).toBe(
      OriginUnavailableReason.CLAIMED
    );
  });

  it('offers a pending line and a line at zero, which plan 0057 refused', async () => {
    // Plan 0092 section 3.2. A pending origin is still claimed and still
    // settled, and a list at zero is a list that can be asked again: both
    // refusals were rules about composing a basket rather than about a person
    // deciding to buy something.
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

    expect((await read(pending)).candidates[0].unavailable).toBeUndefined();
    expect((await read(spent)).candidates[0].unavailable).toBeUndefined();
  });

  it('refuses a rejected line, which is a decision the household made', async () => {
    // Plan 0091 section 3.1: raising it would ask a list for something it has
    // already said no to, so it gets its own reason and the row says so.
    const harness = build({
      zoneLines: [
        { id: LINE_A, listId: LIST_A, quantity: 5, itemSetHash: MILK },
        {
          id: LINE_B,
          listId: LIST_B,
          quantity: 1,
          itemSetHash: MILK,
          approvalStatus: LineApprovalStatus.REJECTED,
        },
      ],
    });

    expect((await read(harness)).candidates[0].unavailable).toBe(
      OriginUnavailableReason.REJECTED
    );
  });

  it('ignores a line this basket carries itself, and refuses one another does', async () => {
    // Plan 0092 section 3.2's other half. The query tested `ACTIVE`, which is
    // never written, so it never fired; asking it against the live set makes it
    // fire, and this basket's own lines would be the first thing it refused.
    const mine = build({ carriedBy: { [LINE_B]: BASKET } });
    const theirs = build({ carriedBy: { [LINE_B]: OTHER_BASKET } });

    expect((await read(mine)).candidates[0].unavailable).toBeUndefined();
    expect((await read(theirs)).candidates[0].unavailable).toBe(
      OriginUnavailableReason.CLAIMED
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

describe('every list the line could be asked of (plan 0092, section 3)', () => {
  it('answers a line with nothing at all with every list in scope', async () => {
    // Section 3.1: an added line nobody has sent anywhere. Two empty
    // collections and every writable list, which is the row set the deleted
    // target picker showed, at zero.
    const harness = build({
      origins: [],
      zoneLines: [],
      runLists: [LIST_A],
    });

    const result = await read(harness);

    expect(result.origins).toEqual([]);
    expect(result.candidates).toEqual([]);
    expect(result.others.map((row) => row.listId).sort()).toEqual(
      [LIST_A, LIST_B, LIST_C].sort()
    );
    expect(
      result.others.filter((row) => row.fromRun).map((row) => row.listId)
    ).toEqual([LIST_A]);
    expect(result.others[0]).toMatchObject({
      zoneId: zoneOf(result.others[0].listId),
      listName: `${result.others[0].listId} list`,
    });
  });

  it('places each list once, as an origin, a candidate or an other', async () => {
    // The three collections partition one set: the flat is an origin, the
    // parents hold a matching line, and the office holds bread.
    const result = await read(build());

    expect(result.origins.map((row) => row.listId)).toEqual([LIST_A]);
    expect(result.candidates.map((row) => row.listId)).toEqual([LIST_B]);
    expect(result.others.map((row) => row.listId)).toEqual([LIST_C]);
  });

  it('keeps a list holding a match it cannot offer out of the others', async () => {
    // A row's job is to say what that list holds, so a rejected match is a
    // candidate carrying a reason rather than an other offering to create a
    // second line beside it.
    const harness = build({
      zoneLines: [
        { id: LINE_A, listId: LIST_A, quantity: 5, itemSetHash: MILK },
        {
          id: LINE_B,
          listId: LIST_B,
          quantity: 1,
          itemSetHash: MILK,
          approvalStatus: LineApprovalStatus.REJECTED,
        },
      ],
    });

    const result = await read(harness);

    expect(result.candidates.map((row) => row.listId)).toEqual([LIST_B]);
    expect(result.others.map((row) => row.listId)).toEqual([LIST_C]);
  });

  it('says on every row whether the run drew from that list', async () => {
    const result = await read(build({ runLists: [LIST_A, LIST_B] }));

    expect(result.origins[0].fromRun).toBe(true);
    expect(result.candidates[0].fromRun).toBe(true);
    expect(result.others[0].fromRun).toBe(false);
  });

  it('says on every origin whether the household has agreed to it yet', async () => {
    // One field on every origin rather than one flag on a bind result, which is
    // what it always was.
    const harness = build({
      zoneLines: [
        {
          id: LINE_A,
          listId: LIST_A,
          quantity: 5,
          itemSetHash: MILK,
          approvalStatus: LineApprovalStatus.PENDING,
        },
      ],
    });

    expect((await read(harness)).origins[0].approvalStatus).toBe(
      LineApprovalStatus.PENDING
    );
  });

  it('reads a deleted zone line as nothing wanted and nobody waiting', async () => {
    // The origin outlives what it came from (plan 0050, section 1), and a line
    // nobody can find is not waiting for anybody.
    const harness = build({ zoneLines: [] });

    const [origin] = (await read(harness)).origins;

    expect(origin.listQuantity).toBe(0);
    expect(origin.approvalStatus).toBe(LineApprovalStatus.APPROVED);
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
  it('takes over the demand the list already has before it adds any', async () => {
    // Plan 0092 section 4.1. Plan 0057 moved the zone line by the whole
    // contribution, so a list asking for one, adopted at one, was pushed to two.
    // This basket is taking over demand that exists, and the run itself never
    // raised a list it drew from.
    const asIs = build();
    const above = build();

    await set(asIs, { listId: LIST_B, lineId: LINE_B, quantity: 1, from: 0 });
    await set(above, { listId: LIST_B, lineId: LINE_B, quantity: 3, from: 0 });

    // The parents asked for one. Adopted at one, their line stands still.
    expect(asIs.zoneLines.get(LINE_B)?.quantity).toBe(1);
    // Adopted at three, only the two above what they asked for are new demand.
    expect(above.zoneLines.get(LINE_B)?.quantity).toBe(3);
    // The basket buys all of it either way.
    expect(asIs.basketLine.quantity).toBe(3);
    expect(above.basketLine.quantity).toBe(5);
  });

  it('says nothing on the zone room when the zone line did not move', async () => {
    // A redraw to report that a row is unchanged is a redraw with no news in
    // it. The basket's own room still hears, because its line moved.
    const harness = build();

    await set(harness, {
      listId: LIST_B,
      lineId: LINE_B,
      quantity: 1,
      from: 0,
    });

    expect(harness.events.map((entry) => entry.event)).toEqual([
      RealtimeEvent.GeneratedListLineUpdated,
    ]);
  });

  it('moves by the delta on the edit that follows the adoption', async () => {
    // After adoption the contribution and the list's demand move together, so
    // an edit is plan 0057's pure delta and lowering one is the household
    // changing its mind.
    const harness = build();

    await set(harness, {
      listId: LIST_B,
      lineId: LINE_B,
      quantity: 1,
      from: 0,
    });
    await set(harness, {
      listId: LIST_B,
      lineId: LINE_B,
      quantity: 3,
      from: 1,
    });

    expect(harness.zoneLines.get(LINE_B)?.quantity).toBe(3);
  });

  it('adds an origin, claims it and raises the basket line', async () => {
    const harness = build();

    const result = await set(harness, {
      listId: LIST_B,
      lineId: LINE_B,
      quantity: 2,
      from: 0,
    });

    expect(harness.origins).toHaveLength(2);
    expect(harness.origins[1]).toMatchObject({
      listId: LIST_B,
      lineId: LINE_B,
      zoneId: ZONE_B,
      quantity: 2,
    });
    expect(harness.zoneLines.get(LINE_B)?.quantity).toBe(2);
    expect(harness.basketLine.quantity).toBe(4);
    expect(result.origin?.contributed).toBe(2);
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

  it('refuses a line another live basket already carries', async () => {
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

  it('refuses a rejected line and takes a pending one', async () => {
    // The write restates exactly the refusals the sheet reports, which after
    // plan 0092 is one of plan 0057's three.
    const rejected = build({
      zoneLines: [
        { id: LINE_A, listId: LIST_A, quantity: 5, itemSetHash: MILK },
        {
          id: LINE_B,
          listId: LIST_B,
          quantity: 1,
          itemSetHash: MILK,
          approvalStatus: LineApprovalStatus.REJECTED,
        },
      ],
    });
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

    expect(
      await codeOf(
        set(rejected, { listId: LIST_B, lineId: LINE_B, quantity: 1, from: 0 })
      )
    ).toBe('validation_failed');
    await set(pending, {
      listId: LIST_B,
      lineId: LINE_B,
      quantity: 1,
      from: 0,
    });
    expect(pending.origins).toHaveLength(2);
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

/**
 * Raising a list that holds no matching line, which is what "send this line
 * there" now means (plan 0092, section 4.2).
 */
describe('creating the line a list does not have (section 4.2)', () => {
  /** A basket line nobody has sent anywhere: no origins, no zone lines. */
  function added(overrides: Parameters<typeof build>[0] = {}): Harness {
    return build({ origins: [], zoneLines: [], quantity: 1, ...overrides });
  }

  it('creates the zone line through the ordinary add, writes the origin and claims it', async () => {
    const harness = added();

    const result = await set(harness, { listId: LIST_B, quantity: 2, from: 0 });

    // Through `promote` and not by an insert of its own, so the list's access
    // check, its approval rules and its `line.added` all come with it.
    expect(harness.promotions).toEqual([
      { userId: OWNER, listId: LIST_B, quantity: 2 },
    ]);
    expect(harness.origins).toHaveLength(1);
    expect(harness.origins[0]).toMatchObject({ listId: LIST_B, quantity: 2 });
    // The basket buys what the list asked for.
    expect(harness.basketLine.quantity).toBe(3);
    expect(result.origin?.contributed).toBe(2);
    expect(harness.claims.announced).toEqual([
      {
        zoneId: ZONE_B,
        listId: LIST_B,
        lineId: harness.origins[0].lineId,
        claimed: true,
        claimedByUserId: OWNER,
      },
    ]);
    // Still not a purchase, on the one path that creates something.
    expect(harness.settlements).toEqual([]);
  });

  it('says whether the household still has to agree to the created line', async () => {
    // Plan 0058 section 4.3 survives as a field on the origin rather than a flag
    // on a bind result: nothing here approves anything and nothing overrides the
    // add, so this reports what the ordinary path decided.
    const waiting = added({ promoteApproval: LineApprovalStatus.PENDING });
    const agreed = added({ promoteApproval: LineApprovalStatus.APPROVED });

    expect(
      (await set(waiting, { listId: LIST_B, quantity: 1, from: 0 })).origin
        ?.approvalStatus
    ).toBe(LineApprovalStatus.PENDING);
    expect(
      (await set(agreed, { listId: LIST_B, quantity: 1, from: 0 })).origin
        ?.approvalStatus
    ).toBe(LineApprovalStatus.APPROVED);
  });

  it('lands on a line the list already held when the names fold together', async () => {
    // After plan 0091 the add answers the line it landed on, and the candidate
    // read never offered this one because the product sets did not meet. The
    // origin is written against whichever id came back.
    const harness = added({ promoteLandsOn: { [LIST_B]: LINE_B } });

    const result = await set(harness, { listId: LIST_B, quantity: 2, from: 0 });

    expect(harness.origins[0].lineId).toBe(LINE_B);
    expect(result.origin?.lineId).toBe(LINE_B);
  });

  it('writes nothing at all for a row released where it started', async () => {
    // No zone line is created for an amount of zero, and this is not an error.
    const harness = added();

    const result = await set(harness, { listId: LIST_B, quantity: 0, from: 0 });

    expect(harness.promotions).toEqual([]);
    expect(harness.origins).toEqual([]);
    expect(harness.events).toEqual([]);
    expect(result.origin).toBeNull();
  });

  it('refuses a raise onto a list this basket has already reached', async () => {
    // A raise that lands on a row the client showed at zero has to be shown
    // again before it means anything, and the refusal comes **before** the add,
    // because `promote` commits its own transaction.
    const harness = added();
    await set(harness, { listId: LIST_B, quantity: 2, from: 0 });

    expect(
      await codeOf(set(harness, { listId: LIST_B, quantity: 1, from: 0 }))
    ).toBe('stale_quantity');
    expect(harness.promotions).toHaveLength(1);
    expect(harness.origins).toHaveLength(1);
  });

  it('refuses a stale `from` before it promotes anything', async () => {
    const harness = added();

    expect(
      await codeOf(set(harness, { listId: LIST_B, quantity: 2, from: 1 }))
    ).toBe('stale_quantity');
    expect(harness.promotions).toEqual([]);
    expect(harness.origins).toEqual([]);
  });

  it('refuses a list the owner may no longer write, and promotes nothing', async () => {
    const harness = added({
      writable: { [OWNER]: [LIST_A], [CO_SHOPPER]: [LIST_A, LIST_B] },
    });

    expect(
      await codeOf(set(harness, { listId: LIST_B, quantity: 1, from: 0 }))
    ).toBe('forbidden');
    expect(harness.promotions).toEqual([]);
  });

  it('sends the line to as many lists as are raised', async () => {
    // The whole point of the plan: reaching one list never refuses the next,
    // which plan 0058's "binding is once" did.
    const harness = added();

    await set(harness, { listId: LIST_B, quantity: 2, from: 0 });
    await set(harness, { listId: LIST_C, quantity: 1, from: 0 });

    expect(harness.origins.map((row) => row.listId)).toEqual([LIST_B, LIST_C]);
    expect(harness.basketLine.quantity).toBe(4);
  });
});

describe('a purchase with no list belongs to no origin (plan 0093, section 2.2)', () => {
  it('is not counted as bought here, on any origin', async () => {
    // `settledPerOrigin` groups by the zone line a settlement landed on, and a
    // waiting row landed on none. Counting it would give the floor a key of
    // `null` and hold units against an origin nobody can name.
    const harness = build({
      settlements: [
        { lineId: LINE_A, quantity: 1 },
        { lineId: null, quantity: 3 },
      ],
    });

    const result = await read(harness);

    expect(result.origins).toHaveLength(1);
    expect(result.origins[0].settledHere).toBe(1);
  });

  it('does not raise the floor under a contribution', async () => {
    // The floor is what this basket has already bought **for this list** (plan
    // 0057, section 5.2). Three units bought before the list held the line are
    // not units this list asked for, so lowering it to one is still allowed.
    const harness = build({
      settlements: [{ lineId: null, quantity: 3 }],
    });

    const result = await set(harness, {
      listId: LIST_A,
      lineId: LINE_A,
      from: 2,
      quantity: 1,
    });

    expect(result.origin?.contributed).toBe(1);
  });
});
