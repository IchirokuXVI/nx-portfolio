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
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

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
      expect(sessionStorage.length).toBe(0);
    });
  });

  it('forgets the session on sign out, including in storage', async () => {
    const store = setup(serviceThat({ session }));
    await store.signIn('ops', 'ops');

    store.signOut();

    expect(store.signedIn()).toBe(false);
    expect(sessionStorage.length).toBe(0);
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
});
