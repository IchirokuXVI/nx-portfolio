import type { RefusalPolicy } from './refusal-policy';
import {
  ISOLATED_URLS_NAMED,
  SourceBlockedError,
  SourceGuard,
  type SourceStop,
  type SourceTrip,
} from './source-guard';

/**
 * The guard of plan 0215, sections 2 to 4, driven by hand: a fake clock and a
 * sleep that resolves only when the spec says so. No timer runs.
 */

const PAUSING: RefusalPolicy = {
  consecutive: 5,
  window: { size: 50, refusals: 20 },
  coolDowns: 1,
  coolDownMs: 600_000,
  probes: 3,
};

const NO_PAUSE: RefusalPolicy = {
  consecutive: 5,
  window: null,
  coolDowns: 0,
  coolDownMs: 0,
  probes: 0,
};

const START = Date.UTC(2026, 8, 25, 14, 3, 11);

const url = (n: number): string =>
  `https://tienda.example/api/products/${n}/?wh=4661`;

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

/** Where a promise has got to, read without awaiting it. */
function track(promise: Promise<void>): { state: string; reason?: unknown } {
  const seen: { state: string; reason?: unknown } = { state: 'pending' };
  promise.then(
    () => {
      seen.state = 'resolved';
    },
    (reason: unknown) => {
      seen.state = 'rejected';
      seen.reason = reason;
    }
  );
  return seen;
}

function harness(policy: RefusalPolicy = PAUSING, signal?: AbortSignal) {
  let clock = START;
  const sleeps: Array<{ ms: number; resolve: () => void }> = [];
  const trips: SourceTrip[] = [];
  const stops: SourceStop[] = [];
  let resumes = 0;
  let waits = 0;
  const guard = new SourceGuard(policy, {
    now: () => clock,
    sleep: (ms) => new Promise<void>((resolve) => sleeps.push({ ms, resolve })),
    signal,
    onTrip: (trip) => trips.push(trip),
    onResume: () => {
      resumes += 1;
    },
    onStop: (stop) => stops.push(stop),
    onWait: () => {
      waits += 1;
    },
  });

  /** Let every pending sleep of the pause run out, moving the clock with it. */
  const endPause = async (): Promise<void> => {
    await flush();
    while (sleeps.length > 0) {
      const sleep = sleeps.shift() as { ms: number; resolve: () => void };
      clock += sleep.ms;
      sleep.resolve();
      await flush();
    }
  };

  /** Trip the guard with five refusals in a row. */
  const trip = (): Array<'retry' | 'fail'> =>
    [1, 2, 3, 4, 5].map((n) => guard.refused(403, url(n)));

  return {
    guard,
    trips,
    stops,
    sleeps,
    endPause,
    trip,
    resumes: () => resumes,
    waits: () => waits,
  };
}

describe('SourceGuard (plan 0215)', () => {
  it('lets refusals that a clean answer separates through as isolated', () => {
    const { guard, trips } = harness();

    const first = [1, 2, 3, 4].map((n) => guard.refused(403, url(n)));
    guard.answered();
    const second = [5, 6, 7, 8].map((n) => guard.refused(403, url(n)));

    expect(first).toEqual(['fail', 'fail', 'fail', 'fail']);
    expect(second).toEqual(['fail', 'fail', 'fail', 'fail']);
    expect(trips).toEqual([]);
    expect(guard.stop).toBeNull();
    expect(guard.summary().isolated).toBe(8);
  });

  it('counts the refusals in a row until a clearing answer or a trip ends them', () => {
    const { guard, trip } = harness();

    expect(guard.consecutiveRefusals).toBe(0);
    guard.refused(403, url(1));
    guard.refused(403, url(2));
    expect(guard.consecutiveRefusals).toBe(2);
    guard.answered();
    expect(guard.consecutiveRefusals).toBe(0);
    trip();
    expect(guard.consecutiveRefusals).toBe(0);
  });

  it('trips on the fifth refusal in a row, which is to be sent again', () => {
    const { trip, trips } = harness();

    expect(trip()).toEqual(['fail', 'fail', 'fail', 'fail', 'retry']);
    expect(trips).toEqual([
      expect.objectContaining({
        rule: 'consecutive',
        refusals: 5,
        status: 403,
        url: url(5),
        pauseMs: 600_000,
        at: START,
      }),
    ]);
  });

  it('trips by the window rule on 20 refusals among the last 50 answers', () => {
    const { guard, trips } = harness();

    const answers: Array<'retry' | 'fail'> = [];
    for (let n = 1; n <= 20; n += 1) {
      answers.push(guard.refused(403, url(n)));
      if (n < 20) {
        guard.answered();
      }
    }

    expect(answers.slice(0, 19).every((answer) => answer === 'fail')).toBe(
      true
    );
    expect(answers[19]).toBe('retry');
    expect(trips).toEqual([
      expect.objectContaining({ rule: 'window', refusals: 20, of: 50 }),
    ]);
  });

  it('forgets a refusal once it leaves the window', () => {
    const { guard, trips } = harness();

    // 19 refusals, then 50 clean answers push every one of them out.
    for (let n = 1; n <= 19; n += 1) {
      guard.refused(403, url(n));
      guard.answered();
    }
    for (let n = 0; n < 50; n += 1) {
      guard.answered();
    }
    expect(guard.refused(403, url(99))).toBe('fail');
    expect(trips).toEqual([]);
  });

  it('holds every admit during a pause, and does not count a refusal still in flight', async () => {
    const { guard, trip, sleeps } = harness();
    trip();

    const waiting = [guard.admit(), guard.admit(), guard.admit()].map(track);
    // A request sent before the pause, refused after it began.
    expect(guard.refused(403, url(6))).toBe('retry');
    // One sent before the pause that came back clean is an answer, and the
    // pause goes on.
    guard.answered();
    await flush();

    expect(waiting.map((each) => each.state)).toEqual([
      'pending',
      'pending',
      'pending',
    ]);
    expect(sleeps.length).toBe(1);
    expect(guard.summary().probesRefused).toBe(0);
  });

  it('lets exactly one admit through after the pause until that probe answers', async () => {
    const { guard, trip, endPause } = harness();
    trip();
    const waiting = [guard.admit(), guard.admit(), guard.admit()].map(track);

    await endPause();

    expect(waiting.map((each) => each.state)).toEqual([
      'resolved',
      'pending',
      'pending',
    ]);
    const late = track(guard.admit());
    await flush();
    expect(late.state).toBe('pending');
  });

  it('opens on a clean probe, clears the counts and lets every waiter through', async () => {
    const { guard, trip, endPause, resumes } = harness();
    trip();
    const waiting = [guard.admit(), guard.admit()].map(track);
    await endPause();

    guard.answered();
    await flush();

    expect(resumes()).toBe(1);
    expect(waiting.map((each) => each.state)).toEqual(['resolved', 'resolved']);
    await expect(guard.admit()).resolves.toBeUndefined();
    // The counts were cleared: four more refusals trip nothing.
    expect([1, 2, 3, 4].map((n) => guard.refused(403, url(n)))).toEqual([
      'fail',
      'fail',
      'fail',
      'fail',
    ]);
    expect(guard.summary().paused).toEqual({
      at: '2026-09-25T14:03:11.000Z',
      rule: 'consecutive',
      consecutive: 5,
      refusals: 5,
      resumedAt: '2026-09-25T14:13:11.000Z',
    });
  });

  it('stops after three refused probes, and rejects every waiting and every later admit', async () => {
    const { guard, trip, endPause, stops } = harness();
    trip();
    const waiting = [1, 2, 3, 4].map(() => track(guard.admit()));
    await endPause();

    expect(guard.refused(403, url(10))).toBe('fail');
    await flush();
    expect(waiting.map((each) => each.state)).toEqual([
      'resolved',
      'resolved',
      'pending',
      'pending',
    ]);
    expect(guard.refused(403, url(11))).toBe('fail');
    await flush();
    let thrown: unknown = null;
    try {
      guard.refused(403, url(12));
    } catch (error) {
      thrown = error;
    }
    await flush();

    expect(thrown).toBeInstanceOf(SourceBlockedError);
    expect((thrown as SourceBlockedError).stop).toEqual(
      expect.objectContaining({
        cause: 'probes',
        probesRefused: 3,
        pausedMs: 600_000,
        status: 403,
        url: url(12),
      })
    );
    expect(stops).toHaveLength(1);
    expect(guard.stop).toBe(stops[0]);
    expect(waiting[3]).toEqual({ state: 'rejected', reason: thrown });
    await expect(guard.admit()).rejects.toBe(thrown);
    expect(() => guard.refused(403, url(13))).toThrow(SourceBlockedError);
  });

  it('hands the probe on when a probe meets an answer that says nothing', async () => {
    const { guard, trip, endPause } = harness();
    trip();
    const waiting = [guard.admit(), guard.admit()].map(track);
    await endPause();

    // The probe met a 503 and will retry: the next waiter probes meanwhile.
    guard.inconclusive();
    await flush();

    expect(waiting.map((each) => each.state)).toEqual(['resolved', 'resolved']);
    expect(guard.summary().probesRefused).toBe(0);
  });

  it('stops at once on a second trip once its one pause is spent', async () => {
    const { guard, trip, endPause, trips } = harness();
    trip();
    void guard.admit();
    await endPause();
    guard.answered();

    let thrown: unknown = null;
    try {
      trip();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SourceBlockedError);
    expect((thrown as SourceBlockedError).stop).toEqual(
      expect.objectContaining({ cause: 'trip', pausedMs: 600_000 })
    );
    expect(trips).toHaveLength(2);
    expect(trips[1].pauseMs).toBeNull();
  });

  it('stops on the first trip when the policy has no pause', () => {
    const { guard, stops, sleeps } = harness(NO_PAUSE);

    const answers = [1, 2, 3, 4].map((n) => guard.refused(403, url(n)));
    expect(answers).toEqual(['fail', 'fail', 'fail', 'fail']);
    expect(() => guard.refused(403, url(5))).toThrow(SourceBlockedError);

    expect(stops).toEqual([
      expect.objectContaining({
        cause: 'trip',
        pausedMs: null,
        probesRefused: 0,
        trip: expect.objectContaining({ refusals: 5, pauseMs: null }),
      }),
    ]);
    expect(sleeps).toEqual([]);
    expect(guard.summary()).toEqual(
      expect.objectContaining({
        isolated: 0,
        paused: null,
        stoppedAt: '2026-09-25T14:03:11.000Z',
        lastStatus: 403,
        lastUrl: url(5),
      })
    );
  });

  it('releases a waiting admit with the reason of an aborted signal', async () => {
    const controller = new AbortController();
    const { guard, trip } = harness(PAUSING, controller.signal);
    trip();
    const waiting = track(guard.admit(controller.signal));

    const reason = new Error('A person aborted the run.');
    controller.abort(reason);
    await flush();

    expect(waiting).toEqual({ state: 'rejected', reason });
    await expect(guard.admit(controller.signal)).rejects.toBe(reason);
  });

  it('calls onWait through the pause, about every 30 seconds', async () => {
    const { trip, endPause, waits, sleeps } = harness();
    trip();
    await flush();
    expect(sleeps[0].ms).toBe(30_000);

    await endPause();

    expect(waits()).toBe(20);
  });

  it('names the first 50 isolated URLs and no more', () => {
    const { guard } = harness({ ...PAUSING, window: null });

    for (let n = 1; n <= 60; n += 1) {
      guard.refused(403, url(n));
      guard.answered();
    }
    const summary = guard.summary();

    expect(summary.isolated).toBe(60);
    expect(summary.isolatedUrls).toHaveLength(ISOLATED_URLS_NAMED);
    expect(summary.isolatedUrls[0]).toBe(url(1));
    expect(summary.isolatedUrls[49]).toBe(url(50));
  });

  it('does not count the refusals in a row that tripped as isolated', () => {
    const { guard, trip } = harness();
    guard.refused(403, url(100));
    guard.answered();

    trip();

    expect(guard.summary()).toEqual(
      expect.objectContaining({ isolated: 1, isolatedUrls: [url(100)] })
    );
  });
});
