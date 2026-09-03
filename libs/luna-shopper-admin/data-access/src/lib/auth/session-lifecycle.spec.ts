import { TestBed } from '@angular/core/testing';
import {
  ADMIN_SESSION_POLICY,
  DEFAULT_SESSION_POLICY,
  type AdminMe,
  type AdminSession,
} from '@portfolio/luna-shopper-admin/models';
import { GatewayError } from '../gateway-error';
import { SessionLifecycle } from './session-lifecycle';
import { SESSION_SERVICE, type SessionServiceI } from './session-service';
import { SessionStorage } from './session-storage';
import { SessionStore } from './session-store';

/**
 * The session that keeps itself alive (plan 0003, section 8).
 *
 * Fake timers throughout, which is what makes "outlives its token" an assertion
 * rather than a fifteen minute test. `whenStable` hangs under them, so nothing
 * here awaits stability: the microtask queue is drained by hand where an
 * assertion needs a promise to have settled.
 *
 * The clock is the interesting input, so it is driven explicitly and every
 * instant a session carries is taken from it. A session built with a real
 * `new Date()` under fake timers is a session that expired in 1970.
 */

const MINUTE = 60_000;
const LIFETIME = 15 * MINUTE;
const RENEW_AT = LIFETIME * (1 - DEFAULT_SESSION_POLICY.renewFraction);
const WARN_AT = LIFETIME * (1 - DEFAULT_SESSION_POLICY.warnFraction);

const me: AdminMe = {
  admin: {
    adminId: 'adm_1',
    username: 'ops',
    displayName: 'Operations',
    lastLoginAt: null,
  },
  deployment: 'development',
};

/** A token minted at the current fake instant, lasting a quarter of an hour. */
function issue(): AdminSession {
  const now = Date.now();
  return {
    adminId: 'adm_1',
    username: 'ops',
    displayName: 'Operations',
    accessToken: `token-${now}`,
    expiresAt: new Date(now + LIFETIME),
    receivedAt: new Date(now),
  };
}

/** What the server did, per test. */
const control = { refreshes: 0, refreshFails: false };

const service: SessionServiceI = {
  signIn: async () => issue(),
  signInForDevelopment: async () => issue(),
  refresh: async () => {
    control.refreshes += 1;
    if (control.refreshFails) {
      throw new GatewayError({
        code: 'unauthorized',
        status: 401,
        correlationId: 'cid',
      });
    }
    return issue();
  },
  readMe: async () => me,
};

/**
 * Let every pending promise settle without letting the clock move.
 *
 * A renewal is `await`ed inside a timer callback, so advancing time is not
 * enough on its own: the microtasks it queued have to run before the next
 * assertion, and `jest.advanceTimersByTime` does not run them.
 */
async function drain(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

/** Move the clock and let everything it started finish. */
async function advance(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  await drain();
}

/**
 * A real interaction, of the kind that keeps a session alive.
 *
 * A minute passes first, because "active" means interacting **since** the token
 * was issued and under fake timers a sign in and the keystroke after it land on
 * the same millisecond. A test that skipped the minute would be asserting
 * against a session that is still, correctly, idle.
 */
async function interact(): Promise<void> {
  await advance(MINUTE);
  document.dispatchEvent(new Event('keydown'));
}

/** What `document.visibilityState` answers, which jsdom leaves read only. */
function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('SessionLifecycle', () => {
  let sessions: SessionStore;
  let lifecycle: SessionLifecycle;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-03T09:00:00.000Z'));
    sessionStorage.clear();
    control.refreshes = 0;
    control.refreshFails = false;
    setVisibility('visible');

    TestBed.configureTestingModule({
      providers: [
        { provide: SESSION_SERVICE, useValue: service },
        SessionStorage,
        SessionStore,
        SessionLifecycle,
      ],
    });

    sessions = TestBed.inject(SessionStore);
    lifecycle = TestBed.inject(SessionLifecycle);

    await sessions.signIn('ops', 'ops');
    await drain();
    lifecycle.start();
  });

  afterEach(() => {
    lifecycle.stop();
    // The fake service is a module level object, so a spy left on it would still
    // be there for the next test's own sign in and break it somewhere else
    // entirely.
    jest.restoreAllMocks();
    jest.useRealTimers();
    sessionStorage.clear();
  });

  /**
   * The first half of the plan, and the reason it exists: working continuously
   * never ends the session. An hour is four token lifetimes.
   */
  it('outlives its token while somebody is working', async () => {
    const first = sessions.token();

    for (let minute = 0; minute < 60; minute += 1) {
      await interact();
    }

    expect(sessions.signedIn()).toBe(true);
    expect(lifecycle.locked()).toBe(false);
    expect(lifecycle.warning()).toBe(false);
    expect(sessions.token()).not.toBe(first);
    // Renewals happen at half a lifetime, so an hour is a handful of them and
    // nothing like one per minute of interaction.
    expect(control.refreshes).toBeGreaterThanOrEqual(6);
    expect(control.refreshes).toBeLessThanOrEqual(10);
  });

  /** Nothing but the renewals. No polling, no `me`, no keepalive ping. */
  it('renews without making any other request', async () => {
    const calls = { readMe: 0 };
    jest.spyOn(service, 'readMe').mockImplementation(async () => {
      calls.readMe += 1;
      return me;
    });

    for (let minute = 0; minute < 20; minute += 1) {
      await interact();
    }

    expect(control.refreshes).toBeGreaterThan(0);
    expect(calls.readMe).toBe(0);
  });

  describe('an operator who walked away', () => {
    it('warns at the configured fraction, and not before', async () => {
      await advance(WARN_AT - MINUTE);
      expect(lifecycle.warning()).toBe(false);

      await advance(MINUTE);
      expect(lifecycle.warning()).toBe(true);
      expect(lifecycle.locked()).toBe(false);
      expect(control.refreshes).toBe(0);
    });

    it('expires if the warning is ignored', async () => {
      await advance(LIFETIME);

      expect(lifecycle.locked()).toBe(true);
      expect(lifecycle.warning()).toBe(false);
      expect(lifecycle.lockedUsername()).toBe('ops');
    });

    /**
     * Section 3: dismissing the warning and touching anything are the same act,
     * so the button does exactly what a keystroke does.
     */
    it.each([
      ['a keystroke', () => interact()],
      [
        'the warning button',
        () => TestBed.inject(SessionLifecycle).keepAlive(),
      ],
    ])('renews and dismisses the warning on %s', async (_case, act) => {
      await advance(WARN_AT);
      expect(lifecycle.warning()).toBe(true);

      await act();
      await drain();

      expect(lifecycle.warning()).toBe(false);
      expect(control.refreshes).toBe(1);
      expect(lifecycle.locked()).toBe(false);
    });
  });

  /**
   * Section 2. A backgrounded tab must not hold a session open; a phone in a
   * pocket is the case this exists for, and it is exactly what the fifteen
   * minute token is protecting against.
   */
  it('does not renew while the tab is hidden, however busy it looks', async () => {
    setVisibility('hidden');

    for (let minute = 0; minute < 14; minute += 1) {
      await interact();
    }

    expect(control.refreshes).toBe(0);

    await advance(2 * MINUTE);
    expect(lifecycle.locked()).toBe(true);
  });

  /**
   * The freeze and thaw case. A mobile browser can suspend a page and resume it
   * with timers that did not fire, so coming back to the foreground re-decides
   * against the real clock rather than trusting one that slept.
   */
  it('verifies its token when the page comes back to the foreground', async () => {
    setVisibility('hidden');
    await interact();

    // The clock moves past the renewal point with the tab in the background, so
    // the session is now overdue rather than merely due.
    await advance(RENEW_AT);
    expect(control.refreshes).toBe(0);

    setVisibility('visible');
    await drain();

    expect(control.refreshes).toBe(1);
    expect(lifecycle.locked()).toBe(false);
  });

  /** Section 4, from the timer's side rather than the interceptor's. */
  it('makes exactly one refresh call for two simultaneous triggers', async () => {
    let release: (() => void) | null = null;
    jest.spyOn(service, 'refresh').mockImplementation(async () => {
      control.refreshes += 1;
      await new Promise<void>((resolve) => (release = resolve));
      return issue();
    });

    await interact();
    // The timer's own renewal, and a 401 arriving at the same moment.
    await advance(RENEW_AT - MINUTE);
    const recovered = lifecycle.recover();
    await drain();

    expect(control.refreshes).toBe(1);

    release?.();
    await drain();
    await expect(recovered).resolves.toBe(true);
  });

  describe('a renewal that fails', () => {
    /**
     * A blink is not the end of a session. The token is still live, so the
     * failure is retried rather than turned into a password prompt.
     */
    it('is retried while the token is still live', async () => {
      control.refreshFails = true;
      await interact();

      await advance(RENEW_AT - MINUTE);
      expect(control.refreshes).toBe(1);
      expect(lifecycle.locked()).toBe(false);

      await advance(DEFAULT_SESSION_POLICY.renewRetryMs);
      expect(control.refreshes).toBe(2);
      expect(lifecycle.locked()).toBe(false);
    });

    it('still ends in the overlay when the token runs out', async () => {
      control.refreshFails = true;
      await interact();

      await advance(LIFETIME);

      expect(lifecycle.locked()).toBe(true);
    });

    /**
     * A "successful" renewal that did not move the expiry would be decided
     * against again immediately, and again, at whatever rate the network allows.
     * That is a server bug this app cannot fix and must not amplify into a
     * request loop against production.
     */
    it('does not loop when the server answers with the same expiry', async () => {
      const stale = issue();
      jest.spyOn(service, 'refresh').mockImplementation(async () => {
        control.refreshes += 1;
        return stale;
      });

      await interact();
      await advance(RENEW_AT - MINUTE);
      await advance(MINUTE);

      expect(control.refreshes).toBeLessThanOrEqual(3);
    });
  });

  describe('the overlay', () => {
    /** Section 5: expiry re-authenticates in place and loses nothing. */
    it('comes down on a password, and the session carries on', async () => {
      await advance(LIFETIME);
      expect(lifecycle.locked()).toBe(true);

      await expect(lifecycle.reauthenticate('ops')).resolves.toBeNull();

      expect(lifecycle.locked()).toBe(false);
      expect(sessions.signedIn()).toBe(true);
    });

    it('stays up, and says why, when the password is wrong', async () => {
      jest.spyOn(service, 'signIn').mockRejectedValue(
        new GatewayError({
          code: 'unauthorized',
          status: 401,
          correlationId: 'cid',
        })
      );

      await advance(LIFETIME);
      const failure = await lifecycle.reauthenticate('wrong');

      expect(failure).toEqual({ reason: 'invalid-credentials' });
      expect(lifecycle.locked()).toBe(true);
      // Still asking about the same operator, even though the refused attempt
      // cleared the session it was read from.
      expect(lifecycle.lockedUsername()).toBe('ops');
    });

    /** Section 6.4, and section 7: the one path that gives up the session. */
    it('drops the session and the queue when it is abandoned', async () => {
      await advance(LIFETIME);
      const held = lifecycle.recover();
      await drain();

      lifecycle.signOut();

      await expect(held).resolves.toBe(false);
      expect(lifecycle.locked()).toBe(false);
      expect(sessions.signedIn()).toBe(false);
      expect(sessionStorage.length).toBe(0);
    });

    /**
     * A 401 answered after a sign out is a request made too late, not an expiry.
     * There is nobody to ask for a password and no screen worth covering.
     */
    it('is not raised by a 401 with no session held', async () => {
      sessions.signOut();
      await drain();

      await expect(lifecycle.recover()).resolves.toBe(false);
      expect(lifecycle.locked()).toBe(false);
    });
  });

  /**
   * The store is what the rest of the app writes to, so a sign out made through
   * it has to stop the clock even though nothing told the lifecycle directly.
   */
  it('stops timing when the session is cleared elsewhere', async () => {
    sessions.signOut();
    TestBed.tick();
    await drain();

    await advance(2 * LIFETIME);

    expect(lifecycle.locked()).toBe(false);
    expect(lifecycle.warning()).toBe(false);
    expect(control.refreshes).toBe(0);
  });

  /**
   * A fresh sign in is deliberately not active: the click that submitted the
   * form happened before the token it produced. A tab signed in and walked away
   * from warns on its first lifetime rather than its second.
   */
  it('treats a session nobody has touched as idle from the start', async () => {
    await advance(WARN_AT);

    expect(lifecycle.warning()).toBe(true);
    expect(control.refreshes).toBe(0);
  });

  /**
   * The policy is a token so a spec can drive the whole keepalive in
   * milliseconds and the app can change its mind in one line.
   */
  it('takes its fractions from the injected policy', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: SESSION_SERVICE, useValue: service },
        {
          provide: ADMIN_SESSION_POLICY,
          // Warn as soon as the renewal point is declined rather than three
          // quarters of the way from it to expiry.
          useValue: { ...DEFAULT_SESSION_POLICY, warnFraction: 0.5 },
        },
        SessionStorage,
        SessionStore,
        SessionLifecycle,
      ],
    });

    const store = TestBed.inject(SessionStore);
    const eager = TestBed.inject(SessionLifecycle);
    await store.signIn('ops', 'ops');
    await drain();
    eager.start();

    // The renewal point, which under the default fractions is five minutes shy
    // of any warning at all.
    await advance(RENEW_AT);

    expect(eager.warning()).toBe(true);
    eager.stop();
  });
});
