import { SourceGuard } from '@portfolio/luna-shopper/source-guard';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEZA_REFUSAL_POLICY,
  DezaClient,
  DezaHttpError,
  DezaShopPageRefusedError,
} from './deza.client';
import { parseProductPage } from './rows';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

const LANDING = fixture('landing-page.html');
const SEARCH = fixture('search-one-page.html');
const PAST_END = fixture('page-past-the-end.html');

interface Call {
  url: string;
  method: string;
  body: string | undefined;
  cookie: string | undefined;
}

/** A fetch that answers a queue of pages and records what it was asked. */
function stubFetch(pages: Array<{ status?: number; body?: string }>): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  let index = 0;
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body as string | undefined,
      cookie: headers['cookie'],
    });
    const page = pages[Math.min(index, pages.length - 1)];
    index += 1;
    const status = page.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'set-cookie'
            ? 'PHPSESSID=abc123; path=/'
            : null,
      },
      text: async () => page.body ?? '',
    };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('DezaClient', () => {
  it('reads the section tree from the landing page in one request', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: LANDING }]);
    const client = new DezaClient({ userAgent: 'test', fetchImpl });

    const tree = await client.fetchSectionTree();

    expect(tree).toHaveLength(9);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe('https://www.dezacalidad.es/productos/');
  });

  it('selects a section with a POST of wpdzSeccProd', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: LANDING }]);
    const client = new DezaClient({ userAgent: 'test', fetchImpl });

    await client.openQuery({ section: 'W051000001' });

    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toBe('wpdzSeccProd=W051000001');
  });

  it('ANDs the search terms into one wpdz-input-name value', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: SEARCH }]);
    const client = new DezaClient({ userAgent: 'test', fetchImpl });

    const page = await client.openQuery({
      section: 'W051000001',
      terms: ['detergente', 'ariel'],
    });

    expect(calls[0].body).toBe(
      'wpdzSeccProd=W051000001&wpdz-input-name=detergente+ariel'
    );
    expect(page.rows).toHaveLength(8);
    expect(page.lastPage).toBe(0);
  });

  it('sends no search field at all when there is no term', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: LANDING }]);
    const client = new DezaClient({ userAgent: 'test', fetchImpl });

    await client.openQuery({ section: '', terms: ['', '  '] });

    expect(calls[0].body).toBe('wpdzSeccProd=');
  });

  it('carries the session cookie from the POST onto every page after it', async () => {
    // The selection is held in a PHP session cookie, so a page fetch that did
    // not carry it would read whatever the server last had, or nothing at all.
    const { fetchImpl, calls } = stubFetch([
      { body: LANDING },
      { body: LANDING },
    ]);
    const client = new DezaClient({ userAgent: 'test', fetchImpl });

    await client.openQuery({ section: 'W051000001' });
    await client.fetchPage(2);

    expect(calls[0].cookie).toBeUndefined();
    expect(calls[1].cookie).toBe('PHPSESSID=abc123');
    expect(calls[1].url).toBe(
      'https://www.dezacalidad.es/productos/?wpdz-pagination=1&paged=2'
    );
  });

  it('gives two clients two jars, which is why a query gets its own', async () => {
    // Two workers sharing a jar would move each other's section between pages.
    const first = stubFetch([{ body: LANDING }]);
    const second = stubFetch([{ body: LANDING }]);
    await new DezaClient({
      userAgent: 'test',
      fetchImpl: first.fetchImpl,
    }).openQuery({ section: 'A' });
    await new DezaClient({
      userAgent: 'test',
      fetchImpl: second.fetchImpl,
    }).fetchPage(2);

    expect(second.calls[0].cookie).toBeUndefined();
  });

  it('walks every page of a query and stops at the ceiling', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: LANDING }]);
    const client = new DezaClient({ userAgent: 'test', fetchImpl });

    const rows = [];
    for await (const row of client.walkQuery({ section: '' })) {
      rows.push(row);
    }

    // The stub answers the same 15 rows every time, and the walk deduplicates
    // within one query, so what this proves is the page count: one POST plus
    // pages 2 to 20.
    expect(calls).toHaveLength(20);
    expect(rows).toHaveLength(15);
  });

  it('fetches one page and no more when the widget offers none', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: SEARCH }]);
    const client = new DezaClient({ userAgent: 'test', fetchImpl });

    for await (const _row of client.walkQuery({ section: 'W051000001' })) {
      // drained
    }

    expect(calls).toHaveLength(1);
  });

  it('treats a page past the end as an empty page, not a failure', async () => {
    const { fetchImpl } = stubFetch([{ body: PAST_END }]);
    const client = new DezaClient({ userAgent: 'test', fetchImpl });

    await expect(client.fetchPage(21)).resolves.toEqual({
      rows: [],
      lastPage: 20,
    });
  });

  it('retries a 429 and gives up on a 403', async () => {
    const slept: number[] = [];
    const retryable = stubFetch([
      { status: 429 },
      { status: 503 },
      { body: LANDING },
    ]);
    const client = new DezaClient({
      userAgent: 'test',
      fetchImpl: retryable.fetchImpl,
      sleepImpl: async (ms) => {
        slept.push(ms);
      },
    });
    await expect(client.fetchSectionTree()).resolves.toHaveLength(9);
    expect(slept).toHaveLength(2);

    const refused = stubFetch([{ status: 403 }]);
    const second = new DezaClient({
      userAgent: 'test',
      fetchImpl: refused.fetchImpl,
    });
    await expect(second.fetchSectionTree()).rejects.toBeInstanceOf(
      DezaHttpError
    );
  });

  it('awaits the shared gate before every request', async () => {
    // The run's token bucket, not a per client delay: four workers each pausing
    // is four times the rate the owner set.
    let acquired = 0;
    const { fetchImpl } = stubFetch([{ body: SEARCH }]);
    const client = new DezaClient({
      userAgent: 'test',
      fetchImpl,
      acquire: async () => {
        acquired += 1;
      },
    });

    await client.openQuery({ section: 'W051000001' });
    await client.fetchPage(2);

    expect(acquired).toBe(2);
  });

  it('stops on an aborted signal without issuing the request', async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetchImpl, calls } = stubFetch([{ body: LANDING }]);
    const client = new DezaClient({
      userAgent: 'test',
      fetchImpl,
      signal: controller.signal,
    });

    await expect(client.fetchSectionTree()).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

/**
 * The run's refusal guard (plan 0215, section 4). The runner builds one client
 * per query, so a count kept inside a client starts at zero on every query.
 * The guard is the run's, and every client of the run reports to it.
 */
describe('DezaClient and the refusal guard', () => {
  const settle = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve));

  function pausingGuard() {
    const sleeps: Array<() => void> = [];
    const guard = new SourceGuard(DEZA_REFUSAL_POLICY, {
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

  it('shares one count between the clients of two queries', async () => {
    const { guard, endPause } = pausingGuard();
    const { fetchImpl, calls } = stubFetch([
      { body: SEARCH },
      { status: 403 },
      { status: 403 },
      { status: 403 },
      { status: 403 },
      { status: 403 },
      { body: SEARCH },
    ]);
    const query = (): DezaClient =>
      new DezaClient({ userAgent: 'test', fetchImpl, guard });
    const first = query();
    const second = query();

    expect((await first.openQuery({ section: 'W051000001' })).rows).toEqual(
      parseProductPage(SEARCH).rows
    );
    for (const client of [first, first, second, second]) {
      await expect(
        client.openQuery({ section: 'W051000001' })
      ).rejects.toBeInstanceOf(DezaHttpError);
    }
    // The fifth refusal in a row is the second client's third request, and it
    // trips on the count both clients fed.
    const tripping = second.fetchPage(2);
    await settle();
    expect(guard.summary().paused).toEqual(
      expect.objectContaining({ consecutive: 5 })
    );
    expect(calls).toHaveLength(6);

    await endPause();

    expect((await tripping).rows.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(7);
  });

  describe('the shop list (plan 0222)', () => {
    const CENTROS = fixture('centros.html');
    const SHOP_T1 = fixture('shop-t1.html');
    const T1_URL =
      'https://www.dezacalidad.es/centros/avda-de-jesus-rescatado/';

    it('reads the directory and a shop page through the shared gate', async () => {
      let acquired = 0;
      const { fetchImpl, calls } = stubFetch([
        { body: CENTROS },
        { body: SHOP_T1 },
      ]);
      const client = new DezaClient({
        userAgent: 'test',
        fetchImpl,
        acquire: async () => {
          acquired += 1;
        },
      });

      const directory = await client.fetchShopDirectory();
      const page = await client.fetchShopPage(T1_URL);

      expect(directory.entries).toHaveLength(13);
      expect(page.postalCode).toBe('14010');
      expect(calls.map((call) => [call.method, call.url])).toEqual([
        ['GET', 'https://www.dezacalidad.es/centros/'],
        ['GET', T1_URL],
      ]);
      expect(acquired).toBe(2);
      expect(client.requests).toBe(2);
    });

    it('retries a 503 on both methods', async () => {
      const slept: number[] = [];
      const { fetchImpl, calls } = stubFetch([
        { status: 503 },
        { body: CENTROS },
        { status: 503 },
        { body: SHOP_T1 },
      ]);
      const client = new DezaClient({
        userAgent: 'test',
        fetchImpl,
        sleepImpl: async (ms) => {
          slept.push(ms);
        },
      });

      await expect(client.fetchShopDirectory()).resolves.toBeDefined();
      await expect(client.fetchShopPage(T1_URL)).resolves.toMatchObject({
        photoCode: 'T1',
      });
      expect(slept).toHaveLength(2);
      expect(calls).toHaveLength(4);
      expect(client.requests).toBe(4);
    });

    it.each([
      ['another host', 'https://evil.example/centros/avda-de-jesus-rescatado/'],
      ['another scheme', 'http://www.dezacalidad.es/centros/avda-de-libia/'],
      ['a path outside /centros/', 'https://www.dezacalidad.es/productos/'],
      ['the directory itself', 'https://www.dezacalidad.es/centros/'],
      ['no URL at all', 'centros/avda-de-libia/'],
    ])('refuses %s without a request', async (_, url) => {
      let acquired = 0;
      const { fetchImpl, calls } = stubFetch([{ body: SHOP_T1 }]);
      const client = new DezaClient({
        userAgent: 'test',
        fetchImpl,
        acquire: async () => {
          acquired += 1;
        },
      });

      await expect(client.fetchShopPage(url)).rejects.toBeInstanceOf(
        DezaShopPageRefusedError
      );
      expect(calls).toHaveLength(0);
      expect(acquired).toBe(0);
    });
  });

  it('throws DezaHttpError on a 403 with no guard, as before', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 403 }]);

    await expect(
      new DezaClient({ userAgent: 'test', fetchImpl }).fetchSectionTree()
    ).rejects.toBeInstanceOf(DezaHttpError);
    expect(calls).toHaveLength(1);
  });
});
