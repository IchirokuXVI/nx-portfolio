import type { ConfigService } from '@nestjs/config';
import { CarrefourClient } from '@portfolio/luna-shopper/carrefour';
import type { SupermarketSource } from '../entities';
import { CarrefourDetailRunner } from './carrefour-detail.runner';
import type { BackfillEntry } from './catalog-runner';
import type { RunContext } from './run-context';
import { RecordingRunReport } from './run-report';

/**
 * The EAN backfill, over a fake page loader and no browser (plan 0090, section
 * 12.1).
 *
 * **It reads pages and reports products, and that is all it does** (plan 0103,
 * section 6.2). It used to load the rows itself and write the EAN itself, and
 * both are the orchestrator's now: the rows arrive on the input, and the
 * promotion an EAN earns is rung 1's, asserted in `source-ingest.spec.ts` where
 * the ladder lives. So there is no repository fake and no `CatalogClient` fake
 * here any more.
 *
 * What it still pins is what makes the pass safe to stop: a page that printed
 * no EAN is a value, a refused page costs one product, and three refusals in a
 * row stop the run.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const RUN = '33333333-3333-4333-8333-333333333333';

/** One product page, as the storefront renders it. */
const productPage = (id: string, ean: string | null) => ({
  pdp: { product: { product_id: id, ean: ean ?? '' } },
});

/** One row the orchestrator prepared, as the crawl described it. */
function row(externalId = 'p1'): BackfillEntry {
  return {
    externalId,
    url: `/supermercado/${externalId}/p`,
    name: 'Agua CARREFOUR',
    brand: 'CARREFOUR',
    unitSize: null,
    sizeFormat: '1,5 l.',
    categoryPath: ['Bebidas'],
  };
}

class TestRunner extends CarrefourDetailRunner {
  constructor(protected readonly pages: Record<string, unknown>) {
    super({
      getOrThrow: () => ({ userAgent: 'LunaShopperBot/1.0' }),
    } as unknown as ConfigService);
  }

  protected override createClient(): CarrefourClient {
    return new CarrefourClient({
      userAgent: 'LunaShopperBot/1.0',
      sleepImpl: async () => undefined,
      openSession: async () => ({
        goto: async (url: string) => {
          const state = this.pages[url.replace('https://www.carrefour.es', '')];
          return state
            ? { status: 200, state: state as Record<string, unknown> }
            : { status: 404, state: null };
        },
        close: async () => undefined,
      }),
    });
  }
}

/**
 * The same runner, over a session that refuses every page it does not hold.
 *
 * {@link TestRunner} answers 404 for an unknown path, which is a product page
 * that moved. This one answers 403, which is the storefront refusing.
 */
class RefusingRunner extends TestRunner {
  protected override createClient(): CarrefourClient {
    return new CarrefourClient({
      userAgent: 'LunaShopperBot/1.0',
      sleepImpl: async () => undefined,
      openSession: async () => ({
        goto: async (url: string) => {
          const state = this.pages[url.replace('https://www.carrefour.es', '')];
          return state
            ? { status: 200, state: state as Record<string, unknown> }
            : { status: 403, state: null };
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
  } as unknown as RunContext;
}

const source = (config: Record<string, unknown> = {}): SupermarketSource =>
  ({ adapterKey: 'carrefour-web', config }) as SupermarketSource;

describe('CarrefourDetailRunner', () => {
  it('reports the product with the EAN the page printed', async () => {
    const report = new RecordingRunReport();
    await new TestRunner({
      '/supermercado/p1/p': productPage('p1', '8411327052016'),
    }).run(
      context(),
      report,
      { supermarketId: CHAIN, backfill: [row()] },
      source()
    );

    expect(report.products).toHaveLength(1);
    expect(report.products[0]).toMatchObject({
      externalId: 'p1',
      ean: '8411327052016',
      // The row as the crawl described it: the page answers the EAN and nothing
      // else, so a product reported with only an id would blank its own name.
      name: 'Agua CARREFOUR',
      sizeFormat: '1,5 l.',
      categoryPath: ['Bebidas'],
    });
    // The crawl already wrote this chain's prices, and a backfill that reported
    // one would be a second path into what plan 0080 made one path.
    expect(report.products[0].prices).toEqual([]);
  });

  it('treats a page that printed no EAN as a value and not an error', async () => {
    const report = new RecordingRunReport();
    const runContext = context();
    await new TestRunner({
      '/supermercado/p1/p': productPage('p1', null),
    }).run(
      runContext,
      report,
      { supermarketId: CHAIN, backfill: [row()] },
      source()
    );

    expect(report.products).toHaveLength(0);
    expect(runContext.setReport).toHaveBeenCalledWith(
      expect.objectContaining({ eansWritten: 0, noEanOnTheirPage: 1 })
    );
  });

  it('does nothing at all when every row already has one', async () => {
    // A product that has an EAN is never fetched again, which is the whole of
    // this pass's resume logic. The orchestrator finds no row, so the run has
    // nothing to read.
    const report = new RecordingRunReport();
    const runContext = context();
    await new TestRunner({}).run(
      runContext,
      report,
      { supermarketId: CHAIN, backfill: [] },
      source()
    );

    expect(report.products).toHaveLength(0);
    expect(runContext.setReport).toHaveBeenCalledWith(
      expect.objectContaining({ pending: 0 })
    );
  });

  it('steps over a page the storefront refused and keeps going', async () => {
    // The live storefront refused the very first page of a backfill, and the
    // whole pass died. A skipped row keeps no EAN, which is the state it was
    // already in, so the next backfill takes it again for free.
    const report = new RecordingRunReport();
    const runContext = context();
    // Only the second product has a page; the first is refused.
    await new RefusingRunner({
      '/supermercado/p2/p': productPage('p2', '8411327052016'),
    }).run(
      runContext,
      report,
      { supermarketId: CHAIN, backfill: [row('p1'), row('p2')] },
      source()
    );

    expect(report.products.map((product) => product.externalId)).toEqual([
      'p2',
    ]);
    expect(runContext.setReport).toHaveBeenCalledWith(
      expect.objectContaining({ eansWritten: 1, refusedPages: 1 })
    );
  });

  it('stops when the refusals stop being isolated', async () => {
    // Three in a row is the block, and every page after it would be worse for
    // having been asked.
    await expect(
      new RefusingRunner({}).run(
        context(),
        new RecordingRunReport(),
        {
          supermarketId: CHAIN,
          backfill: ['p1', 'p2', 'p3', 'p4'].map(row),
        },
        source()
      )
    ).rejects.toThrow(/refused/);
  });
});
