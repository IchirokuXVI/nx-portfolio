import { ConcurrencyGate, TurnLimiter } from './turn-limiter';

describe('TurnLimiter', () => {
  /** A clock the test moves by hand, so nothing here waits on real time. */
  function clock(startMs = 1_000_000) {
    let nowMs = startMs;
    return {
      now: () => nowMs,
      advance: (ms: number) => {
        nowMs += ms;
      },
    };
  }

  it('allows up to the limit and then refuses', () => {
    const time = clock();
    const limiter = new TurnLimiter(2, 60_000, time.now);

    expect(limiter.take('user-1').allowed).toBe(true);
    expect(limiter.take('user-1').allowed).toBe(true);
    expect(limiter.take('user-1').allowed).toBe(false);
  });

  it('answers with a number of seconds, never zero', () => {
    // Rule A5: "try again later" is the wrong answer, and so is a zero that
    // tells the client to retry immediately.
    const time = clock();
    const limiter = new TurnLimiter(1, 60_000, time.now);
    limiter.take('user-1');

    time.advance(59_900);
    const refused = limiter.take('user-1');

    expect(refused).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it('reports the wait shrinking as the window runs down', () => {
    const time = clock();
    const limiter = new TurnLimiter(1, 60_000, time.now);
    limiter.take('user-1');

    expect(limiter.take('user-1')).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    time.advance(30_000);
    expect(limiter.take('user-1')).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
  });

  it('starts a fresh window once the old one has rolled', () => {
    const time = clock();
    const limiter = new TurnLimiter(1, 60_000, time.now);
    limiter.take('user-1');
    time.advance(60_000);

    expect(limiter.take('user-1').allowed).toBe(true);
  });

  it('counts each caller separately', () => {
    const time = clock();
    const limiter = new TurnLimiter(1, 60_000, time.now);
    limiter.take('user-1');

    expect(limiter.take('user-2').allowed).toBe(true);
  });

  it('supplies the seconds until the window rolls, for a provider 429 with no hint', () => {
    const time = clock();
    const limiter = new TurnLimiter(5, 60_000, time.now);
    limiter.take('user-1');
    time.advance(20_000);

    expect(limiter.secondsUntilWindowRolls('user-1')).toBe(40);
    // Nothing known about a caller who has not been seen, so the service falls
    // through to its fixed fallback rather than inventing a number.
    expect(limiter.secondsUntilWindowRolls('user-2')).toBeUndefined();
  });

  it('drops rolled windows instead of growing a per user map forever', () => {
    // An unbounded map in a long lived process is the ordinary way an in memory
    // limiter becomes an incident.
    const time = clock();
    const limiter = new TurnLimiter(1, 60_000, time.now);
    limiter.take('user-1');
    time.advance(60_000);
    limiter.take('user-2');

    expect(limiter.secondsUntilWindowRolls('user-1')).toBeUndefined();
  });
});

describe('ConcurrencyGate', () => {
  it('queues past the limit rather than refusing', async () => {
    // Waiting two seconds is invisible, being told to come back is not.
    const gate = new ConcurrencyGate(1);
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const a = gate.run(async () => {
      order.push('a:start');
      await first;
      order.push('a:end');
    });
    const b = gate.run(async () => {
      order.push('b:start');
    });

    // b has not started: it is waiting, not failing.
    await Promise.resolve();
    expect(order).toEqual(['a:start']);

    releaseFirst();
    await Promise.all([a, b]);

    expect(order).toEqual(['a:start', 'a:end', 'b:start']);
  });

  it('releases its slot when the task throws', async () => {
    const gate = new ConcurrencyGate(1);

    await expect(
      gate.run(async () => {
        throw new Error('provider said no');
      })
    ).rejects.toThrow('provider said no');

    // A gate that leaked a slot on failure would wedge the instance after
    // exactly `limit` errors, which on a free tier is a matter of minutes.
    await expect(gate.run(async () => 'ok')).resolves.toBe('ok');
  });
});
