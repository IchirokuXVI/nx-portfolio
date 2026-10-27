import {
  expect,
  request,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type Route,
} from '@playwright/test';
import {
  GATEWAY_URL,
  SHOP_ASK_OFF_KEY,
  VELISTA_BASE_URL,
} from '../playwright.config';

/**
 * How session tokens are issued, stored, rotated and spent, as invariants checked
 * against a live auth service, gateway and velista origin.
 *
 * These specs come from an independent review of the session token lifecycle. Each
 * one states the invariant it checks. A failing test is a finding: the assertion
 * states what should hold, and the result tells whether the code holds it. Do not
 * weaken an assertion to make a run green.
 *
 * Every spec registers its own users through the gateway, so the suite needs no
 * seed. A pair is put into a page through `storageState` (the `session:velista`
 * key, `StorageKeys.session` in `libs/velista/platform`), never through the UI.
 *
 * To make the client refresh, the access token's payload is rewritten with an `exp`
 * in the past. The client decides expiry by decoding `exp` without checking the
 * signature (`access-token-expiry.ts`) and never sends a token it believes expired,
 * so the broken signature never reaches the server.
 */

const SESSION_KEY = 'session:velista';
const BASKET_SESSION_PREFIX = 'basket-session:velista:';
const PASSWORD = 'Session-tokens-1';
const SETTLE_MS = 4_000;

interface Pair {
  userId: string;
  kind: string;
  username: string;
  accessToken: string;
  refreshToken: string;
}

interface RefreshOutcome {
  status: number;
  pair: Pair | null;
}

const origin = new URL(VELISTA_BASE_URL).origin;

// --- Gateway helpers ----------------------------------------------------------

async function gateway(): Promise<APIRequestContext> {
  return request.newContext({ baseURL: GATEWAY_URL, ignoreHTTPSErrors: true });
}

let counter = 0;
function uniqueEmail(tag: string): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `st-${tag}-${Date.now()}-${counter}-${rand}@example.com`;
}

/** `POST /v1/auth/register`, then the setup and tour marked done so no guard redirects. */
async function register(api: APIRequestContext, tag: string): Promise<Pair> {
  const res = await api.post('/v1/auth/register', {
    data: { email: uniqueEmail(tag), password: PASSWORD },
  });
  expect(res.status(), `register ${tag}: ${await res.text()}`).toBe(201);
  const pair = (await res.json()) as Pair;
  const state = await api.patch('/v1/account/app-state', {
    headers: { Authorization: `Bearer ${pair.accessToken}` },
    data: { setupCompleted: true, tourSeen: true },
  });
  expect(state.ok(), `app-state ${tag}: ${await state.text()}`).toBe(true);
  return pair;
}

/** `POST /v1/auth/refresh` with one refresh token. */
async function refreshVia(
  api: APIRequestContext,
  refreshToken: string
): Promise<RefreshOutcome> {
  const res = await api.post('/v1/auth/refresh', { data: { refreshToken } });
  const status = res.status();
  return {
    status,
    pair: status === 201 ? ((await res.json()) as Pair) : null,
  };
}

/** A shared live basket of the owner's: `GET /v1/baskets/live`, then `PUT .../share-link`. */
async function sharedLiveBasket(
  api: APIRequestContext,
  owner: Pair
): Promise<{ basketId: string; secret: string }> {
  const headers = { Authorization: `Bearer ${owner.accessToken}` };
  const live = await api.get('/v1/baskets/live', { headers });
  expect(live.ok(), `live basket: ${await live.text()}`).toBe(true);
  const basketId = ((await live.json()) as { id: string }).id;
  const link = await api.put(`/v1/baskets/${basketId}/share-link`, {
    headers,
  });
  expect(link.ok(), `share link: ${await link.text()}`).toBe(true);
  const secret = ((await link.json()) as { secret: string }).secret;
  return { basketId, secret };
}

interface ParticipantRow {
  id: string;
  kind: string;
  userId?: string | null;
}

/** `GET /v1/baskets/:id/participants` as the owner. */
async function participants(
  api: APIRequestContext,
  owner: Pair,
  basketId: string
): Promise<ParticipantRow[]> {
  const res = await api.get(`/v1/baskets/${basketId}/participants`, {
    headers: { Authorization: `Bearer ${owner.accessToken}` },
  });
  expect(res.ok(), `participants: ${await res.text()}`).toBe(true);
  const body = (await res.json()) as { participants: ParticipantRow[] };
  return body.participants;
}

// --- Token and page helpers ---------------------------------------------------

function b64urlDecode(segment: string): string {
  return Buffer.from(
    segment.replace(/-/g, '+').replace(/_/g, '/'),
    'base64'
  ).toString('utf8');
}

function b64urlEncode(text: string): string {
  return Buffer.from(text, 'utf8')
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** The same token with its `exp` an hour in the past, so the client refreshes before using it. */
function expiredLooking(token: string): string {
  const [header, payload, signature] = token.split('.');
  const claims = JSON.parse(b64urlDecode(payload)) as Record<string, unknown>;
  claims['exp'] = Math.floor(Date.now() / 1000) - 3600;
  return [header, b64urlEncode(JSON.stringify(claims)), signature].join('.');
}

function withExpiredAccess(pair: Pair): Pair {
  return { ...pair, accessToken: expiredLooking(pair.accessToken) };
}

function storageStateWith(pair: Pair | null) {
  const localStorage = [{ name: SHOP_ASK_OFF_KEY, value: 'true' }];
  if (pair)
    localStorage.push({ name: SESSION_KEY, value: JSON.stringify(pair) });
  return { cookies: [], origins: [{ origin, localStorage }] };
}

async function contextWith(
  browser: Browser,
  pair: Pair | null
): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: VELISTA_BASE_URL,
    ignoreHTTPSErrors: true,
    storageState: storageStateWith(pair),
  });
}

interface StorageEvent {
  page: string;
  op: 'set' | 'remove';
  refreshTail: string | null;
  at: number;
}

/**
 * Log every write and removal of the session key, in every page of the context, in
 * the order they happen. Storage itself is shared by the pages of one context, so
 * this is the only way to see a removal that a later write undid.
 */
async function recordSessionWrites(
  context: BrowserContext,
  names: Map<Page, string>
): Promise<StorageEvent[]> {
  const events: StorageEvent[] = [];
  await context.exposeBinding(
    '__sessionWrite',
    (source, op: 'set' | 'remove', value: string | null) => {
      let refreshTail: string | null = null;
      if (value) {
        try {
          refreshTail = String((JSON.parse(value) as Pair).refreshToken).slice(
            -8
          );
        } catch {
          refreshTail = 'unparsable';
        }
      }
      events.push({
        page: names.get(source.page) ?? 'unknown',
        op,
        refreshTail,
        at: Date.now(),
      });
    }
  );
  await context.addInitScript((key: string) => {
    const w = window as unknown as {
      __sessionWrite: (op: string, value: string | null) => void;
    };
    const set = Storage.prototype.setItem;
    const remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === key && this === window.localStorage) w.__sessionWrite('set', v);
      return set.call(this, k, v);
    };
    Storage.prototype.removeItem = function (k: string) {
      if (k === key && this === window.localStorage)
        w.__sessionWrite('remove', null);
      return remove.call(this, k);
    };
  }, SESSION_KEY);
  return events;
}

async function storedPair(page: Page): Promise<Pair | null> {
  const raw = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    SESSION_KEY
  );
  return raw === null ? null : (JSON.parse(raw) as Pair);
}

/** The front door: the mount plus the locale and nothing else, where a signed out user lands. */
function isFrontDoor(url: string): boolean {
  return /^\/en\/?$/.test(new URL(url).pathname);
}

function tail(token: string | undefined | null): string {
  return token ? token.slice(-8) : String(token);
}

/** A promise and the function that resolves it. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open = () => undefined as void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Follow a route through to the server and keep its answer. */
async function fetchThrough(route: Route) {
  const response = await route.fetch();
  const body = await response.text();
  return { response, body };
}

test.describe('session tokens', () => {
  let api: APIRequestContext;

  test.beforeEach(async () => {
    api = await gateway();
  });

  test.afterEach(async () => {
    await api.dispose();
  });

  // 1 ---------------------------------------------------------------------------
  test('1. a refresh answer lost in transit does not end the session', async ({
    browser,
  }) => {
    // Invariant: the server applied a rotation whose answer never reached the
    // client. The next gateway request still finds the user signed in: storage
    // holds a pair and no front door is shown.
    const user = await register(api, 'lost');
    const context = await contextWith(browser, withExpiredAccess(user));
    const page = await context.newPage();

    const refreshes: {
      n: number;
      presented: string;
      status: number | 'aborted';
    }[] = [];
    let delivered: Pair | null = null;
    await page.route('**/v1/auth/refresh', async (route) => {
      const presented = (
        route.request().postDataJSON() as { refreshToken: string }
      ).refreshToken;
      const n = refreshes.length + 1;
      const { response, body } = await fetchThrough(route);
      if (n === 1) {
        // The server rotated; the client never hears it.
        if (response.status() === 201) delivered = JSON.parse(body) as Pair;
        refreshes.push({ n, presented: tail(presented), status: 'aborted' });
        await route.abort('connectionreset');
        return;
      }
      refreshes.push({
        n,
        presented: tail(presented),
        status: response.status(),
      });
      await route.fulfill({ response, body });
    });

    await page.goto('/en/account');
    await expect.poll(() => refreshes.length).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(SETTLE_MS);
    const afterLoss = await storedPair(page);

    await page.reload();
    await page.waitForTimeout(SETTLE_MS);
    const afterReload = await storedPair(page);
    const url = page.url();

    // What the server believes: the presented token is spent, and the one it
    // issued instead was never delivered.
    const oldToken = await refreshVia(api, user.refreshToken);
    const undelivered = delivered as Pair | null;

    test.info().annotations.push({
      type: 'observed',
      description: JSON.stringify({
        refreshes,
        storageAfterLoss: afterLoss ? tail(afterLoss.refreshToken) : null,
        storageAfterReload: afterReload ? tail(afterReload.refreshToken) : null,
        urlAfterReload: url,
        oldRefreshStatus: oldToken.status,
        undeliveredRefresh: tail(undelivered?.refreshToken),
      }),
    });
    console.log('[1]', test.info().annotations.at(-1)?.description);

    expect(oldToken.status, 'the presented refresh token is spent').toBe(401);
    expect(
      afterLoss,
      'storage still holds a pair after the lost answer'
    ).not.toBeNull();
    expect(
      afterReload,
      'storage still holds a pair on the next load'
    ).not.toBeNull();
    expect(isFrontDoor(url), `not sent to the front door (url ${url})`).toBe(
      false
    );

    await context.close();
  });

  // 2 ---------------------------------------------------------------------------
  test('2. two concurrent refreshes of one token never both succeed', async () => {
    // Invariant: a refresh token is single use. Two near simultaneous refreshes
    // with the same token yield at most one 201.
    const ROUNDS = 10;
    let current = await register(api, 'race');
    const rounds: { round: number; statuses: number[] }[] = [];
    let forked = 0;

    for (let round = 1; round <= ROUNDS; round++) {
      const token = current.refreshToken;
      const [a, b] = await Promise.all([
        refreshVia(api, token),
        refreshVia(api, token),
      ]);
      rounds.push({ round, statuses: [a.status, b.status] });
      if (a.status === 201 && b.status === 201) forked += 1;
      const next = a.pair ?? b.pair;
      if (next) {
        current = next;
      } else {
        // Neither won: start the next round from a fresh account.
        current = await register(api, 'race');
      }
    }

    const summary = `${forked} of ${ROUNDS} rounds forked: ${JSON.stringify(rounds)}`;
    test.info().annotations.push({ type: 'observed', description: summary });
    console.log('[2]', summary);
    expect(forked, summary).toBe(0);
  });

  // 3 ---------------------------------------------------------------------------
  for (const variant of [
    {
      id: '3',
      title:
        "3. two documents refreshing the same pair never sign each other out (A's answer 500 ms late)",
      // Both requests reach the server together; A's answer is delivered late.
      delayBeforeServer: false,
    },
    {
      id: '3b',
      title:
        '3b. two documents refreshing the same pair never sign each other out (A reaches the server 500 ms after B)',
      // A presents the token after B already rotated it: no server race, the
      // client side adoption alone has to save A.
      delayBeforeServer: true,
    },
  ]) {
    test(variant.title, async ({ browser }) => {
      // Invariant: two tabs of one origin, both holding the same expired looking
      // pair, refresh at once. Neither ever removes the session, neither shows
      // the front door, and both end holding the same live pair.
      const user = await register(api, `twotabs${variant.id}`);
      const context = await contextWith(browser, withExpiredAccess(user));
      const a = await context.newPage();
      const b = await context.newPage();
      const names = new Map<Page, string>([
        [a, 'A'],
        [b, 'B'],
      ]);
      const writes = await recordSessionWrites(context, names);

      const answers: {
        page: string;
        presented: string;
        status: number;
        issued: string | null;
        at: number;
      }[] = [];
      const issued: string[] = [];
      const handler =
        (name: string, delay: 'before' | 'after' | 'none') =>
        async (route: Route) => {
          const presented = (
            route.request().postDataJSON() as { refreshToken: string }
          ).refreshToken;
          if (delay === 'before') await new Promise((r) => setTimeout(r, 500));
          const { response, body } = await fetchThrough(route);
          if (delay === 'after') await new Promise((r) => setTimeout(r, 500));
          const fresh =
            response.status() === 201 ? (JSON.parse(body) as Pair) : null;
          if (fresh) issued.push(fresh.refreshToken);
          answers.push({
            page: name,
            presented: tail(presented),
            status: response.status(),
            issued: fresh ? tail(fresh.refreshToken) : null,
            at: Date.now(),
          });
          await route.fulfill({ response, body });
        };
      await a.route(
        '**/v1/auth/refresh',
        handler('A', variant.delayBeforeServer ? 'before' : 'after')
      );
      await b.route('**/v1/auth/refresh', handler('B', 'none'));

      const urls: string[] = [];
      for (const [p, name] of names) {
        p.on('framenavigated', (frame) => {
          if (frame === p.mainFrame()) urls.push(`${name} ${frame.url()}`);
        });
      }

      await Promise.all([a.goto('/en/account'), b.goto('/en/account')]);
      await expect.poll(() => answers.length).toBeGreaterThanOrEqual(1);
      await a.waitForTimeout(SETTLE_MS);

      const pairA = await storedPair(a);
      const pairB = await storedPair(b);

      // Every pair the server issued that nobody holds any more: is it still live?
      const orphans: { token: string; status: number }[] = [];
      for (const token of issued) {
        if (token === pairA?.refreshToken) continue;
        orphans.push({
          token: tail(token),
          status: (await refreshVia(api, token)).status,
        });
      }

      const observed = {
        answers,
        writes,
        navigations: urls,
        finalA: tail(pairA?.refreshToken),
        finalB: tail(pairB?.refreshToken),
        orphanedPairsStillLive: orphans,
        urlA: a.url(),
        urlB: b.url(),
      };
      test.info().annotations.push({
        type: 'observed',
        description: JSON.stringify(observed),
      });
      console.log(`[${variant.id}]`, JSON.stringify(observed));

      expect(
        writes.filter((w) => w.op === 'remove'),
        'no document ever removed the session'
      ).toEqual([]);
      expect(pairA, 'A holds a pair').not.toBeNull();
      expect(pairB, 'B holds a pair').not.toBeNull();
      expect(pairA?.refreshToken).toBe(pairB?.refreshToken);
      expect(
        urls.filter((u) => isFrontDoor(u.slice(2))),
        'neither page was sent to the front door'
      ).toEqual([]);

      // The pair they hold is live on the server.
      const live = await refreshVia(api, pairA?.refreshToken ?? '');
      expect(live.status, 'the shared pair is live').toBe(201);

      await context.close();
    });
  }

  // 4 ---------------------------------------------------------------------------
  test('4. a sign out is final even with a refresh in flight in another tab', async ({
    browser,
  }) => {
    // Invariant: tab B signs out while tab A's refresh is on the wire. When A's
    // answer lands afterwards, storage stays empty in both tabs and the app stays
    // signed out.
    const user = await register(api, 'signout-race');
    const context = await contextWith(browser, user);
    const a = await context.newPage();
    const b = await context.newPage();
    const names = new Map<Page, string>([
      [a, 'A'],
      [b, 'B'],
    ]);
    const writes = await recordSessionWrites(context, names);

    // A's first profile read is refused, which makes A's interceptor force a
    // refresh with a token that still looks valid. The refresh reaches the server,
    // and its answer is held until B has signed out.
    let meRefused = false;
    await a.route('**/v1/account/me', async (route) => {
      if (!meRefused && route.request().method() === 'GET') {
        meRefused = true;
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 401,
            code: 'unauthorized',
            message: 'test',
          }),
        });
        return;
      }
      await route.continue();
    });
    const held = gate();
    const reachedServer = gate();
    let refreshStatus = 0;
    await a.route('**/v1/auth/refresh', async (route) => {
      const { response, body } = await fetchThrough(route);
      refreshStatus = response.status();
      reachedServer.open();
      await held.promise;
      await route.fulfill({ response, body });
    });

    await a.goto('/en/account');
    await reachedServer.promise;

    await b.goto('/en/account');
    await b.getByText('Sign out', { exact: true }).click();
    await expect.poll(() => storedPair(b)).toBeNull();
    await expect.poll(() => isFrontDoor(b.url())).toBe(true);

    held.open();
    await a.waitForTimeout(SETTLE_MS);

    const finalA = await storedPair(a);
    const finalB = await storedPair(b);
    await b.goto('/en/account');
    await b.waitForTimeout(1_500);
    const bUrl = b.url();

    const observed = {
      refreshStatus,
      writes,
      finalA: tail(finalA?.refreshToken),
      finalB: tail(finalB?.refreshToken),
      bUrlAfterOpeningAccount: bUrl,
    };
    test
      .info()
      .annotations.push({
        type: 'observed',
        description: JSON.stringify(observed),
      });
    console.log('[4]', JSON.stringify(observed));

    expect(finalA, 'storage empty in A after the late answer').toBeNull();
    expect(finalB, 'storage empty in B after the late answer').toBeNull();
    expect(isFrontDoor(bUrl), `B is still signed out (url ${bUrl})`).toBe(true);

    await context.close();
  });

  // 5 ---------------------------------------------------------------------------
  test('5. a held but unprovable session is never sent anonymously to a basket join', async ({
    browser,
  }) => {
    // Invariant: a user holds a pair whose access token needs a refresh, and the
    // refresh answers 503. Opening someone else's basket share link must not join
    // as a guest: no GUEST participant is created and no basket-session key is
    // written.
    const owner = await register(api, 'owner5');
    const joiner = await register(api, 'joiner5');
    const { basketId, secret } = await sharedLiveBasket(api, owner);
    const before = await participants(api, owner, basketId);

    const context = await contextWith(browser, withExpiredAccess(joiner));
    const page = await context.newPage();
    let refreshes = 0;
    await page.route('**/v1/auth/refresh', async (route) => {
      refreshes += 1;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ status: 503, code: 'service_unavailable' }),
      });
    });
    const joins: { authorization: string | null; status: number }[] = [];
    page.on('requestfinished', async (req) => {
      if (/\/v1\/share-links\/[^/]+\/join$/.test(req.url())) {
        const res = await req.response();
        joins.push({
          authorization: (await req.allHeaders())['authorization'] ?? null,
          status: res?.status() ?? 0,
        });
      }
    });

    await page.goto(`/s/${secret}`);
    await page.waitForTimeout(SETTLE_MS + 2_000);

    const keys = await page.evaluate((prefix) => {
      const found: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(prefix)) found.push(k);
      }
      return found;
    }, BASKET_SESSION_PREFIX);
    const after = await participants(api, owner, basketId);
    const added = after.filter((p) => !before.some((q) => q.id === p.id));
    const stillHeld = await storedPair(page);

    const observed = {
      refreshes,
      joins,
      basketSessionKeys: keys,
      participantsAdded: added,
      sessionStillHeld: stillHeld !== null,
      url: page.url(),
    };
    test
      .info()
      .annotations.push({
        type: 'observed',
        description: JSON.stringify(observed),
      });
    console.log('[5]', JSON.stringify(observed));
    await page.screenshot({
      path: test.info().outputPath('join-after-503.png'),
    });

    expect(
      joins.filter((j) => j.authorization === null),
      'no join went out without a bearer'
    ).toEqual([]);
    expect(
      added.filter((p) => p.kind === 'GUEST'),
      'no guest participant was created'
    ).toEqual([]);
    expect(keys, 'no basket-session key was written').toEqual([]);

    await context.close();
  });

  // 6a --------------------------------------------------------------------------
  test('6a. signing out revokes the refresh token on the server', async ({
    browser,
  }) => {
    // Invariant: after a sign out in the UI, a copy of the refresh token taken
    // before it no longer refreshes (401).
    const user = await register(api, 'signout');
    const context = await contextWith(browser, user);
    const page = await context.newPage();
    await page.goto('/en/account');
    await page.getByText('Sign out', { exact: true }).click();
    await expect.poll(() => storedPair(page)).toBeNull();
    await expect.poll(() => isFrontDoor(page.url())).toBe(true);

    const copy = await refreshVia(api, user.refreshToken);
    console.log('[6a] refresh with the pre sign out copy:', copy.status);
    test.info().annotations.push({
      type: 'observed',
      description: `refresh with the pre sign out copy answered ${copy.status}`,
    });
    expect(copy.status, 'the copy is refused after sign out').toBe(401);

    await context.close();
  });

  // 6b --------------------------------------------------------------------------
  test('6b. a stolen refresh token cannot keep rotating once the victim presents it', async ({
    browser,
  }) => {
    // Invariant: once the server sees a rotated refresh token presented again (the
    // victim's), the chain it belongs to is revoked, so the thief cannot continue.
    const user = await register(api, 'theft');

    // The thief copies the pair and refreshes first.
    const thief0 = await refreshVia(api, user.refreshToken);
    expect(thief0.status).toBe(201);

    // The victim's page now needs a refresh, and presents the rotated token.
    const context = await contextWith(browser, withExpiredAccess(user));
    const page = await context.newPage();
    const victimRefreshes: number[] = [];
    page.on('response', (res) => {
      if (res.url().endsWith('/v1/auth/refresh'))
        victimRefreshes.push(res.status());
    });
    await page.goto('/en/account');
    await expect.poll(() => victimRefreshes.length).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(SETTLE_MS);
    const victimPair = await storedPair(page);
    const victimUrl = page.url();
    await page.screenshot({
      path: test.info().outputPath('victim-after-reuse.png'),
    });

    // The thief keeps going.
    const thiefChain: number[] = [];
    let current = thief0.pair as Pair;
    for (let i = 0; i < 5; i++) {
      const next = await refreshVia(api, current.refreshToken);
      thiefChain.push(next.status);
      if (!next.pair) break;
      current = next.pair;
    }

    const observed = {
      victimRefreshes,
      victimSignedOut: victimPair === null,
      victimUrl,
      thiefChain,
    };
    test
      .info()
      .annotations.push({
        type: 'observed',
        description: JSON.stringify(observed),
      });
    console.log('[6b]', JSON.stringify(observed));

    expect(
      thiefChain[0],
      `the thief's chain is revoked after reuse was seen (chain ${JSON.stringify(thiefChain)})`
    ).toBe(401);

    await context.close();
  });

  // 7 ---------------------------------------------------------------------------
  test('7. the auth callback does not replace a held session with a pair from a URL fragment', async ({
    browser,
  }) => {
    // Invariant: a page signed in as guest G that is sent to
    // /en/auth/callback#accessToken=... with another account's pair keeps G's
    // pair. And the history does not keep a URL carrying a live token.
    const zone = await api.post('/v1/zones', {
      data: { name: 'Session spec' },
    });
    expect(zone.status(), await zone.text()).toBe(201);
    const guest = ((await zone.json()) as { tokens: Pair }).tokens;
    expect(guest?.kind).toBe('TEMPORARY');
    const other = await register(api, 'callback');

    const context = await contextWith(browser, guest);
    const page = await context.newPage();
    await page.goto('/en/home');
    await page.waitForTimeout(1_500);
    expect((await storedPair(page))?.userId).toBe(guest.userId);

    const fragment = new URLSearchParams({
      accessToken: other.accessToken,
      refreshToken: other.refreshToken,
      userId: other.userId,
      kind: other.kind,
      username: other.username,
    }).toString();
    await page.goto(`/en/auth/callback#${fragment}`);
    await expect
      .poll(() => new URL(page.url()).pathname)
      .not.toMatch(/auth\/callback/);
    await page.waitForTimeout(1_000);
    const after = await storedPair(page);

    // Walk back through the history the callback left, and note every URL a
    // step lands on (and every navigation it causes), whether or not the page
    // then moves on by itself.
    const historyLength = await page.evaluate(() => window.history.length);
    const seen: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) seen.push(frame.url());
    });
    for (let step = 0; step < 3; step++) {
      await page.goBack().catch(() => null);
      seen.push(`after back ${step + 1}: ${page.url()}`);
      await page.waitForTimeout(800);
    }
    const tokenInHistory = seen.some((u) => u.includes('accessToken='));

    const observed = {
      guest: guest.userId,
      other: other.userId,
      storedAfterCallback: after?.userId ?? null,
      historyLength,
      urlsAfterBack: seen.map((u) =>
        u
          .replace(/accessToken=[^&]+/, 'accessToken=<redacted>')
          .replace(/refreshToken=[^&]+/, 'refreshToken=<redacted>')
      ),
      tokenInHistory,
    };
    test
      .info()
      .annotations.push({
        type: 'observed',
        description: JSON.stringify(observed),
      });
    console.log('[7]', JSON.stringify(observed));

    expect
      .soft(after?.userId, 'the stored pair is still the guest')
      .toBe(guest.userId);
    expect
      .soft(tokenInHistory, 'no history entry carries the token fragment')
      .toBe(false);

    await context.close();
  });

  // 8 ---------------------------------------------------------------------------
  test('8. a basket participant socket token is not an account token at the gateway', async () => {
    // Invariant: the participant token (same signing key, no `sub`) sent as
    // `Authorization: Bearer` to account routes answers 401 on each.
    const owner = await register(api, 'owner8');
    const { basketId, secret } = await sharedLiveBasket(api, owner);

    const joined = await api.post(`/v1/share-links/${secret}/join`, {
      data: {},
    });
    expect(joined.status(), await joined.text()).toBe(201);
    const join = (await joined.json()) as {
      socketToken: string;
      sessionSecret: string;
      participant: { kind: string };
    };
    expect(join.participant.kind).toBe('GUEST');

    const renewed = await api.post(
      `/v1/baskets/${basketId}/participant-token`,
      {
        headers: { 'x-participant-secret': join.sessionSecret },
      }
    );
    expect(renewed.status(), await renewed.text()).toBe(201);
    const token = ((await renewed.json()) as { socketToken: string })
      .socketToken;

    const bearer = { Authorization: `Bearer ${token}` };
    const me = await api.get('/v1/account/me', { headers: bearer });
    const zones = await api.get('/v1/zones', { headers: bearer });
    const live = await api.get('/v1/baskets/live', { headers: bearer });
    const del = await api.delete('/v1/account', { headers: bearer });

    const observed = {
      me: [me.status(), (await me.text()).slice(0, 200)],
      zones: [zones.status(), (await zones.text()).slice(0, 200)],
      liveBasket: [live.status(), (await live.text()).slice(0, 200)],
      deleteAccount: [del.status(), (await del.text()).slice(0, 200)],
    };
    test
      .info()
      .annotations.push({
        type: 'observed',
        description: JSON.stringify(observed),
      });
    console.log('[8]', JSON.stringify(observed));

    // The owner's account must be untouched by whatever the delete did.
    const ownerMe = await api.get('/v1/account/me', {
      headers: { Authorization: `Bearer ${owner.accessToken}` },
    });

    expect.soft(me.status(), 'GET /v1/account/me').toBe(401);
    expect.soft(zones.status(), 'GET /v1/zones').toBe(401);
    expect.soft(live.status(), 'GET /v1/baskets/live').toBe(401);
    expect.soft(del.status(), 'DELETE /v1/account').toBe(401);
    expect(ownerMe.status(), 'an unrelated account still exists').toBe(200);
  });
});
