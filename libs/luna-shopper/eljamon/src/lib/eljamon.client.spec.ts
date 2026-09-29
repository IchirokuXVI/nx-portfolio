import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
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
