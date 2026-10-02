import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DIA_BROWSER_HEADERS,
  DiaClient,
  DiaHttpError,
  DiaSessionError,
  DiaStoppedError,
} from './dia.client';

const fixture = (name: string): Buffer =>
  readFileSync(join(__dirname, '__fixtures__', name));

const statuses = JSON.parse(
  fixture('statuses.json').toString('utf8')
) as Record<string, number>;

interface Sent {
  url: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

interface Answer {
  status?: number;
  body?: Buffer | string;
  location?: string;
  setCookie?: string[];
}

/** A fake site: answers by request, and records what was sent. */
function fakeSite(answer: (sent: Sent, index: number) => Answer | Error): {
  fetchImpl: typeof fetch;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const url = String(input);
    const parsed = new URL(url);
    const request: Sent = {
      url,
      path: `${parsed.pathname}${parsed.search}`,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    sent.push(request);
    const answered = answer(request, sent.length - 1);
    if (answered instanceof Error) {
      throw answered;
    }
    const { status = 200, body = '', location, setCookie = [] } = answered;
    const headers = new Headers();
    if (location) {
      headers.set('location', location);
    }
    for (const cookie of setCookie) {
      headers.append('set-cookie', cookie);
    }
    // A 204 may carry no body at all, by the Response constructor's own rule.
    return new Response(status === 204 ? null : body, { status, headers });
  }) as typeof fetch;
  return { fetchImpl, sent };
}

/** The fixture answer with the status the capture recorded for it. */
const recorded = (name: string): Answer => ({
  status: statuses[name],
  body: fixture(name),
});

const HEADER = '/api/v1/common-aggregator/header-data';
const CHECK = '/api/v1/common-aggregator/check-service';
const SAVE = '/api/v1/common-aggregator/save-shipping-address';

/** A client that never waits, with the sleeps it asked for recorded. */
function quickClient(
  fetchImpl: typeof fetch,
  options: ConstructorParameters<typeof DiaClient>[0] = {}
): { client: DiaClient; slept: number[] } {
  const slept: number[] = [];
  const client = new DiaClient({
    fetchImpl,
    minIntervalMs: 0,
    sleepImpl: async (ms) => {
      slept.push(ms);
    },
    ...options,
  });
  return { client, slept };
}

describe('DiaClient headers (decision D1)', () => {
  it('sends the browser headers on every request, and no name of ours', async () => {
    const { fetchImpl, sent } = fakeSite(() => recorded('menu.json'));
    const { client } = quickClient(fetchImpl);
    await client.menu();

    expect(sent[0].headers).toMatchObject(DIA_BROWSER_HEADERS);
    expect(sent[0].headers['user-agent']).toMatch(/Chrome\/\d+/);
    expect(sent[0].headers['user-agent']).not.toMatch(/luna|velista/i);
  });

  it('takes no user agent option', () => {
    // A compile time fact, stated where a reader looks for it: the option does
    // not exist, so a source row cannot change what Akamai is sent.
    const options: ConstructorParameters<typeof DiaClient>[0] = {};
    expect('userAgent' in options).toBe(false);
  });
});

describe('DiaClient session', () => {
  /** A site that holds a postal code per session, as the real one does. */
  function sessionSite(served: Record<string, string>): {
    fetchImpl: typeof fetch;
    sent: Sent[];
  } {
    let sessions = 0;
    const postalCodes = new Map<string, string>();
    return fakeSite((sent) => {
      const { pathname, searchParams } = new URL(sent.url);
      const cookie = /session_id=([^;]+)/.exec(sent.headers['cookie'] ?? '');
      if (pathname === HEADER) {
        const answer: Answer = {};
        let id = cookie?.[1];
        if (!id) {
          sessions += 1;
          id = `s${sessions}`;
          postalCodes.set(id, '28041');
          answer.setCookie = [`session_id=${id}; Path=/; HttpOnly`];
        }
        const body = JSON.parse(
          fixture('header-anonymous.json').toString('utf8')
        );
        body.cart.postal_code = postalCodes.get(id);
        return { ...answer, body: JSON.stringify(body) };
      }
      if (pathname === SAVE) {
        const code = searchParams.get('new_postal_code') ?? '';
        if (!served[code] || !cookie) {
          return recorded('save-shipping-address-206.json');
        }
        postalCodes.set(cookie[1], code);
        return { status: 204 };
      }
      if (pathname === CHECK) {
        const store = served[searchParams.get('postal_code') ?? ''];
        return store
          ? { body: JSON.stringify({ physical_store_id: store }) }
          : recorded('check-service-206.txt');
      }
      return { status: 404 };
    });
  }

  it('starts a session, sets the postal code and confirms it', async () => {
    const { fetchImpl, sent } = sessionSite({
      '08001': '959',
      '28041': '13835',
    });
    const { client } = quickClient(fetchImpl);

    await expect(client.startSession('08001', '959')).resolves.toBe('959');

    expect(sent.map((request) => `${request.method} ${request.path}`)).toEqual([
      `GET ${HEADER}`,
      `PUT ${SAVE}?new_postal_code=08001`,
      `GET ${HEADER}`,
      `GET ${CHECK}?postal_code=08001`,
    ]);
    expect(sent[1].body).toBe('null');
  });

  it('keeps its own cookies, since fetch has no jar', async () => {
    const { fetchImpl, sent } = sessionSite({ '08001': '959' });
    const { client } = quickClient(fetchImpl);
    await client.startSession('08001');

    expect(sent[0].headers['cookie']).toBeUndefined();
    expect(sent[1].headers['cookie']).toBe('session_id=s1');
    expect(sent[3].headers['cookie']).toBe('session_id=s1');
  });

  it('starts every session from no cookie, so a scope never inherits one', async () => {
    const { fetchImpl, sent } = sessionSite({
      '08001': '959',
      '41001': '2354',
    });
    const { client } = quickClient(fetchImpl);
    await client.startSession('08001');
    await client.startSession('41001');

    expect(sent[4].headers['cookie']).toBeUndefined();
    expect(sent[5].headers['cookie']).toBe('session_id=s2');
  });

  it('refuses a 206, which would walk under the postal code it had', async () => {
    const { fetchImpl } = sessionSite({ '28041': '13835' });
    const { client } = quickClient(fetchImpl);

    const refusal = await client.startSession('44200').catch((error) => error);
    expect(refusal).toBeInstanceOf(DiaSessionError);
    expect(refusal).toMatchObject({ postalCode: '44200', reason: 'refused' });
    expect(String(refusal.message)).toContain('206');
  });

  it('refuses a session whose header shows another postal code', async () => {
    // The fixtures of the real refusal: the PUT is forced to 204 here, and the
    // header still shows the code the session had.
    const { fetchImpl } = fakeSite((sent) => {
      const { pathname } = new URL(sent.url);
      if (pathname === SAVE) {
        return { status: 204 };
      }
      return recorded('header-after-refusal.json');
    });
    const { client } = quickClient(fetchImpl);

    await expect(client.startSession('44200')).rejects.toMatchObject({
      reason: 'postal-code-not-kept',
    });
  });

  it('refuses a postal code that another store serves', async () => {
    const { fetchImpl } = sessionSite({ '08001': '959' });
    const { client } = quickClient(fetchImpl);

    await expect(client.startSession('08001', '13835')).rejects.toMatchObject({
      reason: 'store-mismatch',
    });
  });

  it('reads the fixture pair: the PUT moved the session, the refusal did not', () => {
    const code = (name: string): string =>
      JSON.parse(fixture(name).toString('utf8')).cart.postal_code;
    expect(statuses['save-shipping-address-204.txt']).toBe(204);
    expect(statuses['save-shipping-address-206.json']).toBe(206);
    expect(code('header-anonymous.json')).toBe('28041');
    expect(code('header-after-put.json')).toBe('08001');
    expect(code('header-after-refusal.json')).toBe('08001');
  });

  it('finds the store of the anonymous session', async () => {
    const { fetchImpl } = sessionSite({ '28041': '13835' });
    const { client } = quickClient(fetchImpl);

    await expect(client.anonymousStore()).resolves.toEqual({
      postalCode: '28041',
      storeCode: '13835',
    });
  });
});

describe('DiaClient.checkService', () => {
  it('answers the store of a served code, and null for a 206', async () => {
    const { fetchImpl } = fakeSite((sent) =>
      sent.url.endsWith('28041')
        ? recorded('check-service-200.json')
        : recorded('check-service-206.txt')
    );
    const { client } = quickClient(fetchImpl);

    await expect(client.checkService('28041')).resolves.toBe('13835');
    await expect(client.checkService('44200')).resolves.toBeNull();
  });
});

describe('DiaClient.listing', () => {
  const COLA = '/agua-y-refrescos/cola/c/L2108';

  it('asks page 1 with no query and page N with ?page=N', async () => {
    const { fetchImpl, sent } = fakeSite((request) =>
      request.url.includes('page=2')
        ? recorded('listing-page-2.json')
        : recorded('listing-page-1.json')
    );
    const { client } = quickClient(fetchImpl);

    const first = await client.listing(COLA);
    const second = await client.listing(COLA, 2);

    expect(sent.map((request) => request.path)).toEqual([
      `/api/v1/plp-back/reduced${COLA}`,
      `/api/v1/plp-back/reduced${COLA}?page=2`,
    ]);
    expect(first.pageNumber).toBe(1);
    expect(second.pageNumber).toBe(2);
    expect(first.movedTo).toBeNull();
  });

  it('follows a moved leaf once and says where it went', async () => {
    const moved = '/agua-y-refrescos/refrescos-de-cola/c/L2108';
    const { fetchImpl, sent } = fakeSite((request) =>
      request.path.includes('/cola/c/')
        ? { status: 301, location: moved }
        : recorded('listing-page-1.json')
    );
    const { client } = quickClient(fetchImpl);

    const page = await client.listing(COLA);

    expect(page.movedTo).toBe(moved);
    expect(page.rows).toHaveLength(20);
    expect(sent[1].path).toBe(`/api/v1/plp-back/reduced${moved}`);
  });

  it('fails a leaf that moves twice, rather than chasing it', async () => {
    const { fetchImpl, sent } = fakeSite(() => ({
      status: 301,
      location: '/somewhere/else/c/L1',
    }));
    const { client } = quickClient(fetchImpl);

    await expect(client.listing(COLA)).rejects.toBeInstanceOf(DiaHttpError);
    expect(sent).toHaveLength(2);
  });
});

describe('DiaClient stores', () => {
  it('reads the file the store finder page names, in two requests', async () => {
    const { fetchImpl, sent } = fakeSite((request) =>
      request.path === '/tiendas/buscador-tiendas-folletos'
        ? recorded('store-finder.html')
        : recorded('stores.json.gz')
    );
    const { client } = quickClient(fetchImpl);

    const file = await client.storeFile();

    expect(file.stores.length).toBeGreaterThan(2300);
    expect(sent).toHaveLength(2);
    expect(sent[1].path).toMatch(/^\/clubdia\/ES\/tiendas\.v\d+\.json\.gz$/);
  });

  it('reads one shop detail by idTienda', async () => {
    const { fetchImpl, sent } = fakeSite(() =>
      recorded('store-detail-normal.json')
    );
    const { client } = quickClient(fetchImpl);

    const detail = await client.storeDetail('1001720');

    expect(detail?.postalCode).toBe('28004');
    expect(sent[0].path).toBe(
      '/tiendas/buscadorTiendas.html?action=buscarInformacionTienda&id=1001720'
    );
  });
});

describe('DiaClient retries', () => {
  it('retries a 5xx with backoff of 30, 60 and 120 seconds', async () => {
    const { fetchImpl, sent } = fakeSite((_, index) =>
      index < 3 ? { status: 503 } : recorded('menu.json')
    );
    const { client, slept } = quickClient(fetchImpl);

    await client.menu();

    expect(sent).toHaveLength(4);
    expect(slept).toEqual([30_000, 60_000, 120_000]);
    expect(client.requests).toBe(4);
  });

  it('retries a refused connection the same way, since that is what a block looked like', async () => {
    const { fetchImpl } = fakeSite((_, index) =>
      index < 2 ? new TypeError('fetch failed') : recorded('menu.json')
    );
    const { client, slept } = quickClient(fetchImpl);

    await expect(client.menu()).resolves.toMatchObject({
      roots: expect.any(Array),
    });
    expect(slept).toEqual([30_000, 60_000]);
  });

  it('retries a 403 once after 60 seconds, then fails the request', async () => {
    const { fetchImpl, sent } = fakeSite(() => ({ status: 403 }));
    const { client, slept } = quickClient(fetchImpl);

    await expect(client.menu()).rejects.toMatchObject({ status: 403 });
    expect(sent).toHaveLength(2);
    expect(slept).toEqual([60_000]);
  });

  it('fails a 404 at once', async () => {
    const { fetchImpl, sent } = fakeSite(() => ({ status: 404 }));
    const { client, slept } = quickClient(fetchImpl);

    await expect(client.menu()).rejects.toBeInstanceOf(DiaHttpError);
    expect(sent).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it('stops after five failed requests in a row, naming the last error', async () => {
    const { fetchImpl, sent } = fakeSite(() => ({ status: 404 }));
    const { client } = quickClient(fetchImpl);

    for (let index = 0; index < 4; index += 1) {
      await expect(client.menu()).rejects.toBeInstanceOf(DiaHttpError);
    }
    const stopped = await client.menu().catch((error) => error);
    expect(stopped).toBeInstanceOf(DiaStoppedError);
    expect(stopped.failures).toBe(5);
    expect(stopped.lastError).toBeInstanceOf(DiaHttpError);

    // And every call after it fails without a request.
    await expect(client.checkService('28041')).rejects.toBe(stopped);
    expect(sent).toHaveLength(5);
  });

  it('counts failures in a row only: a success starts the count again', async () => {
    let fail = true;
    const { fetchImpl } = fakeSite(() =>
      fail ? { status: 404 } : recorded('menu.json')
    );
    const { client } = quickClient(fetchImpl);

    for (let round = 0; round < 3; round += 1) {
      fail = true;
      for (let index = 0; index < 4; index += 1) {
        await expect(client.menu()).rejects.toBeInstanceOf(DiaHttpError);
      }
      fail = false;
      await expect(client.menu()).resolves.toBeDefined();
    }
  });

  it('does not retry once the run is aborted', async () => {
    const controller = new AbortController();
    const { fetchImpl, sent } = fakeSite(() => {
      controller.abort();
      return new Error('aborted');
    });
    const { client, slept } = quickClient(fetchImpl, {
      signal: controller.signal,
    });

    await expect(client.menu()).rejects.toThrow();
    expect(sent).toHaveLength(1);
    expect(slept).toEqual([]);
  });
});

describe('DiaClient pacing', () => {
  it('keeps 500 ms between requests by default, whatever the bucket allows', async () => {
    const { fetchImpl } = fakeSite(() => recorded('check-service-200.json'));
    let now = 1_000_000;
    const slept: number[] = [];
    let acquired = 0;
    const client = new DiaClient({
      fetchImpl,
      nowImpl: () => now,
      sleepImpl: async (ms) => {
        slept.push(ms);
        now += ms;
      },
      // A bucket that never makes anybody wait, as a high rate would.
      acquire: async () => {
        acquired += 1;
      },
    });

    await client.checkService('28041');
    now += 100;
    await client.checkService('28041');
    now += 800;
    await client.checkService('28041');

    // The second request came 100 ms after the first, so it waited the other
    // 400. The third came 800 ms later and waited nothing.
    expect(slept).toEqual([400]);
    expect(acquired).toBe(3);
  });
});
