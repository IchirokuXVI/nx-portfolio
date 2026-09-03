import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ADMIN_API_CONFIG,
  type AdminSession,
} from '@portfolio/luna-shopper-admin/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { GatewayError } from '../gateway-error';
import { adminAuthInterceptor } from './admin-auth-interceptor';
import { withoutSessionRecovery } from './session-http-context';
import { SessionLifecycle } from './session-lifecycle';
import { SESSION_SERVICE, type SessionServiceI } from './session-service';
import { SessionStorage } from './session-storage';
import { SessionStore } from './session-store';

/**
 * The bearer header, and what a 401 does about itself (plan 0002, section 4, and
 * plan 0003, section 6).
 *
 * The scope check is asserted harder than the header itself, because getting it
 * wrong is a leaked credential rather than a broken request, and because the
 * shape of the mistake is specific: a substring match would send the token to
 * `https://evil.test/?next=https://api.example.test`.
 */

const GATEWAY = 'https://api.example.test';

/**
 * Let everything the interceptor started finish.
 *
 * A macrotask rather than a chain of `Promise.resolve()`s, because the recovery
 * path is several awaits deep and counting them is a test that breaks when the
 * implementation gains one.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const session: AdminSession = {
  adminId: 'adm_1',
  username: 'ops',
  displayName: null,
  accessToken: 'a.b.c',
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  receivedAt: new Date(),
};

/** The renewal a retry is supposed to carry. A different token, deliberately. */
const renewed: AdminSession = {
  ...session,
  accessToken: 'renewed.token',
  expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  receivedAt: new Date(),
};

/** Driven per test: how many renewals were asked for, and whether they work. */
const control = { refreshes: 0, refreshFails: false };

const service: SessionServiceI = {
  signIn: async () => session,
  signInForDevelopment: async () => session,
  refresh: async () => {
    control.refreshes += 1;
    if (control.refreshFails) {
      throw new GatewayError({
        code: 'unauthorized',
        status: 401,
        correlationId: 'cid',
      });
    }
    return renewed;
  },
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

describe('adminAuthInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let sessions: SessionStore;
  let lifecycle: SessionLifecycle;

  beforeEach(() => {
    sessionStorage.clear();
    control.refreshes = 0;
    control.refreshFails = false;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([adminAuthInterceptor])),
        provideHttpClientTesting(),
        { provide: ADMIN_API_CONFIG, useValue: { gatewayBaseUrl: GATEWAY } },
        { provide: SESSION_SERVICE, useValue: service },
        ApiUrl,
        SessionStorage,
        SessionStore,
        SessionLifecycle,
      ],
    });

    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    sessions = TestBed.inject(SessionStore);
    lifecycle = TestBed.inject(SessionLifecycle);
  });

  afterEach(() => {
    backend.verify();
    sessionStorage.clear();
  });

  async function signIn() {
    await sessions.signIn('ops', 'ops');
  }

  it('attaches the token to a gateway request', async () => {
    await signIn();

    void firstValueFrom(http.get(`${GATEWAY}/v1/admin/auth/me`));

    const request = backend.expectOne(`${GATEWAY}/v1/admin/auth/me`);
    expect(request.request.headers.get('Authorization')).toBe('Bearer a.b.c');
    request.flush({});
  });

  it('sends no header when there is no session', () => {
    void firstValueFrom(http.get(`${GATEWAY}/v1/admin/environment`));

    const request = backend.expectOne(`${GATEWAY}/v1/admin/environment`);
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({});
  });

  describe('never to anything but the gateway', () => {
    it.each([
      ['a different origin', 'https://elsewhere.test/v1/admin/auth/me'],
      [
        'an origin that merely contains the gateway',
        'https://api.example.test.evil.test/v1/admin/auth/me',
      ],
      [
        'a URL carrying the gateway in a query parameter',
        `https://evil.test/?next=${GATEWAY}/v1/admin/auth/me`,
      ],
    ])('sends no token to %s', async (_case, url) => {
      await signIn();

      void firstValueFrom(http.get(url));

      const request = backend.expectOne(url);
      expect(request.request.headers.has('Authorization')).toBe(false);
      request.flush({});
    });
  });

  /**
   * Plan 0003, section 6. `0002` cleared the session and let the request fail,
   * which was honest for a plan with nothing to renew with. A 401 now pauses the
   * request instead, and the assertions below are written against the request's
   * own outcome rather than against the absence of an error, because "the save
   * silently never happened" is exactly the failure this section exists to
   * prevent and it looks like success from anywhere else.
   */
  describe('a 401', () => {
    const PATH = `${GATEWAY}/v1/admin/things`;

    /** A request that 401s, with its answer, for a test to assert on. */
    function send(): Promise<unknown> {
      return firstValueFrom(http.get(PATH)).catch((error: unknown) => error);
    }

    /** Refuse the first attempt with the status that starts all of this. */
    function reject(): void {
      backend
        .expectOne(PATH)
        .flush(null, { status: 401, statusText: 'Unauthorized' });
    }

    it('renews, retries against the new token, and answers normally', async () => {
      await signIn();

      const answer = send();
      reject();
      // The renewal is not an HTTP call here: `SESSION_SERVICE` is a fake, which
      // is what keeps this spec about the interceptor rather than about the API.
      await settle();

      const retry = backend.expectOne(PATH);
      expect(retry.request.headers.get('Authorization')).toBe(
        'Bearer renewed.token'
      );
      retry.flush({ ok: true });

      expect(await answer).toEqual({ ok: true });
      expect(control.refreshes).toBe(1);
      expect(sessions.signedIn()).toBe(true);
    });

    /**
     * Section 4, from the side that makes it matter: a screenful of requests
     * expiring together must not become a renewal each.
     */
    it('renews once for several requests that expired together', async () => {
      await signIn();

      const answers = [send(), send(), send()];
      for (const request of backend.match(PATH)) {
        request.flush(null, { status: 401, statusText: 'Unauthorized' });
      }
      await settle();

      const retries = backend.match(PATH);
      expect(retries).toHaveLength(3);
      for (const retry of retries) {
        expect(retry.request.headers.get('Authorization')).toBe(
          'Bearer renewed.token'
        );
        retry.flush({ ok: true });
      }

      expect(await Promise.all(answers)).toEqual([
        { ok: true },
        { ok: true },
        { ok: true },
      ]);
      expect(control.refreshes).toBe(1);
    });

    it('holds the request behind the overlay and retries after a password', async () => {
      await signIn();
      control.refreshFails = true;

      const answer = send();
      reject();
      await settle();

      // The token is dead, so the overlay is up and the request is still waiting
      // rather than failed.
      expect(lifecycle.locked()).toBe(true);
      backend.expectNone(PATH);

      await lifecycle.reauthenticate('ops');
      await settle();

      const retry = backend.expectOne(PATH);
      expect(retry.request.headers.get('Authorization')).toBe('Bearer a.b.c');
      retry.flush({ ok: true });

      expect(await answer).toEqual({ ok: true });
      expect(lifecycle.locked()).toBe(false);
    });

    /** The one path that loses work, and it takes a deliberate act. */
    it('fails the held request when the overlay is abandoned', async () => {
      await signIn();
      control.refreshFails = true;

      const answer = send();
      reject();
      await settle();

      lifecycle.signOut();

      expect(await answer).toBeInstanceOf(HttpErrorResponse);
      expect(sessions.signedIn()).toBe(false);
      expect(sessionStorage.length).toBe(0);
    });

    /**
     * Login and refresh answer their own 401s. Without the flag, refreshing
     * would refresh from inside a refresh and a wrong password would raise a
     * prompt to sign in again over the login screen.
     */
    it('does not recover a request that answers its own 401', async () => {
      await signIn();

      const answer = firstValueFrom(
        http.get(PATH, { context: withoutSessionRecovery() })
      ).catch((error: unknown) => error);
      reject();
      await settle();

      expect(await answer).toBeInstanceOf(HttpErrorResponse);
      expect(control.refreshes).toBe(0);
      expect(lifecycle.locked()).toBe(false);
    });

    /**
     * A request that never arrived is status 0, and treating that as a rejected
     * token would raise a password prompt every time a network blinked.
     */
    it('does not renew when the request never arrived', async () => {
      await signIn();

      const answer = send();
      backend.expectOne(PATH).error(new ProgressEvent('error'));
      await answer;

      expect(control.refreshes).toBe(0);
      expect(sessions.signedIn()).toBe(true);
    });

    it('does not renew on any other refusal', async () => {
      await signIn();

      const answer = send();
      backend
        .expectOne(PATH)
        .flush(null, { status: 403, statusText: 'Forbidden' });
      await answer;

      expect(control.refreshes).toBe(0);
      expect(sessions.signedIn()).toBe(true);
    });
  });
});
