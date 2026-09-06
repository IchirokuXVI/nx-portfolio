import { withRenewalLock } from './session-renewal-lock';

/**
 * One renewal at a time, across the tabs (plan 0013, section 4).
 *
 * jsdom has no `navigator.locks`, so the lock manager is installed by hand. The
 * fake below is the real API's contract in a few lines: one holder per name, the
 * rest queued in order, and the lock released when the holder's promise settles.
 * A test against it is testing this wrapper, which is all this file owns.
 */

/** A lock manager that serializes by name, as the browser's does. */
function fakeLocks(): LockManager {
  const queues = new Map<string, Promise<unknown>>();

  return {
    request: ((name: string, work: () => Promise<unknown>) => {
      const previous = queues.get(name) ?? Promise.resolve();
      const held = previous.then(work, work);
      // Swallowed on the queue only: a failed holder must not fail the next
      // one, but the caller still hears about it through `held`.
      queues.set(
        name,
        held.then(
          () => undefined,
          () => undefined
        )
      );
      return held;
    }) as LockManager['request'],
    query: async () => ({ held: [], pending: [] }),
  };
}

function withLocks(locks: LockManager | undefined): void {
  Object.defineProperty(globalThis.navigator, 'locks', {
    configurable: true,
    value: locks,
  });
}

describe('withRenewalLock', () => {
  afterEach(() => withLocks(undefined));

  /**
   * The property the whole design rests on. Four tabs deciding to renew in the
   * same millisecond enter one at a time, which is what lets each of them look
   * at storage and find the token the first one already wrote.
   */
  it('runs one caller at a time', async () => {
    withLocks(fakeLocks());
    const order: string[] = [];
    const release: (() => void)[] = [];

    const first = withRenewalLock(async () => {
      order.push('first in');
      await new Promise<void>((resolve) => release.push(resolve));
      order.push('first out');
    });
    const second = withRenewalLock(async () => {
      order.push('second in');
    });

    await Promise.resolve();
    expect(order).toEqual(['first in']);

    release[0]();
    await Promise.all([first, second]);

    expect(order).toEqual(['first in', 'first out', 'second in']);
  });

  it('answers with what the work answered', async () => {
    withLocks(fakeLocks());

    await expect(withRenewalLock(async () => 'renewed')).resolves.toBe(
      'renewed'
    );
  });

  it('reports a failure from the work rather than swallowing it', async () => {
    withLocks(fakeLocks());
    const work = jest.fn(async () => {
      throw new Error('the gateway said no');
    });

    await expect(withRenewalLock(work)).rejects.toThrow('the gateway said no');
    // Once. A failure inside the lock is an answer, not a reason to try again.
    expect(work).toHaveBeenCalledTimes(1);
  });

  /**
   * A browser with no lock manager, which is every browser this app is not used
   * in, plus jsdom. The work still runs: tabs that collide can each renew, which
   * is the behaviour before this plan and costs a request rather than a session.
   */
  it('runs the work when the browser has no lock manager', async () => {
    withLocks(undefined);

    await expect(withRenewalLock(async () => 'renewed')).resolves.toBe(
      'renewed'
    );
  });

  /**
   * A lock manager that refuses. The work never ran, so it is run unserialized:
   * a renewal must not be lost to a lock, which is a detail of how the renewal is
   * scheduled and has nothing to do with the operator's session.
   */
  it('runs the work anyway when the lock cannot be taken', async () => {
    withLocks({
      request: () => Promise.reject(new Error('denied')),
      query: async () => ({ held: [], pending: [] }),
    } as unknown as LockManager);

    await expect(withRenewalLock(async () => 'renewed')).resolves.toBe(
      'renewed'
    );
  });
});
