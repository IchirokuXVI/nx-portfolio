import {
  SourceProbeRecorder,
  belowFloor,
  countingFetch,
  httpStatusOf,
  mostRowsCarry,
  pacedAcquire,
  parserErrorsAsProblems,
} from './source-probe-steps';

/** The step helpers every chain's probe shares (plan 0219, section 3.1). */
describe('SourceProbeRecorder', () => {
  it('runs the steps in order and skips every step after one that is not ok', async () => {
    const probe = new SourceProbeRecorder(() => 0);
    const read = jest.fn(async () => 1);

    const first = await probe.step('categories', 'u1', read, () => ({
      problems: [],
      sample: { roots: 26 },
    }));
    const second = await probe.step('listing', 'u2', read, () => ({
      problems: ['3 of 10 rows carried id'],
    }));
    const third = await probe.step('product', 'u3', read, () => ({
      problems: [],
    }));

    expect([first, second, third]).toEqual([1, undefined, undefined]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(probe.stopped).toBe(true);
    expect(probe.result(2)).toEqual({
      requests: 2,
      steps: [
        expect.objectContaining({ name: 'categories', ok: true, url: 'u1' }),
        expect.objectContaining({
          name: 'listing',
          ok: false,
          problems: ['3 of 10 rows carried id'],
        }),
      ],
    });
  });

  it('records a thrown status and message, and keeps the exception', async () => {
    const probe = new SourceProbeRecorder(() => 0);
    const refused = Object.assign(new Error('answered 403'), {
      status: 403,
      url: 'https://shop.example/x',
    });

    await probe.step(
      'warehouse',
      null,
      async () => {
        throw refused;
      },
      () => ({ problems: [] })
    );

    const result = probe.result(1);
    expect(result.steps[0]).toEqual({
      name: 'warehouse',
      url: 'https://shop.example/x',
      ok: false,
      httpStatus: 403,
      error: 'answered 403',
      problems: [],
      sample: {},
      durationMs: 0,
    });
    expect(result.failure).toBe(refused);
  });

  it('keeps at most six sample values', async () => {
    const probe = new SourceProbeRecorder(() => 0);
    await probe.step(
      'listing',
      null,
      async () => null,
      () => ({
        problems: [],
        sample: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 },
      })
    );
    expect(Object.keys(probe.result(0).steps[0].sample)).toHaveLength(6);
  });
});

describe('the 80 per cent rule', () => {
  const rows = (carrying: number) =>
    Array.from({ length: 10 }, (_, n) => ({ id: n < carrying ? 'x' : '' }));
  const fields = { id: (row: { id: string }) => row.id !== '' };

  it('passes at eight of ten and fails at seven, naming the field', () => {
    expect(mostRowsCarry(rows(8), fields)).toEqual([]);
    expect(mostRowsCarry(rows(7), fields)).toEqual(['7 of 10 rows carried id']);
  });

  it('needs at least one row', () => {
    expect(mostRowsCarry([], fields)).toEqual(['no rows were read']);
  });
});

describe('the other helpers', () => {
  it('reads a floor', () => {
    expect(belowFloor(10, 10, 'roots')).toEqual([]);
    expect(belowFloor(9, 10, 'roots')).toEqual([
      '9 roots were read, and the floor is 10',
    ]);
  });

  it('reads a status only when it is a number', () => {
    expect(httpStatusOf({ status: 429 })).toBe(429);
    expect(httpStatusOf({ status: '429' })).toBeNull();
    expect(httpStatusOf(new Error('no'))).toBeNull();
  });

  it('holds the interval beside the caller acquire', async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const acquire = jest.fn(async () => undefined);
    const gate = pacedAcquire({
      acquire,
      minIntervalMs: 1000,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });

    await gate();
    clock += 200;
    await gate();

    expect(acquire).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([800]);
  });

  it('counts the requests that pass through a fetch', async () => {
    const counter = countingFetch(
      (async () => new Response('ok')) as unknown as typeof fetch
    );
    await counter.fetchImpl('https://a.example');
    await counter.fetchImpl('https://b.example');
    expect(counter.count()).toBe(2);
  });
});

describe('parserErrorsAsProblems', () => {
  const shapeError = new Error('The page names no shop file.');
  const recognizes = (error: unknown) => error === shapeError;

  it('records a recognized parser error as the one problem of a step', async () => {
    const probe = new SourceProbeRecorder(() => 0);
    const later = jest.fn(async () => 1);

    await probe.step(
      'shops',
      'u1',
      parserErrorsAsProblems(async () => {
        throw shapeError;
      }, recognizes),
      () => ({ problems: [] })
    );
    await probe.step('product', 'u2', later, () => ({ problems: [] }));

    const result = probe.result(1);
    expect(result.steps).toEqual([
      expect.objectContaining({
        name: 'shops',
        url: 'u1',
        ok: false,
        httpStatus: null,
        error: null,
        problems: ['The page names no shop file.'],
      }),
    ]);
    expect(result.failure).toBeUndefined();
    expect(later).not.toHaveBeenCalled();
  });

  it('throws on any error it does not recognize', async () => {
    const probe = new SourceProbeRecorder(() => 0);
    const other = Object.assign(new Error('answered 503'), { status: 503 });

    await probe.step(
      'shops',
      'u1',
      parserErrorsAsProblems(async () => {
        throw other;
      }, recognizes),
      () => ({ problems: [] })
    );

    const result = probe.result(1);
    expect(result.steps[0]).toEqual(
      expect.objectContaining({
        ok: false,
        httpStatus: 503,
        error: 'answered 503',
        problems: [],
      })
    );
    expect(result.failure).toBe(other);
  });
});
