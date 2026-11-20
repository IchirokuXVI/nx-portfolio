import { TestBed } from '@angular/core/testing';
import type { HarvestRun } from '@portfolio/luna-shopper-admin/models';
import { EarlierRunTotals } from './earlier-run-totals';
import { HARVEST_RUN_SEED } from './harvest-seed';
import { HARVEST_SERVICE, type RunQuery } from './harvest-service';

/**
 * The approximate total of a run that does not know its own (decision 86 of
 * the harvester round), read from the latest completed run of its preset, or
 * else of its chain and mode (owner decision 98b), as the harvester picks the
 * reference of a duration estimate.
 */

const seeded = (id: string) =>
  HARVEST_RUN_SEED.find((run) => run.id === id) as HarvestRun;

const ABORTED = seeded('run-deza-aborted');
const COMPLETED = seeded('run-deza-completed');

const PRESET = 'preset-deza-weekly';

/** A runs list that answers the runs given, filtered as the route filters. */
function listing(runs: readonly HarvestRun[]) {
  return jest.fn(async (query: RunQuery) => ({
    items: runs
      .filter(
        (run) =>
          (query.supermarketId === undefined ||
            run.supermarketId === query.supermarketId) &&
          (query.mode === undefined || run.mode === query.mode) &&
          (query.status === undefined || run.status === query.status) &&
          (query.presetId === undefined || run.presetId === query.presetId) &&
          (query.reverted === undefined ||
            query.reverted === (run.revertedAt !== null))
      )
      .slice(0, query.limit ?? 20),
    nextCursor: null,
  }));
}

function setUp(listRuns: jest.Mock) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: HARVEST_SERVICE, useValue: { listRuns } }],
  });
  return TestBed.inject(EarlierRunTotals);
}

describe('EarlierRunTotals', () => {
  it('gives what the latest completed run of the chain and mode processed', async () => {
    const totals = setUp(listing([ABORTED, COMPLETED]));

    await totals.resolve(ABORTED);

    expect(totals.of(ABORTED)).toBe(2361);
  });

  it('asks a run with no preset for its chain and mode, completed and standing', async () => {
    const listRuns = listing([COMPLETED]);
    const totals = setUp(listRuns);

    await totals.resolve({ ...ABORTED, presetId: null });

    expect(listRuns).toHaveBeenCalledTimes(1);
    expect(listRuns).toHaveBeenCalledWith({
      supermarketId: 'sm_deza',
      mode: 'CATALOG_DISCOVERY',
      status: 'COMPLETED',
      reverted: false,
      limit: 5,
    });
  });

  describe('a run of a preset', () => {
    const fromPreset = { ...ABORTED, presetId: PRESET };

    it('prefers the latest completed run of the same preset', async () => {
      const listRuns = listing([
        // Newer, same chain and mode, another preset or none.
        { ...COMPLETED, id: 'chain-newer', processed: 3000 },
        { ...COMPLETED, id: 'preset-older', presetId: PRESET, processed: 2100 },
      ]);
      const totals = setUp(listRuns);

      await totals.resolve(fromPreset);

      expect(totals.of(fromPreset)).toBe(2100);
      expect(listRuns).toHaveBeenCalledTimes(1);
      expect(listRuns).toHaveBeenCalledWith({
        presetId: PRESET,
        status: 'COMPLETED',
        reverted: false,
        limit: 5,
      });
    });

    it('falls back to the chain and mode when the preset has no completed run', async () => {
      const listRuns = listing([
        { ...COMPLETED, id: 'chain-only', processed: 3000 },
        {
          ...COMPLETED,
          id: 'preset-reverted',
          presetId: PRESET,
          revertedAt: '2026-09-01T00:00:00Z',
        },
      ]);
      const totals = setUp(listRuns);

      await totals.resolve(fromPreset);

      expect(totals.of(fromPreset)).toBe(3000);
      expect(listRuns).toHaveBeenCalledTimes(2);
      expect(listRuns).toHaveBeenLastCalledWith({
        supermarketId: 'sm_deza',
        mode: 'CATALOG_DISCOVERY',
        status: 'COMPLETED',
        reverted: false,
        limit: 5,
      });
    });

    /** The newest preset run gives nothing usable, an older one of it does. */
    it('reads past preset runs that give no usable total to an older one of the preset', async () => {
      const listRuns = listing([
        { ...COMPLETED, id: 'preset-empty', presetId: PRESET, processed: 0 },
        { ...COMPLETED, id: 'preset-short', presetId: PRESET, processed: 500 },
        { ...COMPLETED, id: 'preset-whole', presetId: PRESET, processed: 2300 },
        { ...COMPLETED, id: 'chain-newer', processed: 3000 },
      ]);
      const totals = setUp(listRuns);

      // 824 processed, so the run of 500 is smaller than the part and skipped.
      await totals.resolve(fromPreset);

      expect(totals.of(fromPreset)).toBe(2300);
      expect(listRuns).toHaveBeenCalledTimes(1);
    });

    it('reads past chain runs that give no usable total to an older one of the chain', async () => {
      const listRuns = listing([
        { ...COMPLETED, id: 'preset-short', presetId: PRESET, processed: 500 },
        { ...COMPLETED, id: 'chain-empty', processed: 0 },
        { ...COMPLETED, id: 'chain-short', processed: 600 },
        { ...COMPLETED, id: 'chain-whole', processed: 2500 },
      ]);
      const totals = setUp(listRuns);

      await totals.resolve(fromPreset);

      // The preset's one run is short, so the chain is read, and its newest
      // usable run is the one of 2500, not the preset's run of 500 it also lists.
      expect(totals.of(fromPreset)).toBe(2500);
      expect(listRuns).toHaveBeenCalledTimes(2);
    });

    it('asks a preset over every chain by its preset only', async () => {
      const everyChain = { ...fromPreset, supermarketId: null };
      const listRuns = listing([
        {
          ...COMPLETED,
          id: 'preset-run',
          presetId: PRESET,
          supermarketId: null,
        },
      ]);
      const totals = setUp(listRuns);

      await totals.resolve(everyChain);

      expect(totals.of(everyChain)).toBe(2361);
      expect(listRuns).toHaveBeenCalledTimes(1);
    });
  });

  /** Owner decision 111c: a completed run shows its count and reads nothing. */
  it('reads nothing for a completed run and holds nothing for it', async () => {
    const done = {
      ...COMPLETED,
      id: 'done-unsized',
      totalPlanned: null,
      processed: 2200,
    };
    const listRuns = listing([{ ...COMPLETED, id: 'before', processed: 2361 }]);
    const totals = setUp(listRuns);

    await totals.resolve(done);

    expect(listRuns).not.toHaveBeenCalled();
    expect(totals.of(done)).toBeNull();
  });

  /** A run that was running when it was asked for and has completed since. */
  it('stops giving the estimate once the run completed', async () => {
    const totals = setUp(listing([COMPLETED]));
    const running = { ...ABORTED, status: 'RUNNING' as const };

    await totals.resolve(running);
    expect(totals.of(running)).toBe(2361);

    expect(totals.of({ ...running, status: 'COMPLETED' })).toBeNull();
  });

  it('leaves the run itself out', async () => {
    // A listing that answers the run itself, whatever the filter says.
    const listRuns = jest.fn(async () => ({
      items: [
        { ...ABORTED, processed: 3000 },
        { ...COMPLETED, id: 'before', processed: 2361 },
      ],
      nextCursor: null,
    }));
    const totals = setUp(listRuns);

    await totals.resolve(ABORTED);

    expect(totals.of(ABORTED)).toBe(2361);
  });

  describe('reading again (owner decision 113b)', () => {
    it('reads again after reread, and keeps the old answer until the new one', async () => {
      let runs: readonly HarvestRun[] = [COMPLETED];
      const listRuns = jest.fn((query: RunQuery) => listing(runs)(query));
      const totals = setUp(listRuns);
      await totals.resolve(ABORTED);
      expect(totals.of(ABORTED)).toBe(2361);

      // The reference run is reverted, and the run's page opens again.
      runs = [{ ...COMPLETED, revertedAt: '2026-09-01T00:00:00Z' }];
      totals.reread(ABORTED.id);
      const lookup = totals.resolve(ABORTED);
      expect(totals.of(ABORTED)).toBe(2361);
      await lookup;

      expect(listRuns).toHaveBeenCalledTimes(2);
      expect(totals.of(ABORTED)).toBeNull();
    });

    it('does not read again without a reread', async () => {
      const listRuns = listing([COMPLETED]);
      const totals = setUp(listRuns);

      await totals.resolve(ABORTED);
      await totals.resolve({ ...ABORTED, processed: 900 });
      await totals.resolve({ ...ABORTED, processed: 950 });

      expect(listRuns).toHaveBeenCalledTimes(1);
    });

    it('shares a lookup on its way rather than starting a second', async () => {
      const listRuns = listing([COMPLETED]);
      const totals = setUp(listRuns);

      const first = totals.resolve(ABORTED);
      totals.reread(ABORTED.id);
      const second = totals.resolve(ABORTED);
      await Promise.all([first, second]);

      expect(listRuns).toHaveBeenCalledTimes(1);
      expect(totals.of(ABORTED)).toBe(2361);
    });

    it('keeps the one retry on a reread, and drops the old answer when both fail', async () => {
      const answer = listing([COMPLETED]);
      const listRuns = jest
        .fn()
        .mockImplementationOnce(answer)
        .mockRejectedValue(new Error('down'));
      const totals = setUp(listRuns);
      await totals.resolve(ABORTED);
      expect(totals.of(ABORTED)).toBe(2361);

      totals.reread(ABORTED.id);
      await totals.resolve(ABORTED);

      expect(listRuns).toHaveBeenCalledTimes(3);
      expect(totals.of(ABORTED)).toBeNull();
    });
  });

  describe('clear', () => {
    it('forgets every answer, and the next ask reads again', async () => {
      const listRuns = listing([COMPLETED]);
      const totals = setUp(listRuns);
      await totals.resolve(ABORTED);

      totals.clear();
      expect(totals.of(ABORTED)).toBeNull();

      await totals.resolve(ABORTED);
      expect(listRuns).toHaveBeenCalledTimes(2);
      expect(totals.of(ABORTED)).toBe(2361);
    });

    it('drops an answer that was on its way', async () => {
      const totals = setUp(listing([COMPLETED]));

      const lookup = totals.resolve(ABORTED);
      totals.clear();
      await lookup;

      expect(totals.of(ABORTED)).toBeNull();
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

  it('reads nothing for a run that knows its total, processed nothing, or has nothing to compare', async () => {
    const listRuns = listing([COMPLETED]);
    const totals = setUp(listRuns);

    await totals.resolve({ ...ABORTED, totalPlanned: 2400 });
    await totals.resolve({ ...ABORTED, id: 'zero', processed: 0 });
    await totals.resolve({ ...ABORTED, supermarketId: null, presetId: null });

    expect(listRuns).not.toHaveBeenCalled();
    expect(totals.of({ ...ABORTED, totalPlanned: 2400 })).toBeNull();
  });

  /** One retry, at once: a passing blip does not lose the estimate. */
  it('tries a failed read once more, and holds what the second try gives', async () => {
    const answer = listing([COMPLETED]);
    const listRuns = jest
      .fn()
      .mockRejectedValueOnce(new Error('blip'))
      .mockImplementation(answer);
    const totals = setUp(listRuns);

    await totals.resolve(ABORTED);

    expect(listRuns).toHaveBeenCalledTimes(2);
    expect(totals.of(ABORTED)).toBe(2361);
  });

  /**
   * Twice down is silence: no loop, no timer, and the page reads as before. A
   * poll does not ask again; only the run's page opening again does.
   */
  it('gives up silently after the second failure and does not ask again on a poll', async () => {
    const listRuns = jest.fn(async () => {
      throw new Error('down');
    });
    const totals = setUp(listRuns);

    await expect(totals.resolve(ABORTED)).resolves.toBeUndefined();
    await totals.resolve({ ...ABORTED, processed: 900 });

    expect(listRuns).toHaveBeenCalledTimes(2);
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

  /** The running DEZA walk names a preset with no completed run of its own. */
  it('falls back from the seeded DEZA preset to the chain in the memory back end', async () => {
    TestBed.resetTestingModule();
    const totals = TestBed.inject(EarlierRunTotals);
    const running = seeded('run-deza-running');

    await totals.resolve(running);

    expect(running.presetId).not.toBeNull();
    expect(totals.of(running)).toBe(2361);
  });
});
