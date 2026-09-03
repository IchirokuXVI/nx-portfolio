import { TestBed } from '@angular/core/testing';
import { provideRouter, UrlTree } from '@angular/router';
import type { AdminSession } from '@portfolio/luna-shopper-admin/models';
import {
  requireNoSession,
  requireSession,
  SIGN_IN_PATH,
} from './session-guards';
import { SESSION_SERVICE, type SessionServiceI } from './session-service';
import { SessionStorage } from './session-storage';
import { SessionStore } from './session-store';

/**
 * The two guards, driven directly (plan 0002).
 *
 * Directly rather than through the router, because the router declines to
 * re-run a navigation that resolves to the URL it is already on, which hides
 * exactly the transition worth asserting: a session that has just been cleared.
 * The route table's own spec covers the wiring; this covers the decision.
 */

const session: AdminSession = {
  adminId: 'adm_1',
  username: 'ops',
  displayName: null,
  accessToken: 'a.b.c',
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
};

const service: SessionServiceI = {
  signIn: async () => session,
  signInForDevelopment: async () => session,
  readMe: async () => ({
    admin: {
      adminId: 'adm_1',
      username: 'ops',
      displayName: null,
      lastLoginAt: null,
    },
    deployment: 'development',
  }),
};

function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: SESSION_SERVICE, useValue: service },
      SessionStorage,
      SessionStore,
    ],
  });

  return {
    sessions: TestBed.inject(SessionStore),
    // The guards take a snapshot and a state they never read, so the arguments
    // are stubs; what they do read is the injector, which is what this supplies.
    run: (guard: typeof requireSession) =>
      TestBed.runInInjectionContext(() => guard(null as never, null as never)),
  };
}

const asPath = (result: unknown) =>
  result instanceof UrlTree ? result.toString() : result;

describe('requireSession', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it('lets a signed in operator through', async () => {
    const { sessions, run } = setup();
    await sessions.signIn('ops', 'pw');

    expect(run(requireSession)).toBe(true);
  });

  it('sends an operator with no session to the login screen', () => {
    const { run } = setup();

    expect(asPath(run(requireSession))).toBe(`/${SIGN_IN_PATH}`);
  });

  /** The transition a 401 produces, which is the reason this guard exists. */
  it('refuses once the session has been cleared', async () => {
    const { sessions, run } = setup();
    await sessions.signIn('ops', 'pw');
    expect(run(requireSession)).toBe(true);

    sessions.signOut();

    expect(asPath(run(requireSession))).toBe(`/${SIGN_IN_PATH}`);
  });
});

describe('requireNoSession', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it('lets a signed out operator reach the login screen', () => {
    const { run } = setup();

    expect(run(requireNoSession)).toBe(true);
  });

  /**
   * It answers with the **landing route**, never the URL it was handed. A guard
   * that redirects to the URL it is guarding loops forever with no error at all:
   * a white tab in a browser, and no output whatsoever in jest.
   */
  it('sends an operator who already has a session to the landing route', async () => {
    const { sessions, run } = setup();
    await sessions.signIn('ops', 'pw');

    expect(asPath(run(requireNoSession))).toBe('/');
  });

  it('never answers with the login screen, which would loop', async () => {
    const { sessions, run } = setup();
    await sessions.signIn('ops', 'pw');

    expect(asPath(run(requireNoSession))).not.toBe(`/${SIGN_IN_PATH}`);
  });
});
