import type { ConfigService } from '@nestjs/config';
import { PriceScopeKind } from '@portfolio/luna-shopper/contracts';
import { LidlClient } from '@portfolio/luna-shopper/lidl';
import {
  SourceBlockedError,
  SourceGuard,
} from '@portfolio/luna-shopper/source-guard';
import type { SupermarketSource } from '../entities';
import { mergeCategoryPaths } from './category-paths';
import { FailingRunReport } from './failing-run-report.fake';
import { LidlCatalogRunner } from './lidl-catalog.runner';
import type { RunContext } from './run-context';
import { RecordingRunReport } from './run-report';
import { ReportWriteFailedError } from './run-report.sink';

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
  /** `wonCategoryBreadcrumbs` of the row's `meta`, by name (plan 0268). */
  breadcrumbs?: string[][];
}): Record<string, unknown> {
  return {
    gridbox: {
      ...(options.breadcrumbs
        ? { meta: { wonCategoryBreadcrumbs: crumbs(options.breadcrumbs) } }
        : {}),
      data: {
        productId: options.id,
        category: options.category,
        canonicalPath: `/p/x/p${options.id}`,
        image: `https://www.lidl.es/assets/gcp${options.id}.png`,
        imageList: [`https://www.lidl.es/assets/gcp${options.id}.png`],
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

/** Paths of names as the chain prints a breadcrumb list: nodes, root first. */
function crumbs(paths: string[][]): unknown[] {
  return paths.map((path) =>
    path.map((name, i) => ({
      id: `${name.length}${i}`,
      name,
      url: '/c/x',
      hiddenCategory: false,
    }))
  );
}

/** One product page's state, with a price per region group. */
function product(options: {
  id: string;
  eans?: string[];
  /** The size the page prints, verbatim. */
  size?: string;
  groups?: Array<{ priceId: string; regions: string[]; price: number | null }>;
  /**
   * The page's `wonCategoryBreadcrumbs`, by name (plan 0268). Absent leaves
   * the list out of the page, as the pages captured before November do.
   */
  breadcrumbs?: string[][];
  /** The page's `wonCategoryBreadcrumbs` as printed, over {@link breadcrumbs}. */
  rawBreadcrumbs?: unknown[];
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
            price: { packaging: { text: options.size ?? '500 g' } },
            storeFacts: { retail: true, online: false },
            regionsV2,
            regionsPrices,
            ...(options.breadcrumbs
              ? { wonCategoryBreadcrumbs: crumbs(options.breadcrumbs) }
              : {}),
            ...(options.rawBreadcrumbs
              ? { wonCategoryBreadcrumbs: options.rawBreadcrumbs }
              : {}),
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
    private readonly pages: {
      index: Array<Record<string, unknown>>;
      products: Record<string, string | number>;
    },
    /** Called with every path asked, before it is answered. */
    private readonly onAsk?: (path: string) => void
  ) {
    super({
      getOrThrow: () => ({ userAgent: 'LunaShopperBot/1.0' }),
    } as unknown as ConfigService);
  }

  protected override createClient(context: RunContext): LidlClient {
    return new LidlClient({
      // The seam is the fetch, so the run below exercises the real paging, the
      // real header and the real normalizing.
      userAgent: 'LunaShopperBot/1.0',
      sleepImpl: async () => undefined,
      // The run's gate, guard and signal, as the runtime passes them.
      acquire: context.acquire,
      guard: context.guard,
      signal: context.signal,
      fetchImpl: (async (url: string, init?: RequestInit) => {
        // As the real fetch does: a request on an aborted signal never leaves.
        init?.signal?.throwIfAborted();
        const path = String(url).replace('https://www.lidl.es', '');
        this.asked.push(path);
        this.onAsk?.(path);
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

/**
 * A context with a refusal guard that stops on the first refusal, wired the
 * way `RunExecutor` wires the run's (plan 0215).
 */
function guardedContext(): RunContext {
  const controller = new AbortController();
  const ctx = context(controller.signal);
  const guard = new SourceGuard(
    { consecutive: 1, window: null, coolDowns: 0, coolDownMs: 0, probes: 0 },
    { onStop: (stop) => controller.abort(new SourceBlockedError(stop)) }
  );
  return Object.assign(ctx, {
    guard,
    acquire: () => guard.admit(controller.signal),
  });
}

function context(signal = new AbortController().signal): RunContext {
  return {
    runId: RUN,
    signal,
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
  // A recording report and nothing else. The run declares its regions and
  // creates none, so there is no `CatalogClient` to fake here any more, and no
  // ingest either (plan 0103, sections 6.4 and 9).
  let report: RecordingRunReport;

  beforeEach(() => {
    report = new RecordingRunReport();
  });

  /** Every product the run reported, by id. */
  const idsOf = (): string[] =>
    report.products.map((observation) => observation.externalId);

  /** Every offer region the reported prices name, in order, without repeats. */
  const scopeKeysOf = (): string[] => [
    ...new Set(
      report.products.flatMap((observation) =>
        observation.prices.map((price) => price.scopeKey as string)
      )
    ),
  ];

  it('keeps the groceries, drops the bazar and the online shop', async () => {
    const runner = new TestRunner({
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

    await runner.run(context(), report, { supermarketId: CHAIN }, source());

    // Only the two grocery rows were fetched at all: the run pays a page per
    // product, so what it filters out it never reads.
    expect(runner.asked.filter((path) => path.startsWith('/p/'))).toEqual([
      '/p/x/p1',
      '/p/x/p2',
    ]);
    expect(idsOf()).toEqual(['1', '2']);
  });

  it('writes the size with the unit it is in, for every shape the chain prints (plan 0177)', async () => {
    // The two rows the plan measured are here: `75cl` is written as 750 and
    // `1,28 l` stays 1.28, so the printed text alone cannot say which unit the
    // number is in, and `sizeUnit` is what does.
    const printed = [
      '75cl',
      '1,28 l',
      '1 kg',
      '500 g',
      '10 ud',
      '6x33cl',
      'Paquete',
    ];
    const group = [{ priceId: 'a', regions: ['1'], price: 2.5 }];
    const runner = new TestRunner({
      index: printed.map((size, index) =>
        row({ id: String(index + 1), title: 'Queso', category: 'Food', size })
      ),
      products: Object.fromEntries(
        printed.map((size, index) => [
          `/p/x/p${index + 1}`,
          product({ id: String(index + 1), size, groups: group }),
        ])
      ),
    });

    await runner.run(context(), report, { supermarketId: CHAIN }, source());

    expect(
      Object.fromEntries(
        report.products.map((observation) => [
          observation.sizeFormat,
          [observation.unitSize, observation.sizeUnit],
        ])
      )
    ).toEqual({
      '75cl': [750, 'MILLILITER'],
      '1,28 l': [1.28, 'LITER'],
      '1 kg': [1, 'KILOGRAM'],
      '500 g': [500, 'GRAM'],
      '10 ud': [10, 'UNIT'],
      '6x33cl': [1980, 'MILLILITER'],
      // A word that is not a size: no number, and so no unit either.
      Paquete: [null, null],
    });
  });

  it('writes a tray printed Aprox. as a piece priced as one (plan 0244, section 5.2)', async () => {
    const printed = ['Aprox. 350 g', 'Aprox. 360-460g', '500 g'];
    const group = [{ priceId: 'a', regions: ['1'], price: 4.99 }];
    const runner = new TestRunner({
      index: printed.map((size, index) =>
        row({ id: String(index + 1), title: 'Lomo', category: 'Food', size })
      ),
      products: Object.fromEntries(
        printed.map((size, index) => [
          `/p/x/p${index + 1}`,
          product({ id: String(index + 1), size, groups: group }),
        ])
      ),
    });

    await runner.run(context(), report, { supermarketId: CHAIN }, source());

    const bySize = Object.fromEntries(
      report.products.map((observation) => [
        observation.sizeFormat,
        observation,
      ])
    );
    expect(bySize['Aprox. 350 g']).toMatchObject({
      unitSize: null,
      sizeUnit: null,
      approxWeight: 350,
      soldByWeight: false,
      // The tray's price, unchanged.
      prices: [expect.objectContaining({ price: 4.99 })],
    });
    // A printed range is neither a size nor a weight.
    expect(bySize['Aprox. 360-460g']).toMatchObject({
      unitSize: null,
      approxWeight: null,
    });
    expect(bySize['500 g']).toMatchObject({
      unitSize: 500,
      sizeUnit: 'GRAM',
      approxWeight: null,
    });
  });

  it('declares one scope per region, and creates none itself', async () => {
    const runner = new TestRunner({
      index: [row({ id: '1', title: 'Queso', category: 'Food' })],
      products: {
        '/p/x/p1': product({
          id: '1',
          groups: [{ priceId: 'a', regions: ['1', '2', '3'], price: 2.5 }],
        }),
      },
    });

    await runner.run(context(), report, { supermarketId: CHAIN }, source());

    // A LIDL offer region is a group of shops the chain prices together and
    // names itself, which is what REGION means (plan 0089, section 4). The run
    // declares them; creating what catalog does not hold is the orchestrator's
    // (plan 0103, section 6.4).
    expect(report.scopes).toEqual([
      { key: '1', kind: PriceScopeKind.REGION, name: 'Region 1' },
      { key: '2', kind: PriceScopeKind.REGION, name: 'Region 2' },
      { key: '3', kind: PriceScopeKind.REGION, name: 'Region 3' },
    ]);
    // **One pass, not one per scope** (plan 0103, D5). The regions travel with
    // the product rather than splitting the run into a pass each.
    expect(scopeKeysOf()).toEqual(['1', '2', '3']);
    expect(report.products[0]).toMatchObject({
      externalId: '1',
      ean: '4335619207615',
      unitSize: 500,
      sizeUnit: 'GRAM',
      sizeFormat: '500 g',
      // The search row's own photo address, verbatim (plan 0198).
      imageUrl: 'https://www.lidl.es/assets/gcp1.png',
    });
    expect(report.products[0].prices[0]).toMatchObject({
      scopeKey: '1',
      price: 2.5,
      currency: 'EUR',
      // LIDL publishes no per kilogram figure, and deriving one would
      // disagree with the chain on the field made for comparing.
      unitPrice: null,
      validFrom: new Date('2026-09-03T22:00Z'),
      validUntil: new Date('2026-09-06T21:59:59Z'),
    });
  });

  it('declares a region once however many products are priced for it', async () => {
    const runner = new TestRunner({
      index: [
        row({ id: '1', title: 'Queso', category: 'Food' }),
        row({ id: '2', title: 'Uva', category: 'F+V' }),
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

    await runner.run(context(), report, { supermarketId: CHAIN }, source());

    // Whether catalog already holds it, and what to do when it does not, is
    // `price-scope-resolver.spec.ts`.
    expect(report.scopes.map((scope) => scope.key)).toEqual(['1']);
  });

  it('reports the two prices of a product its regions disagree about', async () => {
    const runner = new TestRunner({
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

    await runner.run(context(), report, { supermarketId: CHAIN }, source());

    // Three prices on one product, each naming its own region. **A collapsed
    // model cannot store the week one region differs**, so the two that agree
    // this week are still two entries (plan 0089, section 4).
    const priced = new Map(
      report.products[0].prices.map((price) => [price.scopeKey, price.price])
    );
    expect(priced.get('1')).toBe(74.99);
    expect(priced.get('2')).toBe(74.99);
    expect(priced.get('58')).toBe(77.99);
  });

  it('drops a region the chain publishes no price for', async () => {
    const runner = new TestRunner({
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

    await runner.run(context(), report, { supermarketId: CHAIN }, source());

    expect(report.scopes.map((scope) => scope.key)).toEqual(['1']);
    expect(scopeKeysOf()).toEqual(['1']);
  });

  it('reports a product the window holds and prices nowhere', async () => {
    const runner = new TestRunner({
      index: [row({ id: '1', title: 'Plátano', category: 'F+V' })],
      products: { '/p/x/p1': product({ id: '1', groups: [] }) },
    });

    await runner.run(context(), report, { supermarketId: CHAIN }, source());

    // 21 of the week's products look like this. The catalog is allowed to know
    // the article exists, so the product is reported with no price at all.
    expect(report.products).toHaveLength(1);
    expect(report.products[0].prices).toEqual([]);
    expect(report.scopes).toEqual([]);
  });

  it('lets a page that fails cost one product, and names it', async () => {
    const run = context();
    const runner = new TestRunner({
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

    await runner.run(run, report, { supermarketId: CHAIN }, source());

    // The run keeps what it read rather than failing on one page.
    expect(idsOf()).toEqual(['1']);
    const runReport = (run.setReport as jest.Mock).mock.calls[0][0];
    expect(runReport).toMatchObject({
      listed: 2,
      grocery: 2,
      detailRead: 1,
      detailFailed: 1,
      unreadableProducts: ['2'],
    });
  });

  describe('a run that stops partway (plan 0215)', () => {
    const index = [
      row({ id: '1', title: 'Queso', category: 'Food' }),
      row({ id: '2', title: 'Uva', category: 'F+V' }),
      row({ id: '3', title: 'Leche', category: 'Food' }),
    ];
    const pageOf = (id: string): string =>
      product({ id, groups: [{ priceId: 'a', regions: ['1'], price: 2.5 }] });

    it('reports the products read before the guard stopped it', async () => {
      const run = guardedContext();
      const runner = new TestRunner({
        index,
        products: {
          '/p/x/p1': pageOf('1'),
          '/p/x/p2': 403,
          '/p/x/p3': pageOf('3'),
        },
      });

      await runner.run(run, report, { supermarketId: CHAIN }, source());

      expect(run.signal.aborted).toBe(true);
      expect(idsOf()).toEqual(['1']);
      expect(runner.asked).not.toContain('/p/x/p3');
      // The refused page that stopped the run is not a failed product.
      expect(run.report).not.toHaveBeenCalledWith({ failed: 1 });
      expect(run.setReport).toHaveBeenCalled();
    });

    it('reports the products read before a person aborted it', async () => {
      const controller = new AbortController();
      const run = context(controller.signal);
      const runner = new TestRunner(
        {
          index,
          products: {
            '/p/x/p1': pageOf('1'),
            '/p/x/p2': pageOf('2'),
            '/p/x/p3': pageOf('3'),
          },
        },
        (path) => {
          if (path === '/p/x/p2') {
            controller.abort();
          }
        }
      );

      await runner.run(run, report, { supermarketId: CHAIN }, source());

      // The page in flight answered and is kept; nothing was asked after it.
      expect(idsOf()).toEqual(['1', '2']);
      expect(runner.asked).not.toContain('/p/x/p3');
      expect(run.setReport).toHaveBeenCalled();
    });
  });

  it('reports the window and never a total for the chain', async () => {
    const run = context();
    const runner = new TestRunner({
      index: [row({ id: '1', title: 'Queso', category: 'Food' })],
      products: {
        '/p/x/p1': product({
          id: '1',
          groups: [{ priceId: 'a', regions: ['1'], price: 2.5 }],
        }),
      },
    });

    await runner.run(run, report, { supermarketId: CHAIN }, source());

    const runReport = (run.setReport as jest.Mock).mock.calls[0][0];
    expect(runReport).toMatchObject({
      window: {
        from: '2026-09-03T22:00:00.000Z',
        to: '2026-09-06T21:59:59.000Z',
      },
      priced: 1,
      unpriced: 0,
      withEan13: 1,
      regionsSeen: 1,
      regionsDeclared: ['1'],
      observations: 1,
      regionallyPriced: 0,
    });
    // Nothing in the report claims the chain's assortment: the site publishes
    // a window, and `listed` is a count of what this window held.
    expect(Object.keys(runReport as object)).not.toContain('total');
  });

  describe('a walk reports what it has read as it goes (plan 0267)', () => {
    /**
     * Three products over three regions. The second names a region the first
     * did not, and the third names none the run has not declared, so the
     * order of declarations against products is visible.
     */
    const index = [
      row({ id: '1', title: 'Queso', category: 'Food' }),
      row({ id: '2', title: 'Uva', category: 'F+V' }),
      // The index repeats a row it already gave: one product, one page.
      row({ id: '1', title: 'Queso', category: 'Food' }),
      row({ id: '3', title: 'Leche', category: 'Food' }),
    ];
    const pages = (): Record<string, string | number> => ({
      '/p/x/p1': product({
        id: '1',
        groups: [{ priceId: 'a', regions: ['1', '2'], price: 2.5 }],
      }),
      '/p/x/p2': product({
        id: '2',
        groups: [
          { priceId: 'a', regions: ['2'], price: 1.5 },
          { priceId: 'b', regions: ['3'], price: 1.75 },
        ],
      }),
      '/p/x/p3': product({
        id: '3',
        groups: [{ priceId: 'a', regions: ['3', '1'], price: 0.99 }],
      }),
    });

    /**
     * Every scope, product, page asked and stage set, in the order the run
     * said them, as `scope:<key>`, `product:<id>`, `ask:<path>` and
     * `stage:<stage>`.
     */
    function watch(runContext: RunContext): string[] {
      const events: string[] = [];
      const scope = report.scope.bind(report);
      report.scope = (declaration) => {
        events.push(`scope:${declaration.key}`);
        scope(declaration);
      };
      const reported = report.product.bind(report);
      report.product = (observation) => {
        events.push(`product:${observation.externalId}`);
        reported(observation);
      };
      (runContext.setStage as jest.Mock).mockImplementation(
        async (stage: string) => {
          events.push(`stage:${stage}`);
        }
      );
      return events;
    }

    it('reports each product once, as its page answers, each region declared before the first product that names it', async () => {
      const runContext = context();
      const events = watch(runContext);
      const runner = new TestRunner({ index, products: pages() }, (path) => {
        if (path.startsWith('/p/')) {
          events.push(`ask:${path}`);
        }
      });

      await runner.run(runContext, report, { supermarketId: CHAIN }, source());

      expect(events).toEqual([
        'stage:LIST',
        'stage:DETAIL',
        'ask:/p/x/p1',
        'scope:1',
        'scope:2',
        'product:1',
        'ask:/p/x/p2',
        'scope:3',
        'product:2',
        'ask:/p/x/p3',
        // Both of its regions were declared already: once each, never again.
        'product:3',
        'stage:INGEST',
      ]);
      // The name of a region is that of its first sighting.
      expect(report.scopes).toEqual([
        { key: '1', kind: PriceScopeKind.REGION, name: 'Region 1' },
        { key: '2', kind: PriceScopeKind.REGION, name: 'Region 2' },
        { key: '3', kind: PriceScopeKind.REGION, name: 'Region 3' },
      ]);
      // LIDL publishes a window, not an assortment: nothing is ever whole.
      expect(report.wholeListings).toEqual([]);
      expect(report.notWhole).toEqual([]);
    });

    it('gives the same report at the end as before', async () => {
      const runContext = context();
      const runner = new TestRunner({ index, products: pages() });

      await runner.run(runContext, report, { supermarketId: CHAIN }, source());

      expect(runContext.setReport).toHaveBeenCalledTimes(1);
      expect((runContext.setReport as jest.Mock).mock.calls[0][0]).toEqual({
        window: {
          from: '2026-09-03T22:00:00.000Z',
          to: '2026-09-06T21:59:59.000Z',
        },
        listed: 3,
        grocery: 3,
        detailRead: 3,
        detailFailed: 0,
        unreadableProducts: [],
        priced: 3,
        unpriced: 0,
        withEan13: 3,
        regionsSeen: 3,
        regionsDeclared: ['1', '2', '3'],
        observations: 4,
        regionallyPriced: 1,
        requests: runner.asked.length,
      });
      expect(idsOf()).toEqual(['1', '2', '3']);
    });

    it('has reported what it read while the walk is still going, and declared nothing whole', async () => {
      let reached!: () => void;
      const stalled = new Promise<void>((resolve) => (reached = resolve));
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      /** A walk whose third page never answers until released, as a dying pod. */
      class StallingRunner extends TestRunner {
        protected override createClient(runContext: RunContext): LidlClient {
          const inner = super.createClient(runContext);
          const getProduct = inner.getProduct.bind(inner);
          inner.getProduct = async (listed) => {
            if (listed.externalId === '3') {
              reached();
              await released;
              throw new Error('The connection was reset.');
            }
            return getProduct(listed);
          };
          return inner;
        }
      }
      const runContext = context();
      const runner = new StallingRunner({ index, products: pages() });

      const run = runner.run(
        runContext,
        report,
        { supermarketId: CHAIN },
        source()
      );
      await stalled;

      // Half way: the products read are with the sink, with their regions,
      // and the end of the walk has not run.
      expect(idsOf()).toEqual(['1', '2']);
      expect(report.scopes.map((scope) => scope.key)).toEqual(['1', '2', '3']);
      expect(report.wholeListings).toEqual([]);
      expect(runContext.setReport).not.toHaveBeenCalled();
      expect(runContext.setStage).not.toHaveBeenCalledWith(
        'INGEST',
        expect.anything()
      );

      release();
      await run;
      // The page that failed costs one product, and nothing is reported twice.
      expect(idsOf()).toEqual(['1', '2']);
      expect(runContext.report).toHaveBeenCalledWith({ failed: 1 });
      expect(report.wholeListings).toEqual([]);
    });

    it('reports the products read before an abort, and none after it', async () => {
      const controller = new AbortController();
      const runContext = context(controller.signal);
      const events = watch(runContext);
      const runner = new TestRunner({ index, products: pages() }, (path) => {
        if (path === '/p/x/p2') {
          controller.abort();
        }
      });

      await runner.run(runContext, report, { supermarketId: CHAIN }, source());

      // The page in flight answered and is kept, its new region declared
      // before it. The third page was never asked.
      expect(events).toEqual([
        'stage:LIST',
        'stage:DETAIL',
        'scope:1',
        'scope:2',
        'product:1',
        'scope:3',
        'product:2',
        'stage:INGEST',
      ]);
      expect(runner.asked).not.toContain('/p/x/p3');
      expect(report.wholeListings).toEqual([]);
      expect(report.notWhole).toEqual([]);
    });

    it('asks for no page after a chunk failed to write (plan 0269, section 1)', async () => {
      const controller = new AbortController();
      const failing = new FailingRunReport(controller);
      const runContext = context(controller.signal);
      const runner = new TestRunner({ index, products: pages() });

      await runner.run(runContext, failing, { supermarketId: CHAIN }, source());

      // The executor's abort reached the walk through the signal it reads.
      expect(controller.signal.reason).toBeInstanceOf(ReportWriteFailedError);
      expect(runner.asked).toContain('/p/x/p1');
      expect(runner.asked).not.toContain('/p/x/p2');
      expect(runner.asked).not.toContain('/p/x/p3');
      expect(failing.dropped).toBe(0);
      expect(failing.wholeListings).toEqual([]);
      expect(failing.notWhole).toEqual([]);
    });
  });

  describe('every path a product is filed under (plan 0268)', () => {
    const QUESO = [
      'Mundos de necesidad',
      'Comida y cerca de la comida',
      'Quesos, productos lácteos y huevos',
      'Queso',
    ];
    const SHOP = ['Alimentación', 'Quesos'];
    const AUTUMN = ['Especial otoño'];
    const priced = [{ priceId: 'a', regions: ['1'], price: 2.5 }];

    const callFor = (externalId: string) =>
      report.categoryPathCalls.find((call) => call.externalId === externalId);

    it('gives a product its need world path and every breadcrumb, in that order, as REPLACE', async () => {
      const run = context();
      const runner = new TestRunner({
        index: [
          row({ id: '1', title: 'Queso', category: 'Food' }),
          row({ id: '2', title: 'Leche', category: 'Food' }),
        ],
        products: {
          '/p/x/p1': product({
            id: '1',
            groups: priced,
            breadcrumbs: [SHOP, AUTUMN],
          }),
          // The page states the list, and it is empty: no statement (owner
          // decision 95b).
          '/p/x/p2': product({ id: '2', groups: priced, breadcrumbs: [] }),
        },
      });
      let callsAtFlush = -1;
      (run.flush as jest.Mock).mockImplementation(async () => {
        callsAtFlush = report.categoryPathCalls.length;
      });

      await runner.run(run, report, { supermarketId: CHAIN }, source());

      expect(callFor('1')).toEqual({
        externalId: '1',
        paths: [QUESO, SHOP, AUTUMN],
        mode: 'REPLACE',
      });
      expect(callFor('2')).toEqual({
        externalId: '2',
        paths: [QUESO],
        mode: 'ADD',
      });
      // One call a product.
      expect(report.categoryPathCalls).toHaveLength(2);
      // `categoryPath` is what it was, and the first path of the call.
      const observed = report.products.find(
        (observation) => observation.externalId === '1'
      );
      expect(observed?.categoryPath).toEqual(QUESO);
      expect(observed?.categoryPath).toEqual(callFor('1')?.paths[0]);
      // No observation carries the paths.
      for (const observation of report.products) {
        expect(observation).not.toHaveProperty('categoryPaths');
      }
      // Made at the end of the walk, before the run flushes and the sink
      // drains.
      expect(callsAtFlush).toBe(2);
    });

    it('takes the breadcrumbs of the index row for a page that prints none, as ADD', async () => {
      const runner = new TestRunner({
        index: [
          row({
            id: '1',
            title: 'Queso',
            category: 'Food',
            breadcrumbs: [SHOP],
          }),
        ],
        // A page that leaves the list out, as every page captured before
        // November does.
        products: { '/p/x/p1': product({ id: '1', groups: priced }) },
      });

      await runner.run(context(), report, { supermarketId: CHAIN }, source());

      expect(report.categoryPathCalls).toEqual([
        { externalId: '1', paths: [QUESO, SHOP], mode: 'ADD' },
      ]);
    });

    it('says ADD for a page that states its need world path and leaves the list out', async () => {
      const runner = new TestRunner({
        index: [row({ id: '1', title: 'Queso', category: 'Food' })],
        products: { '/p/x/p1': product({ id: '1', groups: priced }) },
      });

      await runner.run(context(), report, { supermarketId: CHAIN }, source());

      expect(report.categoryPathCalls).toEqual([
        { externalId: '1', paths: [QUESO], mode: 'ADD' },
      ]);
    });

    it('says ADD for a page whose list is not empty and has nothing readable', async () => {
      const runner = new TestRunner({
        index: [row({ id: '1', title: 'Queso', category: 'Food' })],
        products: {
          '/p/x/p1': product({
            id: '1',
            groups: priced,
            // A renamed field: no node carries a name.
            rawBreadcrumbs: [[{ id: '1', label: 'Alimentación' }]],
          }),
        },
      });

      await runner.run(context(), report, { supermarketId: CHAIN }, source());

      expect(report.categoryPathCalls).toEqual([
        { externalId: '1', paths: [QUESO], mode: 'ADD' },
      ]);
    });

    it('says ADD for a page whose list was read only in part', async () => {
      const runner = new TestRunner({
        index: [row({ id: '1', title: 'Queso', category: 'Food' })],
        products: {
          '/p/x/p1': product({
            id: '1',
            groups: priced,
            rawBreadcrumbs: [
              [
                { id: '1', name: 'Alimentación' },
                { id: '2', name: 'Quesos' },
              ],
              [{ id: '3', label: 'Especial otoño' }],
            ],
          }),
        },
      });

      await runner.run(context(), report, { supermarketId: CHAIN }, source());

      expect(report.categoryPathCalls).toEqual([
        { externalId: '1', paths: [QUESO, SHOP], mode: 'ADD' },
      ]);
    });

    it('adds the breadcrumbs of the index row to a page list read only in part, as ADD (owner decision 115b)', async () => {
      const runner = new TestRunner({
        index: [
          row({
            id: '1',
            title: 'Queso',
            category: 'Food',
            breadcrumbs: [AUTUMN, SHOP],
          }),
        ],
        products: {
          '/p/x/p1': product({
            id: '1',
            groups: priced,
            rawBreadcrumbs: [
              [
                { id: '1', name: 'Alimentación' },
                { id: '2', name: 'Quesos' },
              ],
              [{ id: '3' }],
            ],
          }),
        },
      });

      await runner.run(context(), report, { supermarketId: CHAIN }, source());

      // SHOP is on both lists and is written once.
      expect(report.categoryPathCalls).toEqual([
        { externalId: '1', paths: [QUESO, SHOP, AUTUMN], mode: 'ADD' },
      ]);
    });

    it('leaves the breadcrumbs of the index row out beside a page list read in full, as REPLACE', async () => {
      const runner = new TestRunner({
        index: [
          row({
            id: '1',
            title: 'Queso',
            category: 'Food',
            breadcrumbs: [AUTUMN],
          }),
        ],
        products: {
          '/p/x/p1': product({ id: '1', groups: priced, breadcrumbs: [SHOP] }),
        },
      });

      await runner.run(context(), report, { supermarketId: CHAIN }, source());

      expect(report.categoryPathCalls).toEqual([
        { externalId: '1', paths: [QUESO, SHOP], mode: 'REPLACE' },
      ]);
    });

    it('says ADD for a page that states an empty list, so a path stored earlier survives (owner decision 95b)', async () => {
      const runner = new TestRunner({
        index: [row({ id: '1', title: 'Queso', category: 'Food' })],
        products: {
          '/p/x/p1': product({ id: '1', groups: priced, rawBreadcrumbs: [] }),
        },
      });

      await runner.run(context(), report, { supermarketId: CHAIN }, source());

      expect(report.categoryPathCalls).toEqual([
        { externalId: '1', paths: [QUESO], mode: 'ADD' },
      ]);
      // What the entry holds after the call: the breadcrumb an earlier week
      // stored is still there, beside the need world path.
      const [call] = report.categoryPathCalls;
      expect(mergeCategoryPaths([SHOP], call.paths, call.mode)).toEqual([
        SHOP,
        QUESO,
      ]);
    });

    it('takes the breadcrumbs of the index row for a page that states an empty list, as ADD (owner decision 101b)', async () => {
      const runner = new TestRunner({
        index: [
          row({
            id: '1',
            title: 'Queso',
            category: 'Food',
            breadcrumbs: [SHOP],
          }),
        ],
        products: {
          '/p/x/p1': product({ id: '1', groups: priced, rawBreadcrumbs: [] }),
        },
      });

      await runner.run(context(), report, { supermarketId: CHAIN }, source());

      expect(report.categoryPathCalls).toEqual([
        { externalId: '1', paths: [QUESO, SHOP], mode: 'ADD' },
      ]);
    });

    it('says REPLACE for a page that states a real list read in full, so a path it no longer names goes', async () => {
      const runner = new TestRunner({
        index: [row({ id: '1', title: 'Queso', category: 'Food' })],
        products: {
          '/p/x/p1': product({ id: '1', groups: priced, breadcrumbs: [SHOP] }),
        },
      });

      await runner.run(context(), report, { supermarketId: CHAIN }, source());

      expect(report.categoryPathCalls).toEqual([
        { externalId: '1', paths: [QUESO, SHOP], mode: 'REPLACE' },
      ]);
      const [call] = report.categoryPathCalls;
      expect(mergeCategoryPaths([AUTUMN], call.paths, call.mode)).toEqual([
        QUESO,
        SHOP,
      ]);
    });

    it('says ADD for a page whose list holds one empty breadcrumb', async () => {
      const runner = new TestRunner({
        index: [row({ id: '1', title: 'Queso', category: 'Food' })],
        products: {
          '/p/x/p1': product({ id: '1', groups: priced, rawBreadcrumbs: [[]] }),
        },
      });

      await runner.run(context(), report, { supermarketId: CHAIN }, source());

      expect(report.categoryPathCalls).toEqual([
        { externalId: '1', paths: [QUESO], mode: 'ADD' },
      ]);
    });

    it('makes no call for a product whose page did not answer', async () => {
      const runner = new TestRunner({
        index: [
          row({ id: '1', title: 'Queso', category: 'Food' }),
          row({ id: '2', title: 'Uva', category: 'F+V' }),
        ],
        products: {
          '/p/x/p1': product({ id: '1', groups: priced, breadcrumbs: [] }),
          '/p/x/p2': 500,
        },
      });

      await runner.run(context(), report, { supermarketId: CHAIN }, source());

      expect(report.categoryPathCalls.map((call) => call.externalId)).toEqual([
        '1',
      ]);
    });

    it('says ADD for every product when the run was aborted', async () => {
      const controller = new AbortController();
      const runner = new TestRunner(
        {
          index: [
            row({ id: '1', title: 'Queso', category: 'Food' }),
            row({ id: '2', title: 'Uva', category: 'F+V' }),
            row({ id: '3', title: 'Leche', category: 'Food' }),
          ],
          products: {
            '/p/x/p1': product({ id: '1', groups: priced, breadcrumbs: [] }),
            '/p/x/p2': product({ id: '2', groups: priced, breadcrumbs: [] }),
            '/p/x/p3': product({ id: '3', groups: priced, breadcrumbs: [] }),
          },
        },
        (path) => {
          if (path === '/p/x/p2') {
            controller.abort();
          }
        }
      );

      await runner.run(
        context(controller.signal),
        report,
        { supermarketId: CHAIN },
        source()
      );

      expect(report.categoryPathCalls.map((call) => call.externalId)).toEqual([
        '1',
        '2',
      ]);
      expect(
        report.categoryPathCalls.every((call) => call.mode === 'ADD')
      ).toBe(true);
    });
  });
});
