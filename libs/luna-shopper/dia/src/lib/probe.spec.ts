import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DiaClient } from './dia.client';
import { probeDia } from './probe';

/**
 * The DIA probe against the committed answers and a fake site (plan 0219,
 * Tests). Nothing here touches the network, and no sleep really waits.
 */

const fixture = (name: string): Buffer =>
  readFileSync(join(__dirname, '__fixtures__', name));

const LISTING = JSON.parse(fixture('listing-page-1.json').toString('utf8')) as {
  plp_items: Array<Record<string, unknown>>;
};

interface Answer {
  status?: number;
  body?: Buffer | string;
}

type Route = (path: string) => Answer | undefined;

/** The site, path by path, with an override in front of it. */
function fakeSite(override: Route = () => undefined) {
  const paths: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const parsed = new URL(String(input));
    const path = `${parsed.pathname}${parsed.search}`;
    paths.push(path);
    const answer = override(path) ?? recorded(path);
    return new Response(answer.body ?? '', { status: answer.status ?? 200 });
  }) as typeof fetch;
  return { fetchImpl, paths };
}

function recorded(path: string): Answer {
  if (path.startsWith('/api/v1/common-aggregator/menu-data')) {
    return { body: fixture('menu.json') };
  }
  if (path.startsWith('/api/v1/plp-back/reduced')) {
    return { body: fixture('listing-page-1.json') };
  }
  if (path === '/tiendas/buscador-tiendas-folletos') {
    return { body: fixture('store-finder.html') };
  }
  if (path.startsWith('/clubdia/')) {
    return { body: fixture('stores.json.gz') };
  }
  if (path.startsWith('/tiendas/buscadorTiendas.html')) {
    return { body: fixture('store-detail-normal.json') };
  }
  throw new Error(`Unexpected request to ${path}`);
}

/** Page 1 of Cola with `lost` rows that print no price. */
function listingWithout(lost: number): string {
  const listing = JSON.parse(JSON.stringify(LISTING)) as typeof LISTING;
  listing.plp_items = listing.plp_items
    .slice(0, 10)
    .map((row, n) =>
      n < lost ? { ...row, prices: { currency: 'EUR' } } : row
    );
  return JSON.stringify(listing);
}

function run(fetchImpl: typeof fetch, sleeps: number[] = []) {
  return probeDia({
    fetchImpl,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
    now: () => 0,
  });
}

describe('probeDia', () => {
  it('passes every step over the fixtures, in five requests', async () => {
    const { fetchImpl, paths } = fakeSite();

    const result = await run(fetchImpl);

    expect(result.steps.map((step) => [step.name, step.ok])).toEqual([
      ['categories', true],
      ['listing', true],
      ['shops', true],
    ]);
    expect(result.requests).toBe(5);
    expect(paths).toHaveLength(5);
    expect(result.steps[2].sample).toEqual(
      expect.objectContaining({
        storeCode: expect.any(String),
        postalCode: expect.any(String),
      })
    );
  });

  it('names a renamed price field and makes no later request', async () => {
    const renamed = JSON.parse(JSON.stringify(LISTING)) as typeof LISTING;
    renamed.plp_items = renamed.plp_items.map((row) => {
      const prices = { ...(row['prices'] as Record<string, unknown>) };
      prices['amount'] = prices['price'];
      delete prices['price'];
      return { ...row, prices };
    });
    const { fetchImpl, paths } = fakeSite((path) =>
      path.startsWith('/api/v1/plp-back/reduced')
        ? { body: JSON.stringify(renamed) }
        : undefined
    );

    const result = await run(fetchImpl);

    expect(result.steps).toHaveLength(2);
    expect(result.steps[1].ok).toBe(false);
    expect(result.steps[1].problems.join(' ')).toContain('prices.price');
    expect(paths.some((path) => path.startsWith('/tiendas'))).toBe(false);
  });

  it('stops at a 403 on the first step, with no second request and no wait', async () => {
    const { fetchImpl, paths } = fakeSite(() => ({ status: 403 }));
    const sleeps: number[] = [];

    const result = await run(fetchImpl, sleeps);

    expect(result.steps).toEqual([
      expect.objectContaining({
        name: 'categories',
        ok: false,
        httpStatus: 403,
      }),
    ]);
    expect(paths).toHaveLength(1);
    expect(result.requests).toBe(1);
    expect(sleeps).not.toContain(60_000);
  });

  it('fails the 80 per cent rule when most rows lost their price, and passes when a few did', async () => {
    const most = fakeSite((path) =>
      path.startsWith('/api/v1/plp-back/reduced')
        ? { body: listingWithout(6) }
        : undefined
    );
    const few = fakeSite((path) =>
      path.startsWith('/api/v1/plp-back/reduced')
        ? { body: listingWithout(1) }
        : undefined
    );

    const failed = await run(most.fetchImpl);
    const passed = await run(few.fetchImpl);

    expect(failed.steps[1].problems).toEqual([
      '4 of 10 rows carried prices.price above zero',
    ]);
    expect(passed.steps.every((step) => step.ok)).toBe(true);
  });

  it('reads a store finder page that names no shop file as a problem', async () => {
    const { fetchImpl, paths } = fakeSite((path) =>
      path === '/tiendas/buscador-tiendas-folletos'
        ? { body: '<html><body>No file here</body></html>' }
        : undefined
    );

    const result = await run(fetchImpl);

    expect(result.steps[2]).toEqual(
      expect.objectContaining({
        name: 'shops',
        ok: false,
        httpStatus: null,
        error: null,
        problems: ['The DIA store finder page names no shop file.'],
      })
    );
    expect(result.failure).toBeUndefined();
    expect(paths.some((path) => path.startsWith('/clubdia/'))).toBe(false);
    expect(paths).toHaveLength(3);
  });

  it('reads a shop file that is not a list as a problem', async () => {
    const { fetchImpl, paths } = fakeSite((path) =>
      path.startsWith('/clubdia/') ? { body: '{"stores":[]}' } : undefined
    );

    const result = await run(fetchImpl);

    expect(result.steps[2]).toEqual(
      expect.objectContaining({
        name: 'shops',
        ok: false,
        httpStatus: null,
        error: null,
        problems: ['The DIA shop file is not a list of records.'],
      })
    );
    expect(result.failure).toBeUndefined();
    expect(
      paths.some((path) => path.startsWith('/tiendas/buscadorTiendas.html'))
    ).toBe(false);
    expect(paths).toHaveLength(4);
  });
});

describe('DiaClient retryForbidden (plan 0219, section 3.6)', () => {
  it('sends no second request after a 403 when it is false', async () => {
    const { fetchImpl, paths } = fakeSite(() => ({ status: 403 }));
    const sleeps: number[] = [];
    const client = new DiaClient({
      fetchImpl,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
      minIntervalMs: 0,
      retryForbidden: false,
    });

    await expect(client.menu()).rejects.toMatchObject({ status: 403 });
    expect(paths).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('still retries a 403 once by default', async () => {
    const { fetchImpl, paths } = fakeSite(() => ({ status: 403 }));
    const client = new DiaClient({
      fetchImpl,
      sleepImpl: async () => undefined,
      minIntervalMs: 0,
    });

    await expect(client.menu()).rejects.toMatchObject({ status: 403 });
    expect(paths).toHaveLength(2);
  });
});
