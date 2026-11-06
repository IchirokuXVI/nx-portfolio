import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import categoriesTree from './__fixtures__/categories-tree.json';
import categoryExpanded from './__fixtures__/category-expanded.json';
import productDetail from './__fixtures__/product-detail-es.json';
import { probeMercadona } from './probe';

/**
 * The Mercadona probe against the committed fixtures and a fake fetch (plan
 * 0219, Tests). Nothing here touches the network.
 *
 * The committed tree holds two roots and four children, a cut of the 26 and
 * 151 the floors were set against, so the tree here repeats its roots until it
 * is as large as the storefront's. Every value in it is the fixture's.
 */

const FIXTURES = join(__dirname, '__fixtures__');
const STORES = readFileSync(join(FIXTURES, 'stores.js'), 'utf8');
const TOTALS = readFileSync(join(FIXTURES, 'stores-total.js'), 'utf8');

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function fullTree(): unknown {
  const tree = clone(categoriesTree) as {
    results: Array<{ id: number; categories: Array<{ id: number }> }>;
  };
  const results = [];
  for (let copy = 0; copy < 13; copy += 1) {
    for (const root of tree.results) {
      const next = clone(root);
      next.id = root.id + copy * 1000;
      next.categories = [0, 1, 2].flatMap((n) =>
        root.categories.map((child) => ({
          ...child,
          id: child.id + copy * 1000 + n * 100_000,
        }))
      );
      results.push(next);
    }
  }
  return { ...tree, results };
}

/** A listing of ten products, of which `lost` carry no unit price. */
function listingWithout(lost: number): unknown {
  const listing = clone(categoryExpanded) as {
    categories: Array<{ products: Array<Record<string, unknown>> }>;
  };
  const template = listing.categories[0].products[0];
  listing.categories = [listing.categories[0]];
  listing.categories[0].products = Array.from({ length: 10 }, (_, n) => {
    const product = clone(template);
    product['id'] = String(9000 + n);
    if (n < lost) {
      (product['price_instructions'] as Record<string, unknown>)['unit_price'] =
        null;
    }
    return product;
  });
  return listing;
}

interface Answers {
  warehouse?: () => Response;
  tree?: () => Response;
  listing?: () => Response;
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

function fakeFetch(answers: Answers = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/postal-codes/actions/change-pc/')) {
      return (
        answers.warehouse ??
        (() => new Response(null, { headers: { 'x-customer-wh': '4661' } }))
      )();
    }
    if (/\/categories\/\?/.test(url)) {
      return (answers.tree ?? json(fullTree()))();
    }
    if (/\/categories\/\d+\//.test(url)) {
      return (answers.listing ?? json(categoryExpanded))();
    }
    if (url.includes('/products/')) {
      return (answers.product ?? json(productDetail))();
    }
    if (url.includes('tiendas_total')) {
      return new Response(TOTALS);
    }
    if (url.includes('tiendas')) {
      return (answers.stores ?? (() => new Response(STORES)))();
    }
    throw new Error(`Unexpected request to ${url}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const run = (fetchImpl: typeof fetch) =>
  probeMercadona({
    userAgent: 'LunaShopperTest/1.0',
    fetchImpl,
    sleepImpl: async () => undefined,
    storesUrl: 'https://stores.example/tiendas.js',
    totalsUrl: 'https://stores.example/tiendas_total.js',
  });

describe('probeMercadona', () => {
  it('passes every step over the fixtures', async () => {
    const { fetchImpl, calls } = fakeFetch();
    const result = await run(fetchImpl);

    expect(result.steps.map((step) => [step.name, step.ok])).toEqual([
      ['warehouse', true],
      ['categories', true],
      ['listing', true],
      ['product', true],
      ['shops', true],
    ]);
    // Five steps and six requests: the shop list reads the companion count
    // document as well, which the client does inside the one call.
    expect(result.requests).toBe(6);
    expect(calls).toHaveLength(6);
    expect(result.failure).toBeUndefined();
    expect(result.steps[0].sample).toEqual({
      postalCode: '14013',
      warehouse: '4661',
    });
    expect(result.steps[3].sample['ean']).toEqual(expect.any(String));
    expect(result.steps[4].sample['shops']).toBe(1675);
    for (const step of result.steps) {
      expect(Object.keys(step.sample).length).toBeLessThanOrEqual(6);
    }
  });

  it('names a renamed product field and makes no later request', async () => {
    const renamed = clone(productDetail) as Record<string, unknown>;
    renamed['gtin'] = renamed['ean'];
    delete renamed['ean'];
    const { fetchImpl, calls } = fakeFetch({ product: json(renamed) });

    const result = await run(fetchImpl);

    const product = result.steps[3];
    expect(product.name).toBe('product');
    expect(product.ok).toBe(false);
    expect(product.problems.join(' ')).toContain('ean');
    expect(result.steps).toHaveLength(4);
    expect(calls.some((url) => url.includes('tiendas'))).toBe(false);
    expect(result.requests).toBe(4);
  });

  it('stops at a 403 on the first step with no second request', async () => {
    const { fetchImpl, calls } = fakeFetch({
      warehouse: () => new Response('denied', { status: 403 }),
    });

    const result = await run(fetchImpl);

    expect(result.steps).toEqual([
      expect.objectContaining({
        name: 'warehouse',
        ok: false,
        httpStatus: 403,
      }),
    ]);
    expect(result.steps[0].error).toContain('403');
    expect(calls).toHaveLength(1);
    expect(result.requests).toBe(1);
  });

  it('retries no 429 and makes no request after it', async () => {
    const { fetchImpl, calls } = fakeFetch({
      listing: () => new Response('slow down', { status: 429 }),
    });

    const result = await run(fetchImpl);

    expect(result.steps[2]).toEqual(
      expect.objectContaining({ name: 'listing', ok: false, httpStatus: 429 })
    );
    expect(calls).toHaveLength(3);
  });

  it('fails the 80 per cent rule when most rows lost their price', async () => {
    const { fetchImpl } = fakeFetch({ listing: json(listingWithout(6)) });

    const result = await run(fetchImpl);

    const listing = result.steps[2];
    expect(listing.ok).toBe(false);
    expect(listing.problems).toEqual([
      '4 of 10 rows carried a unit price above zero',
    ]);
  });

  it('passes the 80 per cent rule when a few rows lost their price', async () => {
    const { fetchImpl } = fakeFetch({ listing: json(listingWithout(2)) });

    const result = await run(fetchImpl);

    expect(result.steps[2].ok).toBe(true);
    expect(result.steps).toHaveLength(5);
  });

  it('reads a thin tree as a change of shape', async () => {
    const { fetchImpl } = fakeFetch({ tree: json(categoriesTree) });

    const result = await run(fetchImpl);

    expect(result.steps[1].ok).toBe(false);
    expect(result.steps[1].problems).toEqual([
      '2 roots were read, and the floor is 10',
      '4 level 1 categories were read, and the floor is 50',
    ]);
  });

  it('reads a warehouse answer with no x-customer-wh header as a problem', async () => {
    const { fetchImpl, calls } = fakeFetch({
      warehouse: () => new Response(null, { status: 200 }),
    });

    const result = await run(fetchImpl);

    expect(result.steps).toEqual([
      expect.objectContaining({
        name: 'warehouse',
        ok: false,
        httpStatus: null,
        error: null,
      }),
    ]);
    expect(result.steps[0].problems).toHaveLength(1);
    expect(result.steps[0].problems[0]).toContain('x-customer-wh');
    expect(result.failure).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('reads a store document that answered 404 as a problem', async () => {
    const { fetchImpl, calls } = fakeFetch({
      stores: () => new Response('gone', { status: 404 }),
    });

    const result = await run(fetchImpl);

    const shops = result.steps[4];
    expect(shops).toEqual(
      expect.objectContaining({
        name: 'shops',
        ok: false,
        httpStatus: null,
        error: null,
      })
    );
    expect(shops.problems).toHaveLength(1);
    expect(shops.problems[0]).toContain('answered 404');
    expect(result.failure).toBeUndefined();
    // The companion count document is never read after the 404.
    expect(calls.some((url) => url.includes('tiendas_total'))).toBe(false);
    expect(calls).toHaveLength(5);
  });

  it('reads a 404 tree, which the client answers as empty, as a change of shape', async () => {
    const { fetchImpl } = fakeFetch({
      tree: () => new Response('gone', { status: 404 }),
    });

    const result = await run(fetchImpl);

    expect(result.steps[1]).toEqual(
      expect.objectContaining({ ok: false, httpStatus: null, error: null })
    );
  });
});
