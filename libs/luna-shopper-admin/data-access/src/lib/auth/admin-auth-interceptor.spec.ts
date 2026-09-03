import {
  HttpClient,
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
import { adminAuthInterceptor } from './admin-auth-interceptor';
import { SESSION_SERVICE, type SessionServiceI } from './session-service';
import { SessionStorage } from './session-storage';
import { SessionStore } from './session-store';

/**
 * The bearer header, and the one thing standing between an operator's token and
 * a third party (plan 0002, section 4).
 *
 * The scope check is asserted harder than the header itself, because getting it
 * wrong is a leaked credential rather than a broken request, and because the
 * shape of the mistake is specific: a substring match would send the token to
 * `https://evil.test/?next=https://api.example.test`.
 */

const GATEWAY = 'https://api.example.test';

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

describe('adminAuthInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let sessions: SessionStore;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([adminAuthInterceptor])),
        provideHttpClientTesting(),
        { provide: ADMIN_API_CONFIG, useValue: { gatewayBaseUrl: GATEWAY } },
        { provide: SESSION_SERVICE, useValue: service },
        ApiUrl,
        SessionStorage,
        SessionStore,
      ],
    });

    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    sessions = TestBed.inject(SessionStore);
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

  describe('a 401', () => {
    /**
     * The whole of this plan's reaction. No retry, no queue, no refresh: there is
     * no refresh token in this design to retry with. `0003` replaces this branch
     * entirely.
     */
    it('clears the session', async () => {
      await signIn();
      expect(sessions.signedIn()).toBe(true);

      const failed = firstValueFrom(
        http.get(`${GATEWAY}/v1/admin/auth/me`)
      ).catch(() => undefined);
      backend
        .expectOne(`${GATEWAY}/v1/admin/auth/me`)
        .flush(null, { status: 401, statusText: 'Unauthorized' });
      await failed;

      expect(sessions.signedIn()).toBe(false);
      expect(sessionStorage.length).toBe(0);
    });

    /**
     * A request that never arrived is status 0, and treating that as a rejected
     * token would sign an operator out every time their network blinked.
     */
    it('does not clear the session when the request never arrived', async () => {
      await signIn();

      const failed = firstValueFrom(
        http.get(`${GATEWAY}/v1/admin/auth/me`)
      ).catch(() => undefined);
      backend
        .expectOne(`${GATEWAY}/v1/admin/auth/me`)
        .error(new ProgressEvent('error'));
      await failed;

      expect(sessions.signedIn()).toBe(true);
    });

    it('does not clear the session on any other refusal', async () => {
      await signIn();

      const failed = firstValueFrom(
        http.get(`${GATEWAY}/v1/admin/things`)
      ).catch(() => undefined);
      backend
        .expectOne(`${GATEWAY}/v1/admin/things`)
        .flush(null, { status: 403, statusText: 'Forbidden' });
      await failed;

      expect(sessions.signedIn()).toBe(true);
    });
  });
});
