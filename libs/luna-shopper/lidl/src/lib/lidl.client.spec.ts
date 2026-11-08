import { SourceGuard } from '@portfolio/luna-shopper/source-guard';
import productShortCode from './__fixtures__/product-short-code.json';
import productSinglePrice from './__fixtures__/product-single-price.json';
import searchPage from './__fixtures__/search-page.json';
import storePage from './__fixtures__/store-page.json';
import { LIDL_REFUSAL_POLICY, LidlClient, LidlHttpError } from './lidl.client';
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

const json =
  (body: unknown, status = 200): (() => Response) =>
  () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

const html =
  (body: string, status = 200): (() => Response) =>
  () =>
    new Response(body, { status, headers: { 'content-type': 'text/html' } });

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
    image: null,
    imageList: [],
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

  /**
   * An index of `total` rows that serves at most `cap` items a page and
   * echoes the size it served, as the live site did on 2026-11-08 (plan
   * 0256). The answer is read off the asked offset and size, so a walk that
   * skips rows is seen to skip them.
   */
  function cappedIndex(total: number, cap: number): (url: string) => Response {
    return (url) => {
      const query = new URL(url).searchParams;
      const offset = Number(query.get('offset'));
      const asked = Number(query.get('fetchsize'));
      const served = Math.max(0, Math.min(asked, cap, total - offset));
      return json({
        numFound: total,
        offset,
        fetchsize: Math.min(asked, cap),
        items: Array.from({ length: served }, (_, index) => ({
          gridbox: {
            data: { productId: String(offset + index), category: 'Food' },
          },
        })),
      })();
    };
  }

  /** A fetch that answers every index request and records its paging. */
  function serve(answer: (url: string) => Response): {
    fetchImpl: typeof fetch;
    offsets: string[];
    sizes: string[];
  } {
    const offsets: string[] = [];
    const sizes: string[] = [];
    const fetchImpl = (async (url: string) => {
      const query = new URL(String(url)).searchParams;
      offsets.push(query.get('offset') ?? '');
      sizes.push(query.get('fetchsize') ?? '');
      return answer(String(url));
    }) as unknown as typeof fetch;
    return { fetchImpl, offsets, sizes };
  }

  it('steps by the items a capped page served, and reads every row once', async () => {
    const { fetchImpl, offsets, sizes } = serve(cappedIndex(150, 60));
    const client = new LidlClient({ userAgent: USER_AGENT, fetchImpl });

    const rows = await collect(client.walkInStore());

    expect(offsets).toEqual(['0', '60', '120']);
    // It still asks for 100 (decision D1): the cap is the site's.
    expect(sizes.every((size) => size === '100')).toBe(true);
    expect(rows.map((row) => row.externalId)).toEqual(
      Array.from({ length: 150 }, (_, index) => String(index))
    );
  });

  it('steps by 100 when the site serves the 100 it was asked for', async () => {
    const { fetchImpl, offsets } = serve(cappedIndex(150, 1000));
    const client = new LidlClient({ userAgent: USER_AGENT, fetchImpl });

    expect(await collect(client.walkInStore())).toHaveLength(150);
    expect(offsets).toEqual(['0', '100']);
  });

  it('makes two requests for a total of one row more than the cap', async () => {
    const { fetchImpl, offsets } = serve(cappedIndex(61, 60));
    const client = new LidlClient({ userAgent: USER_AGENT, fetchImpl });

    expect(await collect(client.walkInStore())).toHaveLength(61);
    expect(offsets).toEqual(['0', '60']);
  });

  it('steps past a tile that is not a product, and on past a page of tiles only', async () => {
    const product = (id: number) => ({
      gridbox: { data: { productId: String(id), category: 'Food' } },
    });
    const banner = { banner: { data: { title: 'Ofertas' } } };
    const pages: Record<string, unknown> = {
      '0': { numFound: 6, items: [product(0), banner, banner] },
      '3': { numFound: 6, items: [banner, banner] },
      '5': { numFound: 6, items: [product(5)] },
    };
    const { fetchImpl, offsets } = serve((url) =>
      json(pages[new URL(url).searchParams.get('offset') ?? ''])()
    );
    const client = new LidlClient({ userAgent: USER_AGENT, fetchImpl });

    const rows = await collect(client.walkInStore());

    expect(offsets).toEqual(['0', '3', '5']);
    expect(rows.map((row) => row.externalId)).toEqual(['0', '5']);
  });

  it('yields a product once however often the paging repeats it', async () => {
    const one = {
      numFound: 4,
      items: [{ gridbox: { data: { productId: 1, category: 'Food' } } }],
    };
    const { fetchImpl } = fakeFetch([
      json(one),
      json(one),
      json(one),
      json(one),
    ]);
    const client = new LidlClient({
      userAgent: USER_AGENT,
      fetchImpl,
      pageSize: 1,
    });

    expect(await collect(client.walkInStore())).toHaveLength(1);
  });

  it('stops on a page that repeats what it saw when no total is stated', async () => {
    const page = {
      items: [1, 2].map((id) => ({
        gridbox: { data: { productId: String(id), category: 'Food' } },
      })),
    };
    const { fetchImpl, offsets } = serve(() => json(page)());
    const client = new LidlClient({ userAgent: USER_AGENT, fetchImpl });

    const rows = await collect(client.walkInStore());

    expect(offsets).toEqual(['0', '2']);
    expect(rows.map((row) => row.externalId)).toEqual(['1', '2']);
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
    expect(calls.map((c) => new URL(c.url).searchParams.get('offset'))).toEqual(
      ['0', '250']
    );
  });
});

describe('LidlClient politeness', () => {
  it('waits on the gate before every request', async () => {
    const { fetchImpl } = fakeFetch(walkAnswers());
    const acquire = jest.fn().mockResolvedValue(undefined);
    const client = new LidlClient({
      userAgent: USER_AGENT,
      fetchImpl,
      acquire,
    });

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

/**
 * The run's refusal guard (plan 0215, section 4). The 200 answers are the
 * committed fixtures and the refusals are synthesized: the guard reads the
 * status and never the body, so no block is provoked to capture one.
 */
describe('LidlClient and the refusal guard', () => {
  const settle = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve));
  const refused =
    (status = 403): (() => Response) =>
    () =>
      new Response('refused', { status });

  function pausingGuard() {
    const sleeps: Array<() => void> = [];
    const guard = new SourceGuard(LIDL_REFUSAL_POLICY, {
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

  const single = row({
    externalId: '11671605',
    path: '/p/producto/p11671605',
  });

  it('trips a passed guard on a run of 403, and a clean probe resumes it', async () => {
    const { guard, endPause } = pausingGuard();
    const { fetchImpl, calls } = fakeFetch([
      json(searchPage),
      json({ numFound: 494, items: [] }),
      refused(),
      refused(),
      refused(),
      refused(),
      refused(),
      html(productHtml(productSinglePrice)),
    ]);
    const client = new LidlClient({
      userAgent: USER_AGENT,
      fetchImpl,
      sleepImpl: async () => undefined,
      guard,
    });

    expect((await collect(client.walkInStore())).length).toBeGreaterThan(0);
    for (let n = 0; n < 4; n += 1) {
      await expect(client.getProduct(single)).rejects.toBeInstanceOf(
        LidlHttpError
      );
    }
    const tripping = client.getProduct(single);
    await settle();
    expect(calls).toHaveLength(7);

    await endPause();

    expect((await tripping)?.externalId).toBe('11671605');
    expect(calls).toHaveLength(8);
    expect(guard.summary().paused?.resumedAt).not.toBeNull();
  });

  it('counts a 429 as a refusal only once its retries are spent', async () => {
    const { guard } = pausingGuard();
    const { fetchImpl, calls } = fakeFetch([
      refused(429),
      refused(429),
      html(productHtml(productSinglePrice)),
      refused(429),
      refused(429),
      refused(429),
    ]);
    const client = new LidlClient({
      userAgent: USER_AGENT,
      fetchImpl,
      sleepImpl: async () => undefined,
      retries: 2,
      guard,
    });

    // Two 429 and then a page: the retries absorbed them and nothing counts.
    expect((await client.getProduct(single))?.externalId).toBe('11671605');
    expect(guard.summary().lastStatus).toBeNull();
    // Three 429 in a row outlive the two retries: one refusal.
    await expect(client.getProduct(single)).rejects.toBeInstanceOf(
      LidlHttpError
    );
    expect(guard.summary()).toEqual(
      expect.objectContaining({ isolated: 1, lastStatus: 429 })
    );
    expect(calls).toHaveLength(6);
  });

  it('throws LidlHttpError on a 403 with no guard, as before', async () => {
    const { fetchImpl, calls } = fakeFetch([refused()]);

    await expect(
      new LidlClient({ userAgent: USER_AGENT, fetchImpl }).getProduct(single)
    ).rejects.toBeInstanceOf(LidlHttpError);
    expect(calls).toHaveLength(1);
  });
});
