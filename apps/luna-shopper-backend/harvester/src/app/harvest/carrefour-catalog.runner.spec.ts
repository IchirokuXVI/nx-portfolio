import type { ConfigService } from '@nestjs/config';
import {
  CARREFOUR_REFUSAL_POLICY,
  CarrefourClient,
} from '@portfolio/luna-shopper/carrefour';
import { HarvestWarningCode } from '@portfolio/luna-shopper/contracts';
import {
  SourceBlockedError,
  SourceGuard,
} from '@portfolio/luna-shopper/source-guard';
import type { HarvestRun, SupermarketSource } from '../entities';
import { TokenBucket } from '../runner/token-bucket';
import { CarrefourCatalogRunner } from './carrefour-catalog.runner';
import { FailingRunReport } from './failing-run-report.fake';
import type { HarvestRunStore } from './harvest-run.store';
import { RunContext } from './run-context';
import { RecordingRunReport } from './run-report';
import { ReportWriteFailedError } from './run-report.sink';

/**
 * The crawl, end to end, over a fake page loader and no browser (plan 0090,
 * section 15).
 *
 * **Nothing here launches Chromium or reaches a network.** A real crawl is 851
 * page loads over about an hour and is never started from a test. The states
 * below are the shape the storefront renders into `__INITIAL_STATE__`, written
 * here rather than imported from the library's recorded fixtures, because a
 * spec may not reach into another project's sources by path and what this file
 * is about is the runner's wiring rather than the parsing.
 *
 * What it pins is what plan 0090 decided: the frontier rule, the price on every
 * card, the card that printed none, and the truncated category reaching the run
 * report.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const SCOPE = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';

/** A card as the storefront renders one. */
function card(
  id: string,
  name: string,
  price: string | undefined,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    product_id: id,
    sku_id: `sku-${id}`,
    name,
    brand: 'CARREFOUR',
    price,
    price_per_unit: price,
    measure_unit: 'l',
    url: `/supermercado/${id}/p`,
    images: {
      desktop: `https://static.carrefour.es/hd_350x_/img_pim_food/${id}_00_1.jpg`,
      mobile: `https://static.carrefour.es/hd_350x_/img_pim_food/${id}_00_1.jpg`,
    },
    ...extra,
  };
}

function page(options: {
  cards?: Array<Record<string, unknown>>;
  totalResults?: number;
  children?: Array<{ id: string; display_name: string; url: string }>;
  firstLevel?: Array<{ id: string; display_name: string; url: string }>;
  displayName?: string;
}): Record<string, unknown> {
  const total = options.totalResults ?? options.cards?.length ?? 0;
  return {
    productCardList: {
      results: { items: options.cards ?? [], total_results: total },
    },
    pagination: {
      page_size: 24,
      total_pages: Math.ceil(Math.min(total, 1008) / 24),
    },
    category: { display_name: options.displayName ?? 'A category' },
    horizontalNavigation: {
      firstLevelCategories: { items: options.firstLevel ?? [] },
      secondLevelCategories: { items: options.children ?? [] },
    },
  };
}

const link = (id: string, name: string) => ({
  id,
  display_name: name,
  url: `/supermercado/x/${id}/c`,
});

/** A runner whose client reads the states a test states, and nothing else. */
class TestRunner extends CarrefourCatalogRunner {
  readonly asked: string[] = [];

  constructor(
    protected readonly states: Record<string, Record<string, unknown>>
  ) {
    super({
      getOrThrow: () => ({ userAgent: 'LunaShopperBot/1.0' }),
    } as unknown as ConfigService);
  }

  protected override createClient(_context: RunContext): CarrefourClient {
    return new CarrefourClient({
      // The seam is the browser session, so the run below exercises the real
      // pacing, the real refusal counting and the real session handling.
      userAgent: 'LunaShopperBot/1.0',
      sleepImpl: async () => undefined,
      openSession: async () => ({
        goto: async (url: string) => {
          const path = url.replace('https://www.carrefour.es', '');
          this.asked.push(path);
          const state = this.states[path];
          return state ? { status: 200, state } : { status: 404, state: null };
        },
        close: async () => undefined,
      }),
    });
  }
}

/**
 * The same runner, over a session that refuses every page it does not know.
 *
 * {@link TestRunner} answers 404 for an unknown path, which is one page missing.
 * This one answers 403, which is the storefront refusing, and three in a row is
 * the block.
 */
class BlockingRunner extends TestRunner {
  protected override createClient(context: RunContext): CarrefourClient {
    return new CarrefourClient({
      userAgent: 'LunaShopperBot/1.0',
      sleepImpl: async () => undefined,
      // The run's guard and gate, as the runtime passes them (plan 0215).
      acquire: context.acquire,
      guard: context.guard,
      signal: context.signal,
      openSession: async () => ({
        goto: async (url: string) => {
          const path = url.replace('https://www.carrefour.es', '');
          this.asked.push(path);
          const state = this.states[path];
          return state ? { status: 200, state } : { status: 403, state: null };
        },
        close: async () => undefined,
      }),
    });
  }
}

/**
 * The same runner, over a session that refuses a path as many times as a test
 * says and answers it after that. An isolated refusal, as the storefront gave
 * seven of on 2026-11-06 (plan 0251).
 */
class RefusingRunner extends TestRunner {
  constructor(
    states: Record<string, Record<string, unknown>>,
    private readonly refusals: Record<string, number>
  ) {
    super(states);
  }

  protected override createClient(context: RunContext): CarrefourClient {
    return new CarrefourClient({
      userAgent: 'LunaShopperBot/1.0',
      sleepImpl: async () => undefined,
      acquire: context.acquire,
      guard: context.guard,
      signal: context.signal,
      openSession: async () => ({
        goto: async (url: string) => {
          const path = url.replace('https://www.carrefour.es', '');
          this.asked.push(path);
          if ((this.refusals[path] ?? 0) > 0) {
            this.refusals[path] -= 1;
            return { status: 403, state: null };
          }
          const state = this.states[path];
          return state ? { status: 200, state } : { status: 404, state: null };
        },
        close: async () => undefined,
      }),
    });
  }
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
    countProgressItself: jest.fn(),
    flush: jest.fn(async () => undefined),
    warn: jest.fn(),
  } as unknown as RunContext;
}

/**
 * A real {@link RunContext} over a store that records what it was asked to
 * write, so a spec reads `processed` as the run row would hold it.
 */
function countingContext() {
  const counters: Array<Record<string, number>> = [];
  let planned: number | null = null;
  const store = {
    setStage: async () => undefined,
    setTotalPlanned: async (_run: string, total: number) => {
      planned = total;
    },
    setReport: async () => undefined,
    addCounters: async (_run: string, added: Record<string, number>) => {
      counters.push(added);
    },
    addWarnings: async () => undefined,
    touchHeartbeat: async () => undefined,
  };
  const context = new RunContext(
    { id: RUN } as HarvestRun,
    new AbortController().signal,
    new TokenBucket({ ratePerSecond: 1000 }),
    store as unknown as HarvestRunStore
  );
  return {
    context,
    planned: () => planned,
    processed: () =>
      counters.reduce((sum, added) => sum + (added['processed'] ?? 0), 0),
  };
}

/**
 * A context with the run's refusal guard, wired the way `RunExecutor` wires
 * it: its stop aborts the run with the stop as the reason (plan 0215).
 */
function guardedContext(controller = new AbortController()): RunContext {
  const ctx = context(controller.signal);
  const guard = new SourceGuard(CARREFOUR_REFUSAL_POLICY, {
    onStop: (stop) => controller.abort(new SourceBlockedError(stop)),
  });
  return Object.assign(ctx, {
    guard,
    acquire: () => guard.admit(controller.signal),
  });
}

const source = (config: Record<string, unknown> = {}): SupermarketSource =>
  ({ adapterKey: 'carrefour-web', config, workers: 1 }) as SupermarketSource;

describe('CarrefourCatalogRunner', () => {
  // A recording report and nothing else: the runner fetches and reports, so
  // there is no ingest to fake here any more (plan 0103, section 9).
  let report: RecordingRunReport;

  beforeEach(() => {
    report = new RecordingRunReport();
  });

  it('pages the frontier and writes a row and a price for every card', async () => {
    const states = {
      '/supermercado/la-despensa/cat20001/c': page({
        firstLevel: [link('cat1', 'Bebidas')],
      }),
      [link('cat1', 'Bebidas').url]: page({
        totalResults: 2,
        cards: [card('p1', 'Agua CARREFOUR 1,5 l.', '0,39 €')],
        displayName: 'Bebidas',
      }),
      '/supermercado/x/cat1/c?offset=0': page({
        totalResults: 2,
        cards: [
          card('p1', 'Agua CARREFOUR 1,5 l.', '0,39 €'),
          card('p2', 'Cola CARREFOUR 33 cl.', '0,35 €'),
        ],
      }),
    };
    const runner = new TestRunner(states);

    await runner.run(
      context(),
      report,
      { supermarketId: CHAIN, priceScopeId: SCOPE },
      source()
    );

    // What observed the price and which scope it falls to are the run's, not
    // the runner's, since plan 0103: a runner reports and holds nothing.
    expect(report.products).toHaveLength(2);
    expect(report.products[0]).toMatchObject({
      externalId: 'p1',
      name: 'Agua CARREFOUR',
      sizeFormat: '1,5 l.',
      unitSize: 1.5,
      sizeUnit: 'LITER',
      // The listing card carries none. The backfill is what fills it.
      ean: null,
      // The card's own photo address, verbatim (plan 0198).
      imageUrl: 'https://static.carrefour.es/hd_350x_/img_pim_food/p1_00_1.jpg',
      categoryPath: ['Bebidas'],
      // One price, naming no scope of its own: Carrefour publishes one price
      // for the whole site, so it falls to the scope the run was started with.
      prices: [
        expect.objectContaining({
          scopeKey: null,
          price: 0.39,
          currency: 'EUR',
          unitPriceLabel: '€/l',
        }),
      ],
    });
  });

  describe('a whole crawl behind the chain switch (plan 0220, section 15.4)', () => {
    /** The clean crawl of the first case: one frontier category, two cards. */
    const clean = () => ({
      '/supermercado/la-despensa/cat20001/c': page({
        firstLevel: [link('cat1', 'Bebidas')],
      }),
      [link('cat1', 'Bebidas').url]: page({ totalResults: 2 }),
      '/supermercado/x/cat1/c?offset=0': page({
        totalResults: 2,
        cards: [
          card('p1', 'Agua CARREFOUR 1,5 l.', '0,39 €'),
          card('p2', 'Cola CARREFOUR 33 cl.', '0,35 €'),
        ],
      }),
    });
    const crawl = (
      states: Record<string, Record<string, unknown>>,
      config: Record<string, unknown>
    ) =>
      new TestRunner(states)
        .run(
          context(),
          report,
          { supermarketId: CHAIN, priceScopeId: SCOPE },
          source(config)
        )
        .catch(() => undefined);

    it('declares nothing while the switch is off, and says so', async () => {
      await crawl(clean(), {});

      expect(report.wholeListings).toEqual([]);
      expect(report.notWhole).toEqual([
        { scopeKey: null, reason: 'switch-off', detail: [], listed: null },
      ]);
    });

    it('declares the default scope whole with the switch on and a clean crawl', async () => {
      await crawl(clean(), { delistCountsCrawl: true });

      expect(report.wholeListings).toEqual([
        { scopeKey: null, listed: ['p1', 'p2'] },
      ]);
      expect(report.notWhole).toEqual([]);
    });

    it('reads only a JSON true as the switch', async () => {
      await crawl(clean(), { delistCountsCrawl: 'true' });

      expect(report.wholeListings).toEqual([]);
      expect(report.notWhole[0].reason).toBe('switch-off');
    });

    it('declares nothing for a crawl a seed path narrowed', async () => {
      await crawl(
        {
          ...clean(),
          '/seed': page({ firstLevel: [link('cat1', 'Bebidas')] }),
        },
        { delistCountsCrawl: true, seedPath: '/seed' }
      );

      expect(report.wholeListings).toEqual([]);
      expect(report.notWhole[0].reason).toBe('seed-path');
    });

    it('declares nothing for a crawl with a category capped at the ceiling', async () => {
      const capped = link('cat2', 'Limpieza');
      await crawl(
        {
          ...clean(),
          '/supermercado/la-despensa/cat20001/c': page({
            firstLevel: [link('cat1', 'Bebidas'), capped],
          }),
          [capped.url]: page({ totalResults: 2000 }),
        },
        { delistCountsCrawl: true }
      );

      expect(report.wholeListings).toEqual([]);
      expect(report.notWhole[0].reason).toBe('truncated');
    });

    it('declares nothing for a crawl with an unreadable category', async () => {
      await crawl(
        {
          ...clean(),
          '/supermercado/la-despensa/cat20001/c': page({
            firstLevel: [link('cat1', 'Bebidas'), link('cat3', 'Gone')],
          }),
        },
        { delistCountsCrawl: true }
      );

      expect(report.wholeListings).toEqual([]);
      expect(report.notWhole[0].reason).toBe('unreadable');
    });

    it('declares nothing for a blocked crawl', async () => {
      // Three categories refused in a row on their first page of results is
      // the block, as in the case further down.
      const refused = ['cat2', 'cat3', 'cat4'].map((id, n) =>
        link(id, `Refused ${n}`)
      );
      const states: Record<string, Record<string, unknown>> = {
        ...clean(),
        '/supermercado/la-despensa/cat20001/c': page({
          firstLevel: [link('cat1', 'Bebidas'), ...refused],
        }),
      };
      for (const category of refused) {
        states[category.url] = page({ totalResults: 500 });
      }
      await new BlockingRunner(states)
        .run(
          context(),
          report,
          { supermarketId: CHAIN, priceScopeId: SCOPE },
          source({ delistCountsCrawl: true })
        )
        .catch(() => undefined);

      expect(report.wholeListings).toEqual([]);
      expect(report.notWhole[0]?.reason).toBe('blocked');
    });
  });

  it('counts progress in listings, the unit it plans in, and the ingest adds nothing (plan 0217)', async () => {
    const states = {
      '/supermercado/la-despensa/cat20001/c': page({
        firstLevel: [link('cat1', 'Bebidas')],
      }),
      [link('cat1', 'Bebidas').url]: page({ totalResults: 2 }),
      '/supermercado/x/cat1/c?offset=0': page({
        totalResults: 2,
        cards: [
          card('p1', 'Agua CARREFOUR 1,5 l.', '0,39 €'),
          card('p2', 'Cola CARREFOUR 33 cl.', '0,35 €'),
        ],
      }),
    };
    const counting = countingContext();

    await new TestRunner(states).run(
      counting.context,
      report,
      { supermarketId: CHAIN, priceScopeId: SCOPE },
      source()
    );
    // What the ingest does with each product it is handed.
    await counting.context.advance(report.products.length);
    await counting.context.flush();

    expect(counting.planned()).toBe(2);
    expect(counting.processed()).toBe(2);
  });

  it('reports a centilitre as millilitres and a dimension as no pack (plans 0177, 0183)', async () => {
    const states = {
      '/supermercado/la-despensa/cat20001/c': page({
        firstLevel: [link('cat1', 'Bebidas')],
      }),
      [link('cat1', 'Bebidas').url]: page({ totalResults: 4 }),
      '/supermercado/x/cat1/c?offset=0': page({
        totalResults: 4,
        cards: [
          card('p2', 'Cola CARREFOUR 33 cl.', '0,35 €'),
          card('p3', 'Cerveza MAHOU 6x33 cl', '4,20 €'),
          card('p4', 'Funda nórdica CARREFOUR 140x200 cm', '19,90 €', {
            measure_unit: 'm',
          }),
          card('p5', 'Agua CARREFOUR 1,5 l.', '0,39 €'),
        ],
      }),
    };

    await new TestRunner(states).run(
      context(),
      report,
      { supermarketId: CHAIN, priceScopeId: SCOPE },
      source()
    );

    const byId = new Map(
      report.products.map((product) => [product.externalId, product])
    );
    // The catalog holds no centilitre. The printed text and the id are the
    // row's key and stay exactly as the chain wrote them.
    expect(byId.get('p2')).toMatchObject({
      externalId: 'p2',
      name: 'Cola CARREFOUR',
      sizeFormat: '33 cl.',
      unitSize: 330,
      sizeUnit: 'MILLILITER',
      packCount: null,
      prices: [
        // Verbatim: what the card printed, in what the card measures in.
        expect.objectContaining({
          price: 0.35,
          unitPrice: 0.35,
          unitPriceLabel: '€/l',
        }),
      ],
    });
    expect(byId.get('p3')).toMatchObject({
      sizeFormat: '6x33 cl',
      packCount: 6,
    });
    // The two sides of one cover, and not a pack of 140.
    expect(byId.get('p4')).toMatchObject({
      name: 'Funda nórdica CARREFOUR',
      sizeFormat: '140x200 cm',
      unitSize: null,
      sizeUnit: null,
      packCount: null,
    });
    expect(byId.get('p5')).toMatchObject({
      sizeFormat: '1,5 l.',
      unitSize: 1.5,
      sizeUnit: 'LITER',
    });
  });

  it('writes an entry and no price row for a card that printed no price', async () => {
    // Some products are priced by weight and print no figure. Writing a zero
    // there is a lie about a real product (plan 0090, section 12).
    const states = {
      '/supermercado/la-despensa/cat20001/c': page({
        firstLevel: [link('cat1', 'Frescos')],
      }),
      [link('cat1', 'Frescos').url]: page({ totalResults: 1 }),
      '/supermercado/x/cat1/c?offset=0': page({
        totalResults: 1,
        cards: [card('p9', 'Merluza fresca', undefined)],
      }),
    };
    await new TestRunner(states).run(
      context(),
      report,
      { supermarketId: CHAIN, priceScopeId: SCOPE },
      source()
    );

    expect(report.products).toHaveLength(1);
    expect(report.products[0]).toMatchObject({
      externalId: 'p9',
      prices: [],
    });
  });

  it('descends only past the ceiling, and never below the node that fits', async () => {
    const parent = link('cat20001', 'Despensa');
    const child = link('cat20009', 'Alimentacion');
    const grandchild = link('cat20010', 'Pasta');
    const states = {
      '/seed': page({ firstLevel: [parent] }),
      [parent.url]: page({ totalResults: 6339, children: [child] }),
      // Under the ceiling, so its own children are never opened, which is what
      // keeps six products in seven (plan 0090, section 7.1).
      [child.url]: page({ totalResults: 800, children: [grandchild] }),
      '/supermercado/x/cat20009/c?offset=0': page({ totalResults: 1 }),
    };
    const runner = new TestRunner(states);

    await runner.run(
      context(),
      report,
      { supermarketId: CHAIN, priceScopeId: SCOPE },
      source({ seedPath: '/seed' })
    );

    expect(runner.asked).not.toContain(grandchild.url);
    expect(runner.asked).toContain('/supermercado/x/cat20009/c?offset=0');
  });

  it('names a category the ceiling truncated in the run report', async () => {
    const orphan = link('cat9999', 'Vinos');
    const states = {
      '/seed': page({ firstLevel: [orphan] }),
      [orphan.url]: page({ totalResults: 2000, children: [] }),
    };
    const runContext = context();
    await new TestRunner(states).run(
      runContext,
      report,
      { supermarketId: CHAIN, priceScopeId: SCOPE },
      source({ seedPath: '/seed' })
    );

    expect(runContext.setReport).toHaveBeenCalledWith(
      expect.objectContaining({
        truncatedCategories: [
          expect.objectContaining({ id: 'cat9999', totalResults: 2000 }),
        ],
      })
    );
  });

  it('stops the crawl when the refusals stop being isolated, and keeps what it read', async () => {
    // The block is the one failure a category may not swallow. What it costs is
    // the rest of the crawl, never the part that worked: prices already fetched
    // are valid data (plan 0038, section 6.6).
    const good = link('cat1', 'Bebidas');
    const refused = ['cat2', 'cat3', 'cat4'].map((id, n) =>
      link(id, `Refused ${n}`)
    );
    const states: Record<string, Record<string, unknown>> = {
      '/seed': page({ firstLevel: [good, ...refused] }),
      [good.url]: page({ totalResults: 1 }),
      '/supermercado/x/cat1/c?offset=0': page({
        totalResults: 1,
        cards: [card('p1', 'Agua CARREFOUR 1,5 l.', '0,39 €')],
      }),
    };
    // Each is found by the walk and then refused on its first page of results.
    // Three refusals with no page answering between them is the escalation
    // signature, and the third is what stops the crawl.
    for (const category of refused) {
      states[category.url] = page({ totalResults: 500 });
    }
    const runner = new BlockingRunner(states);
    const runContext = guardedContext();

    // The guard's stop aborted the run, and the runner returns after the
    // snapshot: the executor ends it FAILED with the stop as its reason (plan
    // 0215, section 6.2).
    await runner.run(
      runContext,
      report,
      { supermarketId: CHAIN, priceScopeId: SCOPE },
      source({ seedPath: '/seed' })
    );

    expect(runContext.guard?.stop).not.toBeNull();
    expect(runContext.signal.aborted).toBe(true);
    // The one product the crawl did read is reported.
    expect(report.products).toHaveLength(1);
    expect(runContext.setReport).toHaveBeenCalledWith(
      expect.objectContaining({
        blockedAfter: expect.stringMatching(/refused/),
      })
    );
    // Nothing was loaded after the third refusal.
    expect(
      runner.asked.filter((path) => path.includes('?offset=0'))
    ).toHaveLength(4);
  });

  describe('a category refused once (plan 0251)', () => {
    const good = link('cat1', 'Bebidas');
    const pastas = link('cat2', 'Pastas');
    const between = link('cat4', 'Lácteos');
    const caldos = link('cat3', 'Caldos');
    const last = link('cat5', 'Aceites');
    const states = (): Record<string, Record<string, unknown>> => ({
      '/seed': page({ firstLevel: [good, pastas, between, caldos, last] }),
      [good.url]: page({ totalResults: 1 }),
      [pastas.url]: page({ totalResults: 30 }),
      [between.url]: page({ totalResults: 1 }),
      [caldos.url]: page({ totalResults: 1 }),
      [last.url]: page({ totalResults: 1 }),
      '/supermercado/x/cat1/c?offset=0': page({
        totalResults: 1,
        cards: [card('p1', 'Agua CARREFOUR 1,5 l.', '0,39 €')],
      }),
      // Two pages: the first answers, the second is refused.
      '/supermercado/x/cat2/c?offset=0': page({
        totalResults: 30,
        cards: [card('p2', 'Macarrones CARREFOUR 500 g', '0,79 €')],
      }),
      '/supermercado/x/cat2/c?offset=24': page({
        totalResults: 30,
        cards: [card('p3', 'Espaguetis CARREFOUR 500 g', '0,79 €')],
      }),
      '/supermercado/x/cat4/c?offset=0': page({
        totalResults: 1,
        cards: [card('p4', 'Leche CARREFOUR 1 l.', '0,89 €')],
      }),
      '/supermercado/x/cat3/c?offset=0': page({
        totalResults: 1,
        cards: [card('p5', 'Caldo CARREFOUR 1 l.', '1,09 €')],
      }),
      '/supermercado/x/cat5/c?offset=0': page({
        totalResults: 1,
        cards: [card('p6', 'Aceite CARREFOUR 1 l.', '4,99 €')],
      }),
    });

    /** The paged reads a crawl asked for, in order, without the tree walk. */
    const offsets = (runner: TestRunner): string[] =>
      runner.asked.filter((path) => path.includes('?offset='));

    const pastasWarning = (again: boolean) => ({
      code: HarvestWarningCode.LISTING_UNREAD,
      name: 'Pastas',
      offerId: null,
      page: null,
      message:
        `Category cat2 Pastas: Carrefour answered 403 at offset 24` +
        `${again ? ', once more at the end of the run' : ''}. The listings ` +
        `from there on, of 30, were not read.`,
    });

    const caldosWarning = (again: boolean) => ({
      code: HarvestWarningCode.LISTING_UNREAD,
      name: 'Caldos',
      offerId: null,
      page: null,
      message:
        `Category cat3 Caldos: Carrefour answered 403 at offset 0` +
        `${again ? ', once more at the end of the run' : ''}. The listings ` +
        `from there on, of 1, were not read.`,
    });

    async function crawl(
      refusals: Record<string, number>,
      options: {
        seed?: Array<ReturnType<typeof link>>;
        abortAfter?: string;
      } = {}
    ) {
      const pages = states();
      if (options.seed) {
        pages['/seed'] = page({ firstLevel: options.seed });
      }
      const runner = new RefusingRunner(pages, refusals);
      const controller = new AbortController();
      const runContext = guardedContext(controller);
      if (options.abortAfter) {
        const after = options.abortAfter;
        (runContext.report as jest.Mock).mockImplementation(async () => {
          if (runner.asked.includes(after)) {
            controller.abort();
          }
        });
      }
      await runner.run(
        runContext,
        report,
        { supermarketId: CHAIN, priceScopeId: SCOPE },
        source({ seedPath: '/seed' })
      );
      return { runner, runContext };
    }

    it('asks once more at the end, from the page that failed, and keeps what it reads', async () => {
      // Pastas is refused once on its second page, Caldos on both asks. A
      // good page answers after each, so the walk ends on no refusal.
      const { runner, runContext } = await crawl({
        '/supermercado/x/cat2/c?offset=24': 1,
        '/supermercado/x/cat3/c?offset=0': 2,
      });

      expect(runContext.signal.aborted).toBe(false);
      expect(
        report.products.map((product) => product.externalId).sort()
      ).toEqual(['p1', 'p2', 'p3', 'p4', 'p6']);
      // After every other category, in the order they failed, and never
      // inside the paging loop: each refused page is asked exactly twice,
      // the second time after the last category's first ask.
      expect(offsets(runner)).toEqual([
        '/supermercado/x/cat1/c?offset=0',
        '/supermercado/x/cat2/c?offset=0',
        '/supermercado/x/cat2/c?offset=24',
        '/supermercado/x/cat4/c?offset=0',
        '/supermercado/x/cat3/c?offset=0',
        '/supermercado/x/cat5/c?offset=0',
        '/supermercado/x/cat2/c?offset=24',
        '/supermercado/x/cat3/c?offset=0',
      ]);
      expect(runContext.setReport).toHaveBeenCalledWith(
        expect.objectContaining({
          unreadableCategories: [caldos.url],
          askedAgain: [
            { id: 'cat2', name: 'Pastas', read: true },
            { id: 'cat3', name: 'Caldos', read: false },
          ],
        })
      );
    });

    it('leaves one LISTING_UNREAD for the category refused twice, and none for the one read', async () => {
      const { runContext } = await crawl({
        '/supermercado/x/cat2/c?offset=24': 1,
        '/supermercado/x/cat3/c?offset=0': 2,
      });

      expect(runContext.warn).toHaveBeenCalledTimes(1);
      expect(runContext.warn).toHaveBeenCalledWith(caldosWarning(true));
      // Before the last flush, which is what writes it onto the row.
      expect(
        (runContext.warn as jest.Mock).mock.invocationCallOrder[0]
      ).toBeLessThan(
        Math.max(...(runContext.flush as jest.Mock).mock.invocationCallOrder)
      );
      // The run is not stopped, so it ends COMPLETED with the warning.
      expect(runContext.guard?.stop).toBeNull();
    });

    it('stops the pass at its first refusal, and every category keeps its warning and the run COMPLETED', async () => {
      // Pastas is refused on both asks. Caldos would answer the second time,
      // and is never asked: the pass ends at the refusal before it.
      const { runner, runContext } = await crawl({
        '/supermercado/x/cat2/c?offset=24': 2,
        '/supermercado/x/cat3/c?offset=0': 1,
      });

      expect(offsets(runner).slice(-2)).toEqual([
        '/supermercado/x/cat5/c?offset=0',
        '/supermercado/x/cat2/c?offset=24',
      ]);
      expect(runContext.warn).toHaveBeenCalledTimes(2);
      expect(runContext.warn).toHaveBeenCalledWith(pastasWarning(true));
      expect(runContext.warn).toHaveBeenCalledWith(caldosWarning(false));
      expect(runContext.setReport).toHaveBeenCalledWith(
        expect.objectContaining({
          unreadableCategories: [pastas.url, caldos.url],
          askedAgain: [{ id: 'cat2', name: 'Pastas', read: false }],
          blockedAfter: null,
        })
      );
      // Not stopped and not aborted: the executor ends it COMPLETED.
      expect(runContext.guard?.stop).toBeNull();
      expect(runContext.signal.aborted).toBe(false);
    });

    it('skips the pass when the walk ended on a refusal', async () => {
      // Caldos is the last category, so the walk hands the pass a guard that
      // counts one refusal in a row.
      const { runner, runContext } = await crawl(
        {
          '/supermercado/x/cat2/c?offset=24': 1,
          '/supermercado/x/cat3/c?offset=0': 1,
        },
        { seed: [good, pastas, between, caldos] }
      );

      expect(offsets(runner)).toEqual([
        '/supermercado/x/cat1/c?offset=0',
        '/supermercado/x/cat2/c?offset=0',
        '/supermercado/x/cat2/c?offset=24',
        '/supermercado/x/cat4/c?offset=0',
        '/supermercado/x/cat3/c?offset=0',
      ]);
      expect(runContext.warn).toHaveBeenCalledTimes(2);
      expect(runContext.warn).toHaveBeenCalledWith(pastasWarning(false));
      expect(runContext.warn).toHaveBeenCalledWith(caldosWarning(false));
      expect(runContext.setReport).toHaveBeenCalledWith(
        expect.objectContaining({ askedAgain: [] })
      );
      expect(runContext.guard?.stop).toBeNull();
    });

    it('skips the pass after an abort', async () => {
      const { runner } = await crawl(
        { '/supermercado/x/cat2/c?offset=24': 1 },
        { abortAfter: '/supermercado/x/cat4/c?offset=0' }
      );

      expect(offsets(runner)).toEqual([
        '/supermercado/x/cat1/c?offset=0',
        '/supermercado/x/cat2/c?offset=0',
        '/supermercado/x/cat2/c?offset=24',
        '/supermercado/x/cat4/c?offset=0',
      ]);
    });
  });

  it('writes no listing warning when the walk is aborted', async () => {
    const one = link('cat1', 'Bebidas');
    const two = link('cat2', 'Lácteos');
    const controller = new AbortController();
    // A node the tree walk cannot open, and a category the abort leaves
    // unread: either would warn on a run that was not aborted.
    const runner = new TestRunner({
      '/seed': page({ firstLevel: [one, link('cat3', 'Gone'), two] }),
      [one.url]: page({ totalResults: 1 }),
      [two.url]: page({ totalResults: 1 }),
      '/supermercado/x/cat1/c?offset=0': page({
        totalResults: 1,
        cards: [card('p1', 'Agua CARREFOUR 1,5 l.', '0,39 €')],
      }),
      '/supermercado/x/cat2/c?offset=0': page({
        totalResults: 1,
        cards: [card('p2', 'Leche CARREFOUR 1 l.', '0,89 €')],
      }),
    });
    const runContext = context(controller.signal);
    (runContext.report as jest.Mock).mockImplementation(async () => {
      if (runner.asked.includes('/supermercado/x/cat1/c?offset=0')) {
        controller.abort();
      }
    });

    await runner.run(
      runContext,
      report,
      { supermarketId: CHAIN, priceScopeId: SCOPE },
      source({ seedPath: '/seed' })
    );

    expect(runContext.signal.aborted).toBe(true);
    expect(runContext.warn).not.toHaveBeenCalled();
  });

  it('names a node the tree walk could not open with LISTING_UNREAD', async () => {
    const runContext = context();
    await new TestRunner({
      '/seed': page({
        firstLevel: [link('cat1', 'Bebidas'), link('cat3', 'Gone')],
      }),
      [link('cat1', 'Bebidas').url]: page({ totalResults: 0 }),
    }).run(
      runContext,
      report,
      { supermarketId: CHAIN, priceScopeId: SCOPE },
      source({ seedPath: '/seed' })
    );

    expect(runContext.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: HarvestWarningCode.LISTING_UNREAD,
        name: link('cat3', 'Gone').url,
      })
    );
  });

  it('keeps what it read when a person aborts the crawl', async () => {
    const one = link('cat1', 'Bebidas');
    const two = link('cat2', 'Lácteos');
    const controller = new AbortController();
    const runner = new TestRunner({
      '/seed': page({ firstLevel: [one, two] }),
      [one.url]: page({ totalResults: 1 }),
      [two.url]: page({ totalResults: 1 }),
      '/supermercado/x/cat1/c?offset=0': page({
        totalResults: 1,
        cards: [card('p1', 'Agua CARREFOUR 1,5 l.', '0,39 €')],
      }),
      '/supermercado/x/cat2/c?offset=0': page({
        totalResults: 1,
        cards: [card('p2', 'Leche CARREFOUR 1 l.', '0,89 €')],
      }),
    });
    const runContext = context(controller.signal);
    // The person aborts once the first category's page is read.
    (runContext.report as jest.Mock).mockImplementation(async () => {
      if (runner.asked.includes('/supermercado/x/cat1/c?offset=0')) {
        controller.abort();
      }
    });

    await runner.run(
      runContext,
      report,
      { supermarketId: CHAIN, priceScopeId: SCOPE },
      source({ seedPath: '/seed' })
    );

    expect(report.products.map((product) => product.externalId)).toEqual([
      'p1',
    ]);
  });

  it('refuses a crawl that has nowhere to write its prices', async () => {
    await expect(
      new TestRunner({}).run(
        context(),
        report,
        { supermarketId: CHAIN },
        source()
      )
    ).rejects.toThrow(/price scope/);
  });

  it('deduplicates a product two frontier categories both list', async () => {
    const a = link('cat1', 'Bebidas');
    const b = link('cat2', 'Ofertas');
    const shared = card('p1', 'Agua CARREFOUR 1,5 l.', '0,39 €');
    const states = {
      '/seed': page({ firstLevel: [a, b] }),
      [a.url]: page({ totalResults: 1 }),
      [b.url]: page({ totalResults: 1 }),
      '/supermercado/x/cat1/c?offset=0': page({
        totalResults: 1,
        cards: [shared],
      }),
      '/supermercado/x/cat2/c?offset=0': page({
        totalResults: 1,
        cards: [shared],
      }),
    };
    await new TestRunner(states).run(
      context(),
      report,
      { supermarketId: CHAIN, priceScopeId: SCOPE },
      source({ seedPath: '/seed' })
    );

    // 17,135 counts category memberships and not distinct products. The first
    // sighting is the one kept, category path and all.
    expect(report.products).toHaveLength(1);
    expect(report.products[0].categoryPath).toEqual(['Bebidas']);
  });

  describe('a walk reports what it has read as it goes (plan 0267)', () => {
    const one = link('cat1', 'Bebidas');
    const two = link('cat2', 'Ofertas');
    const shared = card('p1', 'Agua CARREFOUR 1,5 l.', '0,39 €');
    /** Two frontier categories under the default seed, sharing one product. */
    const states = () => ({
      '/supermercado/la-despensa/cat20001/c': page({ firstLevel: [one, two] }),
      [one.url]: page({ totalResults: 2 }),
      [two.url]: page({ totalResults: 2 }),
      '/supermercado/x/cat1/c?offset=0': page({
        totalResults: 2,
        cards: [shared, card('p2', 'Cola CARREFOUR 33 cl.', '0,35 €')],
      }),
      '/supermercado/x/cat2/c?offset=0': page({
        totalResults: 2,
        cards: [shared, card('p3', 'Leche CARREFOUR 1 l.', '0,89 €')],
      }),
    });

    /**
     * A recording report that notes, for each product, how many pages the
     * walk had asked for and which stages it had set when the product came.
     */
    function watchedReport(runner: TestRunner, runContext: RunContext) {
      const at: Record<string, { asked: number; stages: string[] }> = {};
      const product = report.product.bind(report);
      report.product = (observation) => {
        at[observation.externalId] = {
          asked: runner.asked.length,
          stages: (runContext.setStage as jest.Mock).mock.calls.map(
            ([stage]) => stage as string
          ),
        };
        product(observation);
      };
      return at;
    }

    it('reports each product once, at its first sighting, before the end of the walk', async () => {
      const runner = new TestRunner(states());
      const runContext = context();
      const at = watchedReport(runner, runContext);

      await runner.run(
        runContext,
        report,
        { supermarketId: CHAIN, priceScopeId: SCOPE },
        source({ delistCountsCrawl: true })
      );

      expect(report.products.map((product) => product.externalId)).toEqual([
        'p1',
        'p2',
        'p3',
      ]);
      // The first sighting keeps its category path, as it did at the end.
      expect(report.products[0].categoryPath).toEqual(['Bebidas']);
      const secondPage = runner.asked.indexOf(
        '/supermercado/x/cat2/c?offset=0'
      );
      // p1 and p2 came while the first category was paged, before the second
      // category's page was asked for.
      expect(at['p1'].asked).toBeLessThanOrEqual(secondPage);
      expect(at['p2'].asked).toBeLessThanOrEqual(secondPage);
      // None of them waited for the end of the walk.
      for (const id of ['p1', 'p2', 'p3']) {
        expect(at[id].stages).toEqual(['FRONTIER', 'ENUMERATE']);
      }
      // The whole listing is still decided at the end, from every id read.
      expect(report.wholeListings).toEqual([
        { scopeKey: null, listed: ['p1', 'p2', 'p3'] },
      ]);
    });

    it('has reported what it read while the walk is still going, and has declared no listing', async () => {
      let reached!: () => void;
      const stalled = new Promise<void>((resolve) => (reached = resolve));
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      /** A walk that stops answering on the second category, as a dying pod. */
      class StallingRunner extends TestRunner {
        protected override createClient(): CarrefourClient {
          return new CarrefourClient({
            userAgent: 'LunaShopperBot/1.0',
            sleepImpl: async () => undefined,
            openSession: async () => ({
              goto: async (url: string) => {
                const path = url.replace('https://www.carrefour.es', '');
                this.asked.push(path);
                if (path === '/supermercado/x/cat2/c?offset=0') {
                  reached();
                  await released;
                  throw new Error('The browser stopped answering.');
                }
                const state = this.states[path];
                return state
                  ? { status: 200, state }
                  : { status: 404, state: null };
              },
              close: async () => undefined,
            }),
          });
        }
      }
      const runner = new StallingRunner(states());
      const runContext = context();

      const run = runner.run(
        runContext,
        report,
        { supermarketId: CHAIN, priceScopeId: SCOPE },
        source({ delistCountsCrawl: true })
      );
      await stalled;

      // Half way: the first category's products are with the sink, and
      // nothing whole was declared, so a walk that dies here states no
      // negative and keeps every row it had reported.
      expect(report.products.map((product) => product.externalId)).toEqual([
        'p1',
        'p2',
      ]);
      expect(report.wholeListings).toEqual([]);
      expect(report.notWhole).toEqual([]);
      expect(runContext.setReport).not.toHaveBeenCalled();

      release();
      await run;
      // The category that did not answer makes the crawl not whole, and the
      // products are not reported a second time at the end.
      expect(report.products).toHaveLength(2);
      expect(report.wholeListings).toEqual([]);
      expect(report.notWhole).toEqual([
        expect.objectContaining({ scopeKey: null, reason: 'unreadable' }),
      ]);
    });

    it('reports what the end pass reads as it reads it, and nothing twice', async () => {
      const runner = new RefusingRunner(states(), {
        '/supermercado/x/cat2/c?offset=0': 1,
      });
      const runContext = context();
      const at = watchedReport(runner, runContext);

      await runner.run(
        runContext,
        report,
        { supermarketId: CHAIN, priceScopeId: SCOPE },
        source({ delistCountsCrawl: true })
      );

      expect(report.products.map((product) => product.externalId)).toEqual([
        'p1',
        'p2',
        'p3',
      ]);
      // p3 came from the end pass, which runs under ENUMERATE too.
      expect(at['p3'].stages).toEqual(['FRONTIER', 'ENUMERATE', 'ENUMERATE']);
    });

    it('stops before the next page when its first chunk fails to write (plan 0269)', async () => {
      // Two pages in the first category and one in the second, so a walk that
      // missed the stop would ask for two more pages.
      const pages = {
        ...states(),
        [one.url]: page({ totalResults: 30 }),
        '/supermercado/x/cat1/c?offset=0': page({
          totalResults: 30,
          cards: [shared, card('p2', 'Cola CARREFOUR 33 cl.', '0,35 €')],
        }),
        '/supermercado/x/cat1/c?offset=24': page({
          totalResults: 30,
          cards: [card('p4', 'Zumo CARREFOUR 1 l.', '0,99 €')],
        }),
      };
      /** The runtime's wiring: the client reads the run's signal. */
      class SignalledRunner extends TestRunner {
        protected override createClient(ctx: RunContext): CarrefourClient {
          return new CarrefourClient({
            userAgent: 'LunaShopperBot/1.0',
            sleepImpl: async () => undefined,
            signal: ctx.signal,
            openSession: async () => ({
              goto: async (url: string) => {
                const path = url.replace('https://www.carrefour.es', '');
                this.asked.push(path);
                const state = this.states[path];
                return state
                  ? { status: 200, state }
                  : { status: 404, state: null };
              },
              close: async () => undefined,
            }),
          });
        }
      }
      const controller = new AbortController();
      const failing = new FailingRunReport(controller);
      const runner = new SignalledRunner(pages);
      const runContext = context(controller.signal);

      await runner.run(
        runContext,
        failing,
        { supermarketId: CHAIN, priceScopeId: SCOPE },
        source({ delistCountsCrawl: true })
      );

      // The executor's abort reached the walk through the signal it reads.
      expect(controller.signal.reason).toBeInstanceOf(ReportWriteFailedError);
      // No page was asked after the one whose product failed to write.
      expect(runner.asked).toContain('/supermercado/x/cat1/c?offset=0');
      expect(runner.asked).not.toContain('/supermercado/x/cat1/c?offset=24');
      expect(runner.asked).not.toContain('/supermercado/x/cat2/c?offset=0');
      // Nothing that needs the whole walk is stated for a stopped one.
      expect(failing.wholeListings).toEqual([]);
      expect(failing.notWhole).toEqual([]);
      expect(runContext.warn).not.toHaveBeenCalled();
    });
  });

  describe('every path a product is filed under (plan 0268)', () => {
    const one = link('cat1', 'Bebidas');
    const two = link('cat2', 'Ofertas');
    const shared = card('p1', 'Agua CARREFOUR 1,5 l.', '0,39 €');
    /** Two frontier categories under the default seed, sharing one product. */
    const states = () => ({
      '/supermercado/la-despensa/cat20001/c': page({ firstLevel: [one, two] }),
      [one.url]: page({ totalResults: 2 }),
      [two.url]: page({ totalResults: 2 }),
      '/supermercado/x/cat1/c?offset=0': page({
        totalResults: 2,
        cards: [shared, card('p2', 'Cola CARREFOUR 33 cl.', '0,35 €')],
      }),
      // p1 twice on one page: one category is one path.
      '/supermercado/x/cat2/c?offset=0': page({
        totalResults: 3,
        cards: [shared, shared, card('p3', 'Leche CARREFOUR 1 l.', '0,89 €')],
      }),
    });
    const crawl = (
      runner: TestRunner,
      runContext: RunContext,
      config: Record<string, unknown>
    ) =>
      runner.run(
        runContext,
        report,
        { supermarketId: CHAIN, priceScopeId: SCOPE },
        source(config)
      );
    const callOf = (externalId: string) =>
      report.categoryPathCalls.find((call) => call.externalId === externalId);

    it('gives a product met in two categories both, in walk order, and replaces on a whole crawl', async () => {
      await crawl(new TestRunner(states()), context(), {
        delistCountsCrawl: true,
      });

      expect(report.wholeListings).toHaveLength(1);
      expect(callOf('p1')).toEqual({
        externalId: 'p1',
        paths: [['Bebidas'], ['Ofertas']],
        mode: 'REPLACE',
      });
      // The first path is the one `categoryPath` holds, which is unchanged.
      expect(report.products[0].categoryPath).toEqual(['Bebidas']);
      expect(callOf('p1')?.paths[0]).toEqual(report.products[0].categoryPath);
      // A product of one category gets that one path.
      expect(callOf('p3')).toEqual({
        externalId: 'p3',
        paths: [['Ofertas']],
        mode: 'REPLACE',
      });
      // One call a product, in the order the walk first met them.
      expect(report.categoryPathCalls.map((call) => call.externalId)).toEqual([
        'p1',
        'p2',
        'p3',
      ]);
    });

    it('adds when the crawl is not declared whole', async () => {
      // The switch is off, so the crawl declares nothing and proves no path
      // gone.
      await crawl(new TestRunner(states()), context(), {});

      expect(report.notWhole[0].reason).toBe('switch-off');
      expect(callOf('p1')).toEqual({
        externalId: 'p1',
        paths: [['Bebidas'], ['Ofertas']],
        mode: 'ADD',
      });
      expect(
        report.categoryPathCalls.every((call) => call.mode === 'ADD')
      ).toBe(true);
    });

    it('keeps the path the end pass reads, and replaces once that pass read the refused category', async () => {
      // Ofertas is refused once and read whole by the end pass, so every
      // frontier category was paged after all and the crawl is whole.
      const runner = new RefusingRunner(states(), {
        '/supermercado/x/cat2/c?offset=0': 1,
      });
      await crawl(runner, context(), { delistCountsCrawl: true });

      expect(report.wholeListings).toHaveLength(1);
      expect(callOf('p1')).toEqual({
        externalId: 'p1',
        paths: [['Bebidas'], ['Ofertas']],
        mode: 'REPLACE',
      });
      expect(callOf('p3')?.paths).toEqual([['Ofertas']]);
    });

    it('adds when a category stays unread', async () => {
      // Ofertas is refused on both asks, so a category the crawl did not read
      // may list p1 and p2 too.
      const runner = new RefusingRunner(states(), {
        '/supermercado/x/cat2/c?offset=0': 2,
      });
      await crawl(runner, context(), { delistCountsCrawl: true });

      expect(report.notWhole[0].reason).toBe('unreadable');
      expect(report.categoryPathCalls).toEqual([
        { externalId: 'p1', paths: [['Bebidas']], mode: 'ADD' },
        { externalId: 'p2', paths: [['Bebidas']], mode: 'ADD' },
      ]);
    });

    it('adds for every product of an aborted crawl, and never replaces', async () => {
      const runner = new TestRunner(states());
      const controller = new AbortController();
      const runContext = context(controller.signal);
      (runContext.report as jest.Mock).mockImplementation(async () => {
        if (runner.asked.includes('/supermercado/x/cat1/c?offset=0')) {
          controller.abort();
        }
      });

      await crawl(runner, runContext, { delistCountsCrawl: true });

      expect(runContext.signal.aborted).toBe(true);
      expect(report.categoryPathCalls).toEqual([
        { externalId: 'p1', paths: [['Bebidas']], mode: 'ADD' },
        { externalId: 'p2', paths: [['Bebidas']], mode: 'ADD' },
      ]);
    });

    it('puts the paths on no observation, and makes every call after the last product and before the run flushes', async () => {
      const events: string[] = [];
      const runContext = context();
      (runContext.flush as jest.Mock).mockImplementation(async () => {
        events.push('flush');
      });
      const product = report.product.bind(report);
      report.product = (observation) => {
        events.push('product');
        product(observation);
      };
      const paths = report.categoryPaths.bind(report);
      report.categoryPaths = (externalId, list, mode) => {
        events.push('paths');
        paths(externalId, list, mode);
      };

      await crawl(new TestRunner(states()), runContext, {
        delistCountsCrawl: true,
      });

      for (const observed of report.products) {
        expect(observed).not.toHaveProperty('categoryPaths');
      }
      expect(events.lastIndexOf('product')).toBeLessThan(
        events.indexOf('paths')
      );
      expect(events.filter((event) => event === 'paths')).toHaveLength(3);
      // The run's own flush comes after every path call, so the paths are
      // with the sink before the run hands it over.
      expect(events.filter((event) => event === 'flush')).toHaveLength(1);
      expect(events.lastIndexOf('paths')).toBeLessThan(events.indexOf('flush'));
    });

    it('makes no call when the walk dies before its end', async () => {
      // The run row stops taking writes once the categories are paged, so the
      // run throws before the end of its walk, as a dying pod would.
      const runContext = context();
      (runContext.setStage as jest.Mock).mockImplementation(
        async (stage: string) => {
          if (stage === 'INGEST') {
            throw new Error('The run row did not answer.');
          }
        }
      );

      await expect(
        crawl(new TestRunner(states()), runContext, { delistCountsCrawl: true })
      ).rejects.toThrow('The run row did not answer.');

      // Every product was reported at its first sighting, and no path.
      expect(report.products).toHaveLength(3);
      expect(report.categoryPathCalls).toEqual([]);
    });
  });

  describe('a category cut short is not read (owner decision 90b)', () => {
    const bebidas = link('cat1', 'Bebidas');
    const ofertas = link('cat2', 'Ofertas');
    const shared = card('p1', 'Agua CARREFOUR 1,5 l.', '0,39 €');
    /**
     * Bebidas holds two pages and Ofertas one. p1 sits in both, and p2 sits
     * on the second page of Bebidas only.
     */
    const states = (): Record<string, Record<string, unknown>> => ({
      '/supermercado/la-despensa/cat20001/c': page({
        firstLevel: [bebidas, ofertas],
      }),
      [bebidas.url]: page({ totalResults: 30 }),
      [ofertas.url]: page({ totalResults: 1 }),
      '/supermercado/x/cat1/c?offset=0': page({
        totalResults: 30,
        cards: [card('p3', 'Cola CARREFOUR 33 cl.', '0,35 €')],
      }),
      '/supermercado/x/cat1/c?offset=24': page({
        totalResults: 30,
        cards: [shared, card('p2', 'Leche CARREFOUR 1 l.', '0,89 €')],
      }),
      '/supermercado/x/cat2/c?offset=0': page({
        totalResults: 1,
        cards: [shared],
      }),
    });

    /**
     * The same runner, over a session that answers the statuses a test names
     * for a path, one an ask, and the page's state once they run out.
     */
    class StatusRunner extends TestRunner {
      constructor(
        states: Record<string, Record<string, unknown>>,
        private readonly statuses: Record<string, number[]>
      ) {
        super(states);
      }

      protected override createClient(context: RunContext): CarrefourClient {
        return new CarrefourClient({
          userAgent: 'LunaShopperBot/1.0',
          sleepImpl: async () => undefined,
          acquire: context.acquire,
          guard: context.guard,
          signal: context.signal,
          openSession: async () => ({
            goto: async (url: string) => {
              const path = url.replace('https://www.carrefour.es', '');
              this.asked.push(path);
              const status = this.statuses[path]?.shift();
              if (status !== undefined) {
                return { status, state: null };
              }
              const state = this.states[path];
              return state
                ? { status: 200, state }
                : { status: 404, state: null };
            },
            close: async () => undefined,
          }),
        });
      }
    }

    async function crawl(
      runner: TestRunner,
      options: { guarded?: boolean } = {}
    ) {
      const runContext = options.guarded ? guardedContext() : context();
      await runner.run(
        runContext,
        report,
        { supermarketId: CHAIN, priceScopeId: SCOPE },
        source({ delistCountsCrawl: true })
      );
      return runContext;
    }

    const callOf = (externalId: string) =>
      report.categoryPathCalls.find((call) => call.externalId === externalId);

    const asksOf = (runner: TestRunner, path: string) =>
      runner.asked.filter((asked) => asked === path).length;

    it('declares a crawl whole once the end pass reads the page a 503 cut, and replaces (owner decision 103b)', async () => {
      const runner = new StatusRunner(states(), {
        '/supermercado/x/cat1/c?offset=24': [503],
      });
      const runContext = await crawl(runner);

      // Asked on the walk and once more after Ofertas, and never a third time.
      expect(asksOf(runner, '/supermercado/x/cat1/c?offset=24')).toBe(2);
      expect(
        runner.asked.indexOf('/supermercado/x/cat2/c?offset=0')
      ).toBeLessThan(
        runner.asked.lastIndexOf('/supermercado/x/cat1/c?offset=24')
      );
      expect(
        report.products.map((product) => product.externalId).sort()
      ).toEqual(['p1', 'p2', 'p3']);
      expect(report.wholeListings).toEqual([
        { scopeKey: null, listed: ['p3', 'p1', 'p2'] },
      ]);
      expect(report.notWhole).toEqual([]);
      expect(callOf('p1')).toEqual({
        externalId: 'p1',
        paths: [['Ofertas'], ['Bebidas']],
        mode: 'REPLACE',
      });
      expect(runContext.warn).not.toHaveBeenCalled();
      expect(runContext.setReport).toHaveBeenCalledWith(
        expect.objectContaining({
          unreadableCategories: [],
          askedAgain: [{ id: 'cat1', name: 'Bebidas', read: true }],
        })
      );
      // The 503 told the guard of no refusal.
      expect(runContext.guard?.consecutiveRefusals ?? 0).toBe(0);
    });

    it('does not declare a crawl whole when the page a 503 cut answers 503 again, and adds', async () => {
      const runner = new StatusRunner(states(), {
        '/supermercado/x/cat1/c?offset=24': [503, 503],
      });
      const runContext = await crawl(runner);

      expect(asksOf(runner, '/supermercado/x/cat1/c?offset=24')).toBe(2);
      expect(report.wholeListings).toEqual([]);
      expect(report.notWhole[0].reason).toBe('unreadable');
      expect(
        report.categoryPathCalls.every((call) => call.mode === 'ADD')
      ).toBe(true);
      expect(runContext.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Bebidas',
          message:
            'Category cat1 Bebidas: Carrefour answered 503 at offset 24, ' +
            'once more at the end of the run. The listings from there on, ' +
            'of 30, were not read.',
        })
      );
      expect(runContext.setReport).toHaveBeenCalledWith(
        expect.objectContaining({
          unreadableCategories: [bebidas.url],
          askedAgain: [{ id: 'cat1', name: 'Bebidas', read: false }],
        })
      );
    });

    it('does not declare a crawl whole when the pass cannot start after a 503, and adds', async () => {
      // Ofertas is refused last, so the walk hands the pass a guard counting
      // one refusal in a row, the pass does not start, and the 503 that cut
      // Bebidas stands.
      const runner = new StatusRunner(states(), {
        '/supermercado/x/cat1/c?offset=24': [503],
        '/supermercado/x/cat2/c?offset=0': [403],
      });
      const runContext = await crawl(runner, { guarded: true });

      expect(asksOf(runner, '/supermercado/x/cat1/c?offset=24')).toBe(1);
      // What the first page held is kept.
      expect(report.products.map((product) => product.externalId)).toEqual([
        'p3',
      ]);
      // Not whole, so nothing is delisted and no path is replaced.
      expect(report.wholeListings).toEqual([]);
      expect(report.notWhole).toEqual([
        { scopeKey: null, reason: 'unreadable', detail: [], listed: null },
      ]);
      expect(
        report.categoryPathCalls.every((call) => call.mode === 'ADD')
      ).toBe(true);
      expect(runContext.guard?.stop).toBeNull();
      // Named the way an unreadable category is, with no second ask.
      expect(runContext.warn).toHaveBeenCalledWith({
        code: HarvestWarningCode.LISTING_UNREAD,
        name: 'Bebidas',
        offerId: null,
        page: null,
        message:
          'Category cat1 Bebidas: Carrefour answered 503 at offset 24. The ' +
          'listings from there on, of 30, were not read.',
      });
      expect(runContext.setReport).toHaveBeenCalledWith(
        expect.objectContaining({
          unreadableCategories: [bebidas.url, ofertas.url],
          askedAgain: [],
        })
      );
      expect(runContext.report).toHaveBeenCalledWith({ failed: 1 });
    });

    it('does not declare a crawl whole when a page answered 404 part way, and does not ask it again', async () => {
      const runner = new StatusRunner(states(), {
        '/supermercado/x/cat1/c?offset=24': [404],
      });
      const runContext = await crawl(runner);

      // A 404 is an answer about the page and not a passing failure, so the
      // end pass leaves it (owner decision 103b).
      expect(asksOf(runner, '/supermercado/x/cat1/c?offset=24')).toBe(1);
      expect(runContext.setReport).toHaveBeenCalledWith(
        expect.objectContaining({ askedAgain: [] })
      );
      expect(report.wholeListings).toEqual([]);
      expect(report.notWhole[0].reason).toBe('unreadable');
      expect(callOf('p1')?.mode).toBe('ADD');
      expect(runContext.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Bebidas',
          message: expect.stringContaining(
            'Carrefour answered 404 at offset 24'
          ),
        })
      );
    });

    it('does not declare a crawl whole when an empty page still states rows', async () => {
      const pages = states();
      pages['/supermercado/x/cat1/c?offset=24'] = page({ totalResults: 30 });
      const runner = new TestRunner(pages);
      const runContext = await crawl(runner);

      // Not asked again either: the storefront chose to serve it empty.
      expect(asksOf(runner, '/supermercado/x/cat1/c?offset=24')).toBe(1);
      expect(report.wholeListings).toEqual([]);
      expect(report.notWhole[0].reason).toBe('unreadable');
      expect(runContext.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Bebidas',
          message: expect.stringContaining(
            'Carrefour answered an empty page that states 30 results at offset 24'
          ),
        })
      );
    });

    it('declares a crawl whole when an empty page states the set ended before it', async () => {
      // The category shrank to 24 between the tree walk and the paging, and
      // the page says so: that is the end, not a gap.
      const pages = states();
      pages['/supermercado/x/cat1/c?offset=24'] = page({ totalResults: 24 });
      const runContext = await crawl(new TestRunner(pages));

      expect(report.wholeListings).toEqual([
        { scopeKey: null, listed: ['p3', 'p1'] },
      ]);
      expect(callOf('p1')).toEqual({
        externalId: 'p1',
        paths: [['Ofertas']],
        mode: 'REPLACE',
      });
      expect(runContext.warn).not.toHaveBeenCalled();
    });

    it('declares a crawl whole that paged every category to its last page', async () => {
      await crawl(new TestRunner(states()));

      expect(report.wholeListings).toHaveLength(1);
      expect(callOf('p1')).toEqual({
        externalId: 'p1',
        paths: [['Bebidas'], ['Ofertas']],
        mode: 'REPLACE',
      });
    });

    it('keeps a refused category unread when the end pass meets a 503 in it', async () => {
      // The second page is refused on the walk, and the end pass asks it once
      // more and meets a page after it that answers 503. Bebidas now has
      // three pages so the pass has a page after the refused one to fail on.
      const pages = states();
      pages[bebidas.url] = page({ totalResults: 60 });
      const runner = new StatusRunner(pages, {
        '/supermercado/x/cat1/c?offset=24': [403],
        '/supermercado/x/cat1/c?offset=48': [503],
      });
      const runContext = await crawl(runner);

      // The end pass read the refused page this time.
      expect(
        runner.asked.filter(
          (path) => path === '/supermercado/x/cat1/c?offset=24'
        )
      ).toHaveLength(2);
      expect(report.wholeListings).toEqual([]);
      expect(report.notWhole[0].reason).toBe('unreadable');
      expect(runContext.setReport).toHaveBeenCalledWith(
        expect.objectContaining({
          unreadableCategories: [bebidas.url],
          askedAgain: [{ id: 'cat1', name: 'Bebidas', read: false }],
        })
      );
      expect(runContext.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining(
            'Carrefour answered 503 at offset 48, once more at the end of the run'
          ),
        })
      );
    });

    it('names the second offset when the end pass is cut by a 5xx at a later page', async () => {
      // A 503 cuts Bebidas at offset 24. The end pass reads that page and
      // meets a second 503 at offset 48.
      const pages = states();
      pages[bebidas.url] = page({ totalResults: 60 });
      const runner = new StatusRunner(pages, {
        '/supermercado/x/cat1/c?offset=24': [503],
        '/supermercado/x/cat1/c?offset=48': [503],
      });
      const runContext = await crawl(runner);

      expect(asksOf(runner, '/supermercado/x/cat1/c?offset=24')).toBe(2);
      expect(asksOf(runner, '/supermercado/x/cat1/c?offset=48')).toBe(1);
      expect(runContext.warn).toHaveBeenCalledTimes(1);
      expect(runContext.warn).toHaveBeenCalledWith({
        code: HarvestWarningCode.LISTING_UNREAD,
        name: 'Bebidas',
        offerId: null,
        page: null,
        message:
          'Category cat1 Bebidas: Carrefour answered 503 at offset 48, ' +
          'once more at the end of the run. The listings from there on, ' +
          'of 60, were not read.',
      });
      expect(runContext.setReport).toHaveBeenCalledWith(
        expect.objectContaining({
          unreadableCategories: [bebidas.url],
          askedAgain: [{ id: 'cat1', name: 'Bebidas', read: false }],
        })
      );
    });

    it('goes on to the next entry after a 5xx cuts one again', async () => {
      const runner = new StatusRunner(states(), {
        '/supermercado/x/cat1/c?offset=24': [503, 503],
        '/supermercado/x/cat2/c?offset=0': [503],
      });
      const runContext = await crawl(runner);

      // The pass asked Bebidas, was cut again, and still asked Ofertas.
      expect(
        runner.asked.filter((path) => path.includes('?offset=')).slice(-2)
      ).toEqual([
        '/supermercado/x/cat1/c?offset=24',
        '/supermercado/x/cat2/c?offset=0',
      ]);
      expect(runContext.setReport).toHaveBeenCalledWith(
        expect.objectContaining({
          unreadableCategories: [bebidas.url],
          askedAgain: [
            { id: 'cat1', name: 'Bebidas', read: false },
            { id: 'cat2', name: 'Ofertas', read: true },
          ],
        })
      );
      expect(runContext.warn).toHaveBeenCalledTimes(1);
      expect(runContext.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Bebidas',
          message: expect.stringContaining(
            'Carrefour answered 503 at offset 24, once more at the end of the run'
          ),
        })
      );
    });

    it('ends the pass at a refusal before a waiting 5xx entry, which keeps its first warning', async () => {
      // Bebidas is refused on the walk and again in the pass. Ofertas was cut
      // by a 503 after it and is never asked again. Caldos answers last, so
      // the walk ends on no refusal in a row and the pass starts.
      const caldos = link('cat3', 'Caldos');
      const pages = states();
      pages['/supermercado/la-despensa/cat20001/c'] = page({
        firstLevel: [bebidas, ofertas, caldos],
      });
      pages[caldos.url] = page({ totalResults: 1 });
      pages['/supermercado/x/cat3/c?offset=0'] = page({
        totalResults: 1,
        cards: [card('p5', 'Caldo CARREFOUR 1 l.', '1,09 €')],
      });
      const runner = new StatusRunner(pages, {
        '/supermercado/x/cat1/c?offset=24': [403, 403],
        '/supermercado/x/cat2/c?offset=0': [503],
      });
      const runContext = await crawl(runner, { guarded: true });

      expect(asksOf(runner, '/supermercado/x/cat1/c?offset=24')).toBe(2);
      expect(asksOf(runner, '/supermercado/x/cat2/c?offset=0')).toBe(1);
      expect(runContext.guard?.stop).toBeNull();
      expect(runContext.warn).toHaveBeenCalledTimes(2);
      expect(runContext.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Bebidas',
          message: expect.stringContaining(
            'Carrefour answered 403 at offset 24, once more at the end of the run'
          ),
        })
      );
      expect(runContext.warn).toHaveBeenCalledWith({
        code: HarvestWarningCode.LISTING_UNREAD,
        name: 'Ofertas',
        offerId: null,
        page: null,
        message:
          'Category cat2 Ofertas: Carrefour answered 503 at offset 0. The ' +
          'listings from there on, of 1, were not read.',
      });
      expect(runContext.setReport).toHaveBeenCalledWith(
        expect.objectContaining({
          unreadableCategories: [bebidas.url, ofertas.url],
          askedAgain: [{ id: 'cat1', name: 'Bebidas', read: false }],
        })
      );
    });

    describe('a category that grew since the frontier (owner decision 104b)', () => {
      const at = (offset: number) => `/supermercado/x/cat1/c?offset=${offset}`;

      /**
       * Bebidas alone, 48 at the frontier. Its pages state `stated` results
       * and serve `served` pages of 24, one distinct card each.
       */
      const grown = (stated: number, served: number) => {
        const pages: Record<string, Record<string, unknown>> = {
          '/supermercado/la-despensa/cat20001/c': page({
            firstLevel: [bebidas],
          }),
          [bebidas.url]: page({ totalResults: 48 }),
        };
        for (let offset = 0; offset < served * 24; offset += 24) {
          pages[at(offset)] = {
            ...page({
              totalResults: stated,
              cards: [card(`p${offset}`, `Agua ${offset} 1,5 l.`, '0,39 €')],
            }),
            pagination: { page_size: 24, total_pages: served },
          };
        }
        return pages;
      };

      const run = (runner: TestRunner, runContext: RunContext) =>
        runner.run(
          runContext,
          report,
          { supermarketId: CHAIN, priceScopeId: SCOPE },
          source({ delistCountsCrawl: true })
        );

      it('asks a third page when a page states 49 and serves 48, and reads whole when it is empty', async () => {
        // The stated 49 grows the walk to a third page. It answers empty,
        // stating 49 and two pages served, so its offset is at what paging
        // serves: the natural end, one request more, and no cut.
        const pages = grown(49, 2);
        pages[at(48)] = {
          ...page({ totalResults: 49 }),
          pagination: { page_size: 24, total_pages: 2 },
        };
        const runner = new TestRunner(pages);
        const runContext = context();
        await run(runner, runContext);

        expect(
          runner.asked.filter((path) => path.includes('?offset='))
        ).toEqual([at(0), at(24), at(48)]);
        expect(runContext.warn).not.toHaveBeenCalled();
        expect(report.wholeListings).toHaveLength(1);
        expect(runContext.setReport).toHaveBeenCalledWith(
          expect.objectContaining({ unreadableCategories: [] })
        );
        // The bound grew from 48 to 49, so the plan rose by one.
        expect(runContext.setTotalPlanned).toHaveBeenLastCalledWith(49);
      });

      it('raises the planned total to the grown one, so progress never passes it', async () => {
        // Full pages: 24 distinct cards on each of four pages, where the
        // frontier saw 48 and the pages state 96. Without the raise the run
        // would report 96 processed against a plan of 48.
        const pages = grown(96, 4);
        for (let offset = 0; offset < 96; offset += 24) {
          const cards = Array.from({ length: 24 }, (_, i) =>
            card(`p${offset + i}`, `Agua ${offset + i} 1,5 l.`, '0,39 €')
          );
          pages[at(offset)] = {
            ...page({ totalResults: 96, cards }),
            pagination: { page_size: 24, total_pages: 4 },
          };
        }
        const counting = countingContext();
        const reported: Array<{ processed: number; planned: number | null }> =
          [];
        let processed = 0;
        const original = counting.context.report.bind(counting.context);
        counting.context.report = async (counters) => {
          processed += counters.processed ?? 0;
          reported.push({ processed, planned: counting.planned() });
          await original(counters);
        };
        await run(new TestRunner(pages), counting.context);
        await counting.context.flush();

        expect(reported.length).toBeGreaterThan(0);
        for (const { processed: done, planned } of reported) {
          expect(planned).not.toBeNull();
          expect(done).toBeLessThanOrEqual(planned as number);
        }
        expect(counting.processed()).toBe(96);
        expect(counting.planned()).toBe(96);
      });

      it('names the grown total in the warning of a category it could not finish', async () => {
        // Frontier 48, pages state 96: a 503 at the fourth page, twice.
        const runner = new StatusRunner(grown(96, 4), { [at(72)]: [503, 503] });
        const runContext = context();
        await run(runner, runContext);

        expect(runContext.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Bebidas',
            message:
              'Category cat1 Bebidas: Carrefour answered 503 at offset 72, ' +
              'once more at the end of the run. The listings from there on, ' +
              'of 96, were not read.',
          })
        );
        expect(runContext.setTotalPlanned).toHaveBeenLastCalledWith(96);
      });

      it('keeps the walk’s own error and its progress when the plan write fails', async () => {
        // Frontier 48, pages state 96, and a 503 at the third page, twice.
        // Restating the plan fails after the frontier's write. The 503 is
        // still what cost the category, so the end pass asks it once more,
        // and the two listings the walk did page are still reported.
        const runner = new StatusRunner(grown(96, 4), { [at(48)]: [503, 503] });
        const runContext = context();
        (runContext.setTotalPlanned as jest.Mock)
          .mockResolvedValueOnce(undefined)
          .mockRejectedValue(new Error('the database is down'));
        await run(runner, runContext);

        expect(runContext.report).toHaveBeenCalledWith({ processed: 2 });
        expect(asksOf(runner, at(48))).toBe(2);
        expect(runContext.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Bebidas',
            message:
              'Category cat1 Bebidas: Carrefour answered 503 at offset 48, ' +
              'once more at the end of the run. The listings from there on, ' +
              'of 96, were not read.',
          })
        );
      });
    });
  });
});
