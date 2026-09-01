import {
  GeneratedLineOrigin,
  GeneratedListStatus,
  RealtimeEvent,
} from '@portfolio/luna-shopper/contracts';
import { QueryFailedError, type DataSource } from 'typeorm';
import {
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOption,
  GeneratedListLineOrigin,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { ProfileService } from '../profiles/profile.service';
import { GeneratedListService } from './generated-list.service';
import {
  ACTIVE_OVERLAP_SQL,
  CANDIDATE_LINES_SQL,
  CANDIDATE_LINE_ITEMS_SQL,
  WRITABLE_LISTS_SQL,
} from './generated-list.sql';

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

interface Harness {
  service: GeneratedListService;
  /** Rows written inside the run's transaction, in write order. */
  written: {
    lists: Partial<GeneratedList>[];
    lines: Partial<GeneratedListLine>[];
    origins: Partial<GeneratedListLineOrigin>[];
    options: Partial<GeneratedListLineOption>[];
  };
  events: { event: RealtimeEvent; userIds: readonly string[] }[];
}

function build(options: {
  writable?: { listId: string; zoneId: string }[];
  candidates?: CandidateSeed[];
  /** lineId -> the ACTIVE basket already carrying it. */
  overlaps?: Record<string, string>;
  profileSources?: { zoneId: string; listId: string | null }[];
  profileId?: string;
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
}): Harness {
  const writable = options.writable ?? [
    { listId: LIST_A, zoneId: ZONE_A },
    { listId: LIST_B, zoneId: ZONE_B },
  ];
  const candidates = options.candidates ?? [];
  const overlaps = options.overlaps ?? {};

  const written: Harness['written'] = {
    lists: [],
    lines: [],
    origins: [],
    options: [],
  };
  const events: Harness['events'] = [];

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
    if (sql === ACTIVE_OVERLAP_SQL) {
      return Object.entries(overlaps).map(([lineId, generatedListId]) => ({
        lineId,
        generatedListId,
      }));
    }
    throw new Error(`unmocked query: ${sql.slice(0, 60)}`);
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
    getRepository: (entity: unknown) => {
      if (entity === GeneratedList) {
        return {
          create: (data: Partial<GeneratedList>) => ({ ...data }),
          save: async (row: Partial<GeneratedList>) => {
            if (options.loseTheRace) {
              throw uniqueViolation();
            }
            const stored = { ...row, id: id('gl') };
            written.lists.push(stored);
            return stored;
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
  } as unknown as ProfileService;

  const publisher = {
    emitToUsers: (event: RealtimeEvent, userIds: readonly string[]) => {
      events.push({ event, userIds });
    },
  } as unknown as CoreEventsPublisher;

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
    publisher
  );

  return { service, written, events };
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
  it('composes one line per qualifying zone line, in list order', async () => {
    const { service, written } = build({
      candidates: [
        { id: 'a1', listId: LIST_A, content: 'Milk', quantity: 2 },
        { id: 'a2', listId: LIST_A, content: 'Bread', quantity: 1 },
      ],
    });

    const result = await service.create({ userId: OWNER });

    expect(written.lines).toHaveLength(2);
    expect(written.lines.map((line) => line.content)).toEqual([
      'Milk',
      'Bread',
    ]);
    expect(result.skipped).toEqual([]);
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

  it('skips a line a live basket already carries, and says which basket has it', async () => {
    const { service, written } = build({
      candidates: [
        { id: 'a1', listId: LIST_A, content: 'Milk', quantity: 2 },
        { id: 'a2', listId: LIST_A, content: 'Bread', quantity: 1 },
      ],
      overlaps: { a1: 'gl-already-shopping' },
    });

    const result = await service.create({ userId: OWNER });

    expect(written.lines.map((line) => line.content)).toEqual(['Bread']);
    // Reported rather than silently dropped: a basket missing the milk somebody
    // remembers writing is a bug report otherwise.
    expect(result.skipped).toEqual([
      {
        zoneId: ZONE_A,
        listId: LIST_A,
        lineId: 'a1',
        content: 'Milk',
        carriedByGeneratedListId: 'gl-already-shopping',
      },
    ]);
  });

  it('draws from every writable list when nothing narrows it', async () => {
    const { service, written } = build({
      candidates: [
        { id: 'a1', listId: LIST_A, content: 'Milk', quantity: 1 },
        { id: 'b1', listId: LIST_B, content: 'Bread', quantity: 1 },
      ],
    });

    await service.create({ userId: OWNER });

    expect(written.lists[0].sourceSnapshot).toEqual({
      profileId: 'p-default',
      sources: [
        { zoneId: ZONE_A, listId: LIST_A },
        { zoneId: ZONE_B, listId: LIST_B },
      ],
    });
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

    expect(written.lists[0].sourceSnapshot).toEqual({
      profileId: null,
      sources: [{ zoneId: ZONE_A, listId: LIST_A }],
    });
  });

  it('narrows to a named list inside a zone', async () => {
    const { service, written } = build({
      candidates: [{ id: 'b1', listId: LIST_B, content: 'Bread', quantity: 1 }],
    });

    await service.create({
      userId: OWNER,
      sources: [{ zoneId: ZONE_B, listId: LIST_B }],
    });

    expect(written.lists[0].sourceSnapshot).toEqual({
      profileId: null,
      sources: [{ zoneId: ZONE_B, listId: LIST_B }],
    });
  });

  it('falls back to the profile sources when the request names none', async () => {
    const { service, written } = build({
      candidates: [{ id: 'a1', listId: LIST_A, content: 'Milk', quantity: 1 }],
      profileSources: [{ zoneId: ZONE_A, listId: null }],
      profileId: 'p-weekly',
    });

    await service.create({ userId: OWNER });

    expect(written.lists[0].sourceSnapshot).toEqual({
      profileId: 'p-weekly',
      sources: [{ zoneId: ZONE_A, listId: LIST_A }],
    });
  });

  it('starts a basket as a DRAFT of DERIVED lines and tells only the owner', async () => {
    const { service, written, events } = build({
      candidates: [{ id: 'a1', listId: LIST_A, content: 'Milk', quantity: 1 }],
    });

    await service.create({ userId: OWNER });

    expect(written.lists[0].status).toBe(GeneratedListStatus.DRAFT);
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
        status: GeneratedListStatus.DRAFT,
        generatedAt: new Date('2026-09-01T10:00:00.000Z'),
        sourceSnapshot: { profileId: null, sources: [] },
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
        status: GeneratedListStatus.DRAFT,
        generatedAt: new Date('2026-09-01T10:00:00.000Z'),
        sourceSnapshot: { profileId: null, sources: [] },
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
