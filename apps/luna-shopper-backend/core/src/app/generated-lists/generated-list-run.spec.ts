import {
  BasketKind,
  GeneratedLineOrigin,
  GeneratedListStatus,
  RealtimeEvent,
} from '@portfolio/luna-shopper/contracts';
import { NotFoundException } from '@portfolio/luna-shopper/platform';
import { QueryFailedError, type DataSource } from 'typeorm';
import {
  BasketSource,
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOption,
  GeneratedListLineOrigin,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { BASKET_ORIGIN_LISTS_SQL } from '../lists/trips/trips.sql';
import type { ProfileService } from '../profiles/profile.service';
import { fakeBasketTripRows } from './basket-trip-rows.fake';
import type { GeneratedListMembersService } from './generated-list-members.service';
import { GeneratedListOrderService } from './generated-list-order.service';
import { GeneratedListService } from './generated-list.service';
import {
  CANDIDATE_LINES_SQL,
  CANDIDATE_LINE_ITEMS_SQL,
  ORDER_HISTORY_SQL,
  WRITABLE_LISTS_SQL,
  type OrderHistoryRow,
} from './generated-list.sql';
import { fakeLineClaims, type FakeLineClaims } from './line-claims.fake';

/**
 * The generation run (plan 0050, sections 2, 3 and 4).
 *
 * Everything here is about **what a basket ends up holding**, which is the only
 * part of the feature a person can be surprised by. The three reads the run makes
 * are faked by matching on the SQL constants themselves rather than on a string,
 * so a change to a query that this file was pinning shows up as an unmocked read
 * rather than as a silently passing test.
 *
 * The one thing this file cannot prove is the idempotency index, which is what
 * makes a double tap return the first basket rather than usually returning it. A
 * mocked repository has no unique constraint to violate, so the transaction's
 * loser path is asserted here by making the write throw and the re-read succeed,
 * and the constraint itself lives in the migration.
 */

const OWNER = 'u-owner';
const ZONE_A = 'z-flat';
const ZONE_B = 'z-parents';
const LIST_A = 'l-flat';
const LIST_B = 'l-parents';

interface CandidateSeed {
  id: string;
  listId: string;
  content: string;
  quantity: number;
  version?: number;
  itemSetHash?: string | null;
  itemIds?: string[];
}

/**
 * The source rows a run wrote, as (zone, list) pairs, so an assertion reads like
 * the table in plan 0133 section 4.2 rather than like an insert.
 */
const sourcesOf = (written: Harness['written']) =>
  written.sources.map((row) => ({ zoneId: row.zoneId, listId: row.listId }));

interface Harness {
  service: GeneratedListService;
  /** Rows written inside the run's transaction, in write order. */
  written: {
    lists: Partial<GeneratedList>[];
    /** What the run recorded it was asked to draw from (plan 0133, section 4). */
    sources: Partial<BasketSource>[];
    lines: Partial<GeneratedListLine>[];
    origins: Partial<GeneratedListLineOrigin>[];
    options: Partial<GeneratedListLineOption>[];
  };
  events: { event: RealtimeEvent; userIds: readonly string[] }[];
  /**
   * The lists told to read their trips again (plan 0122, section 6). Kept apart
   * from `events`, which pins who hears about the **basket**: this one is
   * addressed to a list's room and names no person.
   */
  tripsChanged: (string | undefined)[];
  claims: FakeLineClaims;
  /** How many times the run asked for the owner's past trips (plan 0110). */
  orderReads: () => number;
}

function build(options: {
  writable?: { listId: string; zoneId: string }[];
  candidates?: CandidateSeed[];
  profileSources?: { zoneId: string; listId: string | null }[];
  profileId?: string;
  /**
   * A profile id the caller does not own, refused by the load the pricing
   * ladder makes (plan 0078, section 3, rule 1).
   */
  unownedProfileId?: string;
  /** An existing basket the idempotency key already produced. */
  existing?: Partial<GeneratedList> | null;
  /**
   * Make the write lose the unique index, for the two taps that raced.
   *
   * The first `findOne` still answers null, because at that moment the winner had
   * not committed. That ordering is the race, and it is why the loser path exists
   * at all rather than the up front check being enough.
   */
  loseTheRace?: Partial<GeneratedList>;
  /**
   * What the basket is claiming, for the transitions in plan 0052 section 3.
   *
   * The run itself writes the provenance rows the real query reads, so a spec
   * about generation states them here rather than reaching into the write.
   */
  claiming?: { zoneId: string; listId: string; lineId: string }[];
  /**
   * The owner's past trips, which decide the order the basket is written in
   * (plan 0110). Empty by default, so a basket here comes out alphabetically.
   */
  history?: OrderHistoryRow[];
}): Harness {
  const writable = options.writable ?? [
    { listId: LIST_A, zoneId: ZONE_A },
    { listId: LIST_B, zoneId: ZONE_B },
  ];
  const candidates = options.candidates ?? [];

  const written: Harness['written'] = {
    lists: [],
    sources: [],
    lines: [],
    origins: [],
    options: [],
  };
  const events: Harness['events'] = [];
  const tripsChanged: Harness['tripsChanged'] = [];

  let nextId = 0;
  const id = (prefix: string) => `${prefix}-${++nextId}`;

  const query = async (sql: string): Promise<unknown[]> => {
    if (sql === WRITABLE_LISTS_SQL) {
      return writable;
    }
    if (sql === CANDIDATE_LINES_SQL) {
      return candidates.map((line) => ({
        id: line.id,
        listId: line.listId,
        content: line.content,
        quantity: line.quantity,
        version: line.version ?? 1,
        itemSetHash: line.itemSetHash ?? null,
      }));
    }
    if (sql === CANDIDATE_LINE_ITEMS_SQL) {
      return candidates.flatMap((line) =>
        (line.itemIds ?? []).map((itemId) => ({ lineId: line.id, itemId }))
      );
    }
    if (sql === BASKET_ORIGIN_LISTS_SQL) {
      // `DISTINCT`, as the real read is. What the run wrote when there was a
      // run, and what the basket is said to be claiming when there was not.
      const rows = written.origins.length
        ? written.origins
        : (options.claiming ?? []);
      return [...new Set(rows.map((row) => row.listId))].map((listId) => ({
        listId,
      }));
    }
    throw new Error(`unmocked query: ${sql.slice(0, 60)}`);
  };

  // The order's own read (plan 0110), counted, because the run may make it once
  // and only once: it is a query per create and the plan says so.
  let orderReads = 0;
  const orderRepo = {
    query: async (sql: string): Promise<unknown[]> => {
      if (sql !== ORDER_HISTORY_SQL) {
        throw new Error(`unmocked query: ${sql.slice(0, 60)}`);
      }
      orderReads += 1;
      return options.history ?? [];
    },
  };

  let findOneCalls = 0;
  const listRepo = {
    query,
    findOne: async () => {
      findOneCalls += 1;
      if (options.loseTheRace) {
        // Null the first time (the winner had not committed), the winner's row
        // the second time (after the constraint refused ours).
        return findOneCalls > 1 ? options.loseTheRace : null;
      }
      return options.existing ?? null;
    },
    // Only reached by the paths this file does not exercise (update, delete).
    save: async (row: Partial<GeneratedList>) => row,
    delete: async () => ({ affected: 0 }),
    createQueryBuilder: () => {
      throw new Error('the run does not page');
    },
  };

  const lineRepo = {
    find: async () =>
      written.lines.map((line) => ({
        ...line,
        settledQuantity: line.settledQuantity ?? 0,
      })),
    createQueryBuilder: () => {
      throw new Error('the run does not count');
    },
  };
  const originRepo = {
    find: async () => written.origins,
  };
  const optionRepo = {
    find: async () => written.options,
  };

  const manager = {
    // The basket `update` locks and re-reads inside its transaction (plan 0135,
    // section 3.1). The same row the load above answered with, because this
    // harness stores one.
    findOne: async () => options.existing ?? null,
    getRepository: (entity: unknown) => {
      if (entity === GeneratedList) {
        return {
          create: (data: Partial<GeneratedList>) => ({ ...data }),
          // A row that already has an id is an update rather than the run's
          // insert, and it keeps the id it arrived with.
          save: async (row: Partial<GeneratedList>) => {
            if (row.id) {
              return row;
            }
            if (options.loseTheRace) {
              throw uniqueViolation();
            }
            const stored = { ...row, id: id('gl') };
            written.lists.push(stored);
            return stored;
          },
        };
      }
      if (entity === BasketSource) {
        return {
          insert: async (rows: Partial<BasketSource>[]) => {
            written.sources.push(
              ...rows.map((row) => ({ ...row, id: id('bs') }))
            );
          },
        };
      }
      if (entity === GeneratedListLine) {
        return {
          create: (data: Partial<GeneratedListLine>) => ({ ...data }),
          save: async (row: Partial<GeneratedListLine>) => {
            const stored = { ...row, id: id('gll') };
            written.lines.push(stored);
            return stored;
          },
        };
      }
      if (entity === GeneratedListLineOrigin) {
        return {
          insert: async (rows: Partial<GeneratedListLineOrigin>[]) => {
            written.origins.push(
              ...rows.map((row) => ({ ...row, id: id('o') }))
            );
          },
        };
      }
      return {
        insert: async (rows: Partial<GeneratedListLineOption>[]) => {
          written.options.push(
            ...rows.map((row) => ({ ...row, id: id('op') }))
          );
        },
      };
    },
  };

  const dataSource = {
    transaction: async <T>(work: (m: unknown) => Promise<T>): Promise<T> =>
      work(manager),
  } as unknown as DataSource;

  const profiles = {
    resolveGenerationSources: async () => ({
      profileId: options.profileId ?? 'p-default',
      scope: 'ALL',
      sources: options.profileSources ?? [],
    }),
    // Plan 0078's ladder, faked at the same depth as the one above it: a named
    // profile is loaded and answered back, a profile this caller does not own is
    // refused there rather than here, and no name at all takes the default.
    pricingProfileId: async (_userId: string, profileId?: string | null) => {
      if (profileId) {
        if (profileId === options.unownedProfileId) {
          throw new NotFoundException('no such profile');
        }
        return profileId;
      }
      return options.profileId ?? 'p-default';
    },
  } as unknown as ProfileService;

  const publisher = {
    emitToUsers: (event: RealtimeEvent, userIds: readonly string[]) => {
      events.push({ event, userIds });
    },
    // A deletion names the basket room beside the owner since plan 0114, so it
    // goes through the explicit audience. Recorded by its users, as before.
    emitTo: (
      event: RealtimeEvent,
      audience: { userIds?: readonly string[]; listId?: string }
    ) => {
      if (event === RealtimeEvent.ListTripsChanged) {
        tripsChanged.push(audience.listId);
        return;
      }
      events.push({ event, userIds: audience.userIds ?? [] });
    },
  } as unknown as CoreEventsPublisher;

  // Nobody is shared a basket in these runs (plan 0114): no members are named,
  // and a deletion finds nobody to tell.
  const members = {
    liveRegistered: async () => [],
  } as unknown as GeneratedListMembersService;

  const claims = fakeLineClaims({}, () => options.claiming ?? []);

  const tripRows = fakeBasketTripRows();
  const service = new GeneratedListService(
    dataSource,
    listRepo as never,
    lineRepo as never,
    originRepo as never,
    optionRepo as never,
    // The settlements repository, read only, for the basket line view's
    // `lastOutcome` (velista 0044). The run itself never touches it, so an empty
    // find is the whole of what this needs to answer.
    { find: async () => [] } as never,
    profiles,
    claims.service,
    publisher,
    new GeneratedListOrderService(orderRepo as never),
    members,
    // The source rows the run wrote, read back by every view of the basket.
    { find: async () => written.sources } as never,
    tripRows.service
  );

  return {
    service,
    written,
    events,
    tripsChanged,
    claims,
    tripRows,
    orderReads: () => orderReads,
  };
}

/**
 * What Postgres raises when the partial unique index on the idempotency key
 * refuses a second basket.
 *
 * Built by hand rather than provoked, because the service recognises it by
 * `driverError.code` and that is exactly the coupling worth pinning: a refactor
 * that started reading `error.code` instead would pass every other test in this
 * file and turn a lost race into a 500.
 */
function uniqueViolation(): QueryFailedError {
  return new QueryFailedError('INSERT', [], {
    code: '23505',
  } as unknown as Error);
}

describe('the generation run', () => {
  it('composes one line per qualifying zone line', async () => {
    const { service, written } = build({
      candidates: [
        { id: 'a1', listId: LIST_A, content: 'Milk', quantity: 2 },
        { id: 'a2', listId: LIST_A, content: 'Bread', quantity: 1 },
      ],
    });

    const result = await service.create({ userId: OWNER });

    expect(written.lines).toHaveLength(2);
    // Alphabetically, not in list order, because this owner has walked no trip
    // the order could be read from (plan 0110, section 3).
    expect(written.lines.map((line) => line.content)).toEqual([
      'Bread',
      'Milk',
    ]);
    expect(written.lines.map((line) => line.position)).toEqual([1, 2]);
    // The result is the basket and nothing else since plan 0133 section 7: the
    // run refuses no line, so there is nothing left behind to report.
    expect(Object.keys(result)).toEqual(['list']);
  });

  it('writes the positions of the order the owner walks, once', async () => {
    const { service, written, orderReads } = build({
      candidates: [
        { id: 'a1', listId: LIST_A, content: 'Juice', quantity: 1 },
        { id: 'a2', listId: LIST_A, content: 'Milk', quantity: 1 },
        { id: 'a3', listId: LIST_A, content: 'Anchovies', quantity: 1 },
      ],
      history: [
        {
          tripId: 't1',
          content: 'Milk',
          pickItemId: null,
          settledItemIds: [],
          offsetSeconds: 0,
        },
        {
          tripId: 't1',
          content: 'Juice',
          pickItemId: null,
          settledItemIds: [],
          offsetSeconds: 12,
        },
      ],
    });

    await service.create({ userId: OWNER });

    // The two the owner has walked, in the order they walked them, and then the
    // one they never have.
    expect(written.lines.map((line) => [line.content, line.position])).toEqual([
      ['Milk', 1],
      ['Juice', 2],
      ['Anchovies', 3],
    ]);
    // One query per create, which is the whole cost the plan budgets for.
    expect(orderReads()).toBe(1);
  });

  it('merges lines carrying the same product set and sums their quantities', async () => {
    // The case the feature exists for: milk in the flat list and in the
    // parents' list is one line to buy once (section 3).
    const { service, written } = build({
      candidates: [
        {
          id: 'a1',
          listId: LIST_A,
          content: 'Milk',
          quantity: 2,
          itemSetHash: 'milk-hash',
          itemIds: ['item-pascual'],
        },
        {
          id: 'b1',
          listId: LIST_B,
          content: 'Leche',
          quantity: 1,
          itemSetHash: 'milk-hash',
          itemIds: ['item-asturiana'],
        },
      ],
    });

    await service.create({ userId: OWNER });

    expect(written.lines).toHaveLength(1);
    expect(written.lines[0].quantity).toBe(3);
    // Every contributing line gets its provenance row, which is what lets a
    // settle later know how many units each list was asking for.
    expect(written.origins).toHaveLength(2);
    expect(written.origins.map((row) => row.lineId).sort()).toEqual([
      'a1',
      'b1',
    ]);
    expect(written.origins.map((row) => row.quantity)).toEqual([2, 1]);
  });

  it('unions the options of the lines it merged, so either brand can be picked', async () => {
    const { service, written } = build({
      candidates: [
        {
          id: 'a1',
          listId: LIST_A,
          content: 'Milk',
          quantity: 1,
          itemSetHash: 'milk-hash',
          itemIds: ['item-pascual'],
        },
        {
          id: 'b1',
          listId: LIST_B,
          content: 'Milk',
          quantity: 1,
          itemSetHash: 'milk-hash',
          itemIds: ['item-asturiana', 'item-pascual'],
        },
      ],
    });

    await service.create({ userId: OWNER });

    expect(written.options.map((row) => row.itemId)).toEqual([
      'item-pascual',
      'item-asturiana',
    ]);
    // The pick is the first option added, which is section 4's stated fallback
    // for a line whose options carry no price.
    expect(written.lines[0].itemId).toBe('item-pascual');
  });

  it('merges free text lines on normalized text and keeps different words apart', async () => {
    const { service, written } = build({
      candidates: [
        { id: 'a1', listId: LIST_A, content: 'Café', quantity: 1 },
        { id: 'b1', listId: LIST_B, content: '  cafe ', quantity: 2 },
        { id: 'b2', listId: LIST_B, content: 'whole milk', quantity: 1 },
        { id: 'b3', listId: LIST_B, content: 'milk', quantity: 1 },
      ],
    });

    await service.create({ userId: OWNER });

    const byContent = new Map(
      written.lines.map((line) => [line.content, line.quantity])
    );
    expect(byContent.get('Café')).toBe(3);
    // Conservative on purpose: two things a person meant separately stay
    // separate, because merging them loses a purchase silently.
    expect(byContent.get('whole milk')).toBe(1);
    expect(byContent.get('milk')).toBe(1);
  });

  it('leaves a free text line with no pick and no options', async () => {
    const { service, written } = build({
      candidates: [
        {
          id: 'a1',
          listId: LIST_A,
          content: 'Ask about the cake',
          quantity: 1,
        },
      ],
    });

    await service.create({ userId: OWNER });

    expect(written.lines[0].itemId).toBeNull();
    expect(written.options).toEqual([]);
  });

  it('takes a line another basket of the owner\u2019s is carrying (plan 0133)', async () => {
    // Plan 0050 section 3 refused it and plan 0133 section 7 reversed that. The
    // rule was true of two frozen copies of one line and false of two views of
    // it, and with a permanent basket over every list it would refuse
    // everything.
    const { service, written } = build({
      candidates: [
        { id: 'a1', listId: LIST_A, content: 'Milk', quantity: 2 },
        { id: 'a2', listId: LIST_A, content: 'Bread', quantity: 1 },
      ],
      claiming: [{ zoneId: ZONE_A, listId: LIST_A, lineId: 'a1' }],
    });

    const result = await service.create({ userId: OWNER });

    expect(written.lines.map((line) => line.content)).toEqual([
      'Bread',
      'Milk',
    ]);
    expect(result).toEqual({ list: expect.objectContaining({ id: 'gl-1' }) });
  });

  it('draws from every writable list when nothing narrows it', async () => {
    const { service, written } = build({
      candidates: [
        { id: 'a1', listId: LIST_A, content: 'Milk', quantity: 1 },
        { id: 'b1', listId: LIST_B, content: 'Bread', quantity: 1 },
      ],
    });

    await service.create({ userId: OWNER });

    // `ALL` names no source of its own, so it is recorded as one whole zone row
    // per zone the caller can draw from (plan 0133, section 4.2).
    expect(written.lists[0].pricingProfileId).toBe('p-default');
    expect(sourcesOf(written)).toEqual([
      { zoneId: ZONE_A, listId: null },
      { zoneId: ZONE_B, listId: null },
    ]);
  });

  it('narrows to the sources the request names, and never widens past access', async () => {
    const { service, written } = build({
      candidates: [
        { id: 'a1', listId: LIST_A, content: 'Milk', quantity: 1 },
        { id: 'b1', listId: LIST_B, content: 'Bread', quantity: 1 },
      ],
    });

    await service.create({
      userId: OWNER,
      // A zone the caller may not draw from contributes nothing rather than
      // failing the run, which is the same thing as it having been taken away.
      sources: [{ zoneId: ZONE_A }, { zoneId: 'z-stranger' }],
    });

    // The run belongs to somebody who shops somewhere even when it read no
    // profile's sources (plan 0078, section 3).
    expect(written.lists[0].pricingProfileId).toBe('p-default');
    // The zone was named, so the zone is what is recorded, and the stranger's
    // zone narrowed to nothing and wrote no row at all.
    expect(sourcesOf(written)).toEqual([{ zoneId: ZONE_A, listId: null }]);
  });

  it('narrows to a named list inside a zone', async () => {
    const { service, written } = build({
      candidates: [{ id: 'b1', listId: LIST_B, content: 'Bread', quantity: 1 }],
    });

    await service.create({
      userId: OWNER,
      sources: [{ zoneId: ZONE_B, listId: LIST_B }],
    });

    expect(sourcesOf(written)).toEqual([{ zoneId: ZONE_B, listId: LIST_B }]);
  });

  it('writes the whole zone row alone when a source names one of its lists too', async () => {
    // Section 4.1's second rule: both rows would describe the same coverage, and
    // the pair would make `listsOf` ask two questions where one answers.
    const { service, written } = build({
      writable: [
        { listId: LIST_A, zoneId: ZONE_A },
        { listId: 'l-second', zoneId: ZONE_A },
      ],
      candidates: [{ id: 'a1', listId: LIST_A, content: 'Milk', quantity: 1 }],
    });

    await service.create({
      userId: OWNER,
      sources: [{ zoneId: ZONE_A }, { zoneId: ZONE_A, listId: LIST_A }],
    });

    expect(sourcesOf(written)).toEqual([{ zoneId: ZONE_A, listId: null }]);
  });

  it('writes no row for a source that narrows to nothing', async () => {
    // Plan 0050 section 2's rule kept: a source is only ever a narrowing, and
    // one that names nothing is silently nothing.
    const { service, written } = build({
      candidates: [{ id: 'a1', listId: LIST_A, content: 'Milk', quantity: 1 }],
    });

    await service.create({
      userId: OWNER,
      sources: [
        { zoneId: ZONE_A, listId: LIST_A },
        { zoneId: ZONE_B, listId: 'l-gone' },
      ],
    });

    expect(sourcesOf(written)).toEqual([{ zoneId: ZONE_A, listId: LIST_A }]);
  });

  it('falls back to the profile sources when the request names none', async () => {
    const { service, written } = build({
      candidates: [{ id: 'a1', listId: LIST_A, content: 'Milk', quantity: 1 }],
      profileSources: [{ zoneId: ZONE_A, listId: null }],
      profileId: 'p-weekly',
    });

    await service.create({ userId: OWNER });

    expect(written.lists[0].pricingProfileId).toBe('p-weekly');
    // The profile named the whole zone, so the whole zone is recorded, even
    // though it narrowed to one list today.
    expect(sourcesOf(written)).toEqual([{ zoneId: ZONE_A, listId: null }]);
  });

  describe('what the basket is priced against (plan 0078, section 3)', () => {
    it('records the named profile for pricing while the sources stay the caller’s own', async () => {
      // The shape every run velista creates takes: the sheet always sends
      // `sources`, and sends `profileId` beside them whenever one is chosen.
      const { service, written } = build({
        candidates: [
          { id: 'a1', listId: LIST_A, content: 'Milk', quantity: 1 },
        ],
      });

      await service.create({
        userId: OWNER,
        sources: [{ zoneId: ZONE_A }],
        profileId: 'p-weekly',
      });

      expect(written.lists[0].pricingProfileId).toBe('p-weekly');
      expect(sourcesOf(written)).toEqual([{ zoneId: ZONE_A, listId: null }]);
    });

    it('refuses a profile the caller does not own before writing anything', async () => {
      const { service, written } = build({
        candidates: [
          { id: 'a1', listId: LIST_A, content: 'Milk', quantity: 1 },
        ],
        unownedProfileId: 'p-stranger',
      });

      await expect(
        service.create({
          userId: OWNER,
          sources: [{ zoneId: ZONE_A }],
          profileId: 'p-stranger',
        })
      ).rejects.toBeInstanceOf(NotFoundException);
      // A stranger's profile can never price a run, and a refused run leaves no
      // basket behind to price.
      expect(written.lists).toEqual([]);
    });
  });

  it('starts a basket as a DRAFT of DERIVED lines and tells only the owner', async () => {
    const { service, written, events } = build({
      candidates: [{ id: 'a1', listId: LIST_A, content: 'Milk', quantity: 1 }],
    });

    await service.create({ userId: OWNER });

    expect(written.lists[0].status).toBe(GeneratedListStatus.OPEN);
    expect(written.lines[0].origin).toBe(GeneratedLineOrigin.DERIVED);
    expect(written.lines[0].settledQuantity).toBe(0);
    // A basket is private, so the owner's own sessions are the only audience an
    // event about it can have (section 8).
    expect(events).toEqual([
      {
        event: RealtimeEvent.GeneratedListCreated,
        userIds: [OWNER],
      },
    ]);
  });

  it('returns the first basket for a repeated idempotency key rather than a second one', async () => {
    const { service, written } = build({
      existing: {
        id: 'gl-first',
        ownerUserId: OWNER,
        name: null,
        status: GeneratedListStatus.OPEN,
        generatedAt: new Date('2026-09-01T10:00:00.000Z'),
        kind: BasketKind.GENERATED,
        pricingProfileId: null,
      },
      candidates: [{ id: 'a1', listId: LIST_A, content: 'Milk', quantity: 1 }],
    });

    const result = await service.create({
      userId: OWNER,
      idempotencyKey: 'tap-1',
    });

    expect(result.list.id).toBe('gl-first');
    // Nothing was composed a second time, which is the whole point of the key.
    expect(written.lists).toEqual([]);
    expect(written.lines).toEqual([]);
  });

  it('hands back the winner when two taps race past the up front check', async () => {
    // The half a repeated key cannot cover: both taps read no existing basket,
    // both compose, and the index refuses the second. The loser must answer with
    // the winner's basket rather than with a 500.
    const { service } = build({
      loseTheRace: {
        id: 'gl-winner',
        ownerUserId: OWNER,
        name: null,
        status: GeneratedListStatus.OPEN,
        generatedAt: new Date('2026-09-01T10:00:00.000Z'),
        kind: BasketKind.GENERATED,
        pricingProfileId: null,
      },
      candidates: [{ id: 'a1', listId: LIST_A, content: 'Milk', quantity: 1 }],
    });

    const result = await service.create({
      userId: OWNER,
      idempotencyKey: 'tap-1',
    });

    expect(result.list.id).toBe('gl-winner');
  });

  it('composes nothing when no list qualifies, rather than failing', async () => {
    const { service, written } = build({ writable: [], candidates: [] });

    const result = await service.create({ userId: OWNER });

    expect(result.list.lines).toEqual([]);
    expect(written.lines).toEqual([]);
  });
});

/**
 * The one zone event a generated list emits (plan 0052).
 *
 * Plan 0050 section 8 said generated lists never emit zone events, and this is
 * the declared exception rather than a contradiction to be discovered later: a
 * household has to be able to see that somebody is already out buying the milk.
 */
describe('a basket claims the lines it took (plan 0052, section 3)', () => {
  const CLAIMING = [
    { zoneId: ZONE_A, listId: LIST_A, lineId: 'li-1' },
    { zoneId: ZONE_A, listId: LIST_A, lineId: 'li-2' },
  ];

  it('claims every origin the run took, naming the owner', async () => {
    const w = build({
      candidates: [
        { id: 'li-1', listId: LIST_A, content: 'Milk', quantity: 1 },
        { id: 'li-2', listId: LIST_A, content: 'Bread', quantity: 1 },
      ],
      claiming: CLAIMING,
    });

    await w.service.create({ userId: OWNER });

    // One call carrying both lines, not one call each: a run takes every wanted
    // line of every list it drew from, and a per line fan out into a household
    // room is a self inflicted problem (section 3.1).
    expect(w.claims.calls).toEqual([
      { claimed: true, claimedByUserId: OWNER, lineIds: ['li-1', 'li-2'] },
    ]);
  });

  it('releases them when the trip is over', async () => {
    const w = build({
      existing: {
        id: 'gl-old',
        ownerUserId: OWNER,
        status: GeneratedListStatus.OPEN,
        name: null,
        generatedAt: new Date('2026-03-01T00:00:00.000Z'),
        kind: BasketKind.GENERATED,
        pricingProfileId: null,
      },
      claiming: CLAIMING,
    });

    await w.service.update({
      userId: OWNER,
      generatedListId: 'gl-old',
      status: GeneratedListStatus.FINISHED,
    });

    expect(w.claims.calls).toEqual([
      { claimed: false, claimedByUserId: null, lineIds: ['li-1', 'li-2'] },
    ]);
  });

  it('says nothing when a rename leaves the status where it was', async () => {
    const w = build({
      existing: {
        id: 'gl-old',
        ownerUserId: OWNER,
        status: GeneratedListStatus.OPEN,
        name: null,
        generatedAt: new Date('2026-03-01T00:00:00.000Z'),
        kind: BasketKind.GENERATED,
        pricingProfileId: null,
      },
      claiming: CLAIMING,
    });

    await w.service.update({
      userId: OWNER,
      generatedListId: 'gl-old',
      name: 'Saturday',
    });

    expect(w.claims.calls).toEqual([]);
  });

  it('releases them when the basket is deleted', async () => {
    const w = build({
      existing: {
        id: 'gl-old',
        ownerUserId: OWNER,
        status: GeneratedListStatus.OPEN,
        name: null,
        generatedAt: new Date('2026-03-01T00:00:00.000Z'),
      },
      claiming: CLAIMING,
    });

    await w.service.delete({ userId: OWNER, generatedListId: 'gl-old' });

    expect(w.claims.calls).toEqual([
      { claimed: false, claimedByUserId: null, lineIds: ['li-1', 'li-2'] },
    ]);
  });

  it('says nothing when deleting a basket that was already finished', async () => {
    const w = build({
      existing: {
        id: 'gl-old',
        ownerUserId: OWNER,
        status: GeneratedListStatus.FINISHED,
        name: null,
        generatedAt: new Date('2026-03-01T00:00:00.000Z'),
      },
      claiming: CLAIMING,
    });

    await w.service.delete({ userId: OWNER, generatedListId: 'gl-old' });

    expect(w.claims.calls).toEqual([]);
  });
});

/**
 * Plan 0122, section 6: a list's room is told to read its trips again when a
 * basket that touches it changes. One event per list per write, never one per
 * line (plan 0052, section 3.1).
 */
describe('a basket tells the lists it touches (plan 0122, section 6)', () => {
  const existing = {
    id: 'gl-old',
    ownerUserId: OWNER,
    status: GeneratedListStatus.OPEN,
    name: null,
    generatedAt: new Date('2026-03-01T00:00:00.000Z'),
    kind: BasketKind.GENERATED,
    pricingProfileId: null,
  };
  const CLAIMING = [
    { zoneId: ZONE_A, listId: LIST_A, lineId: 'li-1' },
    { zoneId: ZONE_A, listId: LIST_A, lineId: 'li-2' },
    { zoneId: ZONE_B, listId: LIST_B, lineId: 'li-3' },
  ];

  it('tells each list the run drew from once, however many lines it took', async () => {
    const w = build({
      candidates: [
        { id: 'li-1', listId: LIST_A, content: 'Milk', quantity: 1 },
        { id: 'li-2', listId: LIST_A, content: 'Bread', quantity: 1 },
        { id: 'li-3', listId: LIST_B, content: 'Eggs', quantity: 1 },
      ],
    });

    await w.service.create({ userId: OWNER });

    expect(w.tripsChanged).toEqual([LIST_A, LIST_B]);
  });

  it('tells nobody when the run composed nothing', async () => {
    const w = build({ candidates: [] });

    await w.service.create({ userId: OWNER });

    expect(w.tripsChanged).toEqual([]);
  });

  it('tells them on a rename, which the claim has nothing to say about', async () => {
    const w = build({ existing, claiming: CLAIMING });

    await w.service.update({
      userId: OWNER,
      generatedListId: 'gl-old',
      name: 'Saturday',
    });

    expect(w.tripsChanged).toEqual([LIST_A, LIST_B]);
  });

  it('says nothing when only the default target list moved', async () => {
    const w = build({ existing, claiming: CLAIMING });

    await w.service.update({
      userId: OWNER,
      generatedListId: 'gl-old',
      defaultTargetListId: LIST_A,
    });

    expect(w.tripsChanged).toEqual([]);
  });

  it('tells them when the basket is deleted, finished or not', async () => {
    const w = build({
      existing: { ...existing, status: GeneratedListStatus.FINISHED },
      claiming: CLAIMING,
    });

    await w.service.delete({ userId: OWNER, generatedListId: 'gl-old' });

    expect(w.tripsChanged).toEqual([LIST_A, LIST_B]);
  });
});
