import type { ConfigService } from '@nestjs/config';
import { PriceScopeKind } from '@portfolio/luna-shopper/contracts';
import type { SupermarketSource } from '../entities';
import {
  MercadonaStoreDiscoveryRunner,
  type MercadonaStoreOptions,
} from './mercadona-store-discovery.runner';
import type { RunContext } from './run-context';
import { RecordingRunReport } from './run-report';

/**
 * Store discovery against Mercadona's own store finder (plan 0106).
 *
 * **Nothing here reaches a network.** What it pins: every shop the document
 * names is reported with the chain's own postal code on it, one scope is
 * declared per distinct warehouse, a postal code the chain does not serve
 * declares nothing and fails nothing, and the filter matches a shop's own code
 * exactly.
 *
 * What becomes of a reported place is `discovered-place.service`'s since plan
 * 0103, and the run creates nothing at all.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const RUN = '33333333-3333-4333-8333-333333333333';
const STORES_URL = 'https://stores.test/data.js';
const TOTALS_URL = 'https://stores.test/data_total.js';
const STOREFRONT = 'https://storefront.test/api';

/** The chain's identity, which the orchestrator reads and passes in. */
const CHAIN_IDENTITY = { externalBrandKey: 'Q377705', brandName: 'Mercadona' };

interface Shop {
  id: number;
  cp: string;
  country?: string;
}

function document(shops: readonly Shop[]): string {
  const records = shops.map((shop) => ({
    p: shop.country ?? 'ES',
    cp: shop.cp,
    dr: 'AV DA OZA, 134',
    lc: 'A Coruña',
    pv: 'A CORUÑA',
    lt: 43.35342592,
    lg: -8.39317618,
    tf: '981303071',
    id: shop.id,
    in: '0900#0900#C#0900#0900#0900#0900',
    fi: '2130#2130#C#2130#2130#2130#2130',
    fs: '13/09/26-C',
    pk: 'S',
    fap: '24/11/2011',
    lpc: 'N',
  }));
  return `var dataJson=${JSON.stringify({
    fechaCreacion: '11-09-2026',
    tiendasFull: records,
  })}`;
}

function totals(counts: Record<string, number>): string {
  return JSON.stringify({ createdDate: '2026-09-11', stores: counts });
}

/**
 * A runner whose two static calls go through a fake fetch.
 *
 * The seam is the options, because the store finder's document needs no
 * warehouse and the calls that read it are therefore static: a run reads the
 * shops before it knows any warehouse at all.
 */
class TestRunner extends MercadonaStoreDiscoveryRunner {
  readonly asked: string[] = [];

  constructor(
    private readonly body: string,
    private readonly counts: string | null,
    /** Postal code to warehouse. A code that is absent answers 404. */
    private readonly warehouses: Record<string, string>
  ) {
    super({
      getOrThrow: () => ({
        userAgent: 'LunaShopperBot/1.0',
        mercadonaBaseUrl: STOREFRONT,
      }),
    } as unknown as ConfigService);
  }

  protected override clientOptions(): MercadonaStoreOptions {
    return {
      userAgent: 'LunaShopperBot/1.0',
      baseUrl: STOREFRONT,
      storesUrl: STORES_URL,
      totalsUrl: TOTALS_URL,
      sleepImpl: async () => undefined,
      fetchImpl: (async (url: string, init?: RequestInit) => {
        const target = String(url);
        this.asked.push(target);
        if (target === STORES_URL) {
          return new Response(this.body, { status: 200 });
        }
        if (target === TOTALS_URL) {
          return this.counts === null
            ? new Response('', { status: 404 })
            : new Response(this.counts, { status: 200 });
        }
        const code = JSON.parse(String(init?.body ?? '{}'))[
          'new_postal_code'
        ] as string;
        const warehouse = this.warehouses[code];
        return warehouse === undefined
          ? new Response('{"error_msg":"outside of our working area"}', {
              status: 404,
            })
          : new Response('', {
              status: 200,
              headers: { 'x-customer-wh': warehouse },
            });
      }) as unknown as typeof fetch,
    };
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
    heartbeat: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
    warn: jest.fn(),
  } as unknown as RunContext;
}

const source = (adapterKey = 'mercadona-api'): SupermarketSource =>
  ({ adapterKey, config: {}, workers: 1 }) as SupermarketSource;

const input = (postalCodes?: string[]) => ({
  postalCode: '',
  country: 'es',
  radiusMetres: 0,
  supermarketId: CHAIN,
  chain: CHAIN_IDENTITY,
  postalCodes,
});

describe('MercadonaStoreDiscoveryRunner', () => {
  let report: RecordingRunReport;

  beforeEach(() => {
    report = new RecordingRunReport();
  });

  it('writes a place per shop, with the chain’s own postal code on it', async () => {
    const runner = new TestRunner(
      document([{ id: 283185314342, cp: '15006' }]),
      totals({ ES: 1 }),
      { '15006': '4661' }
    );

    await runner.run(context(), report, input(), source());

    expect(report.places).toHaveLength(1);
    expect(report.places[0]).toMatchObject({
      provider: 'MERCADONA',
      externalRef: '283185314342',
      postalCode: '15006',
      // Stated by the chain on every record, so it is never derived.
      postalCodeSource: 'SOURCE',
      country: 'es',
      street: 'AV DA OZA, 134',
      city: 'A Coruña',
      // The chain's own identity, read by the orchestrator and passed in.
      brandKey: 'Q377705',
      // The document holds no store name, so the run reports none.
      name: null,
      openingHours: 'Mo-Sa 09:00-21:30; Su off',
      tags: {
        'mercadona:warehouse': '4661',
        'addr:province': 'A CORUÑA',
        parking: 'yes',
        'mercadona:readyToEat': 'no',
      },
      // The warehouse again, as the scope key a trusted import reads to put the
      // shop in the group the chain prices it with (plan 0107, section 3.3).
      scopeKey: '4661',
    });
    // Whether the row is new is `discovered-place.service`'s. A run reports
    // what the source said and never a status.
    expect(report.places[0]).not.toHaveProperty('status');
  });

  it('declares one scope per warehouse, asked once per postal code', async () => {
    const runner = new TestRunner(
      document([
        { id: 1, cp: '15006' },
        { id: 2, cp: '15008' },
        // The third shop shares the first one's code, so it costs no request.
        { id: 3, cp: '15006' },
      ]),
      totals({ ES: 3 }),
      { '15006': '4661', '15008': '4661', '15009': 'mad3' }
    );

    await runner.run(context(), report, input(), source());

    // Two codes, one warehouse: the scope is declared once and the second code
    // resolving to it declares nothing again.
    expect(report.scopes).toEqual([
      { key: '4661', kind: PriceScopeKind.REGION, name: 'Almacén 4661' },
    ]);
    expect(report.places).toHaveLength(3);
    // One for the document, one for the counts, two for the two codes.
    expect(runner.asked).toHaveLength(4);
  });

  it('counts a shop the chain prices no scope for, rather than failing', async () => {
    const run = context();
    const runner = new TestRunner(
      document([
        { id: 1, cp: '15006' },
        // Portugal answers the same 404 the 150 unserved Spanish codes do.
        { id: 2, cp: '3750-136', country: 'PT' },
      ]),
      totals({ ES: 1, PT: 1 }),
      { '15006': '4661' }
    );

    await runner.run(run, report, input(), source());

    expect(report.places).toHaveLength(2);
    expect(report.places[1]).toMatchObject({ country: 'pt', tags: {} });
    expect(report.scopes).toHaveLength(1);
    expect((run.setReport as jest.Mock).mock.calls[0][0]).toMatchObject({
      stores: 2,
      storesWithNoWarehouse: 1,
      postalCodesAsked: 2,
      countsAgree: true,
      declared: { ES: 1, PT: 1 },
      read: { ES: 1, PT: 1 },
    });
  });

  it('reports that the counts disagreed, and reports its shops anyway', async () => {
    const run = context();
    // The two documents are written by different jobs, so a run that read one
    // shop of a declared two has still found one real shop.
    const runner = new TestRunner(
      document([{ id: 1, cp: '15006' }]),
      totals({ ES: 2 }),
      { '15006': '4661' }
    );

    await runner.run(run, report, input(), source());

    expect(report.places).toHaveLength(1);
    expect((run.setReport as jest.Mock).mock.calls[0][0]).toMatchObject({
      countsAgree: false,
      declared: { ES: 2 },
      read: { ES: 1 },
      publishedOn: '11-09-2026',
    });
  });

  it('filters on the shop’s own code, and resolves only those warehouses', async () => {
    const runner = new TestRunner(
      document([
        { id: 1, cp: '15006' },
        { id: 2, cp: '15008' },
        { id: 3, cp: '14013' },
      ]),
      totals({ ES: 3 }),
      { '15006': '4661', '15008': '4570', '14013': '4661' }
    );

    await runner.run(context(), report, input(['15006', '14013']), source());

    expect(report.places.map((place) => place.externalRef)).toEqual(['1', '3']);
    // 15008's warehouse is never asked for, which is the whole saving.
    expect(report.scopes.map((scope) => scope.key)).toEqual(['4661']);
    expect(
      runner.asked.filter((url) => url.startsWith(STOREFRONT))
    ).toHaveLength(2);
  });

  it('reports nothing and names the code when the filter matched no shop', async () => {
    const run = context();
    const runner = new TestRunner(
      document([{ id: 1, cp: '15006' }]),
      totals({ ES: 1 }),
      { '15006': '4661' }
    );

    await runner.run(run, report, input(['99999']), source());

    expect(report.places).toEqual([]);
    expect(report.scopes).toEqual([]);
    expect((run.setReport as jest.Mock).mock.calls[0][0]).toMatchObject({
      stores: 0,
      postalCodesWithNoShop: ['99999'],
    });
  });

  it('treats an empty filter as every shop, like an absent one', async () => {
    const runner = new TestRunner(
      document([{ id: 1, cp: '15006' }]),
      totals({ ES: 1 }),
      { '15006': '4661' }
    );

    await runner.run(context(), report, input([]), source());

    expect(report.places).toHaveLength(1);
  });

  it('refuses a run that does not say which chain it is reading', async () => {
    const runner = new TestRunner(document([]), totals({}), {});

    await expect(
      runner.run(
        context(),
        report,
        { postalCode: '14013', country: 'es', radiusMetres: 3000 },
        source()
      )
    ).rejects.toThrow(/which chain/);
  });
});
