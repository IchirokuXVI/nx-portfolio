import type { ConfigService } from '@nestjs/config';
import { PostalCodeSource } from '@portfolio/luna-shopper/contracts';
import { DezaClient } from '@portfolio/luna-shopper/deza';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupermarketSource } from '../entities';
import {
  addressesDisagree,
  DezaStoreDiscoveryRunner,
} from './deza-store-discovery.runner';
import type { RunContext } from './run-context';
import { RecordingRunReport } from './run-report';

/**
 * Store discovery against DEZA's own shop list (plan 0222).
 *
 * **Nothing here reaches a network.** The directory and three shop pages are
 * the library's captured fixtures. The other seven shop pages are built here
 * from the T1 page, with the street, the postal code and the photo code each
 * shop page states (plan 0222, section 9), so the run reads ten pages as it
 * does against the site.
 */

const FIXTURES = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'libs',
  'luna-shopper',
  'deza',
  'src',
  'lib',
  '__fixtures__'
);
const fixture = (name: string): string =>
  readFileSync(join(FIXTURES, name), 'utf8');

const SITE = 'https://www.dezacalidad.es';
const CENTROS = fixture('centros.html');
const SHOP_T1 = fixture('shop-t1.html');

/** A shop page built from the T1 page: its street, postal code and photo. */
function shopPage(
  street: string,
  postalCode: string,
  photoCode: string
): string {
  return SHOP_T1.split('Avda. Jesús Rescatado, 15')
    .join(street)
    .split('14010 - Córdoba')
    .join(`${postalCode} - Córdoba`)
    .split('T1_1-')
    .join(`${photoCode}_1-`);
}

const PAGES: Record<string, string> = {
  '/centros/': CENTROS,
  '/centros/avda-de-jesus-rescatado/': SHOP_T1,
  '/centros/ctra-de-castro-esq-pio-xii/': shopPage(
    'Ctra. de Castro, esq. Pío XII',
    '14009',
    'T2'
  ),
  '/centros/avda-ronda-del-marrubial/': shopPage(
    'Avenida Ronda del Marrubial, esq. Agrupación Córdoba',
    '14007',
    'T3'
  ),
  // The one street on which the pin and the page disagree (section 9).
  '/centros/avda-isla-fuerteventura/': shopPage(
    'Avda. Isla Fuerteventura, 21',
    '14011',
    'T4'
  ),
  '/centros/camino-de-la-barca/': shopPage(
    'Camino de la Barca, 1',
    '14010',
    'T5'
  ),
  '/centros/avda-de-libia/': shopPage(
    'Avda. de Libia, esq. Paco León',
    '14014',
    'T6'
  ),
  '/centros/avda-virgen-de-las-angustias/': shopPage(
    'Calle Acera Fuente de la Salud',
    '14006',
    'T7'
  ),
  '/centros/pol-ind-las-quemadas/': shopPage(
    'Imprenta la Alborada parc. 116 (Pol. las Quemadas)',
    '14014',
    'C1'
  ),
  '/centros/supercash-sector-sur/': fixture('shop-c2.html'),
  '/centros/centro-comercial-zoco-calle-jose-maria-martorell/':
    fixture('shop-z1.html'),
};

const CHAIN = '11111111-1111-4111-8111-111111111111';
const RUN = '33333333-3333-4333-8333-333333333333';
const CHAIN_IDENTITY = { externalBrandKey: 'Q-deza', brandName: 'DEZA' };

class TestRunner extends DezaStoreDiscoveryRunner {
  readonly sent: string[] = [];

  constructor(private readonly pages: Record<string, string | number> = PAGES) {
    super({
      getOrThrow: () => ({ userAgent: 'LunaShopperBot/1.0' }),
    } as unknown as ConfigService);
  }

  protected override createClient(): DezaClient {
    return new DezaClient({
      userAgent: 'LunaShopperBot/1.0',
      retries: 0,
      sleepImpl: async () => undefined,
      fetchImpl: (async (url: string) => {
        this.sent.push(String(url));
        const page = this.pages[new URL(String(url)).pathname];
        if (typeof page === 'number') {
          return new Response('', { status: page });
        }
        return page === undefined
          ? new Response('', { status: 404 })
          : new Response(page, { status: 200 });
      }) as unknown as typeof fetch,
    });
  }
}

function context(): RunContext & { setReport: jest.Mock; report: jest.Mock } {
  return {
    runId: RUN,
    signal: new AbortController().signal,
    acquire: async () => undefined,
    countProgressItself: jest.fn(),
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
  adapterKey: 'deza-web',
  config: {},
  workers: 1,
} as unknown as SupermarketSource;

function input(postalCodes?: string[]) {
  return {
    postalCode: '',
    country: 'es',
    radiusMetres: 0,
    supermarketId: CHAIN,
    chain: CHAIN_IDENTITY,
    postalCodes,
  };
}

describe('DezaStoreDiscoveryRunner', () => {
  let report: RecordingRunReport;

  beforeEach(() => {
    report = new RecordingRunReport();
  });

  it('reports one place per shop, keyed on its code, in 11 requests', async () => {
    const runner = new TestRunner();
    const run = context();

    await runner.run(run, report, input(), source);

    expect(runner.sent).toHaveLength(11);
    expect(runner.sent[0]).toBe(`${SITE}/centros/`);
    expect(report.places.map((place) => place.externalRef).sort()).toEqual([
      'C1',
      'C2',
      'T1',
      'T2',
      'T3',
      'T4',
      'T5',
      'T6',
      'T7',
      'Z1',
    ]);
    expect(report.places.every((place) => place.provider === 'DEZA')).toBe(
      true
    );

    const t1 = report.places.find((place) => place.externalRef === 'T1');
    expect(t1).toEqual({
      provider: 'DEZA',
      externalRef: 'T1',
      brandKey: 'Q-deza',
      brandName: 'DEZA',
      name: 'Avda Jesús Rescatado',
      latitude: 37.89082,
      longitude: -4.761648,
      street: 'Avda. Jesús Rescatado, 15',
      city: 'Córdoba',
      postalCode: '14010',
      postalCodeSource: PostalCodeSource.SOURCE,
      country: 'es',
      website: `${SITE}/centros/avda-de-jesus-rescatado/`,
      openingHours: null,
      tags: {
        'deza:code': 'T1',
        'deza:codeBasis': 'BOTH',
        'deza:postId': '32',
        'deza:mapTitle': 'Tienda 1',
        'deza:mapAddress': 'Avenida de Jesús Rescatado, 15',
        phone: '957 076 802',
      },
      scopeKey: null,
    });
    // The two SuperCash pins carry no code category; the photo names it.
    expect(
      report.places.find((place) => place.externalRef === 'C2')
    ).toMatchObject({
      name: 'SuperCash Sector Sur',
      postalCode: '14013',
      tags: expect.objectContaining({
        'deza:codeBasis': 'PHOTO',
        phone: '957 760 689',
      }),
    });

    expect(run.setReport.mock.calls[0][0]).toMatchObject({
      entriesRead: 13,
      shopEntries: 10,
      pagesRead: 10,
      shopsReported: 10,
      shopsWithoutCode: [],
      failedShops: [],
      postalCodesWithNoShop: [],
      warnings: [],
      requests: 11,
    });
    expect(run.countProgressItself).toHaveBeenCalled();
  });

  it('drops the warehouses and the bakery as not shops, unread', async () => {
    const runner = new TestRunner();
    const run = context();

    await runner.run(run, report, input(), source);

    const { droppedEntries } = run.setReport.mock.calls[0][0];
    expect(droppedEntries).toEqual(
      expect.arrayContaining([
        { title: 'Almacén 1', reason: 'NOT_A_SHOP' },
        { title: 'Almacén 2', reason: 'NOT_A_SHOP' },
        { title: 'Pan Obrador', reason: 'NOT_A_SHOP' },
      ])
    );
    expect(droppedEntries).toHaveLength(3);
    expect(runner.sent.some((url) => url.includes('almacen'))).toBe(false);
  });

  it('names T4, whose pin and page give two house numbers', async () => {
    const runner = new TestRunner();
    const run = context();

    await runner.run(run, report, input(), source);

    expect(run.setReport.mock.calls[0][0].addressDisagreements).toEqual([
      {
        code: 'T4',
        mapAddress: 'Avda. Isla Fuerteventura, 48',
        pageStreet: 'Avda. Isla Fuerteventura, 21',
      },
    ]);
    // The page street is written; the pin address is a tag.
    expect(
      report.places.find((place) => place.externalRef === 'T4')
    ).toMatchObject({
      street: 'Avda. Isla Fuerteventura, 21',
      tags: expect.objectContaining({
        'deza:mapAddress': 'Avda. Isla Fuerteventura, 48',
      }),
    });
  });

  it('reports C2 alone for 14013, matching the page code exactly', async () => {
    // The centroid of 14013 is the centre of Córdoba, and every shop sits
    // within 5 km of it, so the default radius reads all ten pages.
    const runner = new TestRunner();
    const run = context();

    await runner.run(run, report, input(['14013']), source);

    expect(report.places.map((place) => place.externalRef)).toEqual(['C2']);
    expect(runner.sent).toHaveLength(11);
    expect(run.setReport.mock.calls[0][0]).toMatchObject({
      shopsReported: 1,
      postalCodesWithNoShop: [],
    });
  });

  it('reads only the pages within the row’s radius of the centroid', async () => {
    // C2 is 3.3 km from the centroid of 14013 and C1 is 4.6 km from it.
    const runner = new TestRunner();
    const run = context();

    await runner.run(run, report, input(['14013']), {
      ...source,
      config: { postalCodeRadiusMetres: 3_500 },
    } as SupermarketSource);

    expect(report.places.map((place) => place.externalRef)).toEqual(['C2']);
    expect(runner.sent).not.toContain(`${SITE}/centros/pol-ind-las-quemadas/`);
    expect(runner.sent.length - 1).toBeLessThan(10);
  });

  it('reads no shop page for a code far from Córdoba', async () => {
    const runner = new TestRunner();
    const run = context();

    await runner.run(run, report, input(['28001']), source);

    expect(runner.sent).toEqual([`${SITE}/centros/`]);
    expect(report.places).toEqual([]);
    expect(run.setReport.mock.calls[0][0]).toMatchObject({
      pagesRead: 0,
      postalCodesWithNoShop: ['28001'],
      requests: 1,
    });
  });

  it('reads every shop for a code with no centroid', async () => {
    const runner = new TestRunner();
    const run = context();

    await runner.run(run, report, input(['00000']), source);

    expect(runner.sent).toHaveLength(11);
    expect(report.places).toEqual([]);
    expect(run.setReport.mock.calls[0][0].warnings).toEqual([
      expect.stringContaining('00000'),
    ]);
  });

  it('names a page that fails and completes the run', async () => {
    const runner = new TestRunner({
      ...PAGES,
      '/centros/avda-de-libia/': 500,
    });
    const run = context();

    await runner.run(run, report, input(), source);

    expect(report.places).toHaveLength(9);
    expect(run.setReport.mock.calls[0][0].failedShops).toEqual([
      { title: 'Tienda 6', error: expect.stringContaining('500') },
    ]);
    expect(run.report).toHaveBeenCalledWith({ failed: 1 });
  });

  it('names a shop with no code and does not report it', async () => {
    // SuperCash Sector Sur has no map category, so a photo that names no
    // code leaves it with none.
    const runner = new TestRunner({
      ...PAGES,
      '/centros/supercash-sector-sur/': fixture('shop-c2.html')
        .split('C2_1-')
        .join('foto_1-'),
    });
    const run = context();

    await runner.run(run, report, input(), source);

    expect(report.places.map((place) => place.externalRef)).not.toContain('C2');
    expect(report.places).toHaveLength(9);
    expect(run.setReport.mock.calls[0][0].shopsWithoutCode).toEqual([
      { title: 'SuperCash (Sector Sur)', reason: 'NO_CODE' },
    ]);
  });

  it('names a shop whose two codes disagree and does not report it', async () => {
    const runner = new TestRunner({
      ...PAGES,
      '/centros/avda-de-jesus-rescatado/': SHOP_T1.split('T1_1-').join('T9_1-'),
    });
    const run = context();

    await runner.run(run, report, input(), source);

    expect(report.places.map((place) => place.externalRef)).not.toContain('T1');
    expect(run.setReport.mock.calls[0][0].shopsWithoutCode).toEqual([
      { title: 'Tienda 1', reason: 'CODES_DISAGREE' },
    ]);
  });

  it('never fetches a shop page the directory names off the site', async () => {
    const runner = new TestRunner({
      ...PAGES,
      '/centros/': CENTROS.split(
        'https:\\/\\/www.dezacalidad.es\\/centros\\/avda-de-libia\\/'
      ).join('https:\\/\\/elsewhere.example\\/centros\\/avda-de-libia\\/'),
    });
    const run = context();

    await runner.run(run, report, input(), source);

    expect(runner.sent.some((url) => url.includes('elsewhere'))).toBe(false);
    expect(runner.sent).toHaveLength(10);
    expect(run.setReport.mock.calls[0][0].droppedEntries).toContainEqual({
      title: 'Tienda 6',
      reason: 'OFF_SITE',
    });
  });

  it('warns when the list names far fewer shops than were measured', async () => {
    const few = CENTROS.split('Ver Tienda').join('Ver Otra');
    const runner = new TestRunner({ ...PAGES, '/centros/': few });
    const run = context();

    await runner.run(run, report, input(), source);

    expect(runner.sent).toHaveLength(1);
    expect(run.setReport.mock.calls[0][0].warnings).toEqual([
      expect.stringContaining('named 0 shop(s)'),
    ]);
  });

  it('refuses a run that does not say which chain it is reading', async () => {
    const runner = new TestRunner();

    await expect(
      runner.run(
        context(),
        report,
        { postalCode: '', country: 'es', radiusMetres: 0 },
        source
      )
    ).rejects.toThrow(/which chain/);
    expect(runner.sent).toEqual([]);
  });
});

describe('addressesDisagree', () => {
  it.each([
    ['Avenida de Jesús Rescatado, 15', 'Avda. Jesús Rescatado, 15', false],
    ['Avda. Isla Fuerteventura, 48', 'Avda. Isla Fuerteventura, 21', true],
    [
      'Plaza de los Califas s/n Centro Comercial Zoco',
      'Centro comercial Zoco Plaza de los Califas s/n',
      false,
    ],
    ['Camino de la Barca, 1', 'Camino de la Barca, 1', false],
  ])('%s against %s is %s', (map, page, disagree) => {
    expect(addressesDisagree(map, page)).toBe(disagree);
  });
});
