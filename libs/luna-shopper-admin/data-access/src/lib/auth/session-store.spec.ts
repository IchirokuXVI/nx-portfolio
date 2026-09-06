import { TestBed } from '@angular/core/testing';
import type {
  AdminMe,
  AdminSession,
} from '@portfolio/luna-shopper-admin/models';
import { GatewayError } from '../gateway-error';
import { SESSION_SERVICE, type SessionServiceI } from './session-service';
import { SessionStorage } from './session-storage';
import { SessionStore } from './session-store';

/**
 * The one place a session is held (plan 0002, sections 3 and 6).
 *
 * The assertions worth having are about what the store does with a *failure*,
 * because the success path is one assignment: a refused sign in must leave
 * nothing behind, and a restored session must be visible before the first
 * navigation runs rather than a tick later.
 */

const session: AdminSession = {
  adminId: 'adm_1',
  username: 'ops',
  displayName: 'Operations',
  accessToken: 'a.b.c',
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  receivedAt: new Date(),
};

const me: AdminMe = {
  admin: {
    adminId: 'adm_1',
    username: 'ops',
    displayName: 'Operations',
    lastLoginAt: null,
  },
  deployment: 'development',
};

function serviceThat(
  outcome: { session: AdminSession } | { error: unknown }
): SessionServiceI {
  const answer = () =>
    'session' in outcome
      ? Promise.resolve(outcome.session)
      : Promise.reject(outcome.error);

  return {
    signIn: answer,
    signInForDevelopment: answer,
    refresh: answer,
    readMe: async (): Promise<AdminMe> => me,
  };
}

function setup(service: SessionServiceI) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: SESSION_SERVICE, useValue: service },
      SessionStorage,
      SessionStore,
    ],
  });
  return TestBed.inject(SessionStore);
}

describe('SessionStore', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('starts with no session', () => {
    const store = setup(serviceThat({ error: new Error('unused') }));

    expect(store.signedIn()).toBe(false);
    expect(store.token()).toBeNull();
  });

  it('holds the session a successful sign in produced', async () => {
    const store = setup(serviceThat({ session }));

    const failure = await store.signIn('ops', 'ops');

    expect(failure).toBeNull();
    expect(store.signedIn()).toBe(true);
    expect(store.token()).toBe('a.b.c');
    expect(store.session()?.username).toBe('ops');
  });

  /**
   * The change from the plan as written, seen from the store: a session written
   * on one page is there for the next one, because a reload is the case this
   * whole mechanism exists for.
   *
   * It has to be true **on construction**, not a tick later. The route guard runs
   * during the router's first navigation, and a store that restored itself
   * asynchronously would bounce a signed in operator to the login screen and then
   * quietly sign them back in behind it.
   */
  it('makes a stored session visible on construction', async () => {
    const first = setup(serviceThat({ session }));
    await first.signIn('ops', 'ops');

    // A fresh store over the same storage, as a reload produces.
    const afterReload = setup(serviceThat({ error: new Error('unused') }));

    expect(afterReload.signedIn()).toBe(true);
    expect(afterReload.token()).toBe('a.b.c');
  });

  describe('a refusal', () => {
    it('reports the reason rather than throwing', async () => {
      const store = setup(
        serviceThat({
          error: new GatewayError({
            code: 'unauthorized',
            status: 401,
            correlationId: 'cid',
          }),
        })
      );

      await expect(store.signIn('ops', 'wrong')).resolves.toEqual({
        reason: 'invalid-credentials',
      });
    });

    /**
     * Nothing in this plan can reach a sign in while already signed in, but a
     * store whose failure path is "change nothing" is one route change away from
     * holding a session the operator believes they replaced.
     */
    it('leaves no session behind, in memory or in storage', async () => {
      const store = setup(serviceThat({ session }));
      await store.signIn('ops', 'ops');
      expect(store.signedIn()).toBe(true);

      // A second store over the same storage, whose service refuses.
      const second = setup(serviceThat({ error: new Error('nope') }));
      expect(second.signedIn()).toBe(true);

      await second.signIn('ops', 'wrong');

      expect(second.signedIn()).toBe(false);
      expect(localStorage.length).toBe(0);
    });
  });

  it('forgets the session on sign out, including in storage', async () => {
    const store = setup(serviceThat({ session }));
    await store.signIn('ops', 'ops');

    store.signOut();

    expect(store.signedIn()).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  /**
   * `0003` is what notices a token running out and renews it. A store that
   * silently withheld an expiring token would leave this plan's interceptor
   * sending unauthenticated requests that fail in a way nothing explains.
   */
  it('hands out the token without judging its expiry', async () => {
    const nearlyOver = { ...session, expiresAt: new Date(Date.now() + 500) };
    const store = setup(serviceThat({ session: nearlyOver }));

    await store.signIn('ops', 'ops');

    expect(store.token()).toBe('a.b.c');
  });

  /** Plan 0013, sections 3 and 4. */
  describe('the other tabs', () => {
    const KEY = 'luna-shopper-admin.session';

    /** What another tab left in storage, as that tab would have written it. */
    function shared(token: string, minutes: number): void {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          adminId: 'adm_1',
          username: 'ops',
          displayName: 'Operations',
          accessToken: token,
          expiresAt: new Date(Date.now() + minutes * 60 * 1000).toISOString(),
          receivedAt: new Date().toISOString(),
        })
      );
    }

    /** A refresh that answers, and counts. */
    function countingService() {
      const calls = { refreshes: 0 };
      const service: SessionServiceI = {
        ...serviceThat({ session }),
        refresh: async () => {
          calls.refreshes += 1;
          return { ...session, accessToken: 'mine' };
        },
      };
      return { service, calls };
    }

    it('takes a session another tab renewed', async () => {
      const store = setup(serviceThat({ session }));
      await store.signIn('ops', 'ops');

      const taken = store.adopt({
        ...session,
        accessToken: 'theirs',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      });

      expect(taken).toBe(true);
      expect(store.token()).toBe('theirs');
    });

    /**
     * Storage is not written back. The tab that produced the session already
     * wrote it, and writing the same value again would be a second `storage`
     * event for every other tab to react to.
     */
    it('does not write back what it adopted', async () => {
      const store = setup(serviceThat({ session }));
      await store.signIn('ops', 'ops');
      const before = localStorage.getItem(KEY);

      store.adopt({
        ...session,
        accessToken: 'theirs',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      });

      expect(localStorage.getItem(KEY)).toBe(before);
    });

    it('refuses a session that does not supersede the held one', async () => {
      const store = setup(serviceThat({ session }));
      await store.signIn('ops', 'ops');

      expect(store.adopt({ ...session })).toBe(false);
      expect(store.token()).toBe('a.b.c');
    });

    /**
     * The whole point of plan 0013, section 4. Five tabs decide to renew at the
     * same instant because they all read the same expiry; the lock lets them in
     * one at a time, and every one after the first finds the answer already in
     * storage and asks the gateway for nothing.
     */
    it('makes no request when another tab has already renewed', async () => {
      const { service, calls } = countingService();
      const store = setup(service);
      await store.signIn('ops', 'ops');
      shared('theirs', 30);

      await expect(store.refresh()).resolves.toBe(true);

      expect(calls.refreshes).toBe(0);
      expect(store.token()).toBe('theirs');
    });

    /** A stored token no better than the held one is not a renewal. */
    it('renews for itself when storage holds nothing newer', async () => {
      const { service, calls } = countingService();
      const store = setup(service);
      await store.signIn('ops', 'ops');

      await expect(store.refresh()).resolves.toBe(true);

      expect(calls.refreshes).toBe(1);
      expect(store.token()).toBe('mine');
    });
  });

  /** Plan 0003, section 4. */
  describe('refresh', () => {
    const renewed: AdminSession = {
      ...session,
      accessToken: 'renewed.token',
    };

    /** A refresh that can be held open, so two callers can arrive during one. */
    function serviceThatHangs() {
      const calls = { refreshes: 0 };
      let release: ((session: AdminSession) => void) | null = null;

      const service: SessionServiceI = {
        ...serviceThat({ session }),
        refresh: () => {
          calls.refreshes += 1;
          return new Promise<AdminSession>((resolve) => (release = resolve));
        },
      };

      return { service, calls, finish: () => release?.(renewed) };
    }

    it('replaces the held session, and what storage holds', async () => {
      const store = setup(serviceThat({ session: renewed }));
      await store.signIn('ops', 'ops');

      await expect(store.refresh()).resolves.toBe(true);

      expect(store.token()).toBe('renewed.token');
      expect(localStorage.length).toBe(1);
    });

    /**
     * The keepalive timer and a 401 retry will want a renewal at the same
     * moment, and so will several requests that were in flight together. One
     * call is made and everybody awaits the same promise.
     */
    it('makes one call however many callers ask at once', async () => {
      const { service, calls, finish } = serviceThatHangs();
      const store = setup(service);
      await store.signIn('ops', 'ops');

      const both = Promise.all([store.refresh(), store.refresh()]);
      finish();

      await expect(both).resolves.toEqual([true, true]);
      expect(calls.refreshes).toBe(1);
    });

    /** The guard is per renewal, not for the life of the store. */
    it('will renew again once the first one has finished', async () => {
      const store = setup(serviceThat({ session: renewed }));
      await store.signIn('ops', 'ops');

      await store.refresh();
      await expect(store.refresh()).resolves.toBe(true);
    });

    /**
     * The failure is the caller's to interpret. A network that blinked must not
     * cost a session, so this reports and changes nothing; `SessionLifecycle`
     * decides whether to retry or to ask for a password.
     */
    it('reports a refusal without signing anybody out', async () => {
      const store = setup({
        ...serviceThat({ session }),
        refresh: () =>
          Promise.reject(
            new GatewayError({
              code: 'unauthorized',
              status: 401,
              correlationId: 'cid',
            })
          ),
      });
      await store.signIn('ops', 'ops');

      await expect(store.refresh()).resolves.toBe(false);

      expect(store.signedIn()).toBe(true);
      expect(store.token()).toBe('a.b.c');
    });

    /** Asking would send an unauthenticated request that nothing explains. */
    it('does not ask when there is nothing to renew', async () => {
      const { service, calls } = serviceThatHangs();
      const store = setup(service);

      await expect(store.refresh()).resolves.toBe(false);
      expect(calls.refreshes).toBe(0);
    });

    /**
     * An abandoned overlay, or a deliberate sign out, may land while a renewal
     * is in flight. Writing the answer would sign an operator back in after they
     * asked to leave.
     */
    it('discards a renewal that arrives after a sign out', async () => {
      const { service, finish } = serviceThatHangs();
      const store = setup(service);
      await store.signIn('ops', 'ops');

      const renewing = store.refresh();
      store.signOut();
      finish();

      await expect(renewing).resolves.toBe(false);
      expect(store.signedIn()).toBe(false);
      expect(localStorage.length).toBe(0);
    });
  });
});
