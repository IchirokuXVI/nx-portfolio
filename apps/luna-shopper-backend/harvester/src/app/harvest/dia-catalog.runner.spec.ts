import { DiaClient, DiaStoppedError } from '@portfolio/luna-shopper/dia';
import type { SupermarketSource } from '../entities';
import type { CatalogDiscoveryInput } from './catalog-runner';
import { DiaCatalogRunner } from './dia-catalog.runner';
import {
  fakeDiaSite,
  type FakeDiaLeaf,
  type FakeDiaRow,
  type FakeDiaWorld,
} from './dia-site.fake';
import type { RunContext } from './run-context';
import { RecordingRunReport } from './run-report';

/**
 * Catalog discovery against DIA's online shop (plan 0174, section 6).
 *
 * **Nothing here reaches a network.** What it pins: one session per walked
 * fulfilment store, confirmed before it is walked; the regular price and never
 * the Club Dia one; the national row written only when its store was walked
 * and a default scope was given; availability per store; and a report that
 * names what was skipped, moved, unmapped or failed.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const RUN = '33333333-3333-4333-8333-333333333333';
const NATIONAL_SCOPE = '5efa0000-0000-4000-a000-0000000000a1';

const MADRID = { id: 'scope-madrid', externalKey: '13835' };
const BARCELONA = { id: 'scope-barcelona', externalKey: '959' };

const COLA: FakeDiaLeaf = {
  id: 'L2108',
  name: 'Cola',
  path: '/agua-y-refrescos/cola/c/L2108',
  rootId: 'L117',
  rootName: 'Agua y refrescos',
};
const PACKS: FakeDiaLeaf = {
  id: 'L2286',
  name: 'Packs de agua y refrescos',
  path: '/agua-y-refrescos/packs-de-agua-y-refrescos/c/L2286',
  rootId: 'L117',
  rootName: 'Agua y refrescos',
};

const COKE: FakeDiaRow = {
  sku: '659',
  name: 'Coca-Cola 2 L',
  brand: 'Coca-Cola',
  price: 2.15,
  unitPrice: 1.08,
};
const COKE_PACK: FakeDiaRow = {
  sku: '38406',
  name: 'Coca-Cola 2 x 2 L',
  brand: 'Coca-Cola',
  price: 4.09,
  unitPrice: 1.02,
};

/** Two stores: Madrid, which the anonymous session is priced by, and Barcelona. */
function world(overrides: Partial<FakeDiaWorld> = {}): FakeDiaWorld {
  return {
    served: { '28041': '13835', '08820': '959' },
    leaves: [COLA, PACKS],
    listings: {
      '13835': { L2108: [COKE, COKE_PACK], L2286: [COKE_PACK] },
      '959': { L2108: [{ ...COKE, price: 2.69, unitPrice: 1.35 }] },
    },
    ...overrides,
  };
}

/** Both stores state their postal code on the source row, so no file is read. */
const POSTAL_CODES = { '13835': '28041', '959': '08820' };

class TestRunner extends DiaCatalogRunner {
  readonly sent: string[];
  private readonly fetchImpl: typeof fetch;
  client: DiaClient | null = null;

  constructor(site: FakeDiaWorld) {
    super();
    const fake = fakeDiaSite(site);
    this.fetchImpl = fake.fetchImpl;
    this.sent = fake.sent;
  }

  protected override createClient(): DiaClient {
    this.client = new DiaClient({
      fetchImpl: this.fetchImpl,
      minIntervalMs: 0,
      sleepImpl: async () => undefined,
    });
    return this.client;
  }
}

function context(
  signal: AbortSignal = new AbortController().signal
): RunContext & {
  setReport: jest.Mock;
  setTotalPlanned: jest.Mock;
  report: jest.Mock;
} {
  return {
    runId: RUN,
    signal,
    acquire: async () => undefined,
    setStage: jest.fn(async () => undefined),
    setTotalPlanned: jest.fn(async () => undefined),
    setReport: jest.fn(async () => undefined),
    report: jest.fn(async () => undefined),
    heartbeat: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
    warn: jest.fn(),
  } as unknown as RunContext & {
    setReport: jest.Mock;
    setTotalPlanned: jest.Mock;
    report: jest.Mock;
  };
}

const source = (config: Record<string, unknown> = {}): SupermarketSource =>
  ({
    adapterKey: 'dia-api',
    config: { scopePostalCodes: POSTAL_CODES, ...config },
    workers: 1,
  }) as unknown as SupermarketSource;

const input = (
  overrides: Partial<CatalogDiscoveryInput> = {}
): CatalogDiscoveryInput => ({
  supermarketId: CHAIN,
  priceScopeId: NATIONAL_SCOPE,
  priceScopes: [MADRID, BARCELONA],
  ...overrides,
});

const reportOf = (ctx: { setReport: jest.Mock }): Record<string, unknown> =>
  ctx.setReport.mock.calls[ctx.setReport.mock.calls.length - 1][0];

describe('DiaCatalogRunner', () => {
  let report: RecordingRunReport;

  beforeEach(() => {
    report = new RecordingRunReport();
  });

  it('refuses a walk that was given no fulfilment store', async () => {
    const runner = new TestRunner(world());
    await expect(
      runner.run(context(), report, input({ priceScopes: [] }), source())
    ).rejects.toThrow(/store discovery first/);
    expect(runner.sent).toEqual([]);
  });

  it('declares each walked store as a LOCAL_AREA scope, and never a national one', async () => {
    const runner = new TestRunner(world());
    await runner.run(context(), report, input(), source());

    expect(report.scopes).toEqual([
      { key: '13835', kind: 'LOCAL_AREA', name: null },
      { key: '959', kind: 'LOCAL_AREA', name: null },
    ]);
  });

  it('reports one product per sku, with one regular price per store that listed it', async () => {
    const runner = new TestRunner(world());
    await runner.run(context(), report, input(), source());

    expect(report.products.map((product) => product.externalId)).toEqual([
      '659',
      '38406',
    ]);
    const coke = report.products[0];
    expect(coke).toMatchObject({
      externalId: '659',
      name: 'Coca-Cola',
      brand: 'Coca-Cola',
      ean: null,
      sizeFormat: '2 L',
      unitSize: 2,
      packCount: null,
      categoryPath: ['Agua y refrescos', 'Cola'],
      url: 'https://www.dia.es/agua-y-refrescos/cola/p/659',
    });
    expect(
      coke.prices.map((price) => [price.scopeKey, price.price, price.unitPrice])
    ).toEqual([
      ['13835', 2.15, 1.08],
      // The national row: the anonymous session's store, written once more
      // with no scope key (section 3.2).
      [null, 2.15, 1.08],
      ['959', 2.69, 1.35],
    ]);
    expect(coke.prices.every((price) => price.currency === 'EUR')).toBe(true);
    expect(coke.prices.every((price) => price.validFrom === null)).toBe(true);
    expect(coke.prices.every((price) => price.unitPriceLabel === 'LITRO')).toBe(
      true
    );
  });

  it('merges every leaf a product was listed under, in walk order', async () => {
    const runner = new TestRunner(world());
    await runner.run(context(), report, input(), source());

    const pack = report.products[1];
    expect(pack.extra).toMatchObject({
      diaCategoryIds: ['L2108', 'L2286'],
      image: 'https://www.dia.es/product_images/38406/38406_ISO_0_ES.jpg',
    });
    // The path is the first leaf's. The pack is read as a pack of two.
    expect(pack.categoryPath).toEqual(['Agua y refrescos', 'Cola']);
    expect(pack).toMatchObject({
      sizeFormat: '2 x 2 L',
      unitSize: 4,
      packCount: 2,
    });
  });

  it('writes the national row only for the store an anonymous visitor is priced by', async () => {
    const runner = new TestRunner(world());
    const ctx = context();
    await runner.run(ctx, report, input(), source());

    const national = report.products.flatMap((product) =>
      product.prices.filter((price) => price.scopeKey === null)
    );
    // Both products are listed in Madrid, so both have a national price, and
    // neither takes Barcelona's.
    expect(national.map((price) => price.price)).toEqual([2.15, 4.09]);
    expect(reportOf(ctx)['nationalFrom']).toEqual({
      postalCode: '28041',
      store: '13835',
    });
  });

  it('writes no national row when the anonymous store is not walked, and says why', async () => {
    const runner = new TestRunner(world());
    const ctx = context();
    await runner.run(
      ctx,
      report,
      input({ priceScopes: [BARCELONA] }),
      source()
    );

    expect(
      report.products.flatMap((product) =>
        product.prices.map((price) => price.scopeKey)
      )
    ).toEqual(['959']);
    expect(reportOf(ctx)['nationalFrom']).toBeNull();
    expect(reportOf(ctx)['nationalReason']).toMatch(/13835.*did not walk/);
  });

  it('writes no national row when the run has no default scope, and says why', async () => {
    const runner = new TestRunner(world());
    const ctx = context();
    await runner.run(ctx, report, input({ priceScopeId: undefined }), source());

    expect(
      report.products.some((product) =>
        product.prices.some((price) => price.scopeKey === null)
      )
    ).toBe(false);
    expect(reportOf(ctx)['nationalFrom']).toBeNull();
    expect(reportOf(ctx)['nationalReason']).toMatch(/no default scope/);
  });

  it('writes the regular price of a club row, and the club price as loyalty only', async () => {
    const club: FakeDiaRow = {
      sku: '85',
      name: 'Agua mineral Font Vella 1,5 L',
      brand: 'Font Vella',
      price: 0.69,
      strikethrough: 0.77,
      unitPrice: 0.46,
      club: true,
      promotions: [{ description: '10% DTO.', only_club_dia: true }],
    };
    const runner = new TestRunner(
      world({ listings: { '13835': { L2108: [club] } } })
    );
    const ctx = context();
    await runner.run(ctx, report, input({ priceScopes: [MADRID] }), source());

    const [water] = report.products;
    expect(water.prices.map((price) => price.price)).toEqual([0.77, 0.77]);
    expect(water.prices.map((price) => price.unitPrice)).toEqual([0.51, 0.51]);
    expect(water.extra).toMatchObject({
      loyalty: { program: 'CLUB_DIA', price: 0.69, unitPrice: 0.46 },
      unitPriceScaled: true,
      promotion: {
        entries: [
          {
            description: '10% DTO.',
            short_description: null,
            only_club_dia: true,
          },
        ],
      },
    });
    expect(reportOf(ctx)).toMatchObject({
      clubPrices: 1,
      promotions: 1,
      unitPriceScaled: 1,
    });
  });

  it('states availability per store: in stock, out of stock, and not listed there', async () => {
    const runner = new TestRunner(
      world({
        listings: {
          '13835': { L2108: [COKE, { ...COKE_PACK, stock: 0 }] },
          '959': { L2108: [COKE] },
        },
      })
    );
    await runner.run(context(), report, input(), source());

    expect(report.availabilities).toEqual([
      { externalId: '659', available: true, scopeKey: '13835' },
      { externalId: '659', available: true, scopeKey: '959' },
      // Listed in Madrid with no stock.
      { externalId: '38406', available: false, scopeKey: '13835' },
      // Not listed in Barcelona, and Madrid listed it in this run.
      { externalId: '38406', available: false, scopeKey: '959' },
    ]);
    // About 7,600 products are in the sitemap and a walk lists about 5,700,
    // so no walk proves the assortment whole (section 6.5).
    expect(report.completed).toEqual([]);
  });

  it('starts one session per store and confirms it before it walks', async () => {
    const runner = new TestRunner(world());
    await runner.run(context(), report, input(), source());

    const puts = runner.sent.filter((request) => request.startsWith('PUT'));
    expect(puts).toEqual([
      'PUT /api/v1/common-aggregator/save-shipping-address?new_postal_code=28041',
      'PUT /api/v1/common-aggregator/save-shipping-address?new_postal_code=08820',
    ]);
    // After each PUT: the header, then check-service, then the first listing.
    const firstPut = runner.sent.indexOf(puts[0]);
    expect(runner.sent.slice(firstPut + 1, firstPut + 4)).toEqual([
      'GET /api/v1/common-aggregator/header-data',
      'GET /api/v1/common-aggregator/check-service?postal_code=28041',
      `GET /api/v1/plp-back/reduced${COLA.path}`,
    ]);
    // The menu is read once for the run, not once per store.
    expect(
      runner.sent.filter((request) => request.endsWith('/menu-data'))
    ).toHaveLength(1);
  });

  it('skips a store whose postal code has no online service, and never walks it', async () => {
    const runner = new TestRunner(world());
    const ctx = context();
    await runner.run(
      ctx,
      report,
      input(),
      // 44200 is not served: the PUT answers 206 and the session keeps 28041.
      source({ scopePostalCodes: { '13835': '28041', '959': '44200' } })
    );

    expect(reportOf(ctx)['skippedScopes']).toEqual([
      expect.objectContaining({
        scope: '959',
        reason: 'refused',
        postalCode: '44200',
      }),
    ]);
    expect(
      report.products.flatMap((product) =>
        product.prices.map((price) => price.scopeKey)
      )
    ).not.toContain('959');
    // A skipped store proved nothing absent, so it states no availability.
    expect(
      report.availabilities.some((claim) => claim.scopeKey === '959')
    ).toBe(false);
  });

  it('skips a store whose postal code another store serves', async () => {
    const runner = new TestRunner(world());
    const ctx = context();
    await runner.run(
      ctx,
      report,
      input({ priceScopes: [BARCELONA] }),
      // Madrid's code, given for Barcelona's store.
      source({ scopePostalCodes: { '959': '28041' } })
    );

    expect(reportOf(ctx)['skippedScopes']).toEqual([
      expect.objectContaining({ scope: '959', reason: 'store-mismatch' }),
    ]);
    expect(report.products).toEqual([]);
  });

  it('reads the postal code of a store from its own detail when the row states none', async () => {
    const runner = new TestRunner(
      world({
        shops: [
          {
            idTienda: 1003553,
            codigoTienda: 959,
            province: 8,
            latitude: 41.3,
            longitude: 2.1,
            detail: { codigoPostal: '08820', localidad: 'Prat de Llobregat' },
          },
        ],
      })
    );
    const ctx = context();
    await runner.run(
      ctx,
      report,
      input({ priceScopes: [BARCELONA] }),
      source({ scopePostalCodes: {} })
    );

    expect(reportOf(ctx)['scopes']).toEqual([
      expect.objectContaining({
        scope: '959',
        postalCode: '08820',
        listed: 1,
        finished: true,
      }),
    ]);
    expect(
      runner.sent.filter((request) => request.includes('tiendas.v1.json.gz'))
    ).toHaveLength(1);
  });

  it('skips a store the shop file does not hold, by name', async () => {
    const runner = new TestRunner(world({ shops: [] }));
    const ctx = context();
    await runner.run(
      ctx,
      report,
      input({ priceScopes: [BARCELONA] }),
      source({ scopePostalCodes: {} })
    );

    expect(reportOf(ctx)['skippedScopes']).toEqual([
      expect.objectContaining({ scope: '959', reason: 'store-not-in-file' }),
    ]);
  });

  it('follows a moved leaf and names it', async () => {
    const moved = '/agua-y-refrescos/refrescos-de-cola/c/L2108';
    const runner = new TestRunner(world({ moved: { [COLA.path]: moved } }));
    const ctx = context();
    await runner.run(ctx, report, input({ priceScopes: [MADRID] }), source());

    expect(reportOf(ctx)['movedLeaves']).toEqual([
      { id: 'L2108', from: COLA.path, to: moved },
    ]);
    expect(report.products.map((product) => product.externalId)).toContain(
      '659'
    );
  });

  it('names a leaf the category table does not know, and one whose name changed', async () => {
    const fresh: FakeDiaLeaf = {
      ...COLA,
      id: 'L9999',
      name: 'Una hoja nueva',
      path: '/agua-y-refrescos/una-hoja-nueva/c/L9999',
    };
    const renamed: FakeDiaLeaf = { ...COLA, name: 'Refrescos de cola' };
    // Novedades maps to nothing on purpose, so it is not news.
    const novedades: FakeDiaLeaf = {
      id: 'L2302',
      name: 'Novedades',
      path: '/novedades-y-recomendados/novedades/c/L2302',
      rootId: 'L128',
      rootName: 'Novedades y recomendados',
    };
    const runner = new TestRunner(
      world({ leaves: [renamed, fresh, novedades], listings: {} })
    );
    const ctx = context();
    await runner.run(ctx, report, input({ priceScopes: [MADRID] }), source());

    expect(reportOf(ctx)['unmappedLeaves']).toEqual([
      { id: 'L9999', name: 'Una hoja nueva' },
    ]);
    expect(reportOf(ctx)['renamedLeaves']).toEqual([
      { id: 'L2108', was: 'Cola', is: 'Refrescos de cola' },
    ]);
  });

  it('walks every page of a leaf, and plans a leaf per store', async () => {
    const many = Array.from({ length: 45 }, (_, index) => ({
      ...COKE,
      sku: `sku-${index}`,
    }));
    const runner = new TestRunner(
      world({ leaves: [COLA], listings: { '13835': { L2108: many } } })
    );
    const ctx = context();
    await runner.run(ctx, report, input({ priceScopes: [MADRID] }), source());

    expect(report.products).toHaveLength(45);
    expect(
      runner.sent.filter((request) => request.includes(COLA.path))
    ).toEqual([
      `GET /api/v1/plp-back/reduced${COLA.path}`,
      `GET /api/v1/plp-back/reduced${COLA.path}?page=2`,
      `GET /api/v1/plp-back/reduced${COLA.path}?page=3`,
    ]);
    expect(ctx.setTotalPlanned).toHaveBeenCalledWith(1);
    expect(reportOf(ctx)['leaves']).toEqual([
      { id: 'L2108', name: 'Cola', printedTotal: 45, rowsRead: 45 },
    ]);
  });

  it('names a failed page, goes on, and states no absence for that store', async () => {
    const many = Array.from({ length: 45 }, (_, index) => ({
      ...COKE,
      sku: `sku-${index}`,
    }));
    const runner = new TestRunner(
      world({
        leaves: [COLA],
        listings: {
          '13835': { L2108: many },
          '959': { L2108: [{ ...COKE, sku: 'only-barcelona' }] },
        },
        fail: (_, path) => (path.endsWith('?page=2') ? 404 : undefined),
      })
    );
    const ctx = context();
    await runner.run(ctx, report, input(), source());

    expect(reportOf(ctx)['failedPages']).toEqual([
      expect.objectContaining({
        scope: '13835',
        leaf: 'L2108',
        page: 2,
        error: expect.stringContaining('404'),
      }),
    ]);
    // Pages 1 and 3 were read.
    expect(report.products).toHaveLength(26);
    expect(ctx.report).toHaveBeenCalledWith({ failed: 1 });
    // Madrid's walk has a hole, so it cannot say Barcelona's product is absent
    // there. Barcelona's walk was whole, so it says Madrid's are absent.
    expect(
      report.availabilities.filter(
        (claim) => claim.scopeKey === '13835' && !claim.available
      )
    ).toEqual([]);
    expect(
      report.availabilities.filter(
        (claim) => claim.scopeKey === '959' && !claim.available
      )
    ).toHaveLength(25);
  });

  it('stops after five failed requests in a row, and names the last error', async () => {
    const leaves = Array.from({ length: 8 }, (_, index) => ({
      ...COLA,
      id: `L30${index}`,
      path: `/agua-y-refrescos/hoja-${index}/c/L30${index}`,
    }));
    const runner = new TestRunner(
      world({
        leaves,
        fail: (_, path) => (path.includes('/plp-back/') ? 404 : undefined),
      })
    );
    const ctx = context();

    await expect(
      runner.run(ctx, report, input({ priceScopes: [MADRID] }), source())
    ).rejects.toBeInstanceOf(DiaStoppedError);

    // Five listing requests and not eight: the rest were never asked for.
    expect(
      runner.sent.filter((request) => request.includes('/plp-back/'))
    ).toHaveLength(5);
    expect(reportOf(ctx)['stoppedBy']).toMatch(/404/);
    expect(reportOf(ctx)['failedPages']).toHaveLength(4);
    expect(report.products).toEqual([]);
  });

  it('reports what it read and the requests it made', async () => {
    const runner = new TestRunner(world());
    const ctx = context();
    await runner.run(ctx, report, input(), source());

    expect(reportOf(ctx)).toMatchObject({
      listed: 2,
      scopes: [
        {
          scope: '13835',
          postalCode: '28041',
          listed: 2,
          inStock: 2,
          leaves: 2,
        },
        { scope: '959', postalCode: '08820', listed: 1, inStock: 1, leaves: 2 },
      ],
      skippedScopes: [],
      movedLeaves: [],
      unparsedSizes: { count: 0, examples: [] },
      // Coca-Cola 2 L is 2.15 in Madrid and 2.69 in Barcelona.
      priceDifferences: [{ scopes: ['13835', '959'], inBoth: 1, differ: 1 }],
      failedPages: [],
      requests: runner.client?.requests,
    });
  });

  it('counts a name whose format it cannot read, with examples', async () => {
    const runner = new TestRunner(
      world({
        leaves: [COLA],
        listings: {
          '13835': { L2108: [{ ...COKE, name: 'Sandía entera' }] },
        },
      })
    );
    const ctx = context();
    await runner.run(ctx, report, input({ priceScopes: [MADRID] }), source());

    expect(report.products[0]).toMatchObject({
      name: 'Sandía entera',
      sizeFormat: null,
      unitSize: null,
    });
    expect(reportOf(ctx)['unparsedSizes']).toEqual({
      count: 1,
      examples: ['Sandía entera'],
    });
  });

  it('writes positives only when the run is aborted', async () => {
    const controller = new AbortController();
    const runner = new TestRunner(
      world({
        // The abort lands while Barcelona's first listing is read.
        fail: (_, path) => {
          if (path.includes('new_postal_code=08820')) {
            controller.abort();
          }
          return undefined;
        },
      })
    );
    await runner
      .run(context(controller.signal), report, input(), source())
      .catch(() => undefined);

    expect(report.availabilities.every((claim) => claim.available)).toBe(true);
  });
});
