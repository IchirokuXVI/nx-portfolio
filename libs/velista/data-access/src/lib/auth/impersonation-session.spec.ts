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
import {
  APP_API_CONFIG,
  APP_BASE_PATH,
  APP_VERSION,
  type SessionTokens,
} from '@portfolio/velista/models';
import {
  AppUpdates,
  ImpersonationState,
  provideFakeBrowserFacade,
  StorageKeys,
} from '@portfolio/velista/platform';
import { VELISTA_DATA_ACCESS_PROVIDERS } from '../data-access-providers';
import { gatewayInterceptor } from '../gateway-interceptor';
import {
  IMPERSONATION_END_WAIT_MS,
  IMPERSONATION_EXCHANGE_WAIT_MS,
  ImpersonationSession,
} from './impersonation-session';
import { TokenStore } from './token-store';

const GATEWAY = 'https://gateway.test';
const ENDED = '/velista/en/auth/support-ended';
const HOUR_S = 3600;

function jwt(payload: object): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'RS256' })}.${encode(payload)}.sig`;
}

const nowS = () => Math.floor(Date.now() / 1000);

/** The pair of a support session that ends `untilS` seconds from now. */
function sessionPair(untilS = 2 * HOUR_S, refreshToken = 'r1'): SessionTokens {
  return {
    userId: 'u1',
    kind: 'REGISTERED',
    username: 'marta_r',
    accessToken: jwt({
      sub: 'u1',
      exp: nowS() + Math.min(untilS, 900),
      act: { sub: 'admin', sid: 's1', until: nowS() + untilS },
    }),
    refreshToken,
  };
}

function ordinaryPair(): SessionTokens {
  return {
    userId: 'op',
    kind: 'REGISTERED',
    username: 'operator',
    accessToken: jwt({ sub: 'op', exp: nowS() + 900 }),
    refreshToken: 'op-refresh',
  };
}

interface Setup {
  readonly support: ImpersonationSession;
  readonly http: HttpTestingController;
  readonly state: ImpersonationState;
  readonly persisted: Map<string, string>;
  readonly tab: Map<string, string>;
  readonly replaceDocument: jest.Mock;
  readonly written: string[];
}

/**
 * `tab` stands for `sessionStorage` and `persisted` for whatever the facade's
 * persisted keys use. In an ordinary tab the two are kept apart to see who writes
 * where. In an active tab the persisted keys are `sessionStorage` too, so a spec passes
 * one `Map` for both: the facade's own spec proves that routing.
 *
 * The double keeps the facade's rule for leaving a document: after the first
 * `replaceDocument`, every write and every removal of the tab's storage does nothing,
 * and so does a second call. The persisted keys of an ordinary tab are the origin's and
 * stay open. `browser-facade.spec.ts` proves that rule on the real facade.
 */
function setUp(options: {
  readonly active: boolean;
  readonly persisted?: Map<string, string>;
  readonly tab?: Map<string, string>;
}): Setup {
  const persisted = options.persisted ?? new Map<string, string>();
  const tab =
    options.tab ??
    new Map<string, string>(
      options.active ? [[StorageKeys.supportSession, '1']] : []
    );
  let leaving = false;
  const replaceDocument = jest.fn();
  const written: string[] = [];
  const unlessLeaving =
    <A extends unknown[]>(write: (...args: A) => void) =>
    (...args: A) => {
      if (!leaving) {
        write(...args);
      }
    };
  // The persisted keys are this tab's only in an active tab. In an ordinary one they are
  // the origin's `localStorage`, which stays open after the document asked to leave.
  const persistedUnlessLeaving = <A extends unknown[]>(
    write: (...args: A) => void
  ) => (options.active ? unlessLeaving(write) : write);

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([gatewayInterceptor])),
      provideHttpClientTesting(),
      {
        provide: APP_API_CONFIG,
        useValue: { gatewayBaseUrl: GATEWAY, realtimeBaseUrl: 'https://rt' },
      },
      { provide: RokuTranslatorService, useValue: { getLocale: () => 'en' } },
      { provide: APP_BASE_PATH, useValue: '/velista' },
      { provide: APP_VERSION, useValue: '1.0.0' },
      { provide: AppUpdates, useValue: { checkNow: jest.fn() } },
      provideFakeBrowserFacade(persisted, {
        writeStorage: persistedUnlessLeaving(
          (key: string, value: string) => void persisted.set(key, value)
        ),
        removeStorage: persistedUnlessLeaving(
          (key: string) => void persisted.delete(key)
        ),
        readSessionStorage: (key: string) => tab.get(key) ?? null,
        writeSessionStorage: unlessLeaving((key: string, value: string) => {
          written.push(key);
          tab.set(key, value);
        }),
        removeSessionStorage: unlessLeaving(
          (key: string) => void tab.delete(key)
        ),
        removeSessionStorageWhere: unlessLeaving(
          (match: (key: string) => boolean) => {
            [...tab.keys()].filter(match).forEach((key) => tab.delete(key));
          }
        ),
        replaceDocument: unlessLeaving((url: string) => {
          leaving = true;
          replaceDocument(url);
        }),
      }),
      ...VELISTA_DATA_ACCESS_PROVIDERS,
    ],
  });

  const support = TestBed.inject(ImpersonationSession);
  TestBed.tick();

  return {
    support,
    http: TestBed.inject(HttpTestingController),
    state: TestBed.inject(ImpersonationState),
    persisted,
    tab,
    replaceDocument,
    written,
  };
}

/**
 * A tab that holds a session. One `Map` for the tab and the persisted keys: in an
 * active tab they are the same store, so the pair `TokenStore` reads is the pair an end
 * has to remove.
 */
function active(pair: SessionTokens | null = sessionPair()): Setup {
  const tab = new Map<string, string>([[StorageKeys.supportSession, '1']]);
  if (pair !== null) {
    tab.set(StorageKeys.session, JSON.stringify(pair));
  }
  return setUp({ active: true, persisted: tab, tab });
}

function expectEnded(setup: Setup): void {
  expect(setup.replaceDocument).toHaveBeenCalledWith(ENDED);
  expect(setup.tab.has(StorageKeys.supportSession)).toBe(false);
  expect(setup.tab.has(StorageKeys.session)).toBe(false);
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('ImpersonationSession', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('the handoff', () => {
    it('trades the code with no token of the operator on the request', async () => {
      const persisted = new Map([
        [StorageKeys.session, JSON.stringify(ordinaryPair())],
      ]);
      const { support, http } = setUp({ active: false, persisted });

      const answer = support.exchange('the-code');
      const req = http.expectOne(`${GATEWAY}/v1/auth/impersonation/exchange`);
      expect(req.request.body).toEqual({ code: 'the-code' });
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush(sessionPair());

      const outcome = await answer;
      expect(outcome.state).toBe('opened');
      http.verify();
    });

    it('answers invalid for a code the server refuses, whatever the reason', async () => {
      const { support, http } = setUp({ active: false });

      const answer = support.exchange('old');
      http
        .expectOne(`${GATEWAY}/v1/auth/impersonation/exchange`)
        .flush(
          { code: 'impersonation_code_invalid' },
          { status: 400, statusText: 'Bad Request' }
        );

      expect(await answer).toEqual({ state: 'invalid' });
    });

    it.each([
      ['a server error', { code: 'internal' }, 500],
      ['an answer it cannot read', { nope: true }, 200],
    ])(
      'answers failed for %s, since the code may still be good',
      async (_, body, status) => {
        const { support, http } = setUp({ active: false });

        const answer = support.exchange('code');
        http
          .expectOne(`${GATEWAY}/v1/auth/impersonation/exchange`)
          .flush(body, { status, statusText: 'x' });

        expect(await answer).toEqual({ state: 'failed' });
      }
    );

    it('writes the marker, then the pair, to this tab, and loads home as a new document', () => {
      const persisted = new Map([
        [StorageKeys.session, JSON.stringify(ordinaryPair())],
      ]);
      const tab = new Map([
        ['last-list:velista', 'left by the last session'],
        ['something:shell', 'not ours'],
      ]);
      const { support, written, replaceDocument } = setUp({
        active: false,
        persisted,
        tab,
      });
      const pair = sessionPair();

      support.begin(pair);

      expect(written).toEqual([
        StorageKeys.supportSession,
        StorageKeys.session,
      ]);
      expect(JSON.parse(tab.get(StorageKeys.session) ?? '')).toEqual(pair);
      expect(tab.has('last-list:velista')).toBe(false);
      expect(tab.get('something:shell')).toBe('not ours');
      // The operator's account is not touched.
      expect(JSON.parse(persisted.get(StorageKeys.session) ?? '')).toEqual(
        ordinaryPair()
      );
      expect(replaceDocument).toHaveBeenCalledWith('/velista/en/home');
    });
  });

  describe('an ordinary tab', () => {
    it('draws no strip, sets no clock and leaves the pair alone', () => {
      jest.useFakeTimers();
      const persisted = new Map([
        [StorageKeys.session, JSON.stringify(ordinaryPair())],
      ]);
      const { state, replaceDocument } = setUp({ active: false, persisted });

      jest.advanceTimersByTime(3 * HOUR_S * 1000);
      TestBed.inject(TokenStore).clear();
      TestBed.tick();

      expect(state.session()).toBeNull();
      expect(replaceDocument).not.toHaveBeenCalled();
    });
  });

  describe('a tab that holds a session', () => {
    it('shows the name from the pair and the deadline from the claim', () => {
      const pair = sessionPair(HOUR_S);
      const { state } = active(pair);

      expect(state.session()?.username).toBe('marta_r');
      expect(state.session()?.until.getTime()).toBe((nowS() + HOUR_S) * 1000);
    });

    it('ends when the clock reaches the deadline', () => {
      jest.useFakeTimers();
      const setup = active(sessionPair(HOUR_S));

      jest.advanceTimersByTime(HOUR_S * 1000 - 1000);
      expect(setup.replaceDocument).not.toHaveBeenCalled();

      jest.advanceTimersByTime(2000);
      expectEnded(setup);
    });

    it('ends on End, after telling the server', async () => {
      const setup = active();

      void setup.support.endByHand();
      const req = setup.http.expectOne(`${GATEWAY}/v1/auth/impersonation/end`);
      expect(req.request.headers.get('Authorization')).toMatch(/^Bearer /);
      expect(setup.replaceDocument).not.toHaveBeenCalled();
      req.flush({ ended: true }, { status: 201, statusText: 'Created' });
      await settle();

      expectEnded(setup);
    });

    it('ends on End when the request fails', async () => {
      const setup = active();

      void setup.support.endByHand();
      setup.http
        .expectOne(`${GATEWAY}/v1/auth/impersonation/end`)
        .flush({ code: 'internal' }, { status: 500, statusText: 'x' });
      await settle();

      expectEnded(setup);
    });

    it('ends on End when the server does not answer in time', async () => {
      jest.useFakeTimers();
      const setup = active();

      void setup.support.endByHand();
      setup.http.expectOne(`${GATEWAY}/v1/auth/impersonation/end`);
      await jest.advanceTimersByTimeAsync(IMPERSONATION_END_WAIT_MS + 10);

      expectEnded(setup);
    });

    it('reaches End through the strip', async () => {
      const setup = active();

      setup.state.end();
      setup.http
        .expectOne(`${GATEWAY}/v1/auth/impersonation/end`)
        .flush({ ended: true });
      await settle();

      expectEnded(setup);
    });

    it('ends on a 401 impersonation_ended, with no refresh', async () => {
      const setup = active();
      const http = TestBed.inject(HttpClient);

      http.get(`${GATEWAY}/v1/zones`).subscribe({ error: () => undefined });
      setup.http
        .expectOne(`${GATEWAY}/v1/zones`)
        .flush(
          { code: 'impersonation_ended' },
          { status: 401, statusText: 'Unauthorized' }
        );
      await settle();

      setup.http.expectNone(`${GATEWAY}/v1/auth/refresh`);
      expectEnded(setup);
    });

    it('ends when the server refuses a refresh', async () => {
      const setup = active();

      void TestBed.inject(TokenStore).refresh();
      setup.http
        .expectOne(`${GATEWAY}/v1/auth/refresh`)
        .flush(
          { code: 'impersonation_ended' },
          { status: 401, statusText: 'Unauthorized' }
        );
      await settle();
      TestBed.tick();

      expectEnded(setup);
    });

    it('ends a pair with no act, which is a defect', () => {
      expectEnded(active(ordinaryPair()));
    });

    it('ends a tab that started with the marker and no pair', () => {
      expectEnded(active(null));
    });

    it('ends once, whatever ends it first', async () => {
      jest.useFakeTimers();
      const setup = active(sessionPair(60));

      setup.support.endedByServer();
      jest.advanceTimersByTime(120_000);
      setup.support.endedByServer();

      expect(setup.replaceDocument).toHaveBeenCalledTimes(1);
    });

    it('writes no pair back when a refresh lands after the end', async () => {
      const setup = active();

      void TestBed.inject(TokenStore).refresh();
      const refresh = setup.http.expectOne(`${GATEWAY}/v1/auth/refresh`);
      setup.support.endedByServer();
      expectEnded(setup);

      refresh.flush(sessionPair(2 * HOUR_S, 'late'));
      await settle();
      TestBed.tick();

      expectEnded(setup);
      expect(setup.replaceDocument).toHaveBeenCalledTimes(1);
    });
  });

  // An operator opens a second link in a tab whose earlier session is still live.
  describe('a handoff in a tab that holds a session', () => {
    const storedRefreshToken = (tab: Map<string, string>) =>
      (
        JSON.parse(
          tab.get(StorageKeys.session) ?? 'null'
        ) as SessionTokens | null
      )?.refreshToken;

    it('keeps the new pair when a refresh of the earlier one lands after begin', async () => {
      const setup = active(sessionPair(2 * HOUR_S, 'old'));

      void TestBed.inject(TokenStore).refresh();
      const oldRefresh = setup.http.expectOne(`${GATEWAY}/v1/auth/refresh`);

      const answer = setup.support.exchange('second-code');
      setup.http
        .expectOne(`${GATEWAY}/v1/auth/impersonation/exchange`)
        .flush(sessionPair(2 * HOUR_S, 'new'));
      const outcome = await answer;
      if (outcome.state !== 'opened') {
        throw new Error('expected a session');
      }
      setup.support.begin(outcome.tokens);

      oldRefresh.flush(sessionPair(2 * HOUR_S, 'old-refreshed'));
      await settle();
      TestBed.tick();

      expect(storedRefreshToken(setup.tab)).toBe('new');
      expect(setup.tab.get(StorageKeys.supportSession)).toBe('1');
      expect(setup.replaceDocument).toHaveBeenCalledTimes(1);
      expect(setup.replaceDocument).toHaveBeenCalledWith('/velista/en/home');
    });

    it('does not end the handoff page when the earlier session runs out during the exchange', async () => {
      jest.useFakeTimers();
      const setup = active(sessionPair(5, 'old'));

      const answer = setup.support.exchange('second-code');
      const req = setup.http.expectOne(
        `${GATEWAY}/v1/auth/impersonation/exchange`
      );
      await jest.advanceTimersByTimeAsync(6_000);
      expect(setup.replaceDocument).not.toHaveBeenCalled();

      req.flush(sessionPair(2 * HOUR_S, 'new'));
      const outcome = await answer;
      if (outcome.state !== 'opened') {
        throw new Error('expected a session');
      }
      setup.support.begin(outcome.tokens);
      await jest.advanceTimersByTimeAsync(60_000);

      expect(storedRefreshToken(setup.tab)).toBe('new');
      expect(setup.replaceDocument).toHaveBeenCalledTimes(1);
      expect(setup.replaceDocument).toHaveBeenCalledWith('/velista/en/home');
    });

    it('ends the earlier session after a code that opens nothing', async () => {
      jest.useFakeTimers();
      const setup = active(sessionPair(5, 'old'));

      const answer = setup.support.exchange('used-code');
      const req = setup.http.expectOne(
        `${GATEWAY}/v1/auth/impersonation/exchange`
      );
      await jest.advanceTimersByTimeAsync(6_000);
      expect(setup.replaceDocument).not.toHaveBeenCalled();

      req.flush(
        { code: 'impersonation_code_invalid' },
        { status: 400, statusText: 'Bad Request' }
      );
      expect(await answer).toEqual({ state: 'invalid' });

      expectEnded(setup);
    });

    it('answers failed for an exchange that hangs, and lets the held end go ahead', async () => {
      jest.useFakeTimers();
      const setup = active(sessionPair(5, 'old'));

      const answer = setup.support.exchange('second-code');
      setup.http.expectOne(`${GATEWAY}/v1/auth/impersonation/exchange`);
      await jest.advanceTimersByTimeAsync(IMPERSONATION_EXCHANGE_WAIT_MS - 10);
      expect(setup.replaceDocument).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(20);
      expect(await answer).toEqual({ state: 'failed' });

      expectEnded(setup);
    });
  });

  // The handoff page in an ordinary tab, while a refresh of the operator's own pair is in
  // flight. The server has rotated that refresh token, so the refreshed pair must land.
  describe('a handoff in an ordinary tab', () => {
    it("keeps the operator's refreshed pair when it lands after begin", async () => {
      const persisted = new Map([
        [StorageKeys.session, JSON.stringify(ordinaryPair())],
      ]);
      const setup = setUp({ active: false, persisted });

      void TestBed.inject(TokenStore).refresh();
      const refresh = setup.http.expectOne(`${GATEWAY}/v1/auth/refresh`);
      setup.support.begin(sessionPair(2 * HOUR_S, 'new'));

      refresh.flush({ ...ordinaryPair(), refreshToken: 'op-rotated' });
      await settle();
      TestBed.tick();

      expect(
        (
          JSON.parse(
            persisted.get(StorageKeys.session) ?? 'null'
          ) as SessionTokens
        ).refreshToken
      ).toBe('op-rotated');
      expect(
        (
          JSON.parse(
            setup.tab.get(StorageKeys.session) ?? 'null'
          ) as SessionTokens
        ).refreshToken
      ).toBe('new');
    });
  });
});
