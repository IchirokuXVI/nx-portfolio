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
  writeStorageElsewhere,
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
 * A pair as another document would have written it: a different refresh token, and an
 * access token that is good, because the other document just got it.
 */
function pairFromElsewhere(refreshToken = 'refresh-2'): SessionTokens {
  return {
    userId: 'u1',
    kind: 'TEMPORARY',
    username: '',
    accessToken: freshToken(),
    refreshToken,
  } as SessionTokens;
}

/**
 * Let the store's own promise chain run before asserting on what it did next.
 *
 * Answering a request settles it a microtask later, so a retry the store decides to
 * make has not been issued yet on the line after the answer.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The session is the account, so this file is about the one question that decides
 * whether one survives: **what is allowed to delete it.**
 *
 * Plan 0035 answered "not a request that got no answer". Plan 0067 finishes the
 * answer, because "the server said something" turned out to be a far wider net than
 * "the server refused this token", and everything caught in the gap between them is an
 * outage rather than a rejection: a 500 from a gateway whose broker call to auth found
 * nobody, a 503 from the proxy while the auth pod restarts, a captive portal answering
 * 200 with its own login page. Every one of those used to sign the user out, and for a
 * temporary user that is the whole account.
 *
 * The second half is that one origin holds more than one document. The installed app
 * and the browser tab share a `localStorage` and rotate each other's refresh tokens, so
 * a real 401 is not proof of anything until the pair that earned it is checked against
 * what is stored now.
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
  function answerWithRejection(status = 401): void {
    httpMock.expectOne(REFRESH_URL).flush(null, { status, statusText: 'no' });
  }

  describe('a refresh that reached no server', () => {
    it('keeps the session', async () => {
      // Plan 0035's bug. The pair thrown away here is the only way back into the
      // account, and the refresh token was not spent, because nothing received it.
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

      expect(await gate).toEqual({ state: 'unavailable' });
    });
  });

  describe('a refresh the server could not answer for', () => {
    // Plan 0067, section 2. The refresh route is a broker call behind the gateway, so
    // an auth service that is restarting answers 500 and a gateway pod that is down
    // gets the proxy's 503. Every deploy opens that window, and every app resuming
    // inside it used to be signed out for good.
    it.each([
      ['auth is restarting behind the gateway', 500],
      ['the proxy has nothing to route to', 503],
      ['the gateway timed out on the broker', 504],
      ['the request was throttled', 429],
    ])('keeps the session when %s', async (_case, status) => {
      const store = restore();
      const refreshing = store.ensureFreshToken();

      answerWithRejection(status);

      expect(await refreshing).toBeNull();
      expect(store.hasSession()).toBe(true);
      expect(storage.get(StorageKeys.session)).toContain('refresh-1');
    });

    it('keeps the session when the body does not parse', async () => {
      // A captive portal answering 200 with its own login page is exactly this shape,
      // and a supermarket wifi is where this app is used. Rule D4 still says it is not
      // a session, so the refresh fails; it is not a refusal, so the pair stays. If it
      // really was spent, the next attempt is answered 401 and cleared then.
      const store = restore();
      const refreshing = store.ensureFreshToken();

      httpMock.expectOne(REFRESH_URL).flush({ data: { nonsense: true } });

      expect(await refreshing).toBeNull();
      expect(store.hasSession()).toBe(true);
    });

    it('reports a held session as unavailable rather than anonymous', async () => {
      // The expensive half of plan 0067. The caller's next move is a route that mints
      // a guest account when it sees no identity, so "anonymous" here hands somebody a
      // second, empty account and leaves their groups on the first.
      const store = restore('TEMPORARY');
      const gate = store.authorizeOptionalAuthCall();

      answerWithRejection(500);

      expect(await gate).toEqual({ state: 'unavailable' });
    });
  });

  describe('a refresh the server refused', () => {
    it.each([
      ['401', 401],
      ['403', 403],
    ])('clears the session on a %s', async (_case, status) => {
      // The case the old bare catch was written for, and the only one left: a refresh
      // token is single use, so one the server rejected is spent or revoked either way.
      const store = restore();
      const refreshing = store.ensureFreshToken();

      answerWithRejection(status);

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
  });

  describe('the other document on this origin', () => {
    // Plan 0067, section 3. The installed app and the browser tab are two documents
    // over one `localStorage`, each holding its own copy of the pair, and the backend
    // revokes the presented token on every rotation.

    it('adopts a pair it wrote', () => {
      const store = restore();

      writeStorageElsewhere(
        storage,
        StorageKeys.session,
        JSON.stringify(pairFromElsewhere())
      );

      expect(store.tokens()?.refreshToken).toBe('refresh-2');
    });

    it('signs out when it removed the key', () => {
      // Nothing but this store removes that key, and it removes it on a deliberate
      // sign out or an account deletion. Both should reach every window.
      const store = restore();

      writeStorageElsewhere(storage, StorageKeys.session, null);

      expect(store.hasSession()).toBe(false);
    });

    it('ignores a value it cannot read', () => {
      // One corrupt write on a shared origin must not end a working session.
      const store = restore();

      writeStorageElsewhere(storage, StorageKeys.session, 'not json');

      expect(store.hasSession()).toBe(true);
      expect(store.tokens()?.refreshToken).toBe('refresh-1');
    });

    it('uses its pair instead of spending one that it already rotated', async () => {
      // The tab wakes holding a pair the installed app replaced an hour ago. Presenting
      // it earns a truthful 401 and used to sign the user out of both windows. There is
      // nothing to ask the server here: what is stored is newer and still good.
      const store = restore();
      storage.set(
        StorageKeys.session,
        JSON.stringify(pairFromElsewhere('refresh-9'))
      );

      const token = await store.ensureFreshToken();

      httpMock.expectNone(REFRESH_URL);
      expect(token).not.toBeNull();
      expect(store.tokens()?.refreshToken).toBe('refresh-9');
    });

    it('adopts and retries rather than clearing when its 401 was a lost race', async () => {
      // Both documents refreshed on the same resume. This one lost, so its 401 is
      // real, and the account behind it is perfectly fine.
      const store = restore();
      const refreshing = store.ensureFreshToken();

      const rotated = {
        ...pairFromElsewhere('refresh-3'),
        accessToken: staleToken(),
      };
      storage.set(StorageKeys.session, JSON.stringify(rotated));
      answerWithRejection();
      await settle();

      // Adopted, and the retry goes out on the newer token rather than on the dead one.
      const retry = httpMock.expectOne(REFRESH_URL);
      expect(retry.request.body).toEqual({ refreshToken: 'refresh-3' });
      retry.flush({ ...pairFromElsewhere('refresh-4') });

      expect(await refreshing).not.toBeNull();
      expect(store.hasSession()).toBe(true);
      expect(store.tokens()?.refreshToken).toBe('refresh-4');
    });
  });

  describe('reportRejected', () => {
    it('clears when the refused pair is still the one this origin holds', () => {
      const store = restore();

      store.reportRejected(pair('REGISTERED'));

      expect(store.hasSession()).toBe(false);
      expect(storage.has(StorageKeys.session)).toBe(false);
    });

    it('adopts instead when another document has already replaced it', () => {
      const store = restore();
      storage.set(StorageKeys.session, JSON.stringify(pairFromElsewhere()));

      store.reportRejected(pair('REGISTERED'));

      expect(store.hasSession()).toBe(true);
      expect(store.tokens()?.refreshToken).toBe('refresh-2');
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
