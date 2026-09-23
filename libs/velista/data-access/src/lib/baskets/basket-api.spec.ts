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
  basketId: BASKET,
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
  basketId: BASKET,
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
    req.flush({ basketId: BASKET, name: 'Saturday big shop' });
    await done;
  });
});

/**
 * **A rename asks before it merges** (velista `0084`). The first request carries no
 * `confirmMerge` at all, and only the Merge button's request carries `true`.
 */
describe('BasketApi.renameRow', () => {
  let api: BasketApi;
  let httpMock: HttpTestingController;

  /** The row every write on this surface answers with (backend `0136`). */
  const ROW_VIEW = {
    rowKey: 'zl-1',
    content: 'Leche entera',
    left: 3,
    bought: 0,
    asked: 3,
    state: 'WANTED',
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    optionIds: [],
    touchedBy: null,
    touchedAt: null,
    entries: [
      {
        lineId: 'zl-1',
        left: 3,
        bought: 0,
        state: 'WANTED',
        approvalStatus: 'APPROVED',
        demandEditable: true,
      },
    ],
  };

  const PROGRESS = { done: 0, unavailable: 0, total: 1, pending: 1 };

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
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // The row writes moved to the basket's own path with backend `0136`, and
  // backend `0144` moved the sharing half there too.
  const url = `${GATEWAY}/v1/baskets/${BASKET}/rows/zl-1`;

  it('patches the row route and leaves confirmMerge off the first request', async () => {
    const done = api.renameRow(BASKET, 'zl-1', { content: 'Leche entera' });
    const req = httpMock.expectOne(url);

    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ content: 'Leche entera' });
    req.flush({ row: ROW_VIEW, progress: PROGRESS });

    expect((await done).absorbedRowKey).toBeNull();
  });

  it('sends confirmMerge only when it is true, and reads the absorbed row', async () => {
    const done = api.renameRow(BASKET, 'zl-1', {
      content: 'Leche entera',
      confirmMerge: true,
    });
    const req = httpMock.expectOne(url);

    expect(req.request.body).toEqual({
      content: 'Leche entera',
      confirmMerge: true,
    });
    req.flush({
      row: ROW_VIEW,
      progress: PROGRESS,
      replacedRowKey: 'zl-2',
    });

    // The wire's `replacedRowKey`, named for what a rename did with it: the row
    // the request addressed was the one absorbed.
    expect((await done).absorbedRowKey).toBe('zl-2');
  });
});

/**
 * The four routes velista `0092` reaches: a skip, taking it back, what a list
 * asks for, and an add that names a list.
 *
 * Asserted here rather than only through the store, because what each of them
 * gets wrong is invisible above this layer. A skip on the wrong verb reads as a
 * write that silently did nothing; a demand with the `lineId` left off moves
 * whichever list the server picked; an add with an empty `itemIds` array is a
 * product set somebody chose where an absent key is free text.
 */
describe('BasketApi, the writes of velista 0092', () => {
  let api: BasketApi;
  let httpMock: HttpTestingController;

  const ROW_VIEW = {
    rowKey: 'zl-1',
    content: 'Milk',
    left: 2,
    bought: 0,
    asked: 2,
    state: 'SKIPPED',
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    optionIds: [],
    touchedBy: null,
    touchedAt: null,
    entries: [
      {
        lineId: 'zl-1',
        listId: 'list-weekly',
        left: 2,
        bought: 0,
        state: 'SKIPPED',
        approvalStatus: 'APPROVED',
        demandEditable: true,
      },
    ],
  };

  const PROGRESS = { done: 0, unavailable: 0, total: 1, pending: 1 };

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
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  const skipUrl = `${GATEWAY}/v1/baskets/${BASKET}/rows/zl-1/skip`;

  it('puts a skip on the row\u2019s skip route and folds the answer', async () => {
    const done = api.skip(BASKET, 'zl-1');
    const req = httpMock.expectOne(skipUrl);

    // `PUT` and not `POST`: skipping an already skipped row is the state that
    // was asked for rather than a second act.
    expect(req.request.method).toBe('PUT');
    req.flush({ row: ROW_VIEW, progress: PROGRESS });

    const result = await done;
    // Read and never patched: the state is whatever the server answered.
    expect(result.row?.state).toBe('SKIPPED');
  });

  it('carries no from on a skip, because a skip has no number', async () => {
    const done = api.skip(BASKET, 'zl-1');
    const req = httpMock.expectOne(skipUrl);

    // Every other write on a row names the number it started from. A skip has
    // none to be stale about; the server refuses a row with nothing left to get
    // instead (backend `0137`, section 5).
    expect(req.request.body).toEqual({});
    req.flush({ row: ROW_VIEW, progress: PROGRESS });
    await done;
  });

  it('takes a skip back with DELETE on the same route', async () => {
    const done = api.unskip(BASKET, 'zl-1');
    const req = httpMock.expectOne(skipUrl);

    expect(req.request.method).toBe('DELETE');
    req.flush({ row: { ...ROW_VIEW, state: 'WANTED' }, progress: PROGRESS });

    expect((await done).row?.state).toBe('WANTED');
  });

  it('sends lineId, quantity and from on a demand', async () => {
    const done = api.setDemand(BASKET, 'zl-1', {
      lineId: 'zl-1',
      quantity: 5,
      from: 2,
    });
    const req = httpMock.expectOne(
      `${GATEWAY}/v1/baskets/${BASKET}/rows/zl-1/demand`
    );

    expect(req.request.method).toBe('POST');
    // `lineId` always, although the server requires it only on a row of several
    // entries: the control is drawn per entry, so there is one to name.
    expect(req.request.body).toEqual({ lineId: 'zl-1', quantity: 5, from: 2 });
    req.flush({ row: { ...ROW_VIEW, left: 5 }, progress: PROGRESS });

    expect((await done).row?.left).toBe(5);
  });

  it('reads the server\u2019s emptied row as no row at all', async () => {
    // A demand taken to zero on a row nothing was bought of. The server states
    // the row it was asked about with no entries and zeros, which is its way of
    // saying the row left the view; the client has one answer for that, null.
    const done = api.setDemand(BASKET, 'zl-1', {
      lineId: 'zl-1',
      quantity: 0,
      from: 2,
    });
    httpMock
      .expectOne(`${GATEWAY}/v1/baskets/${BASKET}/rows/zl-1/demand`)
      .flush({
        row: {
          rowKey: 'zl-1',
          content: '',
          left: 0,
          bought: 0,
          asked: 0,
          state: 'WANTED',
          note: null,
          noteAt: null,
          mark: null,
          awaitingApproval: false,
          optionIds: [],
          touchedBy: null,
          touchedAt: null,
          entries: [],
        },
        progress: { done: 0, unavailable: 0, total: 0, pending: 0 },
      });

    const result = await done;
    expect(result.row).toBeNull();
    // The counts still land: the row going away is what changed them.
    expect(result.progress.total).toBe(0);
  });

  it('posts an add to the basket\u2019s lines, naming its list', async () => {
    const done = api.addLine(BASKET, {
      targetListId: 'list-weekly',
      content: 'Batteries',
      quantity: 1,
    });
    const req = httpMock.expectOne(`${GATEWAY}/v1/baskets/${BASKET}/lines`);

    expect(req.request.method).toBe('POST');
    // No `itemIds` key at all for free text, rather than an empty array: an
    // empty array is a product set somebody chose.
    expect(req.request.body).toEqual({
      targetListId: 'list-weekly',
      content: 'Batteries',
      quantity: 1,
    });
    req.flush({
      row: { ...ROW_VIEW, rowKey: 'zl-9', content: 'Batteries' },
      progress: PROGRESS,
    });

    expect((await done).row?.content).toBe('Batteries');
  });

  it('sends a suggestion\u2019s product set as itemIds', async () => {
    const done = api.addLine(BASKET, {
      targetListId: 'list-weekly',
      content: 'Milk',
      quantity: 2,
      itemIds: ['item-a', 'item-b'],
    });
    const req = httpMock.expectOne(`${GATEWAY}/v1/baskets/${BASKET}/lines`);

    expect(req.request.body).toEqual({
      targetListId: 'list-weekly',
      content: 'Milk',
      quantity: 2,
      itemIds: ['item-a', 'item-b'],
    });
    req.flush({ row: ROW_VIEW, progress: PROGRESS });
    await done;
  });

  describe('a settle names a scope and never money (velista 0095, test 9)', () => {
    const rowUrl = `${GATEWAY}/v1/baskets/${BASKET}/rows/zl-1`;

    /** Every key of a body, nested ones included. */
    function keysOf(value: unknown): string[] {
      if (Array.isArray(value)) {
        return value.flatMap(keysOf);
      }
      if (value === null || typeof value !== 'object') {
        return [];
      }
      return Object.entries(value).flatMap(([key, inner]) => [
        key,
        ...keysOf(inner),
      ]);
    }

    async function settleBody(
      body: Parameters<BasketApi['settle']>[2]
    ): Promise<Record<string, unknown>> {
      const done = api.settle(BASKET, 'zl-1', body);
      const req = httpMock.expectOne(`${rowUrl}/settle`);
      const sent = req.request.body as Record<string, unknown>;
      req.flush({ row: ROW_VIEW, progress: PROGRESS });
      await done;
      return sent;
    }

    async function revertBody(
      body: Parameters<BasketApi['revert']>[2]
    ): Promise<Record<string, unknown>> {
      const done = api.revert(BASKET, 'zl-1', body);
      const req = httpMock.expectOne(`${rowUrl}/revert`);
      const sent = req.request.body as Record<string, unknown>;
      req.flush({ row: ROW_VIEW, progress: PROGRESS });
      await done;
      return sent;
    }

    it('sends the scope on a purchase, and none on a close or a revert', async () => {
      const bought = await settleBody({
        outcome: 'BOUGHT',
        quantity: 2,
        from: 2,
        itemId: 'item-1',
        priceScopeId: 'scope-1',
      });
      expect(bought['priceScopeId']).toBe('scope-1');

      const none = await settleBody({
        outcome: 'NOT_AVAILABLE',
        from: 2,
        priceScopeId: 'scope-1',
      });
      expect(none).not.toHaveProperty('priceScopeId');

      const unpriced = await settleBody({
        outcome: 'BOUGHT',
        quantity: 1,
        from: 2,
      });
      expect(unpriced).not.toHaveProperty('priceScopeId');

      const units = await revertBody({ target: 'UNITS', units: 1, from: 1 });
      const close = await revertBody({ target: 'CLOSE' });
      expect(units).not.toHaveProperty('priceScopeId');
      expect(close).not.toHaveProperty('priceScopeId');
    });

    it('carries no key that names money in any settle or revert body', async () => {
      const bodies = [
        await settleBody({
          outcome: 'BOUGHT',
          quantity: 2,
          from: 2,
          itemId: 'item-1',
          priceScopeId: 'scope-1',
          allocations: [{ lineId: 'zl-1', quantity: 2 }],
        }),
        await settleBody({ outcome: 'NOT_AVAILABLE', from: 2 }),
        await revertBody({ target: 'UNITS', units: 1, from: 1 }),
        await revertBody({ target: 'CLOSE' }),
      ];

      const money = bodies
        .flatMap(keysOf)
        .filter(
          (key) => key !== 'priceScopeId' && /price|cents|amount/i.test(key)
        );
      expect(money).toEqual([]);
    });
  });
});
