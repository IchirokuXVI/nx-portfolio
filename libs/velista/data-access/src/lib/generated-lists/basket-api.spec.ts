import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import {
  APP_API_CONFIG,
  APP_VERSION,
  type SessionTokens,
} from '@portfolio/velista/models';
import {
  AppUpdates,
  provideFakeBrowserFacade,
} from '@portfolio/velista/platform';
import { TokenStore } from '../auth/token-store';
import { VELISTA_DATA_ACCESS_PROVIDERS } from '../data-access-providers';
import { gatewayInterceptor } from '../gateway-interceptor';
import { BasketApi } from './basket-api';
import { BasketSessionStore } from './basket-session-store';

/**
 * **Who a join says it is** (velista `0086`, section 1).
 *
 * The route behind it runs under the gateway's optional JWT guard, so the request
 * decides what the person becomes: with no bearer the server mints a guest, and with
 * a bearer it resolves attaches that account as a registered participant. Nothing
 * about the body or the URL says which, and the join page cannot ask for one or the
 * other. The only thing that carries the answer is a header this app either sends or
 * does not.
 *
 * So the join went out with the `anonymous` context and every signed in person
 * opening their own household's link landed on it as Guest 3, with the lists behind
 * the lines redacted away from them. The call looked right: it sits beside the
 * preview, which genuinely is unauthenticated, and `anonymous` is what login and
 * register use for a reason that reads as though it applies here too.
 *
 * These assert the header itself, against the real interceptor rather than a stub of
 * it, because the defect was invisible everywhere else: both readings of the request
 * succeed, and the wrong one is merely somebody else.
 */

const GATEWAY = 'https://gateway.example';
const SECRET = 'a-link-secret';
const BASKET = 'basket-saturday';

/** A JWT whose exp is far in the future, so nothing refreshes proactively. */
function accountToken(): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${encode({ alg: 'RS256' })}.${encode({ exp, sub: 'u1' })}.sig`;
}

function pair(access: string): SessionTokens {
  return {
    userId: 'u1',
    kind: 'REGISTERED',
    accessToken: access,
    refreshToken: 'refresh-1',
  };
}

/** What the gateway answers a signed in person: a member, and no secret. */
const REGISTERED_ANSWER = {
  generatedListId: BASKET,
  participant: {
    id: 'p-dana',
    kind: 'REGISTERED',
    displayName: 'Dana',
    userId: 'u1',
  },
  sessionSecret: null,
  socketToken: 'socket-token-for-dana',
  socketTokenExpiresAt: null,
};

/** What it answers a visitor: a guest, and the secret they will present. */
const GUEST_ANSWER = {
  generatedListId: BASKET,
  participant: { id: 'p-guest-9', kind: 'GUEST', guestNumber: 9 },
  sessionSecret: 'the-secret',
  socketToken: 'socket-token-for-a-guest',
  socketTokenExpiresAt: null,
};

describe('BasketApi.join', () => {
  let api: BasketApi;
  let sessions: BasketSessionStore;
  let tokens: TokenStore;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([gatewayInterceptor])),
        provideHttpClientTesting(),
        provideFakeBrowserFacade(new Map<string, string>()),
        {
          provide: APP_API_CONFIG,
          useValue: {
            gatewayBaseUrl: GATEWAY,
            realtimeBaseUrl: 'https://realtime.example',
          },
        },
        { provide: RokuTranslatorService, useValue: { getLocale: () => 'en' } },
        { provide: APP_VERSION, useValue: '1.4.0' },
        { provide: AppUpdates, useValue: { checkNow: jest.fn() } },
        ...VELISTA_DATA_ACCESS_PROVIDERS,
        BasketApi,
      ],
    });

    api = TestBed.inject(BasketApi);
    sessions = TestBed.inject(BasketSessionStore);
    tokens = TestBed.inject(TokenStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('carries the bearer when this browser holds a session', async () => {
    const account = accountToken();
    tokens.set(pair(account));

    const done = api.join(SECRET);
    const req = httpMock.expectOne(`${GATEWAY}/v1/share-links/${SECRET}/join`);

    // The whole of the fix: the guard needs this header to attach the account
    // rather than mint a stranger.
    expect(req.request.headers.get('Authorization')).toBe(`Bearer ${account}`);
    req.flush(REGISTERED_ANSWER);

    const session = await done;
    expect(session.participantId).toBe('p-dana');
  });

  it('carries no bearer when there is no session to send', async () => {
    // A visitor on a link, which is the other half of one route: the interceptor
    // attaches a token only when the store holds one, so the same call sends
    // nothing and the server mints the guest it always did.
    const done = api.join(SECRET, 'Sam');
    const req = httpMock.expectOne(`${GATEWAY}/v1/share-links/${SECRET}/join`);

    expect(req.request.headers.has('Authorization')).toBe(false);
    expect(req.request.body).toEqual({ displayName: 'Sam' });
    req.flush(GUEST_ANSWER);

    const session = await done;
    expect(session.participantId).toBe('p-guest-9');
  });

  it('stores the session either way, null secret and all', async () => {
    // A registered participant is given no second credential, so the secret comes
    // back null and is written as null. `_participantOptions` reads exactly that to
    // decide whether to present a secret header at all, so a store that refused the
    // row would send a guest's header for somebody who has none.
    tokens.set(pair(accountToken()));

    const done = api.join(SECRET);
    httpMock
      .expectOne(`${GATEWAY}/v1/share-links/${SECRET}/join`)
      .flush(REGISTERED_ANSWER);
    await done;

    expect(sessions.read(BASKET)?.secret).toBeNull();
    expect(sessions.read(BASKET)?.socketToken).toBe('socket-token-for-dana');
  });

  it('stores a guest’s secret, which is the credential they then present', async () => {
    const done = api.join(SECRET);
    httpMock
      .expectOne(`${GATEWAY}/v1/share-links/${SECRET}/join`)
      .flush(GUEST_ANSWER);
    await done;

    expect(sessions.read(BASKET)?.secret).toBe('the-secret');
  });

  it('leaves the preview unauthenticated, which is the one that stays anonymous', async () => {
    // The pair the join used to belong to is now one route. The preview must keep
    // skipping auth: a stale token belongs to whoever left this browser signed in,
    // and it must not turn a stranger opening a link into a 401 before they have
    // even been offered the join.
    tokens.set(pair(accountToken()));

    const done = api.previewLink(SECRET);
    const req = httpMock.expectOne(`${GATEWAY}/v1/share-links/${SECRET}`);

    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({ generatedListId: BASKET, name: 'Saturday big shop' });
    await done;
  });
});
