import { DIA_REFUSAL_POLICY, DiaClient } from '@portfolio/luna-shopper/dia';
import {
  SourceBlockedError,
  SourceGuard,
} from '@portfolio/luna-shopper/source-guard';
import type { HarvestRun, SupermarketSource } from '../entities';
import { TokenBucket } from '../runner/token-bucket';
import type { CatalogDiscoveryInput } from './catalog-runner';
import { DiaCatalogRunner } from './dia-catalog.runner';
import {
  fakeDiaSite,
  type FakeDiaLeaf,
  type FakeDiaRow,
  type FakeDiaWorld,
} from './dia-site.fake';
import type { HarvestRunStore } from './harvest-run.store';
import { RunContext } from './run-context';
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

  protected override createClient(context: RunContext): DiaClient {
    this.client = new DiaClient({
      fetchImpl: this.fetchImpl,
      minIntervalMs: 0,
      sleepImpl: async () => undefined,
      // The run's guard and gate, as the runtime passes them (plan 0215).
      acquire: context.acquire,
      guard: context.guard,
      signal: context.signal,
    });
    return this.client;
  }
}

/**
 * A context with the run's refusal guard, wired the way `RunExecutor` wires
 * it: its stop aborts the run with the stop as the reason (plan 0215).
 */
function guardedContext(): ReturnType<typeof context> {
  const controller = new AbortController();
  const ctx = context(controller.signal);
  const guard = new SourceGuard(DIA_REFUSAL_POLICY, {
    onStop: (stop) => controller.abort(new SourceBlockedError(stop)),
  });
  return Object.assign(ctx, {
    guard,
    acquire: () => guard.admit(controller.signal),
  });
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
    countProgressItself: jest.fn(),
    heartbeat: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
    warn: jest.fn(),
  } as unknown as RunContext & {
    setReport: jest.Mock;
    setTotalPlanned: jest.Mock;
    report: jest.Mock;
  };
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
      sizeUnit: 'LITER',
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
    });
    // The listing's path, made absolute, is the row's photo address now and
    // is not in the bag any more (plan 0198).
    expect(pack.extra).not.toHaveProperty('image');
    expect(pack.imageUrl).toBe(
      'https://www.dia.es/product_images/38406/38406_ISO_0_ES.jpg'
    );
    // The path is the first leaf's. The pack is read as a pack of two.
    expect(pack.categoryPath).toEqual(['Agua y refrescos', 'Cola']);
    expect(pack).toMatchObject({
      sizeFormat: '2 x 2 L',
      unitSize: 4,
      sizeUnit: 'LITER',
      packCount: 2,
    });
  });

  it('reads a dimension as one object and no pack (plan 0183)', async () => {
    const foil: FakeDiaRow = {
      sku: '70001',
      name: 'Papel de horno Dia 2 x 30 m',
      brand: 'Dia',
      price: 1.99,
      unitPrice: 0.03,
    };
    const cloth: FakeDiaRow = {
      sku: '70002',
      name: 'Mantel de papel Dia 60 x 40 cm',
      brand: 'Dia',
      price: 2.49,
      unitPrice: 2.49,
    };
    const beer: FakeDiaRow = {
      sku: '70003',
      name: 'Cerveza especial 6 x 33 cl',
      brand: 'Dia',
      price: 3.3,
      unitPrice: 1.67,
    };
    const runner = new TestRunner(
      world({
        leaves: [COLA],
        listings: { '13835': { L2108: [foil, cloth, beer] }, '959': {} },
      })
    );
    await runner.run(context(), report, input(), source());

    const byId = new Map(
      report.products.map((product) => [product.externalId, product])
    );
    // The printed text is the key and stays. The numbers are the sides of one
    // roll and of one cloth, so there is no size and no pack of 2 or of 60.
    expect(byId.get('70001')).toMatchObject({
      name: 'Papel de horno Dia',
      sizeFormat: '2 x 30 m',
      unitSize: null,
      sizeUnit: null,
      packCount: null,
    });
    expect(byId.get('70002')).toMatchObject({
      name: 'Mantel de papel Dia',
      sizeFormat: '60 x 40 cm',
      unitSize: null,
      sizeUnit: null,
      packCount: null,
    });
    // A volume is content, so six cans are still six.
    expect(byId.get('70003')).toMatchObject({
      sizeFormat: '6 x 33 cl',
      unitSize: 1980,
      sizeUnit: 'MILLILITER',
      packCount: 6,
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

  describe('a row printed aprox. (plan 0244, section 5.3)', () => {
    /** As `listing-weight.json` prints it: 1.59 the piece, 1.99 a kilo. */
    const APPLES: FakeDiaRow = {
      sku: '275431',
      name: 'Manzana roja granel 800 g aprox.',
      price: 1.59,
      unitPrice: 1.99,
      unit: 'KILO',
    };
    const run = async (row: FakeDiaRow) => {
      const runner = new TestRunner(
        world({ listings: { '13835': { L2108: [row] } } })
      );
      await runner.run(
        context(),
        report,
        input({ priceScopes: [MADRID] }),
        source()
      );
      return report.products[0];
    };

    it('is sold by weight at the price of a kilo, with no size and the weight of one piece', async () => {
      const apples = await run(APPLES);

      expect(apples).toMatchObject({
        soldByWeight: true,
        approxWeight: 800,
        unitSize: null,
        sizeUnit: null,
        sizeFormat: '800 g aprox.',
      });
      // The piece price DIA prints is not written (D1).
      expect(apples.prices.map((price) => price.price)).toEqual([1.99, 1.99]);
      expect(apples.prices.map((price) => price.unitPrice)).toEqual([
        1.99, 1.99,
      ]);
    });

    it('is a piece priced as one when its comparison is not per kilo', async () => {
      const tray = await run({ ...APPLES, unit: 'UNIDAD', unitPrice: 1.59 });

      expect(tray).toMatchObject({
        soldByWeight: false,
        approxWeight: 800,
        unitSize: null,
        sizeUnit: null,
      });
      expect(tray.prices.map((price) => price.price)).toEqual([1.59, 1.59]);
    });

    it('applies the club scaling of plan 0174 to the price of a kilo', async () => {
      // A club row: 1.59 for members, 1.79 regular, 1.99 a kilo at the club
      // price. D2 scales the kilo to the regular price: 1.99 × 1.79 / 1.59.
      const club = await run({
        ...APPLES,
        price: 1.59,
        strikethrough: 1.79,
        club: true,
        promotions: [{ description: '10% DTO.', only_club_dia: true }],
      });

      expect(club.soldByWeight).toBe(true);
      expect(club.prices.map((price) => price.price)).toEqual([2.24, 2.24]);
      expect(club.prices[0].price).toBe(club.prices[0].unitPrice);
    });

    it('writes no price for a scope whose listing prints no price per kilo on a row sold by weight', async () => {
      // Madrid is the identity row and compares per KILO. Barcelona lists
      // the same piece compared per UNIDAD, so it prints only the piece.
      const runner = new TestRunner(
        world({
          listings: {
            '13835': { L2108: [APPLES] },
            '959': { L2108: [{ ...APPLES, unit: 'UNIDAD', unitPrice: 1.59 }] },
          },
        })
      );
      await runner.run(context(), report, input(), source());
      const [apples] = report.products;

      expect(apples.soldByWeight).toBe(true);
      expect(
        apples.prices.map((price) => [price.scopeKey, price.price])
      ).toEqual([
        ['13835', 1.99],
        [null, 1.99],
      ]);
    });

    it('leaves a fixed pack beside it exactly as it was', async () => {
      const pears = await run({
        sku: '1',
        name: 'Pera conferencia bandeja 700 g',
        price: 1.79,
        unitPrice: 2.56,
        unit: 'KILO',
      });

      expect(pears).toMatchObject({
        soldByWeight: false,
        approxWeight: null,
        unitSize: 700,
        sizeUnit: 'GRAM',
      });
      expect(pears.prices[0].price).toBe(1.79);
    });
  });

  it('states availability per store: in stock, and listed with no stock as sold and out of stock (plan 0220)', async () => {
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
      {
        externalId: '659',
        available: true,
        outOfStock: false,
        scopeKey: '13835',
      },
      {
        externalId: '659',
        available: true,
        outOfStock: false,
        scopeKey: '959',
      },
      // Listed in Madrid with no stock: sold, out of stock, never hidden.
      {
        externalId: '38406',
        available: true,
        outOfStock: true,
        scopeKey: '13835',
      },
      // Not listed in Barcelona: no claim. The listing diff states it.
    ]);
    // About 7,600 products are in the sitemap and a walk lists about 5,700,
    // so no walk proves the assortment whole (section 6.5).
    expect(report.completed).toEqual([]);
    // But each store's listing was read whole, and is handed over with every
    // product it listed, the one with no stock included (plan 0220, 2.2).
    expect(report.wholeListings).toEqual([
      { scopeKey: '13835', listed: ['659', '38406'] },
      { scopeKey: '959', listed: ['659'] },
    ]);
    // The national copy of the anonymous store's prices is not a walk of it.
    expect(
      report.wholeListings.some((listing) => listing.scopeKey === null)
    ).toBe(false);
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
    // It was never opened, so it declares no listing at all.
    expect(report.wholeListings.map((listing) => listing.scopeKey)).toEqual([
      '13835',
    ]);
    expect(report.notWhole).toEqual([]);
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

  it('knows every leaf and name of the menu of 2026-11-11 (plan 0254)', async () => {
    const leaf = (
      id: string,
      name: string,
      path: string,
      rootId: string,
      rootName: string
    ): FakeDiaLeaf => ({ id, name, path: `${path}/c/${id}`, rootId, rootName });
    const navidad = (id: string, name: string, slug: string) =>
      leaf(id, name, `/navidad/${slug}`, 'L124', 'Navidad');
    const belleza = (id: string, name: string, slug: string) =>
      leaf(id, name, `/cabello-y-belleza/${slug}`, 'L130', 'Cabello y belleza');
    const added = [
      navidad('L2355', 'Caldos y cremas', 'caldos-y-cremas'),
      navidad('L2222', 'Ibéricos y quesos', 'ibericos-y-quesos'),
      navidad(
        'L2230',
        'Carnes, pescados y mariscos',
        'carnes-pescados-y-mariscos'
      ),
      navidad('L2255', 'Platos especiales', 'platos-especiales'),
      navidad(
        'L2356',
        'Bombones, chocolates y trufas',
        'bombones-chocolates-y-trufas'
      ),
      navidad('L2258', 'Mesa y hogar', 'mesa-y-hogar'),
      leaf(
        'L2353',
        'Turrones y dulces de Navidad',
        '/chocolates-y-golosinas/turrones-y-dulces-de-navidad',
        'L110',
        'Chocolates y golosinas'
      ),
      leaf(
        'L2354',
        'Especial otoño',
        '/novedades-y-recomendados/especial-otono',
        'L128',
        'Novedades y recomendados'
      ),
      belleza('L2358', 'Limpieza facial', 'limpieza-facial'),
      belleza('L2359', 'Cremas y cuidado facial', 'cremas-y-cuidado-facial'),
      belleza(
        'L2360',
        'Perfumes y colonias mujer',
        'perfumes-y-colonias-mujer'
      ),
      belleza(
        'L2361',
        'Perfumes y colonias hombre',
        'perfumes-y-colonias-hombre'
      ),
      belleza(
        'L2362',
        'Colonias infantiles y familiares',
        'colonias-infantiles-y-familiares'
      ),
    ];
    const renamed = [
      leaf('L2030', 'Ensaladas', '/verduras/ensaladas', 'L104', 'Verduras'),
      leaf(
        'L2025',
        'Verduras congeladas',
        '/verduras/verduras-congeladas',
        'L104',
        'Verduras'
      ),
      leaf('L2015', 'Pavo y conejo', '/carnes/pavo-y-conejo', 'L102', 'Carnes'),
      leaf(
        'L2136',
        'Roscones, tartas y churros',
        '/congelados-y-helados/roscones-tartas-y-churros',
        'L119',
        'Congelados y helados'
      ),
      leaf(
        'L2140',
        'Pouches y snacks',
        '/infantil/pouches-y-snacks',
        'L120',
        'Infantil'
      ),
    ];
    const runner = new TestRunner(
      world({ leaves: [...added, ...renamed], listings: {} })
    );
    const ctx = context();
    await runner.run(ctx, report, input({ priceScopes: [MADRID] }), source());

    expect(reportOf(ctx)['unmappedLeaves']).toEqual([]);
    expect(reportOf(ctx)['renamedLeaves']).toEqual([]);
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

  it('counts progress in leaves, the unit it plans in, and the ingest adds nothing (plan 0217)', async () => {
    const many = Array.from({ length: 45 }, (_, index) => ({
      ...COKE,
      sku: `sku-${index}`,
    }));
    const runner = new TestRunner(
      world({ leaves: [COLA], listings: { '13835': { L2108: many } } })
    );
    const counting = countingContext();

    await runner.run(
      counting.context,
      report,
      input({ priceScopes: [MADRID] }),
      source()
    );
    // What the ingest does with each product it is handed.
    await counting.context.advance(report.products.length);
    await counting.context.flush();

    expect(report.products).toHaveLength(45);
    expect(counting.planned()).toBe(1);
    expect(counting.processed()).toBe(1);
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
    // Madrid's walk has a hole, so its listing is handed over for its
    // positives and is not whole. Barcelona's was whole (plan 0220, 2.2).
    expect(report.notWhole).toEqual([
      {
        scopeKey: '13835',
        reason: 'failed-page',
        detail: [],
        listed: expect.any(Array),
      },
    ]);
    expect(report.notWhole[0].listed).toHaveLength(25);
    expect(report.wholeListings).toEqual([
      { scopeKey: '959', listed: ['only-barcelona'] },
    ]);
    // No claim states an absence any more: the listing diff does.
    expect(report.availabilities.every((claim) => claim.available)).toBe(true);
  });

  it('stops after five failed requests in a row, keeps what it read, and names the last error', async () => {
    const leaves = Array.from({ length: 8 }, (_, index) => ({
      ...COLA,
      id: `L30${index}`,
      path: `/agua-y-refrescos/hoja-${index}/c/L30${index}`,
    }));
    const runner = new TestRunner(
      world({
        // Cola is read, then every leaf after it fails.
        leaves: [COLA, ...leaves],
        fail: (_, path) => (path.includes('/hoja-') ? 404 : undefined),
      })
    );
    const ctx = guardedContext();

    // The run's guard stopped it and aborted the run (plan 0215). The runner
    // returns, so the executor ends it FAILED with the stop as its reason.
    await runner.run(
      ctx,
      report,
      input({ priceScopes: [MADRID, BARCELONA] }),
      source()
    );

    expect(ctx.guard?.stop).toEqual(expect.objectContaining({ status: 404 }));
    expect(ctx.signal.aborted).toBe(true);
    // Five failing listing requests and not eight: the rest were never asked
    // for, and Barcelona was never walked.
    expect(
      runner.sent.filter((request) => request.includes('/hoja-'))
    ).toHaveLength(5);
    expect(reportOf(ctx)['stoppedBy']).toMatch(/404/);
    expect(reportOf(ctx)['failedPages']).toHaveLength(4);
    // What the scope walked read is reported, and a scope that did not
    // finish states no negative.
    expect(report.products.map((product) => product.externalId).sort()).toEqual(
      ['38406', '659']
    );
    expect(report.availabilities.filter((claim) => !claim.available)).toEqual(
      []
    );
  });

  it('reports what the walked scopes read when a person aborts mid request', async () => {
    const controller = new AbortController();
    const runner = new TestRunner(
      world({
        // The second leaf's request is where the person aborts.
        fail: (_, path) => {
          if (path.includes('L2286')) {
            controller.abort();
          }
          return undefined;
        },
      })
    );
    const ctx = context(controller.signal);

    await runner.run(
      ctx,
      report,
      input({ priceScopes: [MADRID, BARCELONA] }),
      source()
    );

    expect(report.products.map((product) => product.externalId)).toContain(
      '659'
    );
    expect(report.availabilities.filter((claim) => !claim.available)).toEqual(
      []
    );
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
    // An aborted run declares nothing, whole or not (plan 0220, 2.2).
    expect(report.wholeListings).toEqual([]);
    expect(report.notWhole).toEqual([]);
  });
});
