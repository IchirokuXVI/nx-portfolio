import {
  canAbort,
  canRevert,
  failureBlockReason,
  isReverted,
  isTerminalRun,
  PRICE_WRITING_MODES,
  runCounterKeys,
  runProgress,
  spawnBlockReason,
  TERMINAL_RUN_STATUSES,
  type HarvestRun,
} from './harvest-run';

function run(over: Partial<HarvestRun> = {}): HarvestRun {
  return {
    id: 'run-1',
    supermarketId: null,
    sourceId: null,
    mode: 'CATALOG_DISCOVERY',
    trigger: 'MANUAL',
    status: 'RUNNING',
    requestedAt: '2026-09-03T09:00:00.000Z',
    startedAt: '2026-09-03T09:00:01.000Z',
    finishedAt: null,
    heartbeatAt: null,
    totalPlanned: null,
    processed: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    notFound: 0,
    failed: 0,
    stage: null,
    stageLabel: null,
    abortRequestedAt: null,
    error: null,
    correlationId: null,
    requestedByUserId: null,
    revertedAt: null,
    revertedByUserId: null,
    revertedPriceCount: null,
    ...over,
  };
}

describe('isTerminalRun', () => {
  it.each(TERMINAL_RUN_STATUSES)('is true for %s', (status) => {
    expect(isTerminalRun(run({ status }))).toBe(true);
  });

  it.each(['PENDING', 'RUNNING'] as const)('is false for %s', (status) => {
    expect(isTerminalRun(run({ status }))).toBe(false);
  });

  /**
   * `STALE` is terminal. The harvester's own reaper writes it when a run stops
   * sending a heartbeat, so the process behind it is gone and no further poll
   * will report anything new.
   */
  it('counts a stale run as finished', () => {
    expect(isTerminalRun(run({ status: 'STALE' }))).toBe(true);
  });

  it('is false when there is no run', () => {
    expect(isTerminalRun(null)).toBe(false);
  });
});

describe('canAbort', () => {
  it('is true for a run still going that nobody has stopped', () => {
    expect(canAbort(run())).toBe(true);
  });

  /**
   * The window between the request landing and the run finalizing is long: the
   * run flushes what it has first. A button that stayed live through it would
   * be pressed again, in the exact minutes somebody is most likely to.
   */
  it('is false once an abort has been asked for', () => {
    expect(
      canAbort(run({ abortRequestedAt: '2026-09-03T09:05:00.000Z' }))
    ).toBe(false);
  });

  it('is false for a finished run', () => {
    expect(canAbort(run({ status: 'COMPLETED' }))).toBe(false);
  });
});

describe('runProgress', () => {
  it('reports a percentage once the run knows its size', () => {
    expect(runProgress(run({ processed: 25, totalPlanned: 100 }))).toEqual({
      processed: 25,
      total: 100,
      percent: 25,
    });
  });

  /**
   * `totalPlanned` is null until the category walk has counted, minutes into an
   * eighteen minute run. A bar against a denominator nobody chose says less than
   * the count alone.
   */
  it('reports no percentage before the total is known', () => {
    expect(runProgress(run({ processed: 12, totalPlanned: null }))).toEqual({
      processed: 12,
      total: null,
      percent: null,
    });
  });

  it('reports no percentage against a zero total', () => {
    expect(
      runProgress(run({ processed: 0, totalPlanned: 0 })).percent
    ).toBeNull();
  });

  it('never reports more than a hundred', () => {
    expect(
      runProgress(run({ processed: 120, totalPlanned: 100 })).percent
    ).toBe(100);
  });
});

describe('spawnBlockReason', () => {
  /**
   * `HARVEST_ENABLED` false is a `NotConfiguredException` in the harvester,
   * which renders as 501 carrying `not_configured`. It is the one switch of the
   * three whose state this app can learn without a route that reports it.
   */
  it('reads a not_configured refusal as the service being off', () => {
    expect(spawnBlockReason({ code: 'not_configured', status: 501 })).toBe(
      'service-off'
    );
  });

  it('falls back to the status when the body carried no code', () => {
    expect(spawnBlockReason({ code: '', status: 501 })).toBe('service-off');
  });

  it('is null for a refusal that is about the request', () => {
    expect(spawnBlockReason({ code: 'conflict', status: 409 })).toBeNull();
  });
});

describe('failureBlockReason', () => {
  /**
   * A run that stopped because one chain was switched off is not a thing that
   * happens any more. Backend plan 0083 deleted the per chain variable, and a
   * disabled chain is refused at the spawn by its own source row, so a run
   * naming a storefront reads as an ordinary failure in the server's own words.
   */
  it('does not invent a storefront reason for a run that named one', () => {
    const failed = run({
      status: 'FAILED',
      error: 'Mercadona stopped answering after 41 requests.',
    });

    expect(failureBlockReason(failed)).toBeNull();
  });

  it('reads a service refusal off the finished run', () => {
    const failed = run({
      status: 'FAILED',
      error:
        'Harvesting is disabled on this deployment (HARVEST_ENABLED is false).',
    });

    expect(failureBlockReason(failed)).toBe('service-off');
  });

  it('is null for a run that failed for some other reason', () => {
    expect(failureBlockReason(run({ error: 'connection reset' }))).toBeNull();
  });

  it('is null for a run that did not fail', () => {
    expect(failureBlockReason(run({ status: 'COMPLETED' }))).toBeNull();
  });
});
/**
 * Which runs the revert control belongs on (backend plan 0082).
 *
 * The three conditions are the server's own refusals, asked here so the button
 * is absent rather than present and answered with a 409. A revert is a hard
 * delete with no undo, and a control that appears where it cannot work teaches
 * an operator to press through the refusal.
 */
describe('isReverted', () => {
  it('is false while the run still stands', () => {
    expect(isReverted(run())).toBe(false);
  });

  it('is true once its writes were taken back', () => {
    expect(isReverted(run({ revertedAt: '2026-09-04T08:00:00.000Z' }))).toBe(
      true
    );
  });

  it('is false for no run at all', () => {
    expect(isReverted(null)).toBe(false);
  });
});

describe('canRevert', () => {
  it.each(PRICE_WRITING_MODES)('is true for a finished %s run', (mode) => {
    expect(canRevert(run({ mode, status: 'COMPLETED' }))).toBe(true);
  });

  it('is false for a store discovery run, which wrote no price', () => {
    expect(
      canRevert(run({ mode: 'STORE_DISCOVERY', status: 'COMPLETED' }))
    ).toBe(false);
  });

  it.each(['PENDING', 'RUNNING'] as const)(
    'is false while the run is %s: abort it first',
    (status) => {
      expect(canRevert(run({ status }))).toBe(false);
    }
  );

  /** An abort keeps what was fetched, so there is something left to take back. */
  it('is true for an aborted run, which flushed what it had', () => {
    expect(canRevert(run({ status: 'ABORTED' }))).toBe(true);
  });

  it('is false once it has been reverted: there is nothing left', () => {
    expect(
      canRevert(
        run({ status: 'COMPLETED', revertedAt: '2026-09-04T08:00:00.000Z' })
      )
    ).toBe(false);
  });

  it('is false for no run at all', () => {
    expect(canRevert(null)).toBe(false);
  });
});

/**
 * What the run screen calls two of its counters (admin plan 0014, section 3).
 *
 * A walk writes prices now, so on a run that writes any, `updated` and
 * `unchanged` are prices written and prices confirmed, which is what the ingest
 * actually counted. On a store discovery they are shops, and naming a shop a
 * price would be worse than saying nothing.
 */
describe('runCounterKeys', () => {
  it.each(['CATALOG_DISCOVERY', 'FILE_IMPORT'] as const)(
    'reads a %s run counters as prices',
    (mode) => {
      expect(runCounterKeys(run({ mode }))).toEqual({
        updated: 'pricesWritten',
        unchanged: 'pricesConfirmed',
      });
    }
  );

  it('leaves a store discovery counters neutral', () => {
    expect(runCounterKeys(run({ mode: 'STORE_DISCOVERY' }))).toEqual({
      updated: 'updated',
      unchanged: 'unchanged',
    });
  });
});
