import type { ConfigService } from '@nestjs/config';
import {
  PriceScopeKind,
  PriceSourceKind,
  type PriceScopeView,
} from '@portfolio/luna-shopper/contracts';
import { LidlClient } from '@portfolio/luna-shopper/lidl';
import type { SupermarketSource } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { LidlCatalogRunner } from './lidl-catalog.runner';
import type { RunContext } from './run-context';
import type { SourceIngest, SourceIngestInput } from './source-ingest';

/**
 * The run, end to end, over a fake fetch (plan 0089, section 12).
 *
 * **Nothing here reaches a network.** The payloads are written here rather than
 * imported from the library's recorded fixtures, because a spec may not reach
 * into another project's sources by path and what this file is about is the
 * runner's wiring rather than the parsing. The library's own tests are what
 * assert the parsing, against whole responses.
 *
 * What it pins is what plan 0089 decided: the coarse category filter, one
 * ingest call per scope, the region that pays a second price, the product the
 * window holds and prices nowhere, and a page that fails costing one product.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const RUN = '33333333-3333-4333-8333-333333333333';

/**
 * A plain value as devalue's flat format, which is what the page ships.
 *
 * Test scaffolding, and the mirror of the decoder the library runs: index 0 is
 * the root and every number is an index into the same array.
 */
function flatten(value: unknown): unknown[] {
  const flat: unknown[] = [];
  const index = (node: unknown): number => {
    if (node === null || typeof node !== 'object') {
      flat.push(node);
      return flat.length - 1;
    }
    const slot = flat.length;
    flat.push(null);
    if (Array.isArray(node)) {
      flat[slot] = node.map(index);
    } else {
      const out: Record<string, number> = {};
      for (const [key, nested] of Object.entries(node)) {
        out[key] = index(nested);
      }
      flat[slot] = out;
    }
    return slot;
  };
  index(value);
  return flat;
}

/** One row of the index, as the search endpoint wraps it. */
function row(options: {
  id: string;
  title: string;
  category: string;
  brand?: string;
  size?: string;
  won?: string;
}): Record<string, unknown> {
  return {
    gridbox: {
      data: {
        productId: options.id,
        category: options.category,
        canonicalPath: `/p/x/p${options.id}`,
        brand: { name: options.brand ?? 'Milbona' },
        keyfacts: {
          title: options.title,
          wonCategoryPrimary:
            options.won ??
            'Mundos de necesidad/Comida y cerca de la comida/Quesos, productos lácteos y huevos/Queso',
        },
        price: { price: 1.99, packaging: { text: options.size ?? '500 g' } },
        ians: ['80532'],
      },
    },
  };
}

/** One product page's state, with a price per region group. */
function product(options: {
  id: string;
  eans?: string[];
  groups?: Array<{ priceId: string; regions: string[]; price: number | null }>;
}): string {
  const regionsV2: Record<string, unknown> = {};
  const regionsPrices: Record<string, unknown> = {};
  for (const group of options.groups ?? []) {
    for (const region of group.regions) {
      regionsV2[region] = {
        regionName: `Region ${region}`,
        regionPriceId: group.priceId,
      };
    }
    regionsPrices[group.priceId] = {
      currentPrice:
        group.price === null
          ? {}
          : {
              price: group.price,
              currencyCode: 'EUR',
              startDate: '2026-09-03T22:00Z',
              endDate: '2026-09-06T21:59:59Z',
            },
    };
  }
  const state = {
    pinia: {
      products: {
        byId: {
          [options.id]: {
            productId: options.id,
            eans: options.eans ?? ['4335619207615'],
            ians: ['80532'],
            canonicalPath: `/p/x/p${options.id}`,
            keyfacts: {
              title: `Product ${options.id}`,
              wonCategoryPrimary:
                'Mundos de necesidad/Comida y cerca de la comida/Quesos, productos lácteos y huevos/Queso',
            },
            price: { packaging: { text: '500 g' } },
            storeFacts: { retail: true, online: false },
            regionsV2,
            regionsPrices,
          },
        },
      },
    },
  };
  return `<html><script type="application/json" id="__NUXT_DATA__">${JSON.stringify(
    flatten(state)
  )}</script></html>`;
}

/** A runner whose client answers the pages a test states, and nothing else. */
class TestRunner extends LidlCatalogRunner {
  readonly asked: string[] = [];

  constructor(
    ingest: SourceIngest,
    catalog: CatalogClient,
    private readonly pages: {
      index: Array<Record<string, unknown>>;
      products: Record<string, string | number>;
    }
  ) {
    super(ingest, catalog, {
      getOrThrow: () => ({ userAgent: 'LunaShopperBot/1.0' }),
    } as unknown as ConfigService);
  }

  protected override createClient(): LidlClient {
    return new LidlClient({
      // The seam is the fetch, so the run below exercises the real paging, the
      // real header and the real normalizing.
      userAgent: 'LunaShopperBot/1.0',
      sleepImpl: async () => undefined,
      fetchImpl: (async (url: string) => {
        const path = String(url).replace('https://www.lidl.es', '');
        this.asked.push(path);
        if (path.startsWith('/q/api/search')) {
          const offset = Number(
            new URL(String(url)).searchParams.get('offset') ?? 0
          );
          return new Response(
            JSON.stringify({
              numFound: this.pages.index.length,
              offset,
              items: offset === 0 ? this.pages.index : [],
            }),
            { status: 200 }
          );
        }
        const answer = this.pages.products[path];
        if (typeof answer === 'number') {
          return new Response('no', { status: answer });
        }
        return answer === undefined
          ? new Response('no', { status: 404 })
          : new Response(answer, { status: 200 });
      }) as unknown as typeof fetch,
    });
  }
}

function context(): RunContext {
  return {
    runId: RUN,
    signal: new AbortController().signal,
    acquire: async () => undefined,
    setStage: jest.fn(async () => undefined),
    setTotalPlanned: jest.fn(async () => undefined),
    setReport: jest.fn(async () => undefined),
    report: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
    warn: jest.fn(),
  } as unknown as RunContext;
}

const source = (config: Record<string, unknown> = {}): SupermarketSource =>
  ({ adapterKey: 'lidl-api', config, workers: 1 }) as SupermarketSource;

describe('LidlCatalogRunner', () => {
  let ingested: SourceIngestInput[];
  let ingest: SourceIngest;
  let created: Array<{ externalKey: string | null; kind: PriceScopeKind }>;
  let held: PriceScopeView[];
  let catalog: CatalogClient;

  beforeEach(() => {
    ingested = [];
    created = [];
    held = [];
    ingest = {
      ingest: jest.fn(
        async (_context: RunContext, input: SourceIngestInput) => {
          ingested.push(input);
          return { outcomes: [], counters: {} };
        }
      ),
    } as unknown as SourceIngest;
    catalog = {
      listPriceScopes: jest.fn(async () => ({
        items: held,
        nextCursor: null,
      })),
      createPriceScope: jest.fn(
        async (
          supermarketId: string,
          kind: PriceScopeKind,
          externalKey: string | null
        ) => {
          created.push({ externalKey, kind });
          const scope = {
            id: `scope-${externalKey}`,
            supermarketId,
            kind,
            externalKey,
            label: null,
          } as PriceScopeView;
          held = [...held, scope];
          return scope;
        }
      ),
    } as unknown as CatalogClient;
  });

  /** Every observation of one ingest call, by product id. */
  const idsOf = (input: SourceIngestInput): string[] =>
    input.observations.map((observation) => observation.externalId);

  it('keeps the groceries, drops the bazar and the online shop', async () => {
    const runner = new TestRunner(ingest, catalog, {
      index: [
        row({ id: '1', title: 'Queso', category: 'Food' }),
        row({ id: '2', title: 'Uva', category: 'F+V' }),
        row({ id: '3', title: 'Taladro', category: 'NonFood' }),
        row({ id: '4', title: 'Orquídea', category: 'P+F' }),
        row({ id: '5', title: 'Camiseta', category: 'Categorías/Moda' }),
      ],
      products: {
        '/p/x/p1': product({
          id: '1',
          groups: [{ priceId: 'a', regions: ['1'], price: 2.5 }],
        }),
        '/p/x/p2': product({
          id: '2',
          groups: [{ priceId: 'a', regions: ['1'], price: 1.5 }],
        }),
      },
    });

    await runner.run(context(), { supermarketId: CHAIN }, source());

    // Only the two grocery rows were fetched at all: the run pays a page per
    // product, so what it filters out it never reads.
    expect(runner.asked.filter((path) => path.startsWith('/p/'))).toEqual([
      '/p/x/p1',
      '/p/x/p2',
    ]);
    expect(ingested).toHaveLength(1);
    expect(idsOf(ingested[0])).toEqual(['1', '2']);
    expect(ingested[0].sourceKind).toBe(PriceSourceKind.OFFICIAL_API);
  });

  it('creates one scope per region and writes one ingest call for each', async () => {
    const runner = new TestRunner(ingest, catalog, {
      index: [row({ id: '1', title: 'Queso', category: 'Food' })],
      products: {
        '/p/x/p1': product({
          id: '1',
          groups: [{ priceId: 'a', regions: ['1', '2', '3'], price: 2.5 }],
        }),
      },
    });

    await runner.run(context(), { supermarketId: CHAIN }, source());

    // A LIDL offer region is a group of shops the chain prices together and
    // names itself, which is what REGION means (plan 0089, section 4).
    expect(created).toEqual([
      { externalKey: '1', kind: PriceScopeKind.REGION },
      { externalKey: '2', kind: PriceScopeKind.REGION },
      { externalKey: '3', kind: PriceScopeKind.REGION },
    ]);
    expect(ingested.map((input) => input.priceScopeId)).toEqual([
      'scope-1',
      'scope-2',
      'scope-3',
    ]);
    expect(ingested[0].observations[0]).toMatchObject({
      externalId: '1',
      ean: '4335619207615',
      unitSize: 500,
      sizeFormat: '500 g',
      price: {
        price: 2.5,
        currency: 'EUR',
        // LIDL publishes no per kilogram figure, and deriving one would
        // disagree with the chain on the field made for comparing.
        unitPrice: null,
        validFrom: new Date('2026-09-03T22:00Z'),
        validUntil: new Date('2026-09-06T21:59:59Z'),
      },
    });
  });

  it('reuses a scope catalog already holds for that region', async () => {
    held = [
      {
        id: 'scope-held',
        supermarketId: CHAIN,
        kind: PriceScopeKind.REGION,
        externalKey: '1',
        label: null,
      } as PriceScopeView,
    ];
    const runner = new TestRunner(ingest, catalog, {
      index: [row({ id: '1', title: 'Queso', category: 'Food' })],
      products: {
        '/p/x/p1': product({
          id: '1',
          groups: [{ priceId: 'a', regions: ['1'], price: 2.5 }],
        }),
      },
    });

    await runner.run(context(), { supermarketId: CHAIN }, source());

    expect(created).toEqual([]);
    expect(ingested[0].priceScopeId).toBe('scope-held');
  });

  it('writes the two prices of a product its regions disagree about', async () => {
    const runner = new TestRunner(ingest, catalog, {
      index: [row({ id: '1', title: 'Nevera', category: 'Food' })],
      products: {
        '/p/x/p1': product({
          id: '1',
          groups: [
            { priceId: 'mainland', regions: ['1', '2'], price: 74.99 },
            { priceId: 'islands', regions: ['58'], price: 77.99 },
          ],
        }),
      },
    });

    await runner.run(context(), { supermarketId: CHAIN }, source());

    const priced = new Map(
      ingested.map((input) => [
        input.priceScopeId,
        input.observations[0].price?.price,
      ])
    );
    expect(priced.get('scope-1')).toBe(74.99);
    expect(priced.get('scope-2')).toBe(74.99);
    expect(priced.get('scope-58')).toBe(77.99);
  });

  it('drops a region the chain publishes no price for', async () => {
    const runner = new TestRunner(ingest, catalog, {
      index: [row({ id: '1', title: 'Queso', category: 'Food' })],
      products: {
        '/p/x/p1': product({
          id: '1',
          groups: [
            { priceId: 'mainland', regions: ['1'], price: 2.5 },
            // The Canaries, which most grocery is not priced for at all. A
            // shopper there is shown nothing rather than the mainland figure.
            { priceId: 'canaries', regions: ['58', '59'], price: null },
          ],
        }),
      },
    });

    await runner.run(context(), { supermarketId: CHAIN }, source());

    expect(created.map((scope) => scope.externalKey)).toEqual(['1']);
    expect(ingested.map((input) => input.priceScopeId)).toEqual(['scope-1']);
  });

  it('ingests a product the window holds and prices nowhere', async () => {
    const runner = new TestRunner(ingest, catalog, {
      index: [row({ id: '1', title: 'Plátano', category: 'F+V' })],
      products: { '/p/x/p1': product({ id: '1', groups: [] }) },
    });

    await runner.run(context(), { supermarketId: CHAIN }, source());

    // 21 of the week's products look like this. The catalog is allowed to know
    // the article exists, so the row is written with no scope and no price.
    expect(ingested).toHaveLength(1);
    expect(ingested[0].priceScopeId).toBeNull();
    expect(ingested[0].observations[0].price).toBeNull();
    expect(created).toEqual([]);
  });

  it('lets a page that fails cost one product, and names it', async () => {
    const run = context();
    const runner = new TestRunner(ingest, catalog, {
      index: [
        row({ id: '1', title: 'Queso', category: 'Food' }),
        row({ id: '2', title: 'Uva', category: 'F+V' }),
      ],
      products: {
        '/p/x/p1': product({
          id: '1',
          groups: [{ priceId: 'a', regions: ['1'], price: 2.5 }],
        }),
        '/p/x/p2': 500,
      },
    });

    await runner.run(run, { supermarketId: CHAIN }, source());

    // The run keeps what it read rather than failing on one page.
    expect(idsOf(ingested[0])).toEqual(['1']);
    const report = (run.setReport as jest.Mock).mock.calls[0][0];
    expect(report).toMatchObject({
      listed: 2,
      grocery: 2,
      detailRead: 1,
      detailFailed: 1,
      unreadableProducts: ['2'],
    });
  });

  it('reports the window and never a total for the chain', async () => {
    const run = context();
    const runner = new TestRunner(ingest, catalog, {
      index: [row({ id: '1', title: 'Queso', category: 'Food' })],
      products: {
        '/p/x/p1': product({
          id: '1',
          groups: [{ priceId: 'a', regions: ['1'], price: 2.5 }],
        }),
      },
    });

    await runner.run(run, { supermarketId: CHAIN }, source());

    const report = (run.setReport as jest.Mock).mock.calls[0][0];
    expect(report).toMatchObject({
      window: {
        from: '2026-09-03T22:00:00.000Z',
        to: '2026-09-06T21:59:59.000Z',
      },
      priced: 1,
      unpriced: 0,
      withEan13: 1,
      regionsSeen: 1,
      scopesWritten: 1,
      observations: 1,
      regionallyPriced: 0,
    });
    // Nothing in the report claims the chain's assortment: the site publishes
    // a window, and `listed` is a count of what this window held.
    expect(Object.keys(report as object)).not.toContain('total');
  });
});
