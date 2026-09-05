import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DezaClient, DezaHttpError } from './deza.client';

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
