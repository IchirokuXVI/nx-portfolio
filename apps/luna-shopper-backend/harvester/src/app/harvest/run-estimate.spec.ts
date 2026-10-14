import {
  DEFAULT_RUN_SECONDS,
  OTHER_RUN_SECONDS,
  estimateRun,
  median,
  type RunSample,
} from './run-estimate';

/** About how long a run takes (plan 0206, section 8). */

const samples = (...seconds: number[]): RunSample[] =>
  seconds.map((value, index) => ({ runId: `run-${index}`, seconds: value }));

describe('median', () => {
  it('answers the middle value of an odd count', () => {
    expect(median([600, 1200, 900])).toBe(900);
  });

  it('answers the mean of the two middle values of an even count', () => {
    expect(median([600, 1200, 900, 1500])).toBe(1050);
  });
});

describe('estimateRun', () => {
  it('takes the runs of the preset first', () => {
    expect(
      estimateRun({
        preset: samples(600, 620, 640),
        source: samples(1200),
        adapterKey: 'mercadona-api',
      })
    ).toEqual({ seconds: 620, basis: 'PRESET', samples: 3 });
  });

  it('takes the runs of the source and mode when the preset has none', () => {
    expect(
      estimateRun({
        preset: [],
        source: samples(1200, 1260),
        adapterKey: 'mercadona-api',
      })
    ).toEqual({ seconds: 1230, basis: 'SOURCE', samples: 2 });
  });

  it('starts a run with no preset at its source', () => {
    expect(
      estimateRun({
        preset: null,
        source: samples(90),
        adapterKey: 'lidl-api',
      })
    ).toEqual({ seconds: 90, basis: 'SOURCE', samples: 1 });
  });

  it('answers the default of the adapter when nothing ran', () => {
    expect(
      estimateRun({ preset: [], source: [], adapterKey: 'eljamon-web' })
    ).toEqual({
      seconds: DEFAULT_RUN_SECONDS['eljamon-web'],
      basis: 'DEFAULT',
      samples: 0,
    });
    expect(
      estimateRun({ preset: null, source: null, adapterKey: 'dia-api' })
    ).toEqual({ seconds: OTHER_RUN_SECONDS, basis: 'DEFAULT', samples: 0 });
    expect(
      estimateRun({ preset: null, source: null, adapterKey: null })
    ).toEqual({ seconds: OTHER_RUN_SECONDS, basis: 'DEFAULT', samples: 0 });
  });

  it('takes the newest five, which the caller lists first', () => {
    // A walk got faster when its workers were raised: the old slow runs at
    // the end are not counted.
    expect(
      estimateRun({
        preset: samples(600, 610, 620, 630, 640, 1200, 1200, 1200),
        source: null,
        adapterKey: null,
      })
    ).toEqual({ seconds: 620, basis: 'PRESET', samples: 5 });
  });

  it('never counts the run the estimate is drawn beside', () => {
    // The caller reads six, so five remain once the run itself is left out.
    expect(
      estimateRun({
        preset: samples(9999, 600, 610, 620, 630, 640),
        source: null,
        adapterKey: null,
        excludeRunId: 'run-0',
      })
    ).toEqual({ seconds: 620, basis: 'PRESET', samples: 5 });
  });

  it('falls through to the source when the preset ran only this run', () => {
    expect(
      estimateRun({
        preset: samples(700),
        source: [
          { runId: 'run-0', seconds: 700 },
          { runId: 'other', seconds: 1300 },
        ],
        adapterKey: 'mercadona-api',
        excludeRunId: 'run-0',
      })
    ).toEqual({ seconds: 1300, basis: 'SOURCE', samples: 1 });
  });
});
