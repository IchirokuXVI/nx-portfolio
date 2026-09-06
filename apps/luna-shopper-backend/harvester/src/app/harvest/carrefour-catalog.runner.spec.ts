import type { ConfigService } from '@nestjs/config';
import { CarrefourClient } from '@portfolio/luna-shopper/carrefour';
import { PriceSourceKind } from '@portfolio/luna-shopper/contracts';
import type { SupermarketSource } from '../entities';
import { CarrefourCatalogRunner } from './carrefour-catalog.runner';
import type { RunContext } from './run-context';
import type { SourceIngest, SourceIngestInput } from './source-ingest';

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
    ingest: SourceIngest,
    protected readonly states: Record<string, Record<string, unknown>>
  ) {
    super(ingest, {
      getOrThrow: () => ({ userAgent: 'LunaShopperBot/1.0' }),
    } as unknown as ConfigService);
  }

  protected override createClient(): CarrefourClient {
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
  protected override createClient(): CarrefourClient {
    return new CarrefourClient({
      userAgent: 'LunaShopperBot/1.0',
      sleepImpl: async () => undefined,
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
  ({ adapterKey: 'carrefour-web', config, workers: 1 }) as SupermarketSource;

describe('CarrefourCatalogRunner', () => {
  let ingested: SourceIngestInput | null;
  let ingest: SourceIngest;

  beforeEach(() => {
    ingested = null;
    ingest = {
      ingest: jest.fn(
        async (_context: RunContext, input: SourceIngestInput) => {
          ingested = input;
          return { outcomes: [], counters: {} };
        }
      ),
    } as unknown as SourceIngest;
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
    const runner = new TestRunner(ingest, states);

    await runner.run(
      context(),
      { supermarketId: CHAIN, priceScopeId: SCOPE },
      source()
    );

    expect(ingested?.sourceKind).toBe(PriceSourceKind.OFFICIAL_WEB);
    expect(ingested?.priceScopeId).toBe(SCOPE);
    expect(ingested?.observations).toHaveLength(2);
    expect(ingested?.observations[0]).toMatchObject({
      externalId: 'p1',
      name: 'Agua CARREFOUR',
      sizeFormat: '1,5 l.',
      unitSize: 1.5,
      // The listing card carries none. The backfill is what fills it.
      ean: null,
      categoryPath: ['Bebidas'],
      price: { price: 0.39, currency: 'EUR', unitPriceLabel: '€/l' },
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
    await new TestRunner(ingest, states).run(
      context(),
      { supermarketId: CHAIN, priceScopeId: SCOPE },
      source()
    );

    expect(ingested?.observations).toHaveLength(1);
    expect(ingested?.observations[0]).toMatchObject({
      externalId: 'p9',
      price: null,
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
    const runner = new TestRunner(ingest, states);

    await runner.run(
      context(),
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
    await new TestRunner(ingest, states).run(
      runContext,
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
    const runner = new BlockingRunner(ingest, states);
    const runContext = context();

    await expect(
      runner.run(
        runContext,
        { supermarketId: CHAIN, priceScopeId: SCOPE },
        source({ seedPath: '/seed' })
      )
    ).rejects.toThrow(/refused/);

    // The one product the crawl did read was written before the run failed.
    expect(ingested?.observations).toHaveLength(1);
    expect(runContext.setReport).toHaveBeenCalledWith(
      expect.objectContaining({
        blockedAfter: expect.stringMatching(/refused/),
      })
    );
  });

  it('refuses a crawl that has nowhere to write its prices', async () => {
    await expect(
      new TestRunner(ingest, {}).run(
        context(),
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
    await new TestRunner(ingest, states).run(
      context(),
      { supermarketId: CHAIN, priceScopeId: SCOPE },
      source({ seedPath: '/seed' })
    );

    // 17,135 counts category memberships and not distinct products. The first
    // sighting is the one kept, category path and all.
    expect(ingested?.observations).toHaveLength(1);
    expect(ingested?.observations[0].categoryPath).toEqual(['Bebidas']);
  });
});
