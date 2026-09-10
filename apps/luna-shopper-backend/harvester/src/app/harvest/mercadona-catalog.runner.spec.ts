import type { ConfigService } from '@nestjs/config';
import type { SupermarketSource } from '../entities';
import { MercadonaCatalogRunner } from './mercadona-catalog.runner';
import type { RunContext } from './run-context';
import { RecordingRunReport } from './run-report';

/**
 * The walk, end to end, over a stubbed `fetch` and no network.
 *
 * **No run here fetches anything.** A real catalog discovery is 4,383 requests
 * over eighteen minutes and is never started from a test; the payloads below
 * are the shapes the source answers with, a tree of one category holding two
 * products, so a whole walk is four requests.
 *
 * They are written here rather than imported from
 * `@portfolio/luna-shopper/mercadona`'s recorded fixtures, which is what that
 * library's own spec asserts its parsers against: a spec may not reach into
 * another project's sources by path, and what this file is about is the
 * runner's wiring rather than the parsing.
 *
 * **There is no repository fake, no `CatalogClient` fake and no ingest here**,
 * and that is the point of plan 0103. The runner fetches and reports, so a
 * recording `RunReport` is the whole of what a spec has to give it, and what is
 * asserted is what the run said rather than what somebody wrote. What happens
 * to a report afterwards is `run-report.sink.spec.ts`.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const SCOPE = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';
const BASE = 'https://fixtures.test/api';

/** The assortment, which the one level 2 category below lists. */
const WALKED = ['4241', '7012'];

/** `/categories/`: one level 1 category holding one level 2 category. */
const CATEGORY_TREE = {
  next: null,
  previous: null,
  results: [
    {
      id: 12,
      name: 'Aceite, especias y salsas',
      order: 1,
      published: true,
      categories: [
        { id: 112, name: 'Aceite, vinagre y sal', order: 1, published: true },
      ],
    },
  ],
};

/** One product as a category listing states it: no `ean` and no `brand`. */
function listed(id: string) {
  return {
    id,
    slug: `producto-${id}`,
    display_name: `Producto ${id}`,
    published: true,
    share_url: `https://fixtures.test/product/${id}`,
    price_instructions: {
      size_format: 'l',
      unit_price: '8.75',
      bulk_price: '8.75',
      unit_size: 1,
      reference_format: 'L',
    },
  };
}

/** `/categories/:id/`: the level 2 children with their products inline. */
const CATEGORY_PRODUCTS = {
  id: 112,
  name: 'Aceite, vinagre y sal',
  order: 1,
  published: true,
  categories: [
    {
      id: 113,
      name: 'Aceite de oliva',
      order: 1,
      published: true,
      products: WALKED.map(listed),
    },
  ],
};

/** `/products/:id/`: the detail call, the only place `ean` and `brand` exist. */
function detailed(id: string, ean: string | null) {
  return {
    ...listed(id),
    ean,
    brand: 'Hacendado',
    categories: [
      {
        id: 12,
        name: 'Aceite, especias y salsas',
        level: 0,
        categories: [{ id: 112, name: 'Aceite, vinagre y sal', level: 1 }],
      },
    ],
  };
}

/**
 * A `fetch` that answers from the fixtures and records every URL.
 *
 * `onRequest` is how the abort test stops the run: it is called with the number
 * of requests so far, exactly where a real abort would land, between two
 * fetches.
 */
function stubFetch(options: {
  detailFor?: (externalId: string) => unknown | null;
  onRequest?: (count: number, url: string) => void;
}): { urls: string[]; fetchImpl: typeof fetch } {
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    urls.push(url);
    options.onRequest?.(urls.length, url);

    const answer = (status: number, body: unknown): Response =>
      ({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null },
        json: async () => body,
      }) as unknown as Response;

    if (url.startsWith(`${BASE}/categories/?`)) {
      return answer(200, CATEGORY_TREE);
    }
    if (/\/categories\/\d+\//.test(url)) {
      return answer(200, CATEGORY_PRODUCTS);
    }
    const product = /\/products\/([^/]+)\//.exec(url);
    if (product) {
      const detail =
        options.detailFor?.(product[1]) ??
        detailed(product[1], '8480000135636');
      return detail === null ? answer(404, null) : answer(200, detail);
    }
    throw new Error(`No fixture for ${url}`);
  }) as unknown as typeof fetch;
  return { urls, fetchImpl };
}

function build(options: { controller?: AbortController } = {}) {
  const controller = options.controller ?? new AbortController();
  const context = {
    runId: RUN,
    signal: controller.signal,
    acquire: async () => undefined,
    setStage: jest.fn(async () => undefined),
    setTotalPlanned: jest.fn(async () => undefined),
    report: jest.fn(async () => undefined),
    heartbeat: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
  } as unknown as RunContext;

  const runner = new MercadonaCatalogRunner({
    getOrThrow: () => ({ userAgent: 'test', mercadonaBaseUrl: BASE }),
  } as unknown as ConfigService);

  return { runner, context, report: new RecordingRunReport(), controller };
}

const source = (): SupermarketSource =>
  ({
    adapterKey: 'mercadona-api',
    workers: 1,
    config: { warehouse: '4661' },
  }) as unknown as SupermarketSource;

/** The stub is installed on the global, because the runner builds its client. */
function withFetch(fetchImpl: typeof fetch): () => void {
  const held = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  return () => {
    globalThis.fetch = held;
  };
}

describe('MercadonaCatalogRunner (plan 0103)', () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('reports every product it walked, with the price the detail stated', async () => {
    const { fetchImpl } = stubFetch({});
    restore = withFetch(fetchImpl);
    const { runner, context, report } = build();

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN, priceScopeId: SCOPE },
      source()
    );

    expect(report.products.map((product) => product.externalId).sort()).toEqual(
      WALKED
    );
    // One price, naming no scope of its own: Mercadona prices one warehouse, so
    // the price falls to the scope the run was started with.
    expect(report.products[0].prices).toEqual([
      expect.objectContaining({ scopeKey: null, price: 8.75 }),
    ]);
    expect(report.products[0].ean).toBe('8480000135636');
  });

  it('keeps the heartbeat moving while it walks the tree', async () => {
    const { fetchImpl } = stubFetch({});
    restore = withFetch(fetchImpl);
    const { runner, context, report } = build();

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN, priceScopeId: SCOPE },
      source()
    );

    // The walk reports no counter until the detail phase, so at a low owner set
    // rate the heartbeat is what tells the stale reaper the walk is alive. One
    // call per walked product; the context throttles the actual writes.
    expect(
      (context.heartbeat as jest.Mock).mock.calls.length
    ).toBeGreaterThanOrEqual(WALKED.length);
  });

  it('says the assortment is whole, so a product it did not name is not stocked', async () => {
    const { fetchImpl } = stubFetch({});
    restore = withFetch(fetchImpl);
    const { runner, context, report } = build();

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN, priceScopeId: SCOPE },
      source()
    );

    // The runner used to load every tracked row itself and call the ones it had
    // not seen out of stock. The fact is already in the report, so it says only
    // that the walk was whole and the orchestrator does the diff (plan 0103,
    // section 6.1). `null` is the run's own scope.
    expect(report.completed).toEqual([null]);
  });

  it('an aborted walk keeps what it fetched and asserts no absence', async () => {
    const controller = new AbortController();
    // Abort on the second detail call, so the walk finished, one product was
    // fetched, and the rest of the assortment never was. That is the shape of a
    // real abort: the tree is cheap and the detail phase is the eighteen minutes.
    let details = 0;
    const { fetchImpl } = stubFetch({
      onRequest: (_count, url) => {
        if (url.includes('/products/')) {
          details += 1;
          if (details >= 2) {
            controller.abort();
          }
        }
      },
    });
    restore = withFetch(fetchImpl);
    const { runner, context, report } = build({ controller });

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN, priceScopeId: SCOPE },
      source()
    );

    // What it did fetch is kept: prices already fetched are valid data.
    expect(report.products.length).toBeGreaterThan(0);
    // It did not walk the whole tree, so it says nothing negative about
    // anything. Under-claiming is the safe way to be wrong here.
    expect(report.completed).toEqual([]);
  });

  it('refuses to walk with no price scope to write the prices for', async () => {
    const { fetchImpl } = stubFetch({});
    restore = withFetch(fetchImpl);
    const { runner, context, report } = build();

    await expect(
      runner.run(context, report, { supermarketId: CHAIN }, source())
    ).rejects.toThrow(/price scope/i);
  });
});
