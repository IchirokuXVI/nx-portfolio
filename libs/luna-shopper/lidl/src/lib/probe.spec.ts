import productTwoRegions from './__fixtures__/product-two-region-prices.json';
import searchPage from './__fixtures__/search-page.json';
import storePage from './__fixtures__/store-page.json';
import { probeLidl } from './probe';

/**
 * The LIDL probe against the committed fixtures and a fake fetch (plan 0219,
 * Tests). Nothing here touches the network.
 *
 * The index fixture and the product fixtures were captured on different
 * days, so no row of the one names a product of the other. The index here is
 * the fixture with the first row's id pointed at the two region product, and
 * nothing else changed.
 */

const PRODUCT_ID = 11096990;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type Item = { gridbox: { data: Record<string, unknown> } };

function index(edit: (items: Item[]) => void = () => undefined): unknown {
  const page = clone(searchPage) as unknown as { items: Item[] };
  page.items[0].gridbox.data['productId'] = PRODUCT_ID;
  page.items[0].gridbox.data['canonicalPath'] = `/p/producto/p${PRODUCT_ID}`;
  edit(page.items);
  return page;
}

const productHtml = (payload: unknown): string =>
  `<!DOCTYPE html><html><body><script type="application/json" id="__NUXT_DATA__">${JSON.stringify(
    payload
  )}</script></body></html>`;

interface Routes {
  search?: () => Response;
  product?: () => Response;
  stores?: () => Response;
}

const json =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

function fakeFetch(routes: Routes = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/q/api/search')) {
      return (routes.search ?? json(index()))();
    }
    if (url.includes('/p/')) {
      return (
        routes.product ??
        (() => new Response(productHtml(productTwoRegions), { status: 200 }))
      )();
    }
    if (url.includes('stores.example')) {
      return (routes.stores ?? json(storePage))();
    }
    throw new Error(`Unexpected request to ${url}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const run = (fetchImpl: typeof fetch) =>
  probeLidl({
    userAgent: 'LunaShopperTest/1.0',
    storesUrl: 'https://stores.example/v2/stores',
    fetchImpl,
    sleepImpl: async () => undefined,
  });

describe('probeLidl', () => {
  it('passes every step over the fixtures, in three requests', async () => {
    const { fetchImpl, calls } = fakeFetch();

    const result = await run(fetchImpl);

    expect(result.steps.map((step) => [step.name, step.ok])).toEqual([
      ['listing', true],
      ['product', true],
      ['shops', true],
    ]);
    expect(result.requests).toBe(3);
    expect(calls).toHaveLength(3);
    expect(result.steps[0].sample['total']).toBe(494);
    expect(result.steps[1].sample['prices']).toBe(2);
    expect(new URL(calls[2]).searchParams.get('limit')).toBe('5');
  });

  it('names a renamed path field and makes no later request', async () => {
    const renamed = index((items) => {
      for (const item of items) {
        item.gridbox.data['url'] = item.gridbox.data['canonicalPath'];
        delete item.gridbox.data['canonicalPath'];
      }
    });
    const { fetchImpl, calls } = fakeFetch({ search: json(renamed) });

    const result = await run(fetchImpl);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].ok).toBe(false);
    expect(result.steps[0].problems).toEqual(['0 of 5 rows carried path']);
    expect(calls).toHaveLength(1);
  });

  it('stops at a 403 on the first step with no second request', async () => {
    const { fetchImpl, calls } = fakeFetch({
      search: () => new Response('denied', { status: 403 }),
    });

    const result = await run(fetchImpl);

    expect(result.steps).toEqual([
      expect.objectContaining({ name: 'listing', ok: false, httpStatus: 403 }),
    ]);
    expect(calls).toHaveLength(1);
  });

  it('fails the 80 per cent rule when most rows lost their path, and passes when one did', async () => {
    const losing = (lost: number) =>
      index((items) => {
        items.slice(1, 1 + lost).forEach((item) => {
          delete item.gridbox.data['canonicalPath'];
        });
      });
    const most = fakeFetch({ search: json(losing(3)) });
    const few = fakeFetch({ search: json(losing(1)) });

    const failed = await run(most.fetchImpl);
    const passed = await run(few.fetchImpl);

    expect(failed.steps[0].problems).toEqual(['2 of 5 rows carried path']);
    expect(passed.steps.every((step) => step.ok)).toBe(true);
  });

  it('reads a shop with no offer region as a change of shape', async () => {
    const stores = clone(storePage) as unknown as {
      items: Array<{ marketingData?: Record<string, unknown> }>;
    };
    delete stores.items[0].marketingData;
    const { fetchImpl } = fakeFetch({ stores: json(stores) });

    const result = await run(fetchImpl);

    expect(result.steps[2].ok).toBe(false);
    expect(result.steps[2].problems).toEqual([
      '1 of 5 shops named no offer region',
    ]);
  });
});
