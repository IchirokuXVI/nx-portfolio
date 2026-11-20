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

const ABORTED = seeded('run-eljamon-aborted');
const COMPLETED = seeded('run-eljamon-completed');

const PRESET = 'preset-eljamon-weekly';

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

    expect(totals.of(ABORTED)).toBe(3402);
  });

  it('asks a run with no preset for its chain and mode, completed and standing', async () => {
    const listRuns = listing([COMPLETED]);
    const totals = setUp(listRuns);

    await totals.resolve({ ...ABORTED, presetId: null });

    expect(listRuns).toHaveBeenCalledTimes(1);
    expect(listRuns).toHaveBeenCalledWith({
      supermarketId: 'sm_eljamon',
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
        supermarketId: 'sm_eljamon',
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

      expect(totals.of(everyChain)).toBe(3402);
      expect(listRuns).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Owner decision 112b: the chain and mode stand in for a whole walk only,
   * and only from a whole walk. A preset's runs share one request, so the
   * preset stays.
   */
  describe('a narrowed request', () => {
    const POSTAL_INPUT = {
      mode: 'STORE_DISCOVERY' as const,
      postalCodes: ['15001', '15002'],
    };
    const postal: HarvestRun = {
      ...ABORTED,
      id: 'postal-going',
      mode: 'STORE_DISCOVERY',
      status: 'RUNNING',
      presetId: null,
      processed: 14,
      input: POSTAL_INPUT,
    };
    const wholeDiscovery: HarvestRun = {
      ...COMPLETED,
      id: 'whole-discovery',
      mode: 'STORE_DISCOVERY',
      processed: 2361,
      input: { mode: 'STORE_DISCOVERY', postalCodes: [] },
    };

    it('reads nothing for a narrowed run with no preset', async () => {
      const listRuns = listing([wholeDiscovery]);
      const totals = setUp(listRuns);

      await totals.resolve(postal);

      expect(listRuns).not.toHaveBeenCalled();
      expect(totals.of(postal)).toBeNull();
    });

    it('reads nothing by chain for a run whose request is unknown', async () => {
      const listRuns = listing([COMPLETED]);
      const totals = setUp(listRuns);

      await totals.resolve({ ...ABORTED, presetId: null, input: null });
      await totals.resolve({
        ...ABORTED,
        id: 'absent',
        presetId: null,
        input: undefined,
      });

      expect(listRuns).not.toHaveBeenCalled();
    });

    it('reads its preset, and does not fall back to the chain', async () => {
      const fromPreset = { ...postal, presetId: PRESET };
      const listRuns = listing([wholeDiscovery]);
      const totals = setUp(listRuns);

      await totals.resolve(fromPreset);

      expect(listRuns).toHaveBeenCalledTimes(1);
      expect(listRuns).toHaveBeenCalledWith(
        expect.objectContaining({ presetId: PRESET })
      );
      expect(totals.of(fromPreset)).toBeNull();
    });

    it('still takes its preset run, narrowed as it is', async () => {
      const fromPreset = { ...postal, presetId: PRESET };
      const totals = setUp(
        listing([
          {
            ...wholeDiscovery,
            id: 'preset-run',
            presetId: PRESET,
            processed: 40,
            input: POSTAL_INPUT,
          },
        ])
      );

      await totals.resolve(fromPreset);

      expect(totals.of(fromPreset)).toBe(40);
    });

    it('passes over a narrowed or unknown earlier run of the chain for a whole one', async () => {
      const totals = setUp(
        listing([
          {
            ...COMPLETED,
            id: 'scopes',
            processed: 900,
            input: { mode: 'CATALOG_DISCOVERY', priceScopeIds: ['s1'] },
          },
          { ...COMPLETED, id: 'unknown', processed: 3000, input: null },
          { ...COMPLETED, id: 'whole', processed: 2500 },
        ])
      );

      await totals.resolve(ABORTED);

      expect(totals.of(ABORTED)).toBe(2500);
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
    const listRuns = listing([{ ...COMPLETED, id: 'before', processed: 3402 }]);
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
    expect(totals.of(running)).toBe(3402);

    expect(totals.of({ ...running, status: 'COMPLETED' })).toBeNull();
  });

  it('leaves the run itself out', async () => {
    // A listing that answers the run itself, whatever the filter says.
    const listRuns = jest.fn(async () => ({
      items: [
        { ...ABORTED, processed: 3000 },
        { ...COMPLETED, id: 'before', processed: 3402 },
      ],
      nextCursor: null,
    }));
    const totals = setUp(listRuns);

    await totals.resolve(ABORTED);

    expect(totals.of(ABORTED)).toBe(3402);
  });

  describe('reading again (owner decision 113b)', () => {
    it('reads again after reread, and keeps the old answer until the new one', async () => {
      let runs: readonly HarvestRun[] = [COMPLETED];
      const listRuns = jest.fn((query: RunQuery) => listing(runs)(query));
      const totals = setUp(listRuns);
      await totals.resolve(ABORTED);
      expect(totals.of(ABORTED)).toBe(3402);

      // The reference run is reverted, and the run's page opens again.
      runs = [{ ...COMPLETED, revertedAt: '2026-09-01T00:00:00Z' }];
      totals.reread(ABORTED.id);
      const lookup = totals.resolve(ABORTED);
      expect(totals.of(ABORTED)).toBe(3402);
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
      expect(totals.of(ABORTED)).toBe(3402);
    });

    /** Owner decision 121b: a failed reread does not clear the number shown. */
    it('keeps the one retry on a reread, and keeps the old answer when both fail', async () => {
      const answer = listing([COMPLETED]);
      const listRuns = jest
        .fn()
        .mockImplementationOnce(answer)
        .mockRejectedValue(new Error('down'));
      const totals = setUp(listRuns);
      await totals.resolve(ABORTED);
      expect(totals.of(ABORTED)).toBe(3402);

      totals.reread(ABORTED.id);
      await totals.resolve(ABORTED);

      expect(listRuns).toHaveBeenCalledTimes(3);
      expect(totals.of(ABORTED)).toBe(3402);
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
      expect(totals.of(ABORTED)).toBe(3402);
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
    expect(totals.of(ABORTED)).toBe(3402);
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

  /** The memory back end holds the case: a stopped El Jamón walk and a whole one. */
  it('finds the seeded El Jamón walk through the memory back end', async () => {
    TestBed.resetTestingModule();
    const totals = TestBed.inject(EarlierRunTotals);

    await totals.resolve(ABORTED);

    expect(ABORTED.totalPlanned).toBeNull();
    expect(totals.of(ABORTED)).toBe(3402);
  });

  it('gives the seeded running El Jamón walk its estimate in the memory back end', async () => {
    TestBed.resetTestingModule();
    const totals = TestBed.inject(EarlierRunTotals);
    const running = seeded('run-eljamon-running');

    await totals.resolve(running);

    expect(totals.of(running)).toBe(3402);
  });

  /**
   * Owner decision 127b: no estimate for a run whose adapter's walk totals
   * cannot be compared, from its preset or from its chain, and no read for it.
   */
  describe('a run whose adapter cannot compare its walk totals', () => {
    it.each([
      ['deza-web', PRESET],
      ['deza-web', null],
      [null, PRESET],
      [null, null],
      [undefined, null],
      ['not-an-adapter', null],
    ])(
      'reads nothing for adapter %s and preset %s',
      async (adapter, preset) => {
        const listRuns = listing([
          { ...COMPLETED, id: 'preset-run', presetId: PRESET },
          { ...COMPLETED, id: 'chain-run' },
        ]);
        const totals = setUp(listRuns);
        const asked = {
          ...ABORTED,
          presetId: preset,
          adapterKey: adapter as HarvestRun['adapterKey'],
        };

        await totals.resolve(asked);

        expect(listRuns).not.toHaveBeenCalled();
        expect(totals.of(asked)).toBeNull();
      }
    );

    it('reads nothing for the seeded DEZA walks in the memory back end', async () => {
      TestBed.resetTestingModule();
      const totals = TestBed.inject(EarlierRunTotals);
      const running = seeded('run-deza-running');
      const aborted = seeded('run-deza-aborted');

      await totals.resolve(running);
      await totals.resolve(aborted);

      // A completed DEZA walk of the same config processed 2,361.
      expect(seeded('run-deza-completed').configFingerprint).toBe(
        running.configFingerprint
      );
      expect(totals.of(running)).toBeNull();
      expect(totals.of(aborted)).toBeNull();
    });
  });

  /**
   * Owner decision 130b: an earlier run is a reference only when it walked
   * under the same configuration, on the preset read and the chain read alike.
   */
  describe('the configuration a run walked under', () => {
    it('passes over a preset run of another config to an older one of the same', async () => {
      const fromPreset = { ...ABORTED, presetId: PRESET };
      const listRuns = listing([
        {
          ...COMPLETED,
          id: 'preset-other',
          presetId: PRESET,
          processed: 3000,
          configFingerprint: 'another',
        },
        { ...COMPLETED, id: 'preset-same', presetId: PRESET, processed: 2100 },
      ]);
      const totals = setUp(listRuns);

      await totals.resolve(fromPreset);

      expect(totals.of(fromPreset)).toBe(2100);
      expect(listRuns).toHaveBeenCalledTimes(1);
    });

    it('falls back to the chain when no preset run shares the config', async () => {
      const fromPreset = { ...ABORTED, presetId: PRESET };
      const listRuns = listing([
        {
          ...COMPLETED,
          id: 'preset-other',
          presetId: PRESET,
          configFingerprint: 'another',
        },
        { ...COMPLETED, id: 'chain-same', processed: 2500 },
      ]);
      const totals = setUp(listRuns);

      await totals.resolve(fromPreset);

      expect(totals.of(fromPreset)).toBe(2500);
      expect(listRuns).toHaveBeenCalledTimes(2);
    });

    it('passes over chain runs of another config, or of none, like narrowed ones', async () => {
      const totals = setUp(
        listing([
          {
            ...COMPLETED,
            id: 'other',
            processed: 3000,
            configFingerprint: 'x',
          },
          { ...COMPLETED, id: 'before-column', configFingerprint: null },
          { ...COMPLETED, id: 'absent', configFingerprint: undefined },
          { ...COMPLETED, id: 'same', processed: 2500 },
        ])
      );

      await totals.resolve(ABORTED);

      expect(totals.of(ABORTED)).toBe(2500);
    });

    it('gives nothing when the only earlier run walked under another config', async () => {
      const totals = setUp(
        listing([{ ...COMPLETED, configFingerprint: 'another' }])
      );

      await totals.resolve(ABORTED);

      expect(totals.of(ABORTED)).toBeNull();
    });

    it('reads nothing for a run that carries no fingerprint', async () => {
      const listRuns = listing([{ ...COMPLETED, configFingerprint: null }]);
      const totals = setUp(listRuns);

      await totals.resolve({ ...ABORTED, configFingerprint: null });
      await totals.resolve({
        ...ABORTED,
        id: 'preset-unprinted',
        presetId: PRESET,
        configFingerprint: undefined,
      });

      expect(listRuns).not.toHaveBeenCalled();
    });

    it('gives the seeded running DIA walk nothing in the memory back end', async () => {
      TestBed.resetTestingModule();
      const totals = TestBed.inject(EarlierRunTotals);
      const running = seeded('run-dia-running');
      const before = seeded('run-dia-completed');

      await totals.resolve(running);

      expect(before.processed).toBeGreaterThan(running.processed);
      expect(before.configFingerprint).not.toBe(running.configFingerprint);
      expect(totals.of(running)).toBeNull();
    });
  });

  /** The seeded store discovery of two postal codes, beside a whole one. */
  it('gives the seeded narrowed discovery nothing in the memory back end', async () => {
    TestBed.resetTestingModule();
    const totals = TestBed.inject(EarlierRunTotals);
    const postal = seeded('run-store-postal-running');

    await totals.resolve(postal);

    expect(seeded('run-store-carrefour-completed').processed).toBe(1180);
    expect(totals.of(postal)).toBeNull();
  });
});
