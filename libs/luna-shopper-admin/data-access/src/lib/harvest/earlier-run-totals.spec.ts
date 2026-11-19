import { TestBed } from '@angular/core/testing';
import type { HarvestRun } from '@portfolio/luna-shopper-admin/models';
import { EarlierRunTotals } from './earlier-run-totals';
import { HARVEST_RUN_SEED } from './harvest-seed';
import { HARVEST_SERVICE } from './harvest-service';

/**
 * The approximate total of a run that does not know its own (decision 86 of
 * the harvester round), read from the last completed run of its chain and mode.
 */

const seeded = (id: string) =>
  HARVEST_RUN_SEED.find((run) => run.id === id) as HarvestRun;

const ABORTED = seeded('run-deza-aborted');
const COMPLETED = seeded('run-deza-completed');

const drain = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

/** A runs list that answers the runs given, filtered as the route filters. */
function listing(runs: readonly HarvestRun[]) {
  return jest.fn(
    async (query: {
      supermarketId?: string;
      mode?: string;
      status?: string;
      reverted?: boolean;
      limit?: number;
    }) => ({
      items: runs
        .filter(
          (run) =>
            (query.supermarketId === undefined ||
              run.supermarketId === query.supermarketId) &&
            (query.mode === undefined || run.mode === query.mode) &&
            (query.status === undefined || run.status === query.status) &&
            (query.reverted === undefined ||
              query.reverted === (run.revertedAt !== null))
        )
        .slice(0, query.limit ?? 20),
      nextCursor: null,
    })
  );
}

function setUp(listRuns: jest.Mock) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: HARVEST_SERVICE, useValue: { listRuns } }],
  });
  return TestBed.inject(EarlierRunTotals);
}

describe('EarlierRunTotals', () => {
  it('gives what the last completed run of the chain and mode processed', async () => {
    const totals = setUp(listing([ABORTED, COMPLETED]));

    await totals.resolve(ABORTED);

    expect(totals.of(ABORTED)).toBe(2361);
  });

  it('asks the runs list for one completed run that stands', async () => {
    const listRuns = listing([COMPLETED]);
    const totals = setUp(listRuns);

    await totals.resolve(ABORTED);

    expect(listRuns).toHaveBeenCalledWith({
      supermarketId: 'sm_deza',
      mode: 'CATALOG_DISCOVERY',
      status: 'COMPLETED',
      reverted: false,
      limit: 1,
    });
  });

  it('reads once for each run, however often it is asked', async () => {
    const listRuns = listing([COMPLETED]);
    const totals = setUp(listRuns);

    await Promise.all([totals.resolve(ABORTED), totals.resolve(ABORTED)]);
    // A poll hands over a new object for the same run.
    await totals.resolve({ ...ABORTED, processed: 900 });

    expect(listRuns).toHaveBeenCalledTimes(1);
  });

  it('gives nothing when no earlier run completed', async () => {
    const totals = setUp(listing([ABORTED]));

    await totals.resolve(ABORTED);

    expect(totals.of(ABORTED)).toBeNull();
  });

  it('ignores a reverted or failed earlier run', async () => {
    const totals = setUp(
      listing([
        { ...COMPLETED, id: 'reverted', revertedAt: '2026-09-01T00:00:00Z' },
        { ...COMPLETED, id: 'failed', status: 'FAILED' },
      ])
    );

    await totals.resolve(ABORTED);

    expect(totals.of(ABORTED)).toBeNull();
  });

  it('reads nothing for a run that knows its total or has completed', async () => {
    const listRuns = listing([COMPLETED]);
    const totals = setUp(listRuns);

    await totals.resolve({ ...ABORTED, totalPlanned: 2400 });
    await totals.resolve(COMPLETED);
    await totals.resolve({ ...ABORTED, supermarketId: null });

    expect(listRuns).not.toHaveBeenCalled();
    expect(totals.of({ ...ABORTED, totalPlanned: 2400 })).toBeNull();
  });

  it('keeps the unknown form when the read fails', async () => {
    const totals = setUp(
      jest.fn(async () => {
        throw new Error('down');
      })
    );

    await totals.resolve(ABORTED);
    await drain();

    expect(totals.of(ABORTED)).toBeNull();
  });

  /** The memory back end holds the case: a stopped DEZA walk and a whole one. */
  it('finds the seeded DEZA walk through the memory back end', async () => {
    TestBed.resetTestingModule();
    const totals = TestBed.inject(EarlierRunTotals);

    await totals.resolve(ABORTED);

    expect(ABORTED.totalPlanned).toBeNull();
    expect(totals.of(ABORTED)).toBe(2361);
  });
});
