import {
  GeneratedListStatus,
  RealtimeEvent,
  type GeneratedListView,
} from '@portfolio/luna-shopper/contracts';
import type { DataSource, FindOperator } from 'typeorm';
import type { GeneratedList } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { ProfileService } from '../profiles/profile.service';
import { GeneratedListSweepService } from './generated-list-sweep.service';
import { GeneratedListService } from './generated-list.service';
import type { ZoneLineClaimRef } from './line-claim.sql';
import { fakeLineClaims, type FakeLineClaims } from './line-claims.fake';

/**
 * The sweep (plan 0059, section 4).
 *
 * The service under test is wired to a **real** {@link GeneratedListService}
 * rather than a mock of it, because section 4.4's whole claim is that the sweep
 * goes through `update`: the same save, the same `GeneratedListUpdated` to the
 * owner, the same release announced to every zone room. A mock would assert that
 * a call was made and would keep passing on the day somebody replaced it with a
 * bulk `UPDATE` that a household never hears about, which is the failure the
 * plan is written against. So the exit criterion is met the way it is stated:
 * the events are asserted, not only the rows.
 *
 * The harness has no zone line repository, no settlement repository and a line
 * repository that throws on any write, so a sweep that settled anything or
 * touched a zone list (section 4.5) would fail here rather than pass quietly.
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
}

interface Harness {
  service: GeneratedListSweepService;
  rows: GeneratedList[];
  events: {
    event: RealtimeEvent;
    userIds: readonly string[];
    view: GeneratedListView;
  }[];
  claims: FakeLineClaims;
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
        name: null,
        status: seed.status,
        generatedAt: new Date(NOW - seed.ageMs),
        sourceSnapshot: { profileId: null, sources: [] },
        defaultTargetListId: null,
        idempotencyKey: null,
      }) as GeneratedList
  );
  const vanished = new Set(options.vanished ?? []);
  const events: Harness['events'] = [];

  // A repository that honours the query the sweep sends, so "never touches
  // ARCHIVED" and "respects the batch cap" are facts about the rows that came
  // back rather than about the arguments that went in.
  const lists = {
    find: async (query: {
      where: {
        status: FindOperator<GeneratedListStatus>;
        generatedAt: FindOperator<Date>;
      };
      order: { generatedAt: 'ASC' | 'DESC' };
      take: number;
    }) => {
      const statuses = query.where.status.value as GeneratedListStatus[];
      const before = query.where.generatedAt.value as Date;
      return rows
        .filter(
          (row) =>
            statuses.includes(row.status) &&
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
  };

  const lines = {
    find: async () => [],
    save: () => {
      throw new Error('the sweep wrote a basket line');
    },
  };

  const publisher = {
    emitToUsers: (
      event: RealtimeEvent,
      userIds: readonly string[],
      view: GeneratedListView
    ) => {
      events.push({ event, userIds, view });
    },
  } as unknown as CoreEventsPublisher;

  const claims = fakeLineClaims({}, (id) => options.claiming?.[id] ?? []);

  const generated = new GeneratedListService(
    {} as DataSource,
    lists as never,
    lines as never,
    {} as never,
    {} as never,
    {} as never,
    {} as unknown as ProfileService,
    claims.service,
    publisher
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

  return { service, rows, events, claims, logger };
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
        { id: 'gl-draft', status: GeneratedListStatus.DRAFT, ageMs: 61 * HOUR },
        // Shopped and walked away from with lines unsettled: the case section 1
        // is about, and the one a sweep of the tidy baskets would have missed.
        {
          id: 'gl-active',
          status: GeneratedListStatus.ACTIVE,
          ageMs: 3 * 24 * HOUR,
        },
        {
          id: 'gl-fresh',
          status: GeneratedListStatus.ACTIVE,
          ageMs: 59 * HOUR,
        },
      ],
    });

    await expect(harness.service.sweep()).resolves.toBe(2);

    expect(statusOf(harness, 'gl-draft')).toBe(GeneratedListStatus.COMPLETED);
    expect(statusOf(harness, 'gl-active')).toBe(GeneratedListStatus.COMPLETED);
    expect(statusOf(harness, 'gl-fresh')).toBe(GeneratedListStatus.ACTIVE);
  });

  it('writes through update, so the owner hears it and every zone room hears the release', async () => {
    const harness = build({
      baskets: [
        {
          id: 'gl-a',
          status: GeneratedListStatus.ACTIVE,
          ageMs: 4 * 24 * HOUR,
        },
        {
          id: 'gl-b',
          status: GeneratedListStatus.DRAFT,
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

    // One `GeneratedListUpdated` per basket, to its own owner, carrying the
    // finished view: what a client holding the history screen redraws from.
    expect(
      harness.events.map((entry) => ({
        event: entry.event,
        userIds: entry.userIds,
        id: entry.view.id,
        status: entry.view.status,
      }))
    ).toEqual([
      {
        event: RealtimeEvent.GeneratedListUpdated,
        userIds: ['u-other'],
        id: 'gl-b',
        status: GeneratedListStatus.COMPLETED,
      },
      {
        event: RealtimeEvent.GeneratedListUpdated,
        userIds: [OWNER],
        id: 'gl-a',
        status: GeneratedListStatus.COMPLETED,
      },
    ]);
    // The release, one call per basket carrying every line it held (section
    // 4.5's "never a per line event"), and never a claim in the other direction.
    expect(harness.claims.calls).toEqual([
      { claimed: false, claimedByUserId: null, lineIds: ['zl-3'] },
      { claimed: false, claimedByUserId: null, lineIds: ['zl-1', 'zl-2'] },
    ]);
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
          status: GeneratedListStatus.COMPLETED,
          ageMs: 30 * 24 * HOUR,
        },
      ],
    });

    await expect(harness.service.sweep()).resolves.toBe(0);

    // Archiving is a person hiding a basket (section 4.5), and rewriting it
    // would be rewriting their choice.
    expect(statusOf(harness, 'gl-archived')).toBe(GeneratedListStatus.ARCHIVED);
    expect(statusOf(harness, 'gl-done')).toBe(GeneratedListStatus.COMPLETED);
    expect(harness.events).toEqual([]);
    expect(harness.claims.calls).toEqual([]);
    expect(harness.logger.log).not.toHaveBeenCalled();
  });

  it('caps a tick at the batch, oldest first, and the rest waits for the next one', async () => {
    const harness = build({
      batchSize: 2,
      baskets: [
        {
          id: 'gl-newest',
          status: GeneratedListStatus.ACTIVE,
          ageMs: 3 * 24 * HOUR,
        },
        {
          id: 'gl-oldest',
          status: GeneratedListStatus.ACTIVE,
          ageMs: 9 * 24 * HOUR,
        },
        {
          id: 'gl-middle',
          status: GeneratedListStatus.DRAFT,
          ageMs: 6 * 24 * HOUR,
        },
      ],
    });

    await expect(harness.service.sweep()).resolves.toBe(2);
    expect(statusOf(harness, 'gl-oldest')).toBe(GeneratedListStatus.COMPLETED);
    expect(statusOf(harness, 'gl-middle')).toBe(GeneratedListStatus.COMPLETED);
    expect(statusOf(harness, 'gl-newest')).toBe(GeneratedListStatus.ACTIVE);

    await expect(harness.service.sweep()).resolves.toBe(1);
    expect(statusOf(harness, 'gl-newest')).toBe(GeneratedListStatus.COMPLETED);

    await expect(harness.service.sweep()).resolves.toBe(0);
  });

  it('keeps going when a basket vanished between the query and the write', async () => {
    const harness = build({
      baskets: [
        {
          id: 'gl-gone',
          status: GeneratedListStatus.ACTIVE,
          ageMs: 4 * 24 * HOUR,
        },
        {
          id: 'gl-here',
          status: GeneratedListStatus.ACTIVE,
          ageMs: 3 * 24 * HOUR,
        },
      ],
      vanished: ['gl-gone'],
    });

    // The one that went is logged and skipped; the one that stayed is finished
    // on this tick rather than the next.
    await expect(harness.service.sweep()).resolves.toBe(1);
    expect(statusOf(harness, 'gl-here')).toBe(GeneratedListStatus.COMPLETED);
    expect(harness.logger.error).toHaveBeenCalledTimes(1);
  });

  it('draws the cutoff from the claim window, so a live basket never outlives its claim', async () => {
    const harness = build({
      baskets: [
        // One minute inside the window: still claiming, so still live.
        {
          id: 'gl-inside',
          status: GeneratedListStatus.ACTIVE,
          ageMs: WINDOW_MS - 60_000,
        },
        // One minute past it: the claim has already expired, and this is the
        // sweep writing down what the read already believed (section 4.2).
        {
          id: 'gl-past',
          status: GeneratedListStatus.ACTIVE,
          ageMs: WINDOW_MS + 60_000,
        },
      ],
    });

    await expect(harness.service.sweep()).resolves.toBe(1);
    expect(statusOf(harness, 'gl-inside')).toBe(GeneratedListStatus.ACTIVE);
    expect(statusOf(harness, 'gl-past')).toBe(GeneratedListStatus.COMPLETED);
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
