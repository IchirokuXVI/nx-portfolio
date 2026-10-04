import type { ConfigService } from '@nestjs/config';
import { HarvestDetailFetch } from '@portfolio/luna-shopper/contracts';
import { ElJamonClient } from '@portfolio/luna-shopper/eljamon';
import type { SupermarketSource } from '../entities';
import type { CatalogDiscoveryInput } from './catalog-runner';
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

  protected override createClient(): ElJamonClient {
    return new ElJamonClient({
      userAgent: 'LunaShopperBot/1.0',
      baseUrl: BASE,
      sleepImpl: async () => undefined,
      retries: 0,
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

function context(): RunContext & { setReport: jest.Mock; report: jest.Mock } {
  return {
    runId: 'run-1',
    signal: new AbortController().signal,
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
      sizeFormat: '1kg',
      packCount: null,
      categoryPath: ['Frescos', 'Arroz'],
      url: `${BASE}/detalle/-/Producto/p/101`,
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
});
