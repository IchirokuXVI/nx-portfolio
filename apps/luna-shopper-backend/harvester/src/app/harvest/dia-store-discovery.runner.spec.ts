import { PostalCodeSource } from '@portfolio/luna-shopper/contracts';
import { DiaClient, DiaStoppedError } from '@portfolio/luna-shopper/dia';
import { SPAIN_POSTAL_CODE_CENTROIDS } from '@portfolio/luna-shopper/postal-codes/dataset';
import type { SupermarketSource } from '../entities';
import {
  fakeDiaSite,
  type FakeDiaShop,
  type FakeDiaWorld,
} from './dia-site.fake';
import { DiaStoreDiscoveryRunner } from './dia-store-discovery.runner';
import type { RunContext } from './run-context';
import { RecordingRunReport } from './run-report';

/**
 * Store discovery against DIA's own shop file (plan 0174, section 5).
 *
 * **Nothing here reaches a network.** What it pins: Clarel and a closed shop
 * are dropped and named; a postal code narrows the file by province and
 * radius before any detail is read, and the detail's own code decides; each
 * kept shop carries the key of the online store that prices it, declared once
 * as a `LOCAL_AREA` scope; and a code with no online service names none.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const RUN = '33333333-3333-4333-8333-333333333333';

const centroid = (code: string): { latitude: number; longitude: number } => {
  const found = SPAIN_POSTAL_CODE_CENTROIDS.find(
    (candidate) => candidate.postalCode === code
  );
  if (!found) {
    throw new Error(`The dataset holds no centroid for ${code}.`);
  }
  return found;
};

const MADRID = centroid('28004');
const WEEK = {
  '1': '09:00 - 21:30',
  '2': '09:00 - 21:30',
  '3': '09:00 - 21:30',
  '4': '09:00 - 21:30',
  '5': '09:00 - 21:30',
  '6': '09:00 - 21:30',
};

/** A shop on the centroid of 28004, whose detail states that code. */
const CHURRUCA: FakeDiaShop = {
  idTienda: 1001720,
  codigoTienda: 14126,
  province: 28,
  latitude: MADRID.latitude,
  longitude: MADRID.longitude,
  detail: {
    direccionPostal: 'CL. CHURRUCA 2',
    codigoPostal: '28004',
    localidad: 'Madrid',
    telefono: 626048859,
    horariosTienda: { ...WEEK, '7': '10:00 - 22:00' },
    festivosTienda: ['2026-10-12'],
    horariosAperturaFestivo: ['10:00 - 22:00'],
    toolTipsPerecederos: ['Venta de pollo', 'Venta de fruta'],
    servicioDomicilio: 1,
    folletoId: 1865788,
    documentoFolletoId: 20876,
    validezFolleto2: 'Válido de 30-09 a 06-10',
  },
};

/** 300 metres away, in the radius, and on another postal code. */
const NEIGHBOUR: FakeDiaShop = {
  idTienda: 2,
  codigoTienda: 2,
  province: 28,
  latitude: MADRID.latitude + 0.0027,
  longitude: MADRID.longitude,
  detail: {
    direccionPostal: 'CL. FUENCARRAL 1',
    codigoPostal: '28010',
    localidad: 'Madrid',
    horariosTienda: WEEK,
  },
};

/** The Madrid hub: the store that prices the city, closed to walk in customers. */
const HUB: FakeDiaShop = {
  idTienda: 1003554,
  codigoTienda: 13835,
  province: 28,
  latitude: MADRID.latitude - 0.02,
  longitude: MADRID.longitude,
  detail: {
    direccionPostal: 'CL. EDUARDO BARREIROS 104',
    codigoPostal: '28041',
    localidad: 'Madrid',
    horariosTienda: WEEK,
    fechaApertura: '31/12/2999',
  },
};

const CLAREL: FakeDiaShop = {
  idTienda: 60851,
  codigoTienda: 60851,
  tipoTienda: 1,
  province: 28,
  latitude: MADRID.latitude,
  longitude: MADRID.longitude,
  detail: { codigoPostal: '28004', localidad: 'Madrid' },
};

/** In Teruel, on a code DIA does not deliver to. */
const ALCANIZ: FakeDiaShop = {
  idTienda: 41125,
  codigoTienda: 41125,
  province: 44,
  latitude: 41.05,
  longitude: -0.13,
  detail: {
    direccionPostal: 'AV. ARAGON 5',
    codigoPostal: '44600',
    localidad: 'Alcañiz',
    horariosTienda: { '1': 'Consultar en tienda' },
  },
};

function world(overrides: Partial<FakeDiaWorld> = {}): FakeDiaWorld {
  return {
    served: { '28004': '13835', '28010': '13835', '28041': '13835' },
    shops: [CHURRUCA, NEIGHBOUR, HUB, CLAREL, ALCANIZ],
    ...overrides,
  };
}

class TestRunner extends DiaStoreDiscoveryRunner {
  readonly sent: string[];
  private readonly fetchImpl: typeof fetch;

  constructor(site: FakeDiaWorld) {
    super();
    const fake = fakeDiaSite(site);
    this.fetchImpl = fake.fetchImpl;
    this.sent = fake.sent;
  }

  protected override createClient(): DiaClient {
    return new DiaClient({
      fetchImpl: this.fetchImpl,
      minIntervalMs: 0,
      sleepImpl: async () => undefined,
    });
  }
}

function context(): RunContext & { setReport: jest.Mock } {
  return {
    runId: RUN,
    signal: new AbortController().signal,
    acquire: async () => undefined,
    setStage: jest.fn(async () => undefined),
    setTotalPlanned: jest.fn(async () => undefined),
    setReport: jest.fn(async () => undefined),
    report: jest.fn(async () => undefined),
    heartbeat: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
    warn: jest.fn(),
  } as unknown as RunContext & { setReport: jest.Mock };
}

const source = (config: Record<string, unknown> = {}): SupermarketSource =>
  ({
    adapterKey: 'dia-api',
    config,
    workers: 1,
  }) as unknown as SupermarketSource;

const CHAIN_IDENTITY = { externalBrandKey: 'Q1339', brandName: 'Dia' };

const baseInput = {
  postalCode: '',
  country: 'es',
  radiusMetres: 3000,
  supermarketId: CHAIN,
  chain: CHAIN_IDENTITY,
};

const reportOf = (ctx: { setReport: jest.Mock }): Record<string, unknown> =>
  ctx.setReport.mock.calls[ctx.setReport.mock.calls.length - 1][0];

describe('DiaStoreDiscoveryRunner', () => {
  let report: RecordingRunReport;

  beforeEach(() => {
    report = new RecordingRunReport();
  });

  it('refuses a run that names no chain', async () => {
    await expect(
      new TestRunner(world()).run(
        context(),
        report,
        { postalCode: '', country: 'es', radiusMetres: 3000 },
        source()
      )
    ).rejects.toThrow(/which chain/);
  });

  it('reports every open DIA shop, with the address its detail states', async () => {
    const runner = new TestRunner(world());
    await runner.run(context(), report, baseInput, source());

    expect(report.places.map((place) => place.externalRef)).toEqual([
      '14126',
      '2',
      '41125',
    ]);
    expect(report.places[0]).toEqual({
      provider: 'DIA',
      externalRef: '14126',
      brandKey: 'Q1339',
      brandName: 'Dia',
      // Every DIA shop is "DIA", so there is no name to report.
      name: null,
      latitude: MADRID.latitude,
      longitude: MADRID.longitude,
      street: 'CL. CHURRUCA 2',
      city: 'Madrid',
      postalCode: '28004',
      postalCodeSource: PostalCodeSource.SOURCE,
      country: 'es',
      website: null,
      openingHours: 'Mo-Sa 09:00-21:30; Su 10:00-22:00',
      scopeKey: '13835',
      tags: {
        'dia:idTienda': '1001720',
        'addr:province': '28',
        'dia:fulfilmentStore': '13835',
        phone: '626048859',
        'dia:holidays': JSON.stringify({
          festivosTienda: ['2026-10-12'],
          horariosAperturaFestivo: ['10:00 - 22:00'],
        }),
        'dia:fresh': 'Venta de pollo; Venta de fruta',
        'dia:homeDelivery': 'yes',
        'dia:leaflet': JSON.stringify({
          folletoId: 1865788,
          documentoFolletoId: 20876,
          validezFolleto2: 'Válido de 30-09 a 06-10',
        }),
      },
    });
  });

  it('drops Clarel, counted, and a temporarily closed shop, named', async () => {
    const runner = new TestRunner(world());
    const ctx = context();
    await runner.run(ctx, report, baseInput, source());

    expect(reportOf(ctx)).toMatchObject({
      shopsInFile: 5,
      clarelDropped: 1,
      candidates: 4,
      detailsRead: 4,
      shopsKept: 3,
      droppedRecords: [
        {
          idTienda: '1003554',
          reason: 'temporarily-closed',
          reopensOn: '2999-12-31',
        },
      ],
    });
    // Clarel's detail is never asked for.
    expect(runner.sent.some((request) => request.endsWith('id=60851'))).toBe(
      false
    );
  });

  it('declares each fulfilment store once, as a LOCAL_AREA scope named with its town', async () => {
    const runner = new TestRunner(world());
    const ctx = context();
    await runner.run(ctx, report, baseInput, source());

    // Two shops on two codes that one store serves: one declaration. The hub
    // was dropped as a shop and still names the scope's town.
    expect(report.scopes).toEqual([
      {
        key: '13835',
        kind: 'LOCAL_AREA',
        name: 'Dia online, tienda 13835 (Madrid)',
      },
    ]);
    expect(reportOf(ctx)['scopesDeclared']).toEqual(['13835']);
    // One check-service per distinct postal code, not one per shop.
    expect(
      runner.sent.filter((request) => request.includes('check-service'))
    ).toHaveLength(3);
  });

  it('gives a shop with no online service no scope key, and names its code', async () => {
    const runner = new TestRunner(world());
    const ctx = context();
    await runner.run(ctx, report, baseInput, source());

    const alcaniz = report.places.find(
      (place) => place.externalRef === '41125'
    );
    expect(alcaniz?.scopeKey).toBeNull();
    expect(alcaniz?.tags['dia:fulfilmentStore']).toBeUndefined();
    expect(reportOf(ctx)['postalCodesWithoutOnlineService']).toEqual(['44600']);
  });

  it('keeps unreadable hours raw, leaves openingHours null and names the shop', async () => {
    const runner = new TestRunner(world());
    const ctx = context();
    await runner.run(ctx, report, baseInput, source());

    const alcaniz = report.places.find(
      (place) => place.externalRef === '41125'
    );
    expect(alcaniz?.openingHours).toBeNull();
    expect(alcaniz?.tags['dia:hours']).toBe(
      JSON.stringify({ '1': 'Consultar en tienda' })
    );
    expect(reportOf(ctx)['unreadableHours']).toEqual(['41125']);
  });

  it('given postal codes, reads only the details near them and keeps the exact ones', async () => {
    const runner = new TestRunner(world());
    const ctx = context();
    await runner.run(
      ctx,
      report,
      { ...baseInput, postalCodes: ['28004'] },
      source()
    );

    // Three DIA shops of province 28 within 5 km: the shop, its neighbour and
    // the hub. Alcañiz is another province and its detail is never read.
    expect(
      runner.sent
        .filter((request) => request.includes('buscarInformacionTienda'))
        .map((request) => request.split('id=')[1])
    ).toEqual(['1001720', '2', '1003554']);
    // The neighbour sits on 28010, so it is a candidate and not a shop of
    // 28004.
    expect(report.places.map((place) => place.postalCode)).toEqual(['28004']);
    expect(reportOf(ctx)).toMatchObject({
      candidates: 3,
      detailsRead: 3,
      shopsKept: 1,
      postalCodesWithNoShop: [],
      postalCodesWithoutCentroid: [],
    });
  });

  it('narrows by the radius the source row states', async () => {
    const runner = new TestRunner(world());
    const ctx = context();
    await runner.run(
      ctx,
      report,
      { ...baseInput, postalCodes: ['28004'] },
      // The neighbour is 300 metres away and the hub about 2.2 km.
      source({ postalCodeRadiusMetres: 100 })
    );

    expect(reportOf(ctx)['candidates']).toBe(1);
  });

  it('names a requested code with no centroid, and one no shop sits on', async () => {
    const runner = new TestRunner(world());
    const ctx = context();
    await runner.run(
      ctx,
      report,
      { ...baseInput, postalCodes: ['00000', '28005'] },
      source()
    );

    expect(report.places).toEqual([]);
    expect(reportOf(ctx)).toMatchObject({
      postalCodesWithoutCentroid: ['00000'],
      postalCodesWithNoShop: ['00000', '28005'],
    });
  });

  it('names a shop whose detail fails and reports no place for it', async () => {
    const runner = new TestRunner(
      world({ shops: [CHURRUCA, { ...NEIGHBOUR, detail: 404 }] })
    );
    const ctx = context();
    await runner.run(ctx, report, baseInput, source());

    expect(report.places.map((place) => place.externalRef)).toEqual(['14126']);
    expect(reportOf(ctx)['failedShops']).toEqual([
      { idTienda: '2', error: expect.stringContaining('404') },
    ]);
  });

  it('never reports a place with no postal code', async () => {
    const runner = new TestRunner(
      world({
        shops: [{ ...CHURRUCA, detail: { localidad: 'Madrid' } }],
      })
    );
    const ctx = context();
    await runner.run(ctx, report, baseInput, source());

    expect(report.places).toEqual([]);
    expect(reportOf(ctx)['droppedRecords']).toEqual([
      { idTienda: '1001720', reason: 'no-postal-code' },
    ]);
  });

  it('stops when five details in a row fail, rather than failing the rest', async () => {
    const shops = Array.from({ length: 9 }, (_, index) => ({
      ...NEIGHBOUR,
      idTienda: 100 + index,
      codigoTienda: 100 + index,
      detail: 404,
    }));
    const runner = new TestRunner(world({ shops }));

    await expect(
      runner.run(context(), report, baseInput, source())
    ).rejects.toBeInstanceOf(DiaStoppedError);
    expect(
      runner.sent.filter((request) => request.includes('buscarInformacion'))
    ).toHaveLength(5);
  });
});
