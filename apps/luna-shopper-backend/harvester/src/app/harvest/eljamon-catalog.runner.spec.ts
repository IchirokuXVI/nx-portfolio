import type { ConfigService } from '@nestjs/config';
import {
  HarvestDetailFetch,
  HarvestWarningCode,
} from '@portfolio/luna-shopper/contracts';
import {
  ElJamonClient,
  ElJamonTimeoutError,
} from '@portfolio/luna-shopper/eljamon';
import {
  SourceBlockedError,
  SourceGuard,
} from '@portfolio/luna-shopper/source-guard';
import type { SupermarketSource } from '../entities';
import {
  DETAIL_FAILED_KEY,
  type CatalogDiscoveryInput,
} from './catalog-runner';
import { ElJamonCatalogRunner } from './eljamon-catalog.runner';
import type { RunContext } from './run-context';
import { RecordingRunReport } from './run-report';

/**
 * Catalog discovery against El Jamón's online shop (plan 0169, section 5).
 *
 * **Nothing here reaches a network.** A fake storefront answers in the shape
 * the library's fixtures prove, small enough to read. What it pins: one
 * observation per listed product with one price and no scope key, no
 * availability and no scope declared, a known product reads no page, and every
 * failure is named on the report.
 */

const BASE = 'https://shop.test';

interface Row {
  code: string;
  description: string;
  brand: string;
  price: string;
  previous?: string;
  unit: string;
}

function listing(
  rows: readonly Row[],
  articleCount: number,
  category: string
): string {
  const filters = JSON.stringify({
    categoryCode: category,
    page: 1,
    pageSize: 20,
  }).replace(/"/g, '&quot;');
  return (
    `<p>${articleCount} Artículos</p>` +
    `<input type="hidden" id="filters" name="filters" value="${filters}" />` +
    rows
      .map(
        (row) =>
          `<div id="_P_articulo_${row.code}" class="articulo">` +
          `<p class="marca">${row.brand}</p><p class="nombre"> ` +
          `<a href="${BASE}/detalle/-/Producto/p/${row.code}"> ${row.description} </a> </p>` +
          '<p class="precio"> ' +
          (row.previous
            ? `<span class="tachado">${row.previous} €</span> `
            : '') +
          `<span>${row.price} €</span> </p>` +
          `<div class="texto-porKilo"> ${row.unit} </div></div>`
      )
      .join('')
  );
}

function productPage(
  code: string,
  price: string,
  path: readonly string[]
): string {
  return (
    '<ul class="breadcrumbs lfr-component migas-custom">' +
    '<li class="first"><span><a href="/">Inicio</a></span></li>' +
    path
      .map((level) => `<li ><span><a href="#">${level}</a></span></li>`)
      .join('') +
    `<li class="last"><span><a href="#">product ${code}</a></span></li></ul>` +
    '<script type="application/ld+json">{"@type": "Product", ' +
    `"name": "product ${code}", "brand": {"name": "PAGE BRAND"}, ` +
    `"image": "https://www.supermercadoseljamon.com/documents/10180/892067/${code}_G.jpg", ` +
    `"offers": {"price": "${price}", "availability": 'InStock'}, ` +
    `"sku": "${code}"}</script>`
  );
}

const HOME =
  '<a href="/categorias/frescos/04" title="FRESCOS">x</a>' +
  '<a href="/categorias/bebidas/06" title="BEBIDAS">x</a>';

const FRESCOS: Row[] = [
  {
    code: '101',
    description: 'arroz bomba, 1kg',
    brand: 'DOÑA ANA',
    price: '3,49',
    previous: '3,99',
    unit: '3,49 €/Kilo',
  },
  {
    code: '102',
    description: 'bacon original, kg',
    brand: 'EL POZO',
    price: '8,95',
    unit: '8,95 €/Kilo',
  },
];

const BEBIDAS_PAGE_1: Row[] = Array.from({ length: 20 }, (_, index) => ({
  code: String(200 + index),
  description: `agua ${index}, 1,5l`,
  brand: 'SOLAN',
  price: '0,45',
  unit: '0,30 €/Litro',
}));

class TestRunner extends ElJamonCatalogRunner {
  readonly sent: Array<{ url: string; method: string }> = [];

  constructor(private readonly site: (url: URL, method: string) => Response) {
    super({
      getOrThrow: () => ({ userAgent: 'LunaShopperBot/1.0' }),
    } as unknown as ConfigService);
  }

  protected override createClient(context: RunContext): ElJamonClient {
    return new ElJamonClient({
      userAgent: 'LunaShopperBot/1.0',
      baseUrl: BASE,
      sleepImpl: async () => undefined,
      retries: 0,
      // The run's gate, guard and signal, as the runtime passes them.
      acquire: context.acquire,
      guard: context.guard,
      signal: context.signal,
      fetchImpl: (async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        this.sent.push({ url: String(url), method });
        return this.site(new URL(String(url)), method);
      }) as unknown as typeof fetch,
    });
  }
}

/** The storefront above, with page 2 of BEBIDAS refusing, and 102's page empty. */
function storefront(url: URL): Response {
  const html = (body: string, status = 200) => new Response(body, { status });
  if (url.pathname === '/') return html(HOME);
  if (url.pathname.startsWith('/delegate/')) return html('');
  if (url.pathname === '/categorias/frescos/04')
    return html(listing(FRESCOS, 2, '04'));
  if (url.pathname === '/categorias/bebidas/06') {
    return url.search === ''
      ? html(listing(BEBIDAS_PAGE_1, 25, '06'))
      : html('', 403);
  }
  const code = /\/(\d+)$/.exec(url.pathname)?.[1] ?? '';
  if (code === '102') return html('<p>no product here</p>');
  // 101's page disagrees with its listing price, which the listing wins.
  return html(
    productPage(code, code === '101' ? '3.59' : '0.45', ['Frescos', 'Arroz'])
  );
}

/**
 * A context with a refusal guard that stops on the first refusal, wired the
 * way `RunExecutor` wires the run's (plan 0215).
 */
function guardedContext(): ReturnType<typeof context> {
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

function context(
  signal = new AbortController().signal
): RunContext & { setReport: jest.Mock; report: jest.Mock } {
  return {
    runId: 'run-1',
    signal,
    acquire: async () => undefined,
    setStage: jest.fn(async () => undefined),
    setTotalPlanned: jest.fn(async () => undefined),
    setReport: jest.fn(async () => undefined),
    report: jest.fn(async () => undefined),
    heartbeat: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
    warn: jest.fn(),
    countProgressItself: jest.fn(),
  } as unknown as RunContext & { setReport: jest.Mock; report: jest.Mock };
}

/** Every `processed` the runner reported, summed. */
const processedOf = (ctx: { report: jest.Mock }): number =>
  ctx.report.mock.calls.reduce(
    (sum, [counters]) =>
      sum + ((counters as { processed?: number }).processed ?? 0),
    0
  );

const source = {
  adapterKey: 'eljamon-web',
  config: {},
  workers: 2,
} as unknown as SupermarketSource;

const input: CatalogDiscoveryInput = {
  supermarketId: 'chain-1',
  priceScopeId: 'national-scope',
  details: HarvestDetailFetch.NEW,
};

describe('ElJamonCatalogRunner', () => {
  it('reports one observation per listed product, each with one price and no scope key', async () => {
    const report = new RecordingRunReport();
    await new TestRunner(storefront).run(context(), report, input, source);

    expect(report.products).toHaveLength(22);
    const rice = report.products.find(
      (product) => product.externalId === '101'
    );
    expect(rice).toEqual({
      externalId: '101',
      name: 'arroz bomba',
      brand: 'DOÑA ANA',
      ean: null,
      unitSize: 1,
      sizeUnit: 'KILOGRAM',
      soldByWeight: false,
      sizeFormat: '1kg',
      packCount: null,
      categoryPath: ['Frescos', 'Arroz'],
      url: `${BASE}/detalle/-/Producto/p/101`,
      // The `image` of the product page's JSON-LD, verbatim (plan 0198).
      imageUrl:
        'https://www.supermercadoseljamon.com/documents/10180/892067/101_G.jpg',
      observedAt: expect.any(Date),
      extra: { previousPrice: 3.99 },
      prices: [
        {
          scopeKey: null,
          price: 3.49,
          currency: 'EUR',
          unitPrice: 3.49,
          unitPriceLabel: 'Kilo',
          validFrom: null,
          validUntil: null,
        },
      ],
    });
    expect(
      report.products.every(
        (product) =>
          product.prices.length === 1 && product.prices[0].scopeKey === null
      )
    ).toBe(true);
  });

  it('says a row printed with a bare kg is sold by weight, at the price the chain prints (plan 0181)', async () => {
    const report = new RecordingRunReport();
    await new TestRunner(storefront).run(context(), report, input, source);

    const bacon = report.products.find(
      (product) => product.externalId === '102'
    );
    expect(bacon).toMatchObject({
      name: 'bacon original',
      soldByWeight: true,
      unitSize: null,
      sizeUnit: null,
      sizeFormat: 'kg',
      // The price is unchanged: the chain already prints the price of a kilo.
      prices: [
        expect.objectContaining({
          price: 8.95,
          unitPrice: 8.95,
          unitPriceLabel: 'Kilo',
        }),
      ],
    });
  });

  it('writes no availability, declares no scope and claims no complete assortment', async () => {
    const report = new RecordingRunReport();
    await new TestRunner(storefront).run(context(), report, input, source);

    expect(report.availabilities).toEqual([]);
    expect(report.scopes).toEqual([]);
    expect(report.completed).toEqual([]);
  });

  describe('the national listing (plan 0220, section 2.3)', () => {
    /** BEBIDAS printing `printed` and answering page 2 with `second`. */
    const site =
      (printed: number, second: Row[] = []) =>
      (url: URL): Response => {
        if (url.pathname === '/categorias/bebidas/06') {
          return new Response(
            url.search === ''
              ? listing(BEBIDAS_PAGE_1, printed, '06')
              : listing(second, printed, '06')
          );
        }
        return storefront(url);
      };

    it('declares the default scope whole when no page failed and every category read what it printed', async () => {
      const report = new RecordingRunReport();
      await new TestRunner(site(20)).run(context(), report, input, source);

      expect(report.wholeListings).toEqual([
        {
          scopeKey: null,
          listed: ['101', '102', ...BEBIDAS_PAGE_1.map((row) => row.code)],
        },
      ]);
      expect(report.notWhole).toEqual([]);
    });

    it('declares nothing whole when a page failed, and names the page', async () => {
      const report = new RecordingRunReport();
      await new TestRunner(storefront).run(context(), report, input, source);

      expect(report.wholeListings).toEqual([]);
      expect(report.notWhole).toEqual([
        {
          scopeKey: null,
          reason: 'failed-page',
          detail: [{ category: '06', page: 2 }],
          listed: expect.any(Array),
        },
      ]);
    });

    it('declares nothing whole for a category that ended short with no failed page', async () => {
      // Page 2 answers no rows, so the client ends the category quietly at 20
      // of the 41 it printed.
      const report = new RecordingRunReport();
      await new TestRunner(site(41)).run(context(), report, input, source);

      expect(report.wholeListings).toEqual([]);
      expect(report.notWhole).toEqual([
        {
          scopeKey: null,
          reason: 'short-category',
          detail: [{ category: '06', printedCount: 41, rowsRead: 20 }],
          listed: expect.any(Array),
        },
      ]);
    });

    it('writes LISTING_SHORT on the run row for a short category, with both numbers (plan 0251)', async () => {
      const runContext = context();
      await new TestRunner(site(41)).run(
        runContext,
        new RecordingRunReport(),
        input,
        source
      );

      // One, for BEBIDAS: FRESCOS printed 2 and read 2.
      expect(runContext.warn).toHaveBeenCalledTimes(1);
      expect(runContext.warn).toHaveBeenCalledWith({
        code: HarvestWarningCode.LISTING_SHORT,
        name: expect.any(String),
        offerId: null,
        page: null,
        message: expect.stringMatching(
          /^Category 06 .*: 20 of 41 row\(s\) read\.$/
        ),
      });
      // Before the last flush, which is what writes it onto the row.
      expect(
        (runContext.warn as jest.Mock).mock.invocationCallOrder[0]
      ).toBeLessThan(
        Math.max(...(runContext.flush as jest.Mock).mock.invocationCallOrder)
      );
    });

    it('writes no listing warning for a walk that read what every category printed', async () => {
      const runContext = context();
      await new TestRunner(site(20)).run(
        runContext,
        new RecordingRunReport(),
        input,
        source
      );

      expect(runContext.warn).not.toHaveBeenCalled();
    });

    it('writes LISTING_SHORT for a category whose first page printed no count and gave rows (plan 0251)', async () => {
      const runContext = context();
      const noCount = (url: URL): Response =>
        url.pathname === '/categorias/bebidas/06'
          ? new Response(
              listing(BEBIDAS_PAGE_1, 20, '06').replace(
                '<p>20 Artículos</p>',
                ''
              )
            )
          : storefront(url);
      await new TestRunner(noCount).run(
        runContext,
        new RecordingRunReport(),
        input,
        source
      );

      expect(runContext.warn).toHaveBeenCalledTimes(1);
      expect(runContext.warn).toHaveBeenCalledWith({
        code: HarvestWarningCode.LISTING_SHORT,
        name: expect.any(String),
        offerId: null,
        page: null,
        message: expect.stringMatching(
          /^Category 06 .*: 20 row\(s\) read, no count printed\.$/
        ),
      });
    });

    it('writes LISTING_UNREAD for a category whose first page did not answer (plan 0251)', async () => {
      const runContext = context();
      const refused = (url: URL): Response =>
        url.pathname === '/categorias/bebidas/06'
          ? new Response('', { status: 403 })
          : storefront(url);
      await new TestRunner(refused).run(
        runContext,
        new RecordingRunReport(),
        input,
        source
      );

      expect(runContext.warn).toHaveBeenCalledTimes(1);
      expect(runContext.warn).toHaveBeenCalledWith({
        code: HarvestWarningCode.LISTING_UNREAD,
        name: expect.any(String),
        offerId: null,
        page: null,
        message: expect.stringMatching(
          /^Category 06 .* printed no count: its first page did not answer, and 0 row\(s\) were read\.$/
        ),
      });
    });

    it('declares nothing when the run is aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const report = new RecordingRunReport();
      await new TestRunner(site(20))
        .run(
          { ...context(), signal: controller.signal } as unknown as RunContext,
          report,
          input,
          source
        )
        .catch(() => undefined);

      expect(report.wholeListings).toEqual([]);
      expect(report.notWhole).toEqual([]);
    });
  });

  it('reads no page for a product the chain already holds, and reports it from the listing', async () => {
    const report = new RecordingRunReport();
    const runner = new TestRunner(storefront);
    await runner.run(
      context(),
      report,
      {
        ...input,
        // No EAN on this source, so every stored row is in this set.
        externalIdsWithoutEan: new Set(['101']),
      },
      source
    );

    expect(runner.sent.some((request) => request.url.endsWith('/101'))).toBe(
      false
    );
    expect(report.partialProducts).toEqual([
      {
        externalId: '101',
        detailFetched: false,
        observedAt: expect.any(Date),
        prices: [expect.objectContaining({ scopeKey: null, price: 3.49 })],
      },
    ]);
    expect(
      report.products.some((product) => product.externalId === '101')
    ).toBe(false);
  });

  it('reads every page when the run asks for ALL', async () => {
    const runner = new TestRunner(storefront);
    await runner.run(
      context(),
      new RecordingRunReport(),
      {
        ...input,
        details: HarvestDetailFetch.ALL,
        externalIdsWithoutEan: new Set(['101']),
      },
      source
    );
    expect(runner.sent.some((request) => request.url.endsWith('/101'))).toBe(
      true
    );
  });

  it('names the failed page, the failed product and the price disagreement on the report', async () => {
    const ctx = context();
    const report = new RecordingRunReport();
    await new TestRunner(storefront).run(ctx, report, input, source);

    const written = ctx.setReport.mock.calls[0][0] as Record<string, unknown>;
    expect(written).toMatchObject({
      postalCode: '21440',
      printedArticleCountSum: 27,
      listed: 22,
      onOffer: 1,
      detailPlanned: 22,
      detailRead: 21,
      detailFailed: 1,
      failedPages: [
        expect.objectContaining({
          category: '06',
          page: 2,
          error: expect.stringMatching(/403/),
        }),
      ],
      failedProducts: [expect.objectContaining({ code: '102' })],
      priceDisagreements: [{ code: '101', listing: 3.49, productPage: 3.59 }],
    });
    expect(written['categories']).toEqual([
      {
        code: '04',
        name: 'FRESCOS',
        printedCount: 2,
        rowsRead: 2,
        rowsRepeated: 0,
      },
      {
        code: '06',
        name: 'BEBIDAS',
        printedCount: 25,
        rowsRead: 20,
        rowsRepeated: 0,
      },
    ]);
    expect(written['detail']).toEqual({ pages: 22, failed: 1, timeouts: 0 });
    // One failed page and one failed product, both counted.
    const failures = ctx.report.mock.calls
      .map(([counters]) => (counters as { failed?: number }).failed ?? 0)
      .filter((failed) => failed > 0);
    expect(failures).toEqual([1, 1]);

    // A product whose page failed is still reported, with its top level category.
    const bacon = report.products.find(
      (product) => product.externalId === '102'
    );
    expect(bacon?.categoryPath).toEqual(['FRESCOS']);
    expect(bacon?.prices[0].price).toBe(8.95);
    // Marked, so the next walk reads its page again.
    expect(bacon?.extra).toEqual({ detailFailed: true });
  });

  it('asks for page 2 with a POST, as the listing form does', async () => {
    const runner = new TestRunner(storefront);
    await runner.run(context(), new RecordingRunReport(), input, source);

    const second = runner.sent.find((request) =>
      request.url.includes('pagina=2')
    );
    expect(second?.method).toBe('POST');
  });

  it('reads the page again of a known product whose page failed on an earlier walk', async () => {
    const runner = new TestRunner(storefront);
    await runner.run(
      context(),
      new RecordingRunReport(),
      {
        ...input,
        externalIdsWithoutEan: new Set(['101', '200']),
        // 200's page failed on an earlier walk, so its row carries the mark.
        externalIdsWithFailedDetail: new Set(['200']),
      },
      source
    );

    const read = (code: string) =>
      runner.sent.some((request) => request.url.endsWith(`/p/${code}`));
    expect(read('101')).toBe(false);
    expect(read('200')).toBe(true);
  });

  it('does not mark a page that was read and whose breadcrumb has one level', async () => {
    const report = new RecordingRunReport();
    await new TestRunner((url) =>
      url.pathname.endsWith('/p/101')
        ? new Response(productPage('101', '3.49', ['Frescos']))
        : storefront(url)
    ).run(context(), report, input, source);

    const rice = report.products.find(
      (product) => product.externalId === '101'
    );
    expect(rice?.categoryPath).toEqual(['Frescos']);
    // Only a failed page is read again, so this one stays known next walk.
    expect(rice?.extra).toEqual({ previousPrice: 3.99 });
  });

  it('skips a failed page after the first and goes on reading the category', async () => {
    const third: Row[] = [
      {
        code: '300',
        description: 'zumo, 1l',
        brand: 'DON SIMON',
        price: '1,20',
        unit: '1,20 €/Litro',
      },
    ];
    const ctx = context();
    const report = new RecordingRunReport();
    await new TestRunner((url) => {
      if (url.pathname === '/categorias/bebidas/06') {
        const page = url.searchParams.get(
          '_ProductosFoodPortlet_WAR_comerzziaportletsfood_pagina'
        );
        if (page === null) {
          return new Response(listing(BEBIDAS_PAGE_1, 41, '06'));
        }
        return page === '3'
          ? new Response(listing(third, 41, '06'))
          : new Response('', { status: 403 });
      }
      return storefront(url);
    }).run(ctx, report, input, source);

    const written = ctx.setReport.mock.calls[0][0] as Record<string, unknown>;
    expect(written['failedPages']).toEqual([
      expect.objectContaining({ category: '06', page: 2 }),
    ]);
    expect(written['categories']).toContainEqual(
      expect.objectContaining({ code: '06', rowsRead: 21 })
    );
    expect(
      report.products.some((product) => product.externalId === '300')
    ).toBe(true);
  });

  describe('a run that stops partway (plan 0215)', () => {
    /** The storefront with a whole listing, and a product page `onPage` may answer instead. */
    function site(onPage?: (code: string) => Response | undefined) {
      return (url: URL): Response => {
        if (url.pathname === '/categorias/bebidas/06' && url.search !== '') {
          return new Response(listing([], 25, '06'));
        }
        const code = /\/detalle\/.*\/(\d+)$/.exec(url.pathname)?.[1];
        return (code && onPage?.(code)) || storefront(url);
      };
    }

    /** Every listed row, and whether its page was read. */
    const read = (report: RecordingRunReport) =>
      new Map(
        report.products.map((product) => [
          product.externalId,
          product.extra?.[DETAIL_FAILED_KEY] !== true,
        ])
      );

    it('reports every listed row when the guard stops it, and marks the pages not read', async () => {
      const ctx = guardedContext();
      const report = new RecordingRunReport();
      const runner = new TestRunner(
        site((code) =>
          code === '200' ? new Response('', { status: 403 }) : undefined
        )
      );

      await runner.run(ctx, report, input, source);

      expect(ctx.signal.aborted).toBe(true);
      const rows = read(report);
      expect(rows.size).toBe(22);
      // The refused page and every page after it are read again by the
      // next NEW walk.
      expect(rows.get('200')).toBe(false);
      expect(rows.get('101')).toBe(true);
      expect(ctx.setReport).toHaveBeenCalled();
    });

    it('reports every listed row when a person aborts it', async () => {
      const controller = new AbortController();
      const ctx = context(controller.signal);
      const report = new RecordingRunReport();
      const runner = new TestRunner(
        site((code) => {
          if (code === '205') {
            controller.abort();
          }
          return undefined;
        })
      );

      await runner.run(ctx, report, input, source);

      const rows = read(report);
      expect(rows.size).toBe(22);
      expect([...rows.values()].some((wasRead) => !wasRead)).toBe(true);
      expect(ctx.setReport).toHaveBeenCalled();
    });

    it('reports the rows it never read from the listing alone, so the stored photo and category stay', async () => {
      const controller = new AbortController();
      const ctx = context(controller.signal);
      const report = new RecordingRunReport();
      // A person aborts while the second page is asked for, after 101's page
      // was read. One worker, so the order is the listing's.
      const runner = new TestRunner(
        site((code) => {
          if (code === '102') {
            controller.abort();
          }
          return undefined;
        })
      );

      await runner.run(
        ctx,
        report,
        { ...input, details: HarvestDetailFetch.ALL },
        { ...source, workers: 1 } as SupermarketSource
      );

      expect(report.products).toEqual([
        expect.objectContaining({
          externalId: '101',
          categoryPath: ['Frescos', 'Arroz'],
          imageUrl: expect.stringContaining('101_G.jpg'),
        }),
      ]);
      // An `ALL` walk was handed no ids, so every row may be held: none states
      // a photo or a category path, and each still carries the listing price.
      expect(report.partialProducts).toHaveLength(21);
      for (const product of report.partialProducts) {
        expect(product).not.toHaveProperty('imageUrl');
        expect(product).not.toHaveProperty('categoryPath');
        expect(product.prices).toHaveLength(1);
      }
      // The page the abort cut short is not a failed page.
      expect(ctx.report).not.toHaveBeenCalledWith({ failed: 1 });
    });

    it('marks an unread row the chain holds no row for, and reads a held one from the listing', async () => {
      const ctx = guardedContext();
      const report = new RecordingRunReport();
      const runner = new TestRunner(
        site((code) =>
          code === '101' ? new Response('', { status: 403 }) : undefined
        )
      );

      await runner.run(
        ctx,
        report,
        {
          ...input,
          // 200 was written from a page that failed last week, so it is
          // asked for again and is held.
          externalIdsWithoutEan: new Set(['200']),
          externalIdsWithFailedDetail: new Set(['200']),
        },
        source
      );

      const byId = new Map(
        [...report.products, ...report.partialProducts].map((product) => [
          product.externalId,
          product,
        ])
      );
      expect(byId.size).toBe(22);
      expect(byId.get('200')).toEqual({
        externalId: '200',
        detailFetched: false,
        observedAt: expect.any(Date),
        prices: [expect.objectContaining({ price: 0.45 })],
      });
      // Nothing is stored for 201 to clear, so it is created with the listing
      // and marked for the next `NEW` walk.
      expect(byId.get('201')).toMatchObject({
        imageUrl: null,
        categoryPath: ['BEBIDAS'],
        extra: { [DETAIL_FAILED_KEY]: true },
      });
    });

    it('reports the rows listed so far when the stop comes in the listing', async () => {
      const ctx = guardedContext();
      const report = new RecordingRunReport();
      const runner = new TestRunner((url) =>
        url.pathname === '/categorias/bebidas/06'
          ? new Response('', { status: 403 })
          : storefront(url)
      );

      await runner.run(ctx, report, input, source);

      // FRESCOS was listed before BEBIDAS was refused.
      expect([...read(report).keys()].sort()).toEqual(['101', '102']);
    });
  });

  describe('the detail stage (plan 0253)', () => {
    const BEBIDAS_PAGE_2: Row[] = Array.from({ length: 20 }, (_, index) => ({
      code: String(220 + index),
      description: `agua ${index}, 1l`,
      brand: 'SOLAN',
      price: '0,40',
      unit: '0,40 €/Litro',
    }));

    /**
     * A whole listing of 42 products, two of FRESCOS and 40 of BEBIDAS, and
     * product pages that `timesOut` makes as silent as the transport's idle
     * timeout.
     */
    function site(timesOut: (code: string) => boolean) {
      return (url: URL): Response => {
        if (url.pathname === '/categorias/bebidas/06') {
          return new Response(
            url.search === ''
              ? listing(BEBIDAS_PAGE_1, 40, '06')
              : listing(BEBIDAS_PAGE_2, 40, '06')
          );
        }
        const code = /\/detalle\/.*\/(\d+)$/.exec(url.pathname)?.[1];
        if (code && timesOut(code)) {
          throw new ElJamonTimeoutError(url.toString(), 30_000);
        }
        return storefront(url);
      };
    }

    const written = (ctx: { setReport: jest.Mock }) =>
      ctx.setReport.mock.calls[0][0] as Record<string, unknown>;

    it('moves processed as each product page is read, and ends at totalPlanned once', async () => {
      const ctx = context();
      await new TestRunner(site(() => false)).run(
        ctx,
        new RecordingRunReport(),
        // 101 is known, so it counts when the stage starts.
        { ...input, externalIdsWithoutEan: new Set(['101']) },
        source
      );

      expect(ctx.countProgressItself).toHaveBeenCalled();
      expect(ctx.setTotalPlanned).toHaveBeenCalledWith(42);
      expect(processedOf(ctx)).toBe(42);
      // The pages count during DETAIL, before INGEST starts.
      const ingest = (ctx.setStage as jest.Mock).mock.calls.findIndex(
        ([stage]) => stage === 'INGEST'
      );
      const ingestAt = (ctx.setStage as jest.Mock).mock.invocationCallOrder[
        ingest
      ];
      const perPage = ctx.report.mock.calls
        .map(([counters], index) => ({
          counters: counters as { processed?: number },
          at: ctx.report.mock.invocationCallOrder[index],
        }))
        .filter(({ counters }) => counters.processed === 1);
      // 101 when the stage starts, then 41 pages: 40 read, and 102's, which
      // carries no product and fails.
      expect(perPage).toHaveLength(42);
      expect(perPage.every(({ at }) => at < ingestAt)).toBe(true);
    });

    it('stops asking for pages after 20 timeouts in a row, and still records every listed row', async () => {
      const ctx = context();
      const report = new RecordingRunReport();
      const runner = new TestRunner(site((code) => code !== '101'));

      // One worker, so the order is the listing's and the count exact.
      await runner.run(ctx, report, input, {
        ...source,
        workers: 1,
      } as SupermarketSource);

      const asked = runner.sent.filter((request) =>
        request.url.includes('/detalle/')
      ).length;
      // 101 answered, then 20 timed out in a row, and nothing after them was
      // asked.
      expect(asked).toBe(21);
      const detail = written(ctx)['detail'] as Record<string, number>;
      expect(detail).toEqual({
        pages: asked,
        failed: asked - 1,
        timeouts: asked - 1,
      });

      // Every listed row reaches the ingest; every new product whose page was
      // not read is marked for the next walk.
      expect(report.products).toHaveLength(42);
      const unmarked = report.products.filter(
        (product) => product.extra?.[DETAIL_FAILED_KEY] !== true
      );
      expect(unmarked.map((product) => product.externalId)).toEqual(['101']);
      expect(processedOf(ctx)).toBe(42);

      expect(ctx.warn).toHaveBeenCalledTimes(1);
      expect(ctx.warn).toHaveBeenCalledWith({
        code: HarvestWarningCode.DETAIL_UNREAD,
        name: null,
        offerId: null,
        page: null,
        message:
          'Product pages stopped after 20 timeouts in a row: ' +
          `${asked} of 42 page(s) asked, ${asked - 1} failed, ` +
          `${asked - 1} timed out. 41 product(s) were recorded from the ` +
          'listing without a page, and the next walk asks for them again.',
      });
      // The listing was whole, so the stop costs no listing declaration.
      expect(report.wholeListings).toHaveLength(1);
    });

    it('reads every page when the timeouts never reach 20 in a row', async () => {
      const ctx = context();
      const report = new RecordingRunReport();
      // Every other page times out, 20 in all, with an answer between each.
      const runner = new TestRunner(
        site((code) => Number(code) % 2 === 0 && code !== '102')
      );

      await runner.run(ctx, report, input, {
        ...source,
        workers: 1,
      } as SupermarketSource);

      const asked = runner.sent.filter((request) =>
        request.url.includes('/detalle/')
      ).length;
      expect(asked).toBe(42);
      const detail = written(ctx)['detail'] as Record<string, number>;
      expect(detail.pages).toBe(42);
      expect(detail.timeouts).toBe(20);
      expect(ctx.warn).not.toHaveBeenCalled();
      expect(processedOf(ctx)).toBe(42);
    });
  });
});
