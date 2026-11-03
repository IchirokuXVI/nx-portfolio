import { SourceGuard } from '@portfolio/luna-shopper/source-guard';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ELJAMON_REFUSAL_POLICY,
  ElJamonClient,
  ElJamonHttpError,
  ElJamonSessionError,
} from './eljamon.client';
import type { ElJamonCategory } from './types';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

interface Sent {
  url: string;
  method: string;
  cookie: string | undefined;
  body: string | undefined;
}

/**
 * A fake storefront: answers by URL, records what was sent, and sets a session
 * cookie on the home page the way Liferay does.
 */
function fakeSite(
  answer: (url: string, sent: Sent) => { status?: number; body: string }
): { fetchImpl: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  let session = 0;
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const request: Sent = {
      url,
      method: init?.method ?? 'GET',
      cookie: headers['cookie'],
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    sent.push(request);
    const { status = 200, body } = answer(url, request);
    const responseHeaders = new Headers();
    if (new URL(url).pathname === '/') {
      session += 1;
      responseHeaders.append(
        'set-cookie',
        `JSESSIONID=s${session}; Path=/; HttpOnly`
      );
      responseHeaders.append('set-cookie', 'GCLB=backend-a; Path=/');
    }
    return new Response(body, { status, headers: responseHeaders });
  }) as typeof fetch;
  return { fetchImpl, sent };
}

const HOME = fixture('home.html');
const PAGE_1 = fixture('category-page-1.html');
const PAGE_2 = fixture('category-page-2.html');

const FRESCOS: ElJamonCategory = {
  code: '04',
  slug: 'frescos',
  name: 'FRESCOS',
  path: '/categorias/frescos/04',
};

function storefront(url: string): { status?: number; body: string } {
  const { pathname, searchParams } = new URL(url);
  if (pathname === '/') {
    return { body: HOME };
  }
  if (pathname.startsWith('/delegate/seleccionarCodPostal')) {
    return { body: '' };
  }
  if (pathname === FRESCOS.path) {
    const page = searchParams.get(
      '_ProductosFoodPortlet_WAR_comerzziaportletsfood_pagina'
    );
    // Page 3 repeats page 1, as a server that clamps the page number would.
    return { body: page === null ? PAGE_1 : page === '2' ? PAGE_2 : PAGE_1 };
  }
  if (pathname.startsWith('/detalle/')) {
    return { body: fixture('product.html') };
  }
  return { status: 404, body: '' };
}

const client = (fetchImpl: typeof fetch): ElJamonClient =>
  new ElJamonClient({
    userAgent: 'test',
    fetchImpl,
    sleepImpl: async () => undefined,
  });

describe('ElJamonClient', () => {
  it('starts the session from / and then sets the postal code', async () => {
    const site = fakeSite(storefront);
    const categories = await client(site.fetchImpl).topCategories();

    expect(categories).toHaveLength(11);
    expect(site.sent.map((request) => new URL(request.url).pathname)).toEqual([
      '/',
      '/delegate/seleccionarCodPostalAjaxServletFood',
    ]);
    expect(site.sent[1].url).toContain('cp=21440');
  });

  it('sends the session cookies back', async () => {
    const site = fakeSite(storefront);
    await client(site.fetchImpl).getProduct('/detalle/-/Producto/x/1');

    expect(site.sent[1].cookie).toBe('JSESSIONID=s1; GCLB=backend-a');
    expect(site.sent[2].cookie).toBe('JSESSIONID=s1; GCLB=backend-a');
  });

  it('starts a new session once on sessionko, then fails', async () => {
    const refusing = fakeSite((url) =>
      url.includes('seleccionarCodPostal')
        ? { body: '{"result":"sessionko"}' }
        : storefront(url)
    );
    await expect(
      client(refusing.fetchImpl).topCategories()
    ).rejects.toBeInstanceOf(ElJamonSessionError);
    expect(
      refusing.sent.filter((request) => new URL(request.url).pathname === '/')
    ).toHaveLength(2);

    let refusals = 0;
    const once = fakeSite((url) => {
      if (url.includes('seleccionarCodPostal') && refusals === 0) {
        refusals += 1;
        return { body: '{"result":"sessionko"}' };
      }
      return storefront(url);
    });
    await expect(client(once.fetchImpl).topCategories()).resolves.toHaveLength(
      11
    );
    expect(once.sent[3].cookie).toBe('JSESSIONID=s2; GCLB=backend-a');
  });

  it('fails at once on a postal code the shop does not serve', async () => {
    const site = fakeSite((url) =>
      url.includes('seleccionarCodPostal')
        ? {
            body: '{"resultado":"ko","mensaje":"Actualmente no servimos pedidos"}',
          }
        : storefront(url)
    );
    await expect(client(site.fetchImpl).topCategories()).rejects.toThrow(
      /no servimos/
    );
  });

  it('asks for page N with a POST of the filters, with page N and nothing else changed', async () => {
    const site = fakeSite(storefront);
    const rows = [];
    for await (const row of client(site.fetchImpl).walkCategory(FRESCOS)) {
      rows.push(row);
    }

    const second = site.sent.find((request) =>
      request.url.includes('pagina=2')
    );
    expect(second?.method).toBe('POST');
    const body = new URLSearchParams(second?.body ?? '');
    const filters = JSON.parse(body.get('filters') ?? '{}') as Record<
      string,
      unknown
    >;
    expect(filters).toMatchObject({
      categoryCode: '04',
      page: 2,
      pageSize: 20,
    });
    expect(body.get('modoCuadricula')).toBe('cuadriculaP');
    expect(body.has('idPortlet')).toBe(true);

    // Page 3 repeated page 1's codes, which ends the category there.
    expect(rows).toHaveLength(40);
    expect(new Set(rows.map((row) => row.code)).size).toBe(40);
    expect(site.sent.some((request) => request.url.includes('pagina=4'))).toBe(
      false
    );
  });

  it('backs off on 429 and retries', async () => {
    let limited = 0;
    const waits: number[] = [];
    const site = fakeSite((url) => {
      if (url.includes('/detalle/') && limited < 2) {
        limited += 1;
        return { status: 429, body: '' };
      }
      return storefront(url);
    });
    const product = await new ElJamonClient({
      userAgent: 'test',
      fetchImpl: site.fetchImpl,
      sleepImpl: async (ms) => {
        waits.push(ms);
      },
      backoffBaseMs: 100,
    }).getProduct('/detalle/-/Producto/x/1');

    expect(product).not.toBeNull();
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeGreaterThanOrEqual(100);
    expect(waits[1]).toBeGreaterThanOrEqual(200);
  });

  it('backs off on a dropped connection and retries, as on a 429', async () => {
    let dropped = 0;
    const waits: number[] = [];
    const site = fakeSite(storefront);
    const flaky = (async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      if (String(input).includes('/detalle/') && dropped < 2) {
        dropped += 1;
        throw Object.assign(new Error('socket hang up'), {
          code: 'ECONNRESET',
        });
      }
      return site.fetchImpl(input, init);
    }) as typeof fetch;
    const shop = new ElJamonClient({
      userAgent: 'test',
      fetchImpl: flaky,
      sleepImpl: async (ms) => {
        waits.push(ms);
      },
      backoffBaseMs: 100,
    });

    const product = await shop.getProduct('/detalle/-/Producto/x/1');

    expect(product).not.toBeNull();
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeGreaterThanOrEqual(100);
    expect(waits[1]).toBeGreaterThanOrEqual(200);
    // Session (2) + two dropped attempts + the one that answered.
    expect(shop.requests).toBe(5);
  });

  it('retries a body that breaks off halfway', async () => {
    let broken = false;
    const site = fakeSite(storefront);
    const flaky = (async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      const response = await site.fetchImpl(input, init);
      if (String(input).includes('/detalle/') && !broken) {
        broken = true;
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => {
            throw new Error('aborted');
          },
        } as unknown as Response;
      }
      return response;
    }) as typeof fetch;

    const product = await client(flaky).getProduct('/detalle/-/Producto/x/1');

    expect(product).not.toBeNull();
    expect(broken).toBe(true);
  });

  it('gives up on a connection that keeps dropping once the retries run out', async () => {
    const site = fakeSite(storefront);
    const failing = (async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      if (String(input).includes('/detalle/')) {
        throw new Error('socket hang up');
      }
      return site.fetchImpl(input, init);
    }) as typeof fetch;
    const shop = new ElJamonClient({
      userAgent: 'test',
      fetchImpl: failing,
      sleepImpl: async () => undefined,
      retries: 2,
    });

    await expect(shop.getProduct('/detalle/-/Producto/x/1')).rejects.toThrow(
      'socket hang up'
    );
    expect(shop.requests).toBe(2 + 3);
  });

  it('does not retry once the run is aborted', async () => {
    const controller = new AbortController();
    const site = fakeSite(storefront);
    let calls = 0;
    const aborting = (async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      if (String(input).includes('/detalle/')) {
        calls += 1;
        controller.abort(new Error('cancelled'));
        throw new Error('The operation was aborted');
      }
      return site.fetchImpl(input, init);
    }) as typeof fetch;

    await expect(
      new ElJamonClient({
        userAgent: 'test',
        fetchImpl: aborting,
        sleepImpl: async () => undefined,
        signal: controller.signal,
      }).getProduct('/detalle/-/Producto/x/1')
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('skips a failed page after the first and asks for the next one with the last filters read', async () => {
    const site = fakeSite((url) =>
      url.includes('pagina=2') ? { status: 403, body: '' } : storefront(url)
    );
    const failed: number[] = [];
    const rows = [];
    for await (const row of client(site.fetchImpl).walkCategory(
      FRESCOS,
      undefined,
      (index) => failed.push(index)
    )) {
      rows.push(row);
    }

    expect(failed).toEqual([2]);
    // Page 3 (which the fake answers with page 1) was still asked for, with
    // page 1's filters and page 3 in them; its repeated codes then end the walk.
    const third = site.sent.find((request) => request.url.includes('pagina=3'));
    const filters = JSON.parse(
      new URLSearchParams(third?.body ?? '').get('filters') ?? '{}'
    ) as Record<string, unknown>;
    expect(filters).toMatchObject({ categoryCode: '04', page: 3 });
    expect(rows).toHaveLength(20);
  });

  it('throws on a failed page when nobody takes the failure, and on two in a row', async () => {
    const walk = async (
      failing: (url: string) => boolean,
      onPageError?: (index: number) => void
    ) => {
      const site = fakeSite((url) =>
        failing(url) ? { status: 403, body: '' } : storefront(url)
      );
      for await (const row of client(site.fetchImpl).walkCategory(
        FRESCOS,
        undefined,
        onPageError
      )) {
        void row;
      }
    };

    await expect(
      walk((url) => url.includes('pagina=2'))
    ).rejects.toBeInstanceOf(ElJamonHttpError);
    await expect(
      walk(
        (url) => url.includes('pagina=2') || url.includes('pagina=3'),
        () => undefined
      )
    ).rejects.toBeInstanceOf(ElJamonHttpError);
  });

  it('throws on a status a retry cannot fix', async () => {
    const site = fakeSite((url) =>
      url.includes('/detalle/') ? { status: 403, body: '' } : storefront(url)
    );
    await expect(
      client(site.fetchImpl).getProduct('/detalle/-/Producto/x/1')
    ).rejects.toBeInstanceOf(ElJamonHttpError);
  });

  it('reads the store locator in one POST, with no session', async () => {
    const site = fakeSite(() => ({ body: fixture('stores.html') }));
    const shop = client(site.fetchImpl);
    const list = await shop.listStores();

    expect(list.stores).toHaveLength(366);
    expect(site.sent).toHaveLength(1);
    expect(site.sent[0].method).toBe('POST');
    expect(site.sent[0].cookie).toBeUndefined();
    const body = new URLSearchParams(site.sent[0].body ?? '');
    expect(body.get('action')).toBe('make_search_request');
    expect(body.get('store_locatore_search_radius')).toBe('1000');
    expect(shop.requests).toBe(1);
  });
});

/**
 * The run's refusal guard (plan 0215, section 4). The 200 answers are the
 * committed fixtures and the 403 is synthesized: the guard reads the status
 * and never the body, so no block is provoked to capture one.
 */
describe('ElJamonClient and the refusal guard', () => {
  const settle = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve));
  const PRODUCT = '/detalle/-/Producto/x/1';

  function pausingGuard() {
    const sleeps: Array<() => void> = [];
    const guard = new SourceGuard(ELJAMON_REFUSAL_POLICY, {
      sleep: () => new Promise<void>((resolve) => sleeps.push(resolve)),
    });
    const endPause = async (): Promise<void> => {
      for (let tick = 0; tick < 40; tick += 1) {
        await settle();
        sleeps.shift()?.();
      }
    };
    return { guard, endPause };
  }

  /** The storefront, with its product pages refused while `refusing` holds. */
  function refusingSite(refusing: () => boolean) {
    let details = 0;
    const site = fakeSite((url) => {
      if (url.includes('/detalle/')) {
        details += 1;
        if (refusing()) {
          return { status: 403, body: 'refused' };
        }
      }
      return storefront(url);
    });
    return { ...site, details: () => details };
  }

  it('trips a passed guard on a run of 403, and a clean probe resumes it', async () => {
    const { guard, endPause } = pausingGuard();
    let refusals = 5;
    const site = refusingSite(() => refusals-- > 0);
    const shop = new ElJamonClient({
      userAgent: 'test',
      fetchImpl: site.fetchImpl,
      sleepImpl: async () => undefined,
      guard,
    });

    // The listing answers from its fixture and clears nothing it should not.
    const rows = [];
    for await (const row of shop.walkCategory(FRESCOS)) {
      rows.push(row);
    }
    expect(rows.length).toBeGreaterThan(0);
    for (let n = 0; n < 4; n += 1) {
      await expect(shop.getProduct(PRODUCT)).rejects.toBeInstanceOf(
        ElJamonHttpError
      );
    }
    const tripping = shop.getProduct(PRODUCT);
    await settle();
    expect(site.details()).toBe(5);

    await endPause();

    expect(await tripping).not.toBeNull();
    expect(site.details()).toBe(6);
    expect(guard.summary().paused?.resumedAt).not.toBeNull();
  });

  it('does not count a request that never got an answer', async () => {
    const { guard } = pausingGuard();
    let dropping = false;
    const site = refusingSite(() => true);
    const fetchImpl = (async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      if (dropping && String(input).includes('/detalle/')) {
        throw new Error('socket hang up');
      }
      return site.fetchImpl(input, init);
    }) as typeof fetch;
    const shop = new ElJamonClient({
      userAgent: 'test',
      fetchImpl,
      sleepImpl: async () => undefined,
      retries: 1,
      guard,
    });

    for (let n = 0; n < 4; n += 1) {
      await expect(shop.getProduct(PRODUCT)).rejects.toBeInstanceOf(
        ElJamonHttpError
      );
    }
    dropping = true;
    await expect(shop.getProduct(PRODUCT)).rejects.toThrow('socket hang up');
    expect(guard.summary().paused).toBeNull();

    // The dropped request left the count at four, so the next 403 is the
    // fifth in a row.
    dropping = false;
    const tripping = shop.getProduct(PRODUCT);
    await settle();
    expect(guard.summary().paused).toEqual(
      expect.objectContaining({ consecutive: 5 })
    );
    void tripping.catch(() => undefined);
  });

  it('throws ElJamonHttpError on a 403 with no guard, as before', async () => {
    const site = refusingSite(() => true);

    await expect(
      client(site.fetchImpl).getProduct(PRODUCT)
    ).rejects.toBeInstanceOf(ElJamonHttpError);
    expect(site.details()).toBe(1);
  });
});
