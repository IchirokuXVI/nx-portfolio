import {
  BasketKind,
  GeneratedListStatus,
  RealtimeEvent,
  type BasketUpdatedEvent,
} from '@portfolio/luna-shopper/contracts';
import type { FindOperator } from 'typeorm';
import type { GeneratedList } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { ProfileService } from '../profiles/profile.service';
import {
  fakeBasketTripRows,
  fakeUpdateDataSource,
} from './basket-trip-rows.fake';
import { GeneratedListSweepService } from './generated-list-sweep.service';
import { GeneratedListService } from './generated-list.service';
import type { ZoneLineClaimRef } from './line-claim.sql';
import { fakeLineClaims, type FakeLineClaims } from './line-claims.fake';

/**
 * The sweep (plan 0059, section 4).
 *
 * The service under test is wired to a **real** {@link GeneratedListService}
 * rather than a mock of it, because section 4.4's whole claim is that the sweep
 * goes through `update`: the same save, the same `basket.updated` to the owner
 * and to the basket's room, the same release announced to every zone room. A mock would assert that
 * a call was made and would keep passing on the day somebody replaced it with a
 * bulk `UPDATE` that a household never hears about, which is the failure the
 * plan is written against. So the exit criterion is met the way it is stated:
 * the events are asserted, not only the rows.
 *
 * The harness has no zone line repository and no settlement repository, and its
 * transaction hands out a repository for `generated_lists` alone
 * (`fakeUpdateDataSource`), so a sweep that settled anything or touched a zone
 * list (section 4.5) would fail here rather than pass quietly. Since plan 0136
 * there is no basket line table for it to write to either, which is why the line
 * repository that used to stand in that sentence is gone.
 */

const OWNER = 'u-owner';
const NOW = new Date('2026-09-02T12:00:00.000Z').getTime();
/** Sixty hours, which is what `GENERATED_LIST_CLAIM_WINDOW` defaults to. */
const WINDOW_MS = 60 * 60 * 60 * 1000;

interface Seed {
  id: string;
  status: GeneratedListStatus;
  /** How long before `NOW` the basket was generated. */
  ageMs: number;
  ownerUserId?: string;
  /** `GENERATED` unless a spec is about the permanent basket (plan 0133). */
  kind?: BasketKind;
}

interface Harness {
  service: GeneratedListSweepService;
  rows: GeneratedList[];
  events: {
    event: RealtimeEvent;
    userIds: readonly string[];
    /** The basket's own room, which a finish reaches since plan 0139. */
    basketIds: readonly string[];
    payload: BasketUpdatedEvent;
  }[];
  claims: FakeLineClaims;
  /** The lists told to read their trips again (plan 0122), one entry an event. */
  tripsChanged: (string | undefined)[];
  logger: { log: jest.Mock; error: jest.Mock };
}

function build(options: {
  baskets: Seed[];
  /** What each basket still claims, by basket id. */
  claiming?: Record<string, ZoneLineClaimRef[]>;
  batchSize?: number;
  enabled?: boolean;
  /** Baskets that vanish between the sweep's query and its write. */
  vanished?: string[];
}): Harness {
  const rows = options.baskets.map(
    (seed) =>
      ({
        id: seed.id,
        ownerUserId: seed.ownerUserId ?? OWNER,
        kind: seed.kind ?? BasketKind.GENERATED,
        name: null,
        status: seed.status,
        generatedAt: new Date(NOW - seed.ageMs),
        pricingProfileId: null,
        idempotencyKey: null,
      }) as GeneratedList
  );
  const vanished = new Set(options.vanished ?? []);
  const events: Harness['events'] = [];
  const tripsChanged: Harness['tripsChanged'] = [];

  // A repository that honours the query the sweep sends, so "never touches
  // ARCHIVED" and "respects the batch cap" are facts about the rows that came
  // back rather than about the arguments that went in.
  const lists = {
    find: async (query: {
      where: {
        kind: BasketKind;
        status: GeneratedListStatus;
        generatedAt: FindOperator<Date>;
      };
      order: { generatedAt: 'ASC' | 'DESC' };
      take: number;
    }) => {
      const { kind, status } = query.where;
      const before = query.where.generatedAt.value as Date;
      return rows
        .filter(
          (row) =>
            row.kind === kind &&
            row.status === status &&
            row.generatedAt.getTime() < before.getTime()
        )
        .sort((a, b) => a.generatedAt.getTime() - b.generatedAt.getTime())
        .slice(0, query.take);
    },
    findOne: async ({
      where,
    }: {
      where: { id: string; ownerUserId: string };
    }) =>
      vanished.has(where.id)
        ? null
        : (rows.find(
            (row) =>
              row.id === where.id && row.ownerUserId === where.ownerUserId
          ) ?? null),
    save: async (row: GeneratedList) => {
      const index = rows.findIndex((existing) => existing.id === row.id);
      rows[index] = row;
      return row;
    },
    // The one raw read a finish makes: the lists the basket draws from, which
    // are the lists of whatever it is said to claim, each of them once.
    query: async (_sql: string, [basketId]: [string]) =>
      [
        ...new Set(
          (options.claiming?.[basketId] ?? []).map((ref) => ref.listId)
        ),
      ].map((listId) => ({ listId })),
  };

  const publisher = {
    emitTo: (
      event: RealtimeEvent,
      audience: {
        listId?: string;
        userIds?: readonly string[];
        basketIds?: readonly string[];
      },
      payload: unknown
    ) => {
      if (event === RealtimeEvent.ListTripsChanged) {
        tripsChanged.push(audience.listId);
        return;
      }
      events.push({
        event,
        userIds: audience.userIds ?? [],
        basketIds: audience.basketIds ?? [],
        payload: payload as BasketUpdatedEvent,
      });
    },
  } as unknown as CoreEventsPublisher;

  const claims = fakeLineClaims({}, (id) => options.claiming?.[id] ?? []);

  const tripRows = fakeBasketTripRows();
  const generated = new GeneratedListService(
    fakeUpdateDataSource(lists),
    lists as never,
    {} as unknown as ProfileService,
    claims.service,
    publisher,
    // The order, the members and the basket read: the sweep finishes a basket
    // and never composes, counts or shares one.
    {} as never,
    {} as never,
    { find: async () => [] } as never,
    tripRows.service,
    {} as never
  );

  const logger = { log: jest.fn(), error: jest.fn() };
  const configService = {
    getOrThrow: () => ({
      generatedList: {
        claimWindowMs: WINDOW_MS,
        sweep: {
          enabled: options.enabled ?? true,
          intervalMs: 1000,
          batchSize: options.batchSize ?? 100,
        },
      },
    }),
  };

  const service = new GeneratedListSweepService(
    lists as never,
    generated,
    logger as never,
    configService as never
  );

  return { service, rows, events, claims, tripsChanged, logger, tripRows };
}

const statusOf = (harness: Harness, id: string) =>
  harness.rows.find((row) => row.id === id)?.status;

const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('GeneratedListSweepService.sweep', () => {
  it('finishes every live basket past the window, settled or not, and leaves a fresh one', async () => {
    const harness = build({
      baskets: [
        // Never shopped at all, and closed anyway (section 4.1).
        { id: 'gl-draft', status: GeneratedListStatus.OPEN, ageMs: 61 * HOUR },
        // Shopped and walked away from with lines unsettled: the case section 1
        // is about, and the one a sweep of the tidy baskets would have missed.
        {
          id: 'gl-active',
          status: GeneratedListStatus.OPEN,
          ageMs: 3 * 24 * HOUR,
        },
        {
          id: 'gl-fresh',
          status: GeneratedListStatus.OPEN,
          ageMs: 59 * HOUR,
        },
      ],
    });

    await expect(harness.service.sweep()).resolves.toBe(2);

    expect(statusOf(harness, 'gl-draft')).toBe(GeneratedListStatus.FINISHED);
    expect(statusOf(harness, 'gl-active')).toBe(GeneratedListStatus.FINISHED);
    expect(statusOf(harness, 'gl-fresh')).toBe(GeneratedListStatus.OPEN);
  });

  it('writes through update, so the owner hears it and every zone room hears the release', async () => {
    const harness = build({
      baskets: [
        {
          id: 'gl-a',
          status: GeneratedListStatus.OPEN,
          ageMs: 4 * 24 * HOUR,
        },
        {
          id: 'gl-b',
          status: GeneratedListStatus.OPEN,
          ageMs: 5 * 24 * HOUR,
          ownerUserId: 'u-other',
        },
      ],
      claiming: {
        'gl-a': [
          { zoneId: 'z-flat', listId: 'l-flat', lineId: 'zl-1' },
          { zoneId: 'z-parents', listId: 'l-parents', lineId: 'zl-2' },
        ],
        'gl-b': [{ zoneId: 'z-flat', listId: 'l-flat', lineId: 'zl-3' }],
      },
    });

    await harness.service.sweep();

    // One `basket.updated` per basket, to its own owner **and** to its own room
    // (plan 0139, section 4): a swept basket tells the people still standing in
    // the shop, who used to hear nothing at all when their trip was finished
    // out from under them.
    expect(
      harness.events.map((entry) => ({
        event: entry.event,
        userIds: entry.userIds,
        basketIds: entry.basketIds,
        id: entry.payload.basketId,
        status: entry.payload.status,
      }))
    ).toEqual([
      {
        event: RealtimeEvent.BasketUpdated,
        userIds: ['u-other'],
        basketIds: ['gl-b'],
        id: 'gl-b',
        status: GeneratedListStatus.FINISHED,
      },
      {
        event: RealtimeEvent.BasketUpdated,
        userIds: [OWNER],
        basketIds: ['gl-a'],
        id: 'gl-a',
        status: GeneratedListStatus.FINISHED,
      },
    ]);
    // The release, one call per basket carrying every line it held (section
    // 4.5's "never a per line event"), and never a claim in the other direction.
    expect(harness.claims.calls).toEqual([
      { claimed: false, claimedByUserId: null, lineIds: ['zl-3'] },
      { claimed: false, claimedByUserId: null, lineIds: ['zl-1', 'zl-2'] },
    ]);
    // And each list a swept basket drew from reads its trips again (plan 0122,
    // section 6): the trip has just stopped being live. It costs the sweep
    // nothing of its own, because it finishes a basket through `update`.
    expect(harness.tripsChanged).toEqual(['l-flat', 'l-flat', 'l-parents']);
  });

  it('never touches ARCHIVED, and has nothing to add to COMPLETED', async () => {
    const harness = build({
      baskets: [
        {
          id: 'gl-archived',
          status: GeneratedListStatus.ARCHIVED,
          ageMs: 30 * 24 * HOUR,
        },
        {
          id: 'gl-done',
          status: GeneratedListStatus.FINISHED,
          ageMs: 30 * 24 * HOUR,
        },
      ],
    });

    await expect(harness.service.sweep()).resolves.toBe(0);

    // Archiving is a person hiding a basket (section 4.5), and rewriting it
    // would be rewriting their choice.
    expect(statusOf(harness, 'gl-archived')).toBe(GeneratedListStatus.ARCHIVED);
    expect(statusOf(harness, 'gl-done')).toBe(GeneratedListStatus.FINISHED);
    expect(harness.events).toEqual([]);
    expect(harness.claims.calls).toEqual([]);
    expect(harness.tripsChanged).toEqual([]);
    expect(harness.logger.log).not.toHaveBeenCalled();
  });

  it('caps a tick at the batch, oldest first, and the rest waits for the next one', async () => {
    const harness = build({
      batchSize: 2,
      baskets: [
        {
          id: 'gl-newest',
          status: GeneratedListStatus.OPEN,
          ageMs: 3 * 24 * HOUR,
        },
        {
          id: 'gl-oldest',
          status: GeneratedListStatus.OPEN,
          ageMs: 9 * 24 * HOUR,
        },
        {
          id: 'gl-middle',
          status: GeneratedListStatus.OPEN,
          ageMs: 6 * 24 * HOUR,
        },
      ],
    });

    await expect(harness.service.sweep()).resolves.toBe(2);
    expect(statusOf(harness, 'gl-oldest')).toBe(GeneratedListStatus.FINISHED);
    expect(statusOf(harness, 'gl-middle')).toBe(GeneratedListStatus.FINISHED);
    expect(statusOf(harness, 'gl-newest')).toBe(GeneratedListStatus.OPEN);

    await expect(harness.service.sweep()).resolves.toBe(1);
    expect(statusOf(harness, 'gl-newest')).toBe(GeneratedListStatus.FINISHED);

    await expect(harness.service.sweep()).resolves.toBe(0);
  });

  it('keeps going when a basket vanished between the query and the write', async () => {
    const harness = build({
      baskets: [
        {
          id: 'gl-gone',
          status: GeneratedListStatus.OPEN,
          ageMs: 4 * 24 * HOUR,
        },
        {
          id: 'gl-here',
          status: GeneratedListStatus.OPEN,
          ageMs: 3 * 24 * HOUR,
        },
      ],
      vanished: ['gl-gone'],
    });

    // The one that went is logged and skipped; the one that stayed is finished
    // on this tick rather than the next.
    await expect(harness.service.sweep()).resolves.toBe(1);
    expect(statusOf(harness, 'gl-here')).toBe(GeneratedListStatus.FINISHED);
    expect(harness.logger.error).toHaveBeenCalledTimes(1);
  });

  it('draws the cutoff from the claim window, so a live basket never outlives its claim', async () => {
    const harness = build({
      baskets: [
        // One minute inside the window: still claiming, so still live.
        {
          id: 'gl-inside',
          status: GeneratedListStatus.OPEN,
          ageMs: WINDOW_MS - 60_000,
        },
        // One minute past it: the claim has already expired, and this is the
        // sweep writing down what the read already believed (section 4.2).
        {
          id: 'gl-past',
          status: GeneratedListStatus.OPEN,
          ageMs: WINDOW_MS + 60_000,
        },
      ],
    });

    await expect(harness.service.sweep()).resolves.toBe(1);
    expect(statusOf(harness, 'gl-inside')).toBe(GeneratedListStatus.OPEN);
    expect(statusOf(harness, 'gl-past')).toBe(GeneratedListStatus.FINISHED);
  });
});

describe('GeneratedListSweepService lifecycle', () => {
  it('starts no timer when switched off, and clears the one it started on shutdown', () => {
    jest.useFakeTimers();

    const off = build({ baskets: [], enabled: false });
    off.service.onApplicationBootstrap();
    expect(jest.getTimerCount()).toBe(0);

    const on = build({ baskets: [] });
    on.service.onApplicationBootstrap();
    expect(jest.getTimerCount()).toBe(1);
    on.service.onApplicationShutdown();
    expect(jest.getTimerCount()).toBe(0);
  });
});
