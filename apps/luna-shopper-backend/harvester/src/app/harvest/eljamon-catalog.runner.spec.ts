import type { ConfigService } from '@nestjs/config';
import { HarvestDetailFetch } from '@portfolio/luna-shopper/contracts';
import { ElJamonClient } from '@portfolio/luna-shopper/eljamon';
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
  } as unknown as RunContext & { setReport: jest.Mock; report: jest.Mock };
}

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
      { code: '04', name: 'FRESCOS', printedCount: 2, rowsRead: 2 },
      { code: '06', name: 'BEBIDAS', printedCount: 25, rowsRead: 20 },
    ]);
    // One failed page and one failed product, both counted.
    expect(ctx.report).toHaveBeenCalledTimes(2);

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
});
