import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import {
  DASHBOARD_SERVICE,
  DashboardStore,
  HARVEST_RUN_SEED,
  type DashboardDocument,
} from '@portfolio/luna-shopper-admin/data-access';
import type { HarvestRun } from '@portfolio/luna-shopper-admin/models';
import { HarvestStatus } from './harvest-status';

/**
 * What the harvester has waiting and what it is doing, for the rail and for
 * every Harvest tab (admin plan 0044, targets 2 and 3).
 *
 * One read is behind the count on the rail, the count on Review, the counts
 * on the queue switch and the run line in the header. These cases are that
 * read, turned into those four answers.
 */

const RUNNING = HARVEST_RUN_SEED.find(
  (run) => run.status === 'RUNNING'
) as HarvestRun;

function harvestBlock(over: Record<string, unknown> = {}) {
  return {
    runs: { byStatus: [], inWindow: 0 },
    running: null,
    recent: [],
    queues: {
      entries: [{ supermarketId: 'chain-a', candidate: 90, unresolved: 6 }],
      places: 14,
      shops: [{ supermarketId: 'chain-a', unmapped: 31 }],
      brands: 7,
    },
    sources: { total: 2, enabled: 0 },
    ...over,
  };
}

function document_(harvest: unknown): DashboardDocument {
  return {
    measuredAt: '2026-09-03T10:00:00.000Z',
    harvest,
  } as unknown as DashboardDocument;
}

/** A page whose visibility never changes, so no listener ever fires. */
const page = {
  visibilityState: 'visible',
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};

/** Let every pending microtask settle, without a real clock. */
const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
};

function build(answers: readonly unknown[]) {
  let calls = 0;
  const service = {
    read: async (): Promise<DashboardDocument> => {
      const answer = answers[Math.min(calls, answers.length - 1)];
      calls += 1;
      if (answer instanceof Error) {
        throw answer;
      }
      return document_(answer);
    },
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: DASHBOARD_SERVICE, useValue: service },
      { provide: DOCUMENT, useValue: page },
    ],
  });

  return {
    status: TestBed.inject(HarvestStatus),
    store: TestBed.inject(DashboardStore),
    reads: () => calls,
  };
}

describe('HarvestStatus', () => {
  beforeEach(() => jest.useFakeTimers());

  afterEach(() => {
    TestBed.inject(DashboardStore).stop();
    jest.useRealTimers();
  });

  /** The frame builds it, and the count on the rail is on every screen. */
  it('reads the dashboard from the moment it is built', async () => {
    const { reads } = build([harvestBlock()]);
    await settle();

    expect(reads()).toBe(1);
  });

  it('counts what waits in the four queues', async () => {
    const { status } = build([harvestBlock()]);
    await settle();

    expect(status.waiting()).toMatchObject({
      products: 96,
      shops: 31,
      places: 14,
      brands: 7,
      total: 148,
    });
  });

  describe('the count behind each tab', () => {
    it('is the total on Review', async () => {
      const { status } = build([harvestBlock()]);
      await settle();

      expect(status.countAt('/harvest/review')).toBe(148);
    });

    it('is nothing on Runs and on Setup', async () => {
      const { status } = build([harvestBlock()]);
      await settle();

      expect(status.countAt('/harvest/runs')).toBeNull();
      expect(status.countAt('/harvest/setup')).toBeNull();
    });

    /** Nothing is drawn where nothing is known, and a zero would be a claim. */
    it('is nothing before the first read answers', () => {
      const { status } = build([harvestBlock()]);

      expect(status.waiting()).toBeNull();
      expect(status.countAt('/harvest/review')).toBeNull();
    });

    it('is nothing when the harvester did not answer the read', async () => {
      const { status } = build([null]);
      await settle();

      expect(status.waiting()).toBeNull();
      expect(status.countAt('/harvest/review')).toBeNull();
    });
  });

  describe('the run in progress', () => {
    it('is the run the dashboard names as in flight', async () => {
      const { status } = build([harvestBlock({ running: RUNNING })]);
      await settle();

      expect(status.running()?.id).toBe(RUNNING.id);
    });

    it('is nothing when no run is in flight', async () => {
      const { status } = build([harvestBlock()]);
      await settle();

      expect(status.running()).toBeNull();
    });

    /**
     * A run that finished between the query and the answer. The header would
     * otherwise say "Running" over a run that is over.
     */
    it.each(['COMPLETED', 'FAILED', 'ABORTED', 'STALE'] as const)(
      'is nothing for a run that ended as %s',
      async (ended) => {
        const { status } = build([
          harvestBlock({ running: { ...RUNNING, status: ended } }),
        ]);
        await settle();

        expect(status.running()).toBeNull();
      }
    );
  });

  describe('whether the harvester answered', () => {
    it('is not known before any read', () => {
      const { status } = build([harvestBlock()]);

      expect(status.answered()).toBeNull();
    });

    it('is yes once its block arrived', async () => {
      const { status } = build([harvestBlock()]);
      await settle();

      expect(status.answered()).toBe(true);
    });

    it('is no when the read came back without its block', async () => {
      const { status } = build([null]);
      await settle();

      expect(status.answered()).toBe(false);
    });
  });

  /**
   * A decision takes a row out of a queue, and the count on the rail is that
   * queue's length. Waiting a minute for the next read would leave the rail
   * saying more waits than the queue shows.
   */
  it('reads again when told a decision went through', async () => {
    const { status, reads } = build([
      harvestBlock(),
      harvestBlock({
        queues: { entries: [], places: 13, shops: [], brands: 0 },
      }),
    ]);
    await settle();
    expect(status.countAt('/harvest/review')).toBe(148);

    status.refresh();
    await settle();

    expect(reads()).toBe(2);
    expect(status.countAt('/harvest/review')).toBe(13);
  });

  /** The header follows a run at the faster cadence while a tab is open. */
  it('passes the faster cadence on to the store, and gives it back', async () => {
    const { status, store } = build([harvestBlock({ running: RUNNING })]);
    await settle();
    const slow = store.interval();

    status.followRuns(true);
    expect(store.interval()).toBeLessThan(slow);

    status.followRuns(false);
    expect(store.interval()).toBe(slow);
  });
});
