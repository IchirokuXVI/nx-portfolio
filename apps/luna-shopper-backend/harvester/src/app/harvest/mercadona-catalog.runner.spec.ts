import type { ConfigService } from '@nestjs/config';
import { PriceScopeKind } from '@portfolio/luna-shopper/contracts';
import type { SupermarketSource } from '../entities';
import type { CatalogDiscoveryInput, RunPriceScope } from './catalog-runner';
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

/** The assortment of the first warehouse, which the level 2 category lists. */
const WALKED = ['4241', '7012'];

/**
 * The warehouses a case walks, and what each one stocks (plan 0108).
 *
 * A warehouse is a scope's own `externalKey`, so this is both the assortment
 * table and the scope table. `4661` is Córdoba's and `4804` is A Coruña's, which
 * are the two the plan's mismatch was about.
 */
const ASSORTMENT: Record<string, readonly string[]> = {
  '4661': WALKED,
  '4804': WALKED,
  // One product this one alone carries, so the union is bigger than the first
  // warehouse's assortment and the detail phase has to notice.
  '4149': [...WALKED, '9001'],
};

/** The price each warehouse prints, which is what makes the rows distinct. */
const PRICE: Record<string, string> = {
  '4661': '8.75',
  '4804': '9.10',
  '4149': '9.99',
};

function scope(externalKey: string): RunPriceScope {
  return { id: `${SCOPE}-${externalKey}`, externalKey };
}

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

/**
 * One product as a category listing states it: no `ean` and no `brand`.
 *
 * The listing is where a price comes from since plan 0108, and it is per
 * warehouse, which is what lets one run write a different number per scope.
 */
function listed(id: string, warehouse: string) {
  return {
    id,
    slug: `producto-${id}`,
    display_name: `Producto ${id}`,
    published: true,
    share_url: `https://fixtures.test/product/${id}`,
    price_instructions: {
      size_format: 'l',
      unit_price: PRICE[warehouse],
      bulk_price: PRICE[warehouse],
      unit_size: 1,
      reference_format: 'L',
    },
  };
}

/** `/categories/:id/`: the level 2 children with their products inline. */
function categoryProducts(warehouse: string) {
  return {
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
        products: (ASSORTMENT[warehouse] ?? []).map((id) =>
          listed(id, warehouse)
        ),
      },
    ],
  };
}

/** `/products/:id/`: the detail call, the only place `ean` and `brand` exist. */
function detailed(id: string, warehouse: string, ean: string | null) {
  return {
    ...listed(id, warehouse),
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
  detailFor?: (externalId: string, warehouse: string) => unknown | null;
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

    // Every request the client makes names the warehouse it is for, which is
    // what makes one stub answer for a run of several of them.
    const warehouse = new URL(url).searchParams.get('wh') ?? '';

    if (url.startsWith(`${BASE}/categories/?`)) {
      return answer(200, CATEGORY_TREE);
    }
    if (/\/categories\/\d+\//.test(url)) {
      return answer(200, categoryProducts(warehouse));
    }
    const product = /\/products\/([^/?]+)\//.exec(url);
    if (product) {
      const detail =
        options.detailFor?.(product[1], warehouse) ??
        detailed(product[1], warehouse, '8480000135636');
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
    setReport: jest.fn(async () => undefined),
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

/**
 * The chain's source row, which since plan 0108 says nothing about a warehouse.
 *
 * `config.warehouse` is deleted rather than deprecated (D2), and the value left
 * here is deliberate: a row that still carries a stale one must have no effect,
 * because leaving two answers in place leaves the wrong one with no error
 * attached.
 */
const source = (): SupermarketSource =>
  ({
    adapterKey: 'mercadona-api',
    workers: 1,
    config: { warehouse: 'a-stale-one' },
  }) as unknown as SupermarketSource;

/** What a run of these warehouses is asked to walk. */
function walking(...warehouses: string[]): CatalogDiscoveryInput {
  return {
    supermarketId: CHAIN,
    priceScopes: warehouses.map(scope),
  };
}

/** The stub is installed on the global, because the runner builds its client. */
function withFetch(fetchImpl: typeof fetch): () => void {
  const held = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  return () => {
    globalThis.fetch = held;
  };
}

describe('MercadonaCatalogRunner (plans 0103 and 0108)', () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('reports every product it walked, priced for the warehouse it walked', async () => {
    const { fetchImpl } = stubFetch({});
    restore = withFetch(fetchImpl);
    const { runner, context, report } = build();

    await runner.run(context, report, walking('4661'), source());

    expect(report.products.map((product) => product.externalId).sort()).toEqual(
      WALKED
    );
    // One price, naming the warehouse it came from. It used to name no scope at
    // all and fall to the scope the run was started with, which is the pair plan
    // 0108 collapsed: the warehouse walked and the scope written are one input.
    expect(report.products[0].prices).toEqual([
      expect.objectContaining({ scopeKey: '4661', price: 8.75 }),
    ]);
    expect(report.products[0].ean).toBe('8480000135636');
  });

  it('declares each warehouse as a REGION scope before any price names it', async () => {
    const { fetchImpl } = stubFetch({});
    restore = withFetch(fetchImpl);
    const { runner, context, report } = build();

    await runner.run(context, report, walking('4661', '4804'), source());

    // A price naming a key nothing declared is a warning and no row (plan 0103,
    // D4). The scopes already exist, so the name is left null and nothing is
    // renamed by a walk.
    expect(report.scopes).toEqual([
      { key: '4661', kind: PriceScopeKind.REGION, name: null },
      { key: '4804', kind: PriceScopeKind.REGION, name: null },
    ]);
  });

  it('writes one price per warehouse that carries the product', async () => {
    const { fetchImpl } = stubFetch({});
    restore = withFetch(fetchImpl);
    const { runner, context, report } = build();

    await runner.run(
      context,
      report,
      walking('4661', '4804', '4149'),
      source()
    );

    const shared = report.products.find(
      (product) => product.externalId === '4241'
    );
    // Three warehouses, three prices, three numbers. Nothing is collapsed: the
    // format allows a price per warehouse and a model that stored the agreeing
    // ones once could not record the week one of them differs (plan 0108, D6).
    expect(
      shared?.prices.map((price) => [price.scopeKey, price.price])
    ).toEqual([
      ['4661', 8.75],
      ['4804', 9.1],
      ['4149', 9.99],
    ]);

    // ...and one price for the product only the third warehouse carries.
    const only = report.products.find(
      (product) => product.externalId === '9001'
    );
    expect(only?.prices.map((price) => price.scopeKey)).toEqual(['4149']);
  });

  it('fetches detail once per product across the warehouses, not once each', async () => {
    // The test that protects the saving of plan 0108, section 3. `ean` and
    // `brand` are what the detail phase exists for and neither depends on the
    // warehouse, so three warehouses cost three tree walks and one detail pass.
    const { urls, fetchImpl } = stubFetch({});
    restore = withFetch(fetchImpl);
    const { runner, context, report } = build();

    await runner.run(
      context,
      report,
      walking('4661', '4804', '4149'),
      source()
    );

    const union = new Set(Object.values(ASSORTMENT).flat());
    const details = urls.filter((url) => url.includes('/products/'));
    expect(details.length).toBe(union.size);
    expect(
      new Set(report.products.map((product) => product.externalId))
    ).toEqual(union);
  });

  it('fetches a product only a later warehouse carries from that warehouse', async () => {
    // A product absent from the first warehouse answers 404 there, so reading
    // its detail from the first client would lose it. It is fetched from the
    // first warehouse that listed it, where it answers.
    const { urls, fetchImpl } = stubFetch({
      detailFor: (externalId, warehouse) =>
        ASSORTMENT[warehouse]?.includes(externalId)
          ? detailed(externalId, warehouse, '8480000135636')
          : null,
    });
    restore = withFetch(fetchImpl);
    const { runner, context, report } = build();

    await runner.run(context, report, walking('4661', '4149'), source());

    expect(
      urls.some(
        (url) => url.includes('/products/9001/') && url.includes('wh=4149')
      )
    ).toBe(true);
    expect(
      report.products.map((product) => product.externalId).includes('9001')
    ).toBe(true);
  });

  it('keeps the heartbeat moving while it walks the tree', async () => {
    const { fetchImpl } = stubFetch({});
    restore = withFetch(fetchImpl);
    const { runner, context, report } = build();

    await runner.run(context, report, walking('4661'), source());

    // The walk reports no counter until the detail phase, so at a low owner set
    // rate the heartbeat is what tells the stale reaper the walk is alive. One
    // call per walked product; the context throttles the actual writes.
    expect(
      (context.heartbeat as jest.Mock).mock.calls.length
    ).toBeGreaterThanOrEqual(WALKED.length);
  });

  it('says each warehouse assortment is whole, and names what that one lacks', async () => {
    const { fetchImpl } = stubFetch({});
    restore = withFetch(fetchImpl);
    const { runner, context, report } = build();

    await runner.run(context, report, walking('4661', '4149'), source());

    // One completeness claim per warehouse, so the orchestrator can work out per
    // scope what that warehouse does not carry (plan 0108, section 2).
    expect(report.completed).toEqual(['4661', '4149']);
    // A product is reported once for the whole run, so the orchestrator cannot
    // tell which warehouse named it. The absences are the only thing a run of
    // several warehouses has to state outright.
    expect(report.availabilities).toEqual([
      { externalId: '9001', available: false, scopeKey: '4661' },
    ]);
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

    await runner.run(context, report, walking('4661', '4149'), source());

    // What it did fetch is kept: prices already fetched are valid data.
    expect(report.products.length).toBeGreaterThan(0);
    // It did not finish, so it says nothing negative about anything, for any
    // warehouse. Under-claiming is the safe way to be wrong here.
    expect(report.completed).toEqual([]);
    expect(report.availabilities).toEqual([]);
  });

  it('states both request counts, so the saving is auditable', async () => {
    const { fetchImpl } = stubFetch({});
    restore = withFetch(fetchImpl);
    const { runner, context, report } = build();

    await runner.run(context, report, walking('4661', '4149'), source());

    expect(context.setReport).toHaveBeenCalledWith(
      expect.objectContaining({
        warehouses: ['4661', '4149'],
        // Two assortments summed, against the union the detail phase cost.
        productsListed: ASSORTMENT['4661'].length + ASSORTMENT['4149'].length,
        productsDetailed: 3,
      })
    );
  });

  it('refuses to walk with no warehouse to walk', async () => {
    const { fetchImpl } = stubFetch({});
    restore = withFetch(fetchImpl);
    const { runner, context, report } = build();

    await expect(
      runner.run(context, report, { supermarketId: CHAIN }, source())
    ).rejects.toThrow(/at least one/i);
  });
});
