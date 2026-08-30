import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { APP_API_CONFIG, type SessionTokens } from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  StorageKeys,
} from '@portfolio/velista/platform';
import { ApiUrl } from '../api-url';
import { TokenStore } from './token-store';

const GATEWAY = 'https://gateway.test';
const REFRESH_URL = `${GATEWAY}/v1/auth/refresh`;

/** A JWT that expired an hour ago, so every call refreshes. */
function staleToken(): string {
  return jwt(Math.floor(Date.now() / 1000) - 3600);
}

/** A JWT whose exp is far in the future. */
function freshToken(): string {
  return jwt(Math.floor(Date.now() / 1000) + 3600);
}

function jwt(exp: number): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'RS256' })}.${encode({ exp, sub: 'u1' })}.sig`;
}

function pair(kind: 'TEMPORARY' | 'REGISTERED'): SessionTokens {
  return {
    userId: 'u1',
    kind,
    accessToken: staleToken(),
    refreshToken: 'refresh-1',
  };
}

/**
 * The three causes of plan 0035 are three separate bugs, and this file owns the first
 * one: an app resumed from the background signs the user out.
 *
 * The premise it corrects is that a failed refresh means a rejected token. It does not.
 * A refresh the server answered spent a single use token, and a refresh that never
 * reached a server spent nothing at all, and on a resume the second is the likely one:
 * the access token expired while the app was away, so the first request is guaranteed
 * to refresh, and the radio is at its least reliable in exactly that second.
 */
describe('TokenStore', () => {
  let tokens: TokenStore;
  let httpMock: HttpTestingController;
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideFakeBrowserFacade(storage),
        {
          provide: APP_API_CONFIG,
          useValue: {
            gatewayBaseUrl: GATEWAY,
            realtimeBaseUrl: 'https://realtime.test',
          },
        },
        ApiUrl,
        TokenStore,
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  /** Build the store over a stored pair, as a reload would find it. */
  function restore(
    kind: 'TEMPORARY' | 'REGISTERED' = 'REGISTERED'
  ): TokenStore {
    storage.set(StorageKeys.session, JSON.stringify(pair(kind)));
    tokens = TestBed.inject(TokenStore);
    return tokens;
  }

  /** Answer the one outstanding refresh with no response at all: status 0. */
  function answerWithNoResponse(): void {
    httpMock
      .expectOne(REFRESH_URL)
      .error(new ProgressEvent('error'), { status: 0 });
  }

  /** Answer it the way a server that rejected the token does. */
  function answerWithRejection(): void {
    httpMock
      .expectOne(REFRESH_URL)
      .flush(null, { status: 401, statusText: 'Unauthorized' });
  }

  describe('a refresh that reached no server', () => {
    it('keeps the session', async () => {
      // The bug this plan is named for. The pair thrown away here is the only way back
      // into the account, and the refresh token was not spent, because nothing
      // received it.
      const store = restore();
      const refreshing = store.ensureFreshToken();

      answerWithNoResponse();

      expect(await refreshing).toBeNull();
      expect(store.hasSession()).toBe(true);
      expect(store.tokens()?.refreshToken).toBe('refresh-1');
      expect(storage.get(StorageKeys.session)).toContain('refresh-1');
    });

    it('does not tell a guest their account is gone', async () => {
      // `guest-account-lost` raises `0028`'s panel, which is the one state in this app
      // with no way back from it. A phone in a lift must not produce it.
      const store = restore('TEMPORARY');
      const gate = store.authorizeOptionalAuthCall();

      answerWithNoResponse();

      expect(await gate).toEqual({ state: 'anonymous' });
    });
  });

  describe('a refresh the server answered', () => {
    it('clears the session', async () => {
      // Unchanged, and the case the old bare catch was written for: a refresh token is
      // single use, so one the server rejected is spent or revoked either way.
      const store = restore();
      const refreshing = store.ensureFreshToken();

      answerWithRejection();

      expect(await refreshing).toBeNull();
      expect(store.hasSession()).toBe(false);
      expect(storage.has(StorageKeys.session)).toBe(false);
    });

    it('tells a guest their account is gone', async () => {
      const store = restore('TEMPORARY');
      const gate = store.authorizeOptionalAuthCall();

      answerWithRejection();

      expect(await gate).toEqual({ state: 'guest-account-lost' });
    });

    it('clears the session when the body does not parse', async () => {
      // Also the server answering, so also spent. Rule D4: a 200 carrying something
      // this app cannot read is not a session.
      const store = restore();
      const refreshing = store.ensureFreshToken();

      httpMock.expectOne(REFRESH_URL).flush({ data: { nonsense: true } });

      expect(await refreshing).toBeNull();
      expect(store.hasSession()).toBe(false);
    });
  });

  it('keeps a valid access token without asking anybody', async () => {
    storage.set(
      StorageKeys.session,
      JSON.stringify({ ...pair('REGISTERED'), accessToken: freshToken() })
    );
    const store = TestBed.inject(TokenStore);

    await expect(store.ensureFreshToken()).resolves.not.toBeNull();
    httpMock.expectNone(REFRESH_URL);
  });
});
