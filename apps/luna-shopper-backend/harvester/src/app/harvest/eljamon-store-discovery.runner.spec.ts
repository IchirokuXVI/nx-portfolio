import type { ConfigService } from '@nestjs/config';
import { PostalCodeSource } from '@portfolio/luna-shopper/contracts';
import { ElJamonClient } from '@portfolio/luna-shopper/eljamon';
import type { SupermarketSource } from '../entities';
import { ElJamonStoreDiscoveryRunner } from './eljamon-store-discovery.runner';
import type { RunContext } from './run-context';
import { RecordingRunReport } from './run-report';

/**
 * Store discovery against El Jamón's own store locator (plan 0169, section 3).
 *
 * **Nothing here reaches a network.** What it pins: every shop is reported with
 * the chain stamped on it and **no scope key**, because the chain shows one
 * price list for every shop; another banner is dropped and named; and a postal
 * code filters the one document rather than fetching another.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const RUN = '33333333-3333-4333-8333-333333333333';

interface LocatorRecord {
  name: string;
  street: string;
  town: string;
  postalCode: string;
}

function locator(records: readonly LocatorRecord[]): string {
  return `<script>var locations = ${JSON.stringify({
    center: { lat: '37.2547', lng: '-7.2044' },
    locations: records.map((record, index) => ({
      lat: String(37 + index / 100),
      lng: '-6.5',
      infowindow:
        `<div class="store-infowindow"><div><h3>${record.name}</h3><p> ` +
        `${record.street}<br/>\r\n ${record.town} , Huelva Spain ` +
        `${record.postalCode} </p>\r\n<div><b>Horario:</b> <br/>` +
        '<b>De Lunes a Sábado:</b> <br/>09:00 a 21:30<br/>' +
        '<div class="wpsl-distance">1 km</div></div>',
    })),
  })};</script>`;
}

const SHOPS: LocatorRecord[] = [
  {
    name: 'Supermercados El Jamón',
    street: 'Calle Juan de Lepe 15',
    town: 'Lepe',
    postalCode: '21440',
  },
  {
    name: 'Supermercados El Jamón',
    street: 'Calle Real 2',
    town: 'Cartaya',
    postalCode: '21450',
  },
  {
    name: 'Cash Lepe',
    street: 'Carretera Nacional 431',
    town: 'Lepe',
    postalCode: '21440',
  },
];

class TestRunner extends ElJamonStoreDiscoveryRunner {
  readonly sent: string[] = [];

  constructor(private readonly records: readonly LocatorRecord[]) {
    super({
      getOrThrow: () => ({ userAgent: 'LunaShopperBot/1.0' }),
    } as unknown as ConfigService);
  }

  protected override createClient(): ElJamonClient {
    return new ElJamonClient({
      userAgent: 'LunaShopperBot/1.0',
      sleepImpl: async () => undefined,
      fetchImpl: (async (url: string) => {
        this.sent.push(String(url));
        return new Response(locator(this.records), { status: 200 });
      }) as unknown as typeof fetch,
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

const source = {
  adapterKey: 'eljamon-web',
  config: {},
  workers: 1,
} as unknown as SupermarketSource;

const CHAIN_IDENTITY = { externalBrandKey: 'Q6135982', brandName: 'El Jamón' };

describe('ElJamonStoreDiscoveryRunner', () => {
  let report: RecordingRunReport;

  beforeEach(() => {
    report = new RecordingRunReport();
  });

  it('reports every shop with the chain stamped on it and no scope key', async () => {
    const runner = new TestRunner(SHOPS);
    await runner.run(
      context(),
      report,
      {
        postalCode: '',
        country: 'es',
        radiusMetres: 0,
        supermarketId: CHAIN,
        chain: CHAIN_IDENTITY,
      },
      source
    );

    expect(runner.sent).toHaveLength(1);
    expect(report.places).toHaveLength(2);
    expect(report.places[0]).toEqual({
      provider: 'ELJAMON',
      externalRef: '21440:calle juan de lepe 15',
      brandKey: 'Q6135982',
      brandName: 'El Jamón',
      name: 'Supermercados El Jamón',
      latitude: 37,
      longitude: -6.5,
      street: 'Calle Juan de Lepe 15',
      city: 'Lepe',
      postalCode: '21440',
      postalCodeSource: PostalCodeSource.SOURCE,
      country: 'es',
      website: null,
      openingHours: 'De Lunes a Sábado: 09:00 a 21:30',
      tags: { 'addr:province': 'Huelva' },
      scopeKey: null,
    });
    // One price list for every shop (section 2): nothing is declared.
    expect(report.scopes).toEqual([]);
    expect(report.places.every((place) => place.scopeKey === null)).toBe(true);
  });

  it('names the dropped banner and the count on the report', async () => {
    const ctx = context();
    await new TestRunner(SHOPS).run(
      ctx,
      report,
      {
        postalCode: '',
        country: 'es',
        radiusMetres: 0,
        supermarketId: CHAIN,
        chain: CHAIN_IDENTITY,
      },
      source
    );

    const written = ctx.setReport.mock.calls[0][0] as Record<string, unknown>;
    expect(written).toMatchObject({
      shopsRead: 3,
      shopsKept: 2,
      shopsReported: 2,
      postalCodesWithNoShop: [],
      requests: 1,
    });
    expect(written['droppedRecords']).toEqual([
      expect.objectContaining({ reason: 'OTHER_BANNER', name: 'Cash Lepe' }),
    ]);
    // Two shops is far under the 366 the chain had, so the report says so.
    expect(written['warnings']).toEqual([expect.stringMatching(/366/)]);
  });

  it('keeps only the shops on the postal codes it was given, from one request', async () => {
    const ctx = context();
    const runner = new TestRunner(SHOPS);
    await runner.run(
      ctx,
      report,
      {
        postalCode: '',
        country: 'es',
        radiusMetres: 0,
        supermarketId: CHAIN,
        chain: CHAIN_IDENTITY,
        postalCodes: ['21450', '28001'],
      },
      source
    );

    expect(runner.sent).toHaveLength(1);
    expect(report.places.map((place) => place.postalCode)).toEqual(['21450']);
    const written = ctx.setReport.mock.calls[0][0] as Record<string, unknown>;
    expect(written['postalCodesWithNoShop']).toEqual(['28001']);
  });

  it('refuses a run that does not name the chain', async () => {
    await expect(
      new TestRunner(SHOPS).run(
        context(),
        report,
        { postalCode: '', country: 'es', radiusMetres: 0 },
        source
      )
    ).rejects.toThrow(/naming the supermarket/);
  });
});
