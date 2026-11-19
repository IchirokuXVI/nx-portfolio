import {
  canAbort,
  canRevert,
  earlierTotal,
  failureBlockReason,
  isReverted,
  isTerminalRun,
  PRICE_WRITING_MODES,
  runPriceCounters,
  runPricesPublished,
  runProgress,
  runProgressLine,
  spawnBlockReason,
  TERMINAL_RUN_STATUSES,
  wantsEarlierTotal,
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
    skipped: 0,
    warnings: [],
    documentSha256: null,
    report: {},
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

  // An old run that counted two units in `processed` (backend plan 0217).
  it('never reports more than a hundred', () => {
    expect(
      runProgress(run({ processed: 120, totalPlanned: 100 })).percent
    ).toBe(100);
  });
});

/**
 * An approximate total from another run (decision 86 of the harvester round).
 * A DEZA walk does not know its total while it runs, and the owner wants "824
 * of about 2,361" rather than "824 processed".
 */
describe('runProgress with an earlier total', () => {
  it('gives the earlier total as an approximate one, with a bar', () => {
    expect(
      runProgress(run({ processed: 824, totalPlanned: null }), 2361)
    ).toEqual({
      processed: 824,
      total: null,
      percent: 35,
      about: 2361,
      ended: false,
    });
  });

  it('keeps the unknown form when no earlier run gives a total', () => {
    expect(
      runProgress(run({ processed: 824, totalPlanned: null }), null)
    ).toEqual({ processed: 824, total: null, percent: null });
  });

  /** "0 of about 2,361" says nothing a bare count does not. */
  it.each(['RUNNING', 'PENDING', 'ABORTED', 'FAILED', 'COMPLETED'] as const)(
    'keeps the unknown form for a %s run that processed nothing',
    (status) => {
      expect(
        runProgress(run({ status, processed: 0, totalPlanned: null }), 2361)
      ).toEqual({ processed: 0, total: null, percent: null });
    }
  );

  /** "900 of about 824" would print a whole smaller than its part. */
  it('keeps the unknown form once the run has passed the estimate', () => {
    expect(
      runProgress(run({ processed: 2400, totalPlanned: null }), 2361)
    ).toEqual({ processed: 2400, total: null, percent: null });
  });

  it('never draws a bar against an estimate as full', () => {
    expect(
      runProgress(run({ processed: 2361, totalPlanned: null }), 2361)
    ).toEqual({
      processed: 2361,
      total: null,
      percent: 99,
      about: 2361,
      ended: false,
    });
  });

  it('never replaces a known total', () => {
    expect(
      runProgress(run({ processed: 25, totalPlanned: 100 }), 2361)
    ).toEqual({ processed: 25, total: 100, percent: 25 });
  });

  it('gives no estimate beside a known total of zero', () => {
    expect(
      runProgress(run({ processed: 0, totalPlanned: 0 }), 2361).about ?? null
    ).toBeNull();
  });

  /**
   * Owner decision 97b: an ended run keeps the number, in the past tense, and
   * gets no bar, because a bar on a run that stopped reads as progress. A run
   * that completed without a total is one of them.
   */
  it.each(['COMPLETED', 'ABORTED', 'FAILED', 'STALE'] as const)(
    'gives an ended %s run the estimate with no bar',
    (status) => {
      expect(
        runProgress(run({ status, processed: 824, totalPlanned: null }), 2361)
      ).toEqual({
        processed: 824,
        total: null,
        percent: null,
        about: 2361,
        ended: true,
      });
    }
  );
});

describe('runProgressLine', () => {
  it('says "of about" for a running estimate, with the numbers grouped', () => {
    expect(
      runProgressLine(
        {
          processed: 1824,
          total: null,
          percent: 77,
          about: 2361,
          ended: false,
        },
        'en'
      )
    ).toEqual({
      key: 'harvest.run.progress.ofAbout',
      args: { processed: '1,824', total: '2,361' },
      approximate: true,
    });
  });

  it('words an ended estimate in the past', () => {
    expect(
      runProgressLine(
        {
          processed: 824,
          total: null,
          percent: null,
          about: 2361,
          ended: true,
        },
        'en'
      )
    ).toEqual({
      key: 'harvest.run.progress.ofAboutEnded',
      args: { processed: '824', total: '2,361' },
      approximate: true,
    });
  });

  /**
   * Owner decision 99b: a known total is drawn as it was before the estimate
   * existed, raw, like every other count on the page. Only the estimate line
   * is grouped.
   */
  it('says "of" for a known total with the raw numbers, never "about"', () => {
    expect(
      runProgressLine({ processed: 1907, total: 4383, percent: 44 }, 'en')
    ).toEqual({
      key: 'harvest.run.progress.of',
      args: { processed: 1907, total: 4383 },
      approximate: false,
    });
  });

  it('says how many with the raw number when there is neither', () => {
    expect(
      runProgressLine({ processed: 2361, total: null, percent: null }, 'en')
    ).toEqual({
      key: 'harvest.run.progress.processed',
      args: { processed: 2361 },
      approximate: false,
    });
  });

  it('formats the estimate for the reader’s language', () => {
    expect(
      runProgressLine(
        { processed: 824, total: null, percent: 7, about: 12361 },
        'es'
      ).args.total
    ).toBe('12.361');
  });
});

describe('earlierTotal', () => {
  const completed = run({
    status: 'COMPLETED',
    processed: 2361,
    totalPlanned: null,
  });

  it('is what a completed run that stands processed', () => {
    expect(earlierTotal(completed)).toBe(2361);
  });

  it('ignores a reverted run', () => {
    expect(
      earlierTotal({ ...completed, revertedAt: '2026-09-01T11:20:00.000Z' })
    ).toBeNull();
  });

  it.each(['FAILED', 'ABORTED', 'STALE', 'RUNNING', 'PENDING'] as const)(
    'ignores a %s run, which says nothing of the whole',
    (status) => {
      expect(earlierTotal({ ...completed, status })).toBeNull();
    }
  );

  it('ignores a run that processed nothing, and no run at all', () => {
    expect(earlierTotal({ ...completed, processed: 0 })).toBeNull();
    expect(earlierTotal(null)).toBeNull();
    expect(earlierTotal(undefined)).toBeNull();
  });
});

describe('wantsEarlierTotal', () => {
  const going = run({
    supermarketId: 'sm_deza',
    totalPlanned: null,
    processed: 824,
  });

  it('is true for a run of one chain that does not know its total', () => {
    expect(wantsEarlierTotal(going)).toBe(true);
  });

  it('is true for an ended run, which keeps the estimate in the past', () => {
    expect(wantsEarlierTotal({ ...going, status: 'COMPLETED' })).toBe(true);
    expect(wantsEarlierTotal({ ...going, status: 'ABORTED' })).toBe(true);
  });

  it('is true for a run of a preset over every chain', () => {
    expect(
      wantsEarlierTotal({ ...going, supermarketId: null, presetId: 'p1' })
    ).toBe(true);
  });

  it('is false for a known total, nothing processed, nothing to compare, no run', () => {
    expect(wantsEarlierTotal({ ...going, totalPlanned: 100 })).toBe(false);
    expect(wantsEarlierTotal({ ...going, processed: 0 })).toBe(false);
    expect(wantsEarlierTotal({ ...going, supermarketId: null })).toBe(false);
    expect(wantsEarlierTotal(null)).toBe(false);
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
 * What a run did with prices, read from the run's own report.
 *
 * The screen used to rename `updated` and `unchanged` for a price writing mode,
 * and a LIDL walk of 188 products nobody had matched read "prices written: 0"
 * while its source rows carried 8,154 prices. `updated` is rows the ladder
 * changed, and the harvester adds its price inserts to it as well.
 */
describe('runPriceCounters', () => {
  it('reads the three numbers the report carries', () => {
    expect(
      runPriceCounters(
        run({
          report: {
            pricesRecorded: 8154,
            pricesPublished: 0,
            pricesConfirmed: 0,
          },
        })
      )
    ).toEqual({ recorded: 8154, published: 0, confirmed: 0 });
  });

  /**
   * The counters are not consulted, which is the whole point. A run whose rows
   * all changed states 188 changed rows and no price, and the two must not be
   * read as one number.
   */
  it('ignores the run counters', () => {
    expect(
      runPriceCounters(
        run({
          updated: 188,
          unchanged: 42,
          report: { pricesRecorded: 8154 },
        })
      )
    ).toEqual({ recorded: 8154, published: 0, confirmed: 0 });
  });

  it.each([
    ['a report with no price in it', {}],
    ['a report whose numbers are not numbers', { pricesRecorded: 'many' }],
  ])('answers null for %s', (_name, report) => {
    expect(runPriceCounters(run({ report }))).toBeNull();
  });
});

/** The "Prices" column of the runs list (backend plan 0217). */
describe('runPricesPublished', () => {
  it('reads pricesPublished from the report, zero included', () => {
    expect(
      runPricesPublished(
        run({ updated: 30, report: { pricesPublished: 4000 } })
      )
    ).toBe(4000);
    expect(runPricesPublished(run({ report: { pricesPublished: 0 } }))).toBe(0);
  });

  it.each([
    ['a report with no such key', { pricesRecorded: 8154 }],
    ['a value that is not a number', { pricesPublished: 'many' }],
  ])('answers null for %s', (_name, report) => {
    expect(runPricesPublished(run({ report }))).toBeNull();
  });
});
