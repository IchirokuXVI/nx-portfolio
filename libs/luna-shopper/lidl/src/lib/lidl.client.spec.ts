import searchPage from './__fixtures__/search-page.json';
import productShortCode from './__fixtures__/product-short-code.json';
import storePage from './__fixtures__/store-page.json';
import { LidlClient, LidlHttpError } from './lidl.client';
import type { LidlListRow } from './types';

/**
 * The client, against a fake fetch. No test here touches the network: the
 * fixtures are what keeps the suite off it (plan 0089, section 12).
 */

const USER_AGENT = 'LunaShopperTest/1.0 (+https://velista.app)';

interface Call {
  url: string;
  headers: Record<string, string>;
}

/** A fetch that answers each call from a queue and records what it was asked. */
function fakeFetch(answers: Array<() => Response>): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const answer = answers.shift();
    if (!answer) {
      throw new Error(`Unexpected request to ${String(url)}`);
    }
    return answer();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200): (() => Response) =>
  () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

const html = (body: string, status = 200): (() => Response) =>
  () => new Response(body, { status, headers: { 'content-type': 'text/html' } });

/**
 * The whole walk over the index fixture: the captured page, then the empty page
 * that ends it. The fixture is five rows cut out of a 494 row index, so a walk
 * that stopped after it would be testing a shorter index than the source has.
 */
const walkAnswers = (): Array<() => Response> => [
  json(searchPage),
  json({ numFound: 494, items: [] }),
];

const productHtml = (payload: unknown): string =>
  `<!DOCTYPE html><html><body><script type="application/json" id="__NUXT_DATA__">${JSON.stringify(
    payload
  )}</script></body></html>`;

function row(overrides: Partial<LidlListRow> = {}): LidlListRow {
  return {
    externalId: '11029954',
    name: 'Uva blanca sabores sin semillas',
    brand: 'Solevita',
    siteCategory: 'F+V',
    categoryPath: [],
    path: '/p/uva-blanca-sabores-sin-semillas/p11029954',
    sizeFormat: '400 g',
    listPrice: 1.69,
    ian: '80532',
    ...overrides,
  };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
  }
  return out;
}

describe('LidlClient.walkInStore', () => {
  it('asks for the four parameters the endpoint refuses to work without', async () => {
    const { fetchImpl, calls } = fakeFetch(walkAnswers());
    const client = new LidlClient({ userAgent: USER_AGENT, fetchImpl });

    await collect(client.walkInStore());

    const query = new URL(calls[0].url).searchParams;
    expect(new URL(calls[0].url).pathname).toBe('/q/api/search');
    expect(query.get('assortment')).toBe('ES');
    // Underscored, and not `es`, `es-ES` or `ES`: each is rejected by name.
    expect(query.get('locale')).toBe('es_ES');
    expect(query.get('version')).toBe('2.0.0');
    // An empty query with the in-store filter is the walk. There is no browse
    // endpoint and no category listing.
    expect(query.get('q')).toBe('');
    expect(query.get('store')).toBe('1');
  });

  it('sends the wildcard accept header the endpoint answers to', async () => {
    const { fetchImpl, calls } = fakeFetch(walkAnswers());
    const client = new LidlClient({ userAgent: USER_AGENT, fetchImpl });

    await collect(client.walkInStore());

    // `Accept: application/json` is refused with 406 (section 3).
    expect(calls[0].headers['accept']).toBe('*/*');
    expect(calls[0].headers['accept']).not.toContain('application/json');
    expect(calls[0].headers['user-agent']).toBe(USER_AGENT);
  });

  it('pages by the size it asked for, until the total it was told', async () => {
    const page = (offset: number, rows: number) => ({
      numFound: 5,
      offset,
      fetchsize: 2,
      items: Array.from({ length: rows }, (_, index) => ({
        gridbox: { data: { productId: offset + index, category: 'Food' } },
      })),
    });
    const { fetchImpl, calls } = fakeFetch([
      json(page(0, 2)),
      json(page(2, 2)),
      json(page(4, 1)),
    ]);
    const client = new LidlClient({
      userAgent: USER_AGENT,
      fetchImpl,
      pageSize: 2,
    });

    const rows = await collect(client.walkInStore());

    expect(rows).toHaveLength(5);
    expect(calls.map((call) => new URL(call.url).searchParams.get('offset'))).toEqual([
      '0',
      '2',
      '4',
    ]);
    expect(
      calls.every(
        (call) => new URL(call.url).searchParams.get('fetchsize') === '2'
      )
    ).toBe(true);
  });

  it('yields a product once however often the paging repeats it', async () => {
    const one = {
      numFound: 4,
      items: [{ gridbox: { data: { productId: 1, category: 'Food' } } }],
    };
    const { fetchImpl } = fakeFetch([json(one), json(one), json(one), json(one)]);
    const client = new LidlClient({
      userAgent: USER_AGENT,
      fetchImpl,
      pageSize: 1,
    });

    expect(await collect(client.walkInStore())).toHaveLength(1);
  });

  it('stops when a page answers nothing rather than paging to the total', async () => {
    const { fetchImpl, calls } = fakeFetch([
      json({ numFound: 500, items: [] }),
    ]);
    const client = new LidlClient({ userAgent: USER_AGENT, fetchImpl });

    expect(await collect(client.walkInStore())).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe('LidlClient.getProduct', () => {
  it('reads the product out of the page it is served in', async () => {
    const { fetchImpl, calls } = fakeFetch([
      html(productHtml(productShortCode)),
    ]);
    const client = new LidlClient({
      userAgent: USER_AGENT,
      fetchImpl,
      now: () => new Date('2026-09-06T12:00:00Z'),
    });

    const product = await client.getProduct(row());

    expect(calls[0].url).toBe(
      'https://www.lidl.es/p/uva-blanca-sabores-sin-semillas/p11029954'
    );
    expect(product?.externalId).toBe('11029954');
    expect(product?.shortCode).toBe('40881959');
    expect(product?.brand).toBe('Solevita');
  });

  it('answers null for a page that fails, so one product costs one product', async () => {
    // Section 8: a page that fails is a warning naming the `externalId`, not a
    // failed run, and the runner is what turns this null into that warning.
    const missing = fakeFetch([html('not found', 404)]);
    const emptyPage = fakeFetch([html('<html><body>hydrated</body></html>')]);
    const wrongProduct = fakeFetch([html(productHtml(productShortCode))]);

    await expect(
      new LidlClient({
        userAgent: USER_AGENT,
        fetchImpl: missing.fetchImpl,
      }).getProduct(row())
    ).resolves.toBeNull();
    await expect(
      new LidlClient({
        userAgent: USER_AGENT,
        fetchImpl: emptyPage.fetchImpl,
      }).getProduct(row())
    ).resolves.toBeNull();
    await expect(
      new LidlClient({
        userAgent: USER_AGENT,
        fetchImpl: wrongProduct.fetchImpl,
      }).getProduct(row({ externalId: '999999' }))
    ).resolves.toBeNull();
  });

  it('makes no request for a row with no page to read', async () => {
    const { fetchImpl, calls } = fakeFetch([]);
    const client = new LidlClient({ userAgent: USER_AGENT, fetchImpl });

    await expect(client.getProduct(row({ path: null }))).resolves.toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('LidlClient.listStores', () => {
  it('sends the store key on the store host and pages to the total', async () => {
    const { fetchImpl, calls } = fakeFetch([
      json({ meta: { total: 8 }, items: storePage.items }),
      json({ meta: { total: 8 }, items: storePage.items.slice(0, 3) }),
    ]);
    const client = new LidlClient({
      userAgent: USER_AGENT,
      fetchImpl,
      storesApiKey: 'a-public-key',
    });

    const stores = await client.listStores();

    expect(stores).toHaveLength(8);
    expect(calls[0].headers['x-apikey']).toBe('a-public-key');
    expect(new URL(calls[0].url).searchParams.get('country_code')).toBe('ES');
    expect(calls.map((c) => new URL(c.url).searchParams.get('offset'))).toEqual([
      '0',
      '250',
    ]);
  });
});

describe('LidlClient politeness', () => {
  it('waits on the gate before every request', async () => {
    const { fetchImpl } = fakeFetch(walkAnswers());
    const acquire = jest.fn().mockResolvedValue(undefined);
    const client = new LidlClient({ userAgent: USER_AGENT, fetchImpl, acquire });

    await collect(client.walkInStore());

    // Both pages of the walk, and not only the first one.
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(client.requests).toBe(2);
  });

  it('retries a 429 and gives up on a 403', async () => {
    const retried = fakeFetch([json({}, 429), ...walkAnswers()]);
    const client = new LidlClient({
      userAgent: USER_AGENT,
      fetchImpl: retried.fetchImpl,
      sleepImpl: async () => undefined,
    });
    await collect(client.walkInStore());
    // The refused request, then the same page again, then the page that ends it.
    expect(retried.calls).toHaveLength(3);

    const refused = fakeFetch([json({}, 403)]);
    await expect(
      collect(
        new LidlClient({
          userAgent: USER_AGENT,
          fetchImpl: refused.fetchImpl,
        }).walkInStore()
      )
    ).rejects.toBeInstanceOf(LidlHttpError);
  });

  it('stops when the run is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetchImpl, calls } = fakeFetch(walkAnswers());
    const client = new LidlClient({
      userAgent: USER_AGENT,
      fetchImpl,
      signal: controller.signal,
    });

    await expect(collect(client.walkInStore())).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
