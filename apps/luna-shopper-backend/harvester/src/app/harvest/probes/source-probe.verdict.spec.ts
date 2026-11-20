import { CarrefourBrowserError } from '@portfolio/luna-shopper/carrefour';
import {
  SourceProbeStatus,
  type SourceProbeResult,
  type SourceProbeStepView,
} from '@portfolio/luna-shopper/contracts';
import { SourceBlockedError } from '@portfolio/luna-shopper/source-guard';
import { judgeProbe } from './source-probe.verdict';

/** Each row of the verdict table of plan 0219, section 5, and its order. */

function step(over: Partial<SourceProbeStepView> = {}): SourceProbeStepView {
  return {
    name: 'listing',
    url: 'https://shop.example/listing',
    ok: true,
    httpStatus: null,
    error: null,
    problems: [],
    sample: {},
    durationMs: 10,
    ...over,
  };
}

const failed = (
  over: Partial<SourceProbeStepView>,
  failure?: unknown
): SourceProbeResult => ({
  steps: [step({ name: 'categories' }), step({ ok: false, ...over })],
  requests: 2,
  ...(failure !== undefined ? { failure } : {}),
});

const blockedError = () =>
  new SourceBlockedError({
    at: 0,
    cause: 'trip',
    trip: {
      at: 0,
      rule: 'consecutive',
      refusals: 5,
      of: null,
      status: 500,
      url: 'https://shop.example/x',
      pauseMs: null,
    },
    probesRefused: 0,
    pausedMs: null,
    status: 500,
    url: 'https://shop.example/x',
  });

const httpError = (status: number) =>
  Object.assign(new Error(`answered ${status}`), { status });

describe('judgeProbe', () => {
  it('is PASSED when every step is ok', () => {
    expect(judgeProbe({ steps: [step(), step()], requests: 2 })).toEqual({
      status: SourceProbeStatus.PASSED,
      error: null,
    });
  });

  it.each([403, 429])('is BLOCKED on a %i', (status) => {
    expect(
      judgeProbe(
        failed(
          { httpStatus: status, error: `answered ${status}` },
          httpError(status)
        )
      ).status
    ).toBe(SourceProbeStatus.BLOCKED);
  });

  it('is BLOCKED on the guard stopping the client', () => {
    const blocked = blockedError();
    expect(judgeProbe(failed({ error: blocked.message }, blocked)).status).toBe(
      SourceProbeStatus.BLOCKED
    );
  });

  it.each([500, 502, 503])('is UNREACHABLE on a %i', (status) => {
    expect(
      judgeProbe(failed({ httpStatus: status, error: 'x' }, httpError(status)))
        .status
    ).toBe(SourceProbeStatus.UNREACHABLE);
  });

  it('is UNREACHABLE on a refused connection', () => {
    const error = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      }),
    });
    expect(judgeProbe(failed({ error: error.message }, error)).status).toBe(
      SourceProbeStatus.UNREACHABLE
    );
  });

  it('is UNREACHABLE on the deadline', () => {
    const error = new DOMException(
      'The probe passed its deadline.',
      'TimeoutError'
    );
    expect(judgeProbe(failed({ error: error.message }, error)).status).toBe(
      SourceProbeStatus.UNREACHABLE
    );
  });

  it.each([404, 410])('is SHAPE_CHANGED on a %i', (status) => {
    expect(
      judgeProbe(failed({ httpStatus: status, error: 'x' }, httpError(status)))
        .status
    ).toBe(SourceProbeStatus.SHAPE_CHANGED);
  });

  it('is SHAPE_CHANGED on problems with no exception, and names the step and the first problem', () => {
    expect(
      judgeProbe(
        failed({
          problems: [
            '2 of 40 rows carried a price above zero',
            '3 of 40 rows carried id',
          ],
        })
      )
    ).toEqual({
      status: SourceProbeStatus.SHAPE_CHANGED,
      error: 'listing: 2 of 40 rows carried a price above zero',
    });
  });

  it('is ERROR on a browser that stopped answering, which is ours and not a redesign', () => {
    const error = new CarrefourBrowserError('launching the browser');
    expect(judgeProbe(failed({ error: error.message }, error)).status).toBe(
      SourceProbeStatus.ERROR
    );
  });

  it('is ERROR on any other exception', () => {
    const error = new Error(
      'Mercadona accepted the code but returned no header'
    );
    expect(judgeProbe(failed({ error: error.message }, error))).toEqual({
      status: SourceProbeStatus.ERROR,
      error: 'listing: Mercadona accepted the code but returned no header',
    });
  });

  it('is SHAPE_CHANGED on a body that is not JSON, a SyntaxError with no status', () => {
    // What `response.json()` throws when a JSON API answers HTML with a 200.
    const error = new SyntaxError(
      `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`
    );
    expect(judgeProbe(failed({ error: error.message }, error))).toEqual({
      status: SourceProbeStatus.SHAPE_CHANGED,
      error: `listing: ${error.message}`,
    });
  });

  it('keeps the status of a SyntaxError that carries one', () => {
    const error = Object.assign(new SyntaxError('not JSON'), { status: 503 });
    expect(
      judgeProbe(failed({ httpStatus: 503, error: error.message }, error))
        .status
    ).toBe(SourceProbeStatus.UNREACHABLE);
  });

  it('takes the rows in order when two apply: a refusal over a server error', () => {
    // A guard that stopped on a 500 is still the chain refusing the client.
    const blocked = blockedError();
    expect(
      judgeProbe(failed({ httpStatus: 500, error: blocked.message }, blocked))
        .status
    ).toBe(SourceProbeStatus.BLOCKED);
  });

  it('takes the first step that is not ok', () => {
    const result: SourceProbeResult = {
      steps: [
        step({ name: 'warehouse', ok: false, problems: ['no warehouse'] }),
        step({ name: 'listing', ok: false, httpStatus: 403 }),
      ],
      requests: 2,
    };
    expect(judgeProbe(result)).toEqual({
      status: SourceProbeStatus.SHAPE_CHANGED,
      error: 'warehouse: no warehouse',
    });
  });
});
