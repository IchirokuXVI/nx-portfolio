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
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import { APP_API_CONFIG } from '@portfolio/velista/models';
import { provideFakeBrowserFacade } from '@portfolio/velista/platform';
import { VELISTA_DATA_ACCESS_PROVIDERS } from '../data-access-providers';
import { gatewayInterceptor } from '../gateway-interceptor';
import { GatewayError } from '../errors';
import { AuthApi } from './auth-api';
import { TokenStore } from './token-store';

const GATEWAY = 'https://gateway.example';

function jwt(exp: number): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'RS256' })}.${encode({ exp, sub: 'u1' })}.sig`;
}

const fresh = () => jwt(Math.floor(Date.now() / 1000) + 3600);

/** What the gateway answers on a successful register, login or upgrade. */
function pair(userId = 'u1', kind = 'REGISTERED') {
  return {
    userId,
    kind,
    username: 'dani',
    accessToken: fresh(),
    refreshToken: 'refresh-1',
  };
}

describe('AuthApi', () => {
  let api: AuthApi;
  let httpMock: HttpTestingController;
  let tokens: TokenStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([gatewayInterceptor])),
        provideHttpClientTesting(),
        {
          provide: APP_API_CONFIG,
          useValue: {
            gatewayBaseUrl: GATEWAY,
            realtimeBaseUrl: 'https://realtime.example',
          },
        },
        { provide: RokuTranslatorService, useValue: { getLocale: () => 'en' } },
        provideFakeBrowserFacade(new Map()),
        // Rule D5: these read `APP_API_CONFIG`, so the app injector owns them and a
        // spec has to install them the same way the app does.
        ...VELISTA_DATA_ACCESS_PROVIDERS,
        AuthApi,
      ],
    });

    api = TestBed.inject(AuthApi);
    httpMock = TestBed.inject(HttpTestingController);
    tokens = TestBed.inject(TokenStore);
    TestBed.inject(HttpClient);
  });

  afterEach(() => httpMock.verify());

  describe('signing in', () => {
    it('sends the pair anonymously and stores what comes back', async () => {
      const result = api.login('marta@example.com', 'password123');

      const request = httpMock.expectOne(`${GATEWAY}/v1/auth/login`);
      expect(request.request.body).toEqual({
        email: 'marta@example.com',
        password: 'password123',
      });
      // No bearer: there is nothing to send, and a 401 from this route means the
      // credentials were wrong rather than that a session lapsed.
      expect(request.request.headers.has('Authorization')).toBe(false);
      request.flush(pair());

      await result;

      // Signing in means the app is signed in afterwards. Leaving that to the page
      // would make forgetting it look like a successful sign in that did nothing.
      expect(tokens.tokens()?.userId).toBe('u1');
    });

    it('does not try to refresh when the credentials are rejected', async () => {
      const result = api.login('marta@example.com', 'wrong');

      httpMock
        .expectOne(`${GATEWAY}/v1/auth/login`)
        .flush(
          { code: 'unauthorized', correlationId: 'c1' },
          { status: 401, statusText: 'Unauthorized' }
        );

      await expect(result).rejects.toBeInstanceOf(GatewayError);
      // A refresh here would spend the caller's refresh token on their behalf over a
      // typo. `httpMock.verify()` in `afterEach` is what proves none was sent.
    });
  });

  describe('registering', () => {
    it('sends two fields and never a display name', async () => {
      // The backend generates a username regardless of what is sent, and the display
      // name is not the public cross zone handle (section 5.1).
      const result = api.register('marta@example.com', 'password123');

      const request = httpMock.expectOne(`${GATEWAY}/v1/auth/register`);
      expect(Object.keys(request.request.body as object)).toEqual([
        'email',
        'password',
      ]);
      request.flush(pair());

      await result;
    });
  });

  describe('upgrading', () => {
    it('sends a bearer token and no user id in the body', async () => {
      // The user id comes from the token and never from the body, which is what makes
      // this safe to offer at all.
      tokens.set({
        userId: 'u-guest',
        kind: 'TEMPORARY',
        username: 'dani',
        accessToken: fresh(),
        refreshToken: 'refresh-0',
      });

      const result = api.upgrade('marta@example.com', 'password123');

      const request = httpMock.expectOne(`${GATEWAY}/v1/auth/upgrade`);
      expect(request.request.headers.get('Authorization')).toBe(
        `Bearer ${tokens.tokens()?.accessToken}`
      );
      expect(request.request.body).toEqual({
        email: 'marta@example.com',
        password: 'password123',
      });
      request.flush(pair('u-guest'));

      await result;
    });

    it('stores the pair, which is what stops the app still calling them a guest', async () => {
      tokens.set({
        userId: 'u-guest',
        kind: 'TEMPORARY',
        username: 'dani',
        accessToken: fresh(),
        refreshToken: 'refresh-0',
      });

      const result = api.upgrade('marta@example.com', 'password123');
      httpMock
        .expectOne(`${GATEWAY}/v1/auth/upgrade`)
        .flush(pair('u-guest', 'REGISTERED'));
      await result;

      // The same user id, and the kind flipped. Both matter: the id is what every
      // membership hangs off, and the kind is what takes the guest banner away.
      expect(tokens.tokens()?.userId).toBe('u-guest');
      expect(tokens.tokens()?.kind).toBe('REGISTERED');
    });
  });

  describe('confirming an email', () => {
    it('sends the token anonymously and answers a user id', async () => {
      const result = api.verifyEmail('raw-token');

      const request = httpMock.expectOne(`${GATEWAY}/v1/auth/verify-email`);
      expect(request.request.body).toEqual({ token: 'raw-token' });
      expect(request.request.headers.has('Authorization')).toBe(false);
      request.flush({ userId: 'u1' });

      await expect(result).resolves.toEqual({ userId: 'u1' });
    });

    it('does not sign anybody in', async () => {
      // Confirming an email is not a session. Minting one from a link in an inbox
      // would be the client inventing an identity.
      const result = api.verifyEmail('raw-token');
      httpMock.expectOne(`${GATEWAY}/v1/auth/verify-email`).flush({ userId: 'u1' });
      await result;

      expect(tokens.tokens()).toBeNull();
    });
  });

  describe('asking for another confirmation email', () => {
    it('reads the wait out of the body on a refusal', async () => {
      // Rule C3, and the header route is closed: `enableCors` names no
      // `exposedHeaders`, so a browser cannot read `Retry-After` from this API cross
      // origin.
      tokens.set({
        userId: 'u1',
        kind: 'REGISTERED',
        username: 'dani',
        accessToken: fresh(),
        refreshToken: 'refresh-1',
      });

      const result = api.resendVerification();

      httpMock.expectOne(`${GATEWAY}/v1/auth/verify-resend`).flush(
        {
          code: 'rate_limited',
          correlationId: 'c1',
          retryAfterSeconds: 451,
        },
        { status: 429, statusText: 'Too Many Requests' }
      );

      await expect(result).resolves.toEqual({
        state: 'refused',
        waitSeconds: 451,
      });
    });

    it('reports no wait rather than inventing one', async () => {
      tokens.set({
        userId: 'u1',
        kind: 'REGISTERED',
        username: 'dani',
        accessToken: fresh(),
        refreshToken: 'refresh-1',
      });

      const result = api.resendVerification();

      httpMock
        .expectOne(`${GATEWAY}/v1/auth/verify-resend`)
        .flush(
          { code: 'rate_limited', correlationId: 'c1' },
          { status: 429, statusText: 'Too Many Requests' }
        );

      await expect(result).resolves.toEqual({
        state: 'refused',
        waitSeconds: null,
      });
    });

    it('reports a send with the wait until the next one is allowed', async () => {
      tokens.set({
        userId: 'u1',
        kind: 'REGISTERED',
        username: 'dani',
        accessToken: fresh(),
        refreshToken: 'refresh-1',
      });

      const result = api.resendVerification();
      httpMock
        .expectOne(`${GATEWAY}/v1/auth/verify-resend`)
        .flush({ retryAfterSeconds: 52 });

      await expect(result).resolves.toEqual({ state: 'sent', waitSeconds: 52 });
    });

    it('reports anything else as a failure rather than as a wait', async () => {
      tokens.set({
        userId: 'u1',
        kind: 'REGISTERED',
        username: 'dani',
        accessToken: fresh(),
        refreshToken: 'refresh-1',
      });

      const result = api.resendVerification();
      httpMock
        .expectOne(`${GATEWAY}/v1/auth/verify-resend`)
        .flush(
          { code: 'internal', correlationId: 'c1' },
          { status: 500, statusText: 'Server Error' }
        );

      await expect(result).resolves.toMatchObject({ state: 'failed' });
    });
  });

  describe('rule D4, on the token pair', () => {
    it('refuses to store a pair it could not map', async () => {
      // A half stored session is worse than none: the app would look signed in and
      // fail every request afterwards.
      const result = api.login('marta@example.com', 'password123');
      httpMock
        .expectOne(`${GATEWAY}/v1/auth/login`)
        .flush({ userId: 'u1' });

      await expect(result).rejects.toThrow();
      expect(tokens.tokens()).toBeNull();
    });
  });
});
