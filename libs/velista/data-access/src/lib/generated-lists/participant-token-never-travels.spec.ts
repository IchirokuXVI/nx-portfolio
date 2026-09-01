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
 * **A participant token never travels on a request** (plan 0048, section 2.2).
 *
 * There are two credentials in this app and they authorize different things. The
 * account token is an identity: `TokenStore` holds it and `gatewayInterceptor`
 * attaches it to every gateway request there is. The participant token is a
 * short lived claim naming exactly one basket, minted for one socket, and it
 * reaches that socket and nothing else.
 *
 * The failure this file exists to catch is the tidy looking one. Both are strings
 * called a token, both are held for the same reader at the same moment, and the
 * refresh writes one of them into a store next to the other. Putting the participant
 * token where the interceptor can find it would be one line, would look like
 * consolidation, and would send a credential scoped to one basket to every route in
 * the gateway. A server that accepted it there would be authorizing far more than
 * the person was ever given, and one that refused it would sign the reader out.
 *
 * So the assertions here are about **absence**, on the real interceptor rather than
 * a stub of it: what a request carries, and what `TokenStore` still holds after the
 * socket has been given its token.
 */

const GATEWAY = 'https://gateway.example';
const SOCKET_TOKEN = 'participant-token-for-one-basket';
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

describe('the participant token never reaches gatewayInterceptor', () => {
  let api: BasketApi;
  let sessions: BasketSessionStore;
  let tokens: TokenStore;
  let httpMock: HttpTestingController;
  let storage: Map<string, string>;

  /** Every header on a request, flattened, so a leak anywhere on it is visible. */
  function headerValues(headers: {
    keys(): string[];
    getAll(name: string): string[] | null;
  }): string[] {
    return headers.keys().flatMap((key) => headers.getAll(key) ?? []);
  }

  beforeEach(() => {
    storage = new Map();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([gatewayInterceptor])),
        provideHttpClientTesting(),
        provideFakeBrowserFacade(storage),
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

  /** Mint the socket token the way the socket does, and hand back what went out. */
  async function refresh(): Promise<string[]> {
    const done = api.refreshSocketToken(BASKET);
    const req = httpMock.expectOne(
      `${GATEWAY}/v1/generated-lists/${BASKET}/participant-token`
    );
    const sent = headerValues(req.request.headers);

    req.flush({
      participant: { id: 'p-guest-9', kind: 'GUEST', guestNumber: 9 },
      socketToken: SOCKET_TOKEN,
      socketTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    });
    await done;

    return sent;
  }

  it('is not in TokenStore after the refresh that minted it', async () => {
    sessions.write({
      generatedListId: BASKET,
      participantId: 'p-guest-9',
      secret: 'the-secret',
      socketToken: 'an-older-one',
      socketTokenExpiresAt: null,
    });

    await refresh();

    // The refresh writes to the basket session and to nothing else. A guest has no
    // account at all, so a token store that had gained an entry here would be the
    // app inventing a session for somebody who never signed in.
    expect(tokens.tokens()).toBeNull();
    expect(tokens.hasSession()).toBe(false);
    expect(sessions.read(BASKET)?.socketToken).toBe(SOCKET_TOKEN);
  });

  it('does not travel on the request that mints it', async () => {
    sessions.write({
      generatedListId: BASKET,
      participantId: 'p-guest-9',
      secret: 'the-secret',
      socketToken: 'an-older-one',
      socketTokenExpiresAt: null,
    });

    const sent = await refresh();

    // The credential presented is the **secret**, which is what makes this call the
    // revocation check: it is a database read the server refuses for somebody who
    // has been removed. A token presenting itself would renew itself forever.
    expect(sent).toContain('the-secret');
    expect(sent).not.toContain('an-older-one');
  });

  it('does not travel on a guest’s next request either', async () => {
    sessions.write({
      generatedListId: BASKET,
      participantId: 'p-guest-9',
      secret: 'the-secret',
      socketToken: 'an-older-one',
      socketTokenExpiresAt: null,
    });
    await refresh();

    const done = api.listParticipants(BASKET);
    const req = httpMock.expectOne(
      `${GATEWAY}/v1/generated-lists/${BASKET}/participants/mine`
    );

    expect(req.request.headers.has('Authorization')).toBe(false);
    expect(headerValues(req.request.headers)).not.toContain(SOCKET_TOKEN);
    req.flush({ participants: [] });
    await done;
  });

  it('does not displace the account token for a reader who has one', async () => {
    // The owner and a registered participant hold both credentials at once, which is
    // the arrangement where confusing them is easiest: the socket has just been given
    // a token, and the very next request is an ordinary authenticated read.
    const account = accountToken();
    tokens.set(pair(account));
    sessions.write({
      generatedListId: BASKET,
      participantId: 'p-owner',
      secret: null,
      socketToken: 'an-older-one',
      socketTokenExpiresAt: null,
    });

    await refresh();

    const done = api.getBasket(BASKET);
    const req = httpMock.expectOne(
      `${GATEWAY}/v1/generated-lists/${BASKET}/basket`
    );

    expect(req.request.headers.get('Authorization')).toBe(`Bearer ${account}`);
    expect(headerValues(req.request.headers)).not.toContain(SOCKET_TOKEN);
    req.flush({ id: BASKET, me: { id: 'p-owner', kind: 'OWNER' }, lines: [] });
    await done;

    expect(tokens.tokens()?.accessToken).toBe(account);
  });

  it('does not reach a request to another basket', async () => {
    // The token names one basket in its audience and authorizes nothing about a
    // second, so a store keyed by basket is the thing that keeps them apart.
    sessions.write({
      generatedListId: BASKET,
      participantId: 'p-guest-9',
      secret: 'the-secret',
      socketToken: 'an-older-one',
      socketTokenExpiresAt: null,
    });
    await refresh();

    const done = api.getBasket('somebody-elses-basket');
    const req = httpMock.expectOne(
      `${GATEWAY}/v1/generated-lists/somebody-elses-basket/basket`
    );

    const sent = headerValues(req.request.headers);
    expect(sent).not.toContain(SOCKET_TOKEN);
    expect(sent).not.toContain('the-secret');
    req.flush({
      id: 'somebody-elses-basket',
      me: { id: 'p-other', kind: 'GUEST' },
      lines: [],
    });
    await done;
  });
});
