import type { ConfigService } from '@nestjs/config';
import { PriceScopeKind } from '@portfolio/luna-shopper/contracts';
import { LidlClient } from '@portfolio/luna-shopper/lidl';
import type { SupermarketSource } from '../entities';
import { LidlStoreDiscoveryRunner } from './lidl-store-discovery.runner';
import { MercadonaStoreDiscoveryRunner } from './mercadona-store-discovery.runner';
import { OsmStoreDiscoveryRunner } from './osm-store-discovery.runner';
import type { RunContext } from './run-context';
import { RecordingRunReport } from './run-report';
import { StoreDiscoveryRunner } from './store-discovery.runner';

/**
 * Store discovery against the chain's own list (plan 0089, section 9).
 *
 * **Nothing here reaches a network.** What it pins: the region every shop names
 * is declared as a price scope and lands as a tag on the place, and a shop with
 * no region is counted rather than filled in.
 *
 * What becomes of a reported place, including the rule that a run never
 * overwrites a decision the owner made, is `discovered-place.service`'s since
 * plan 0103, and the run creates nothing at all.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const RUN = '33333333-3333-4333-8333-333333333333';

function store(options: {
  ref: string;
  region: number | null;
  regionName?: string;
  zip?: string;
}): Record<string, unknown> {
  return {
    objectNumber: options.ref,
    storeName: `Shop ${options.ref}`,
    address: {
      streetName: 'Avda. Madrid,',
      streetNumber: '34',
      city: 'Fraga',
      zip: options.zip ?? '22520',
      state: 'Aragón',
      latitude: 41.5223,
      longitude: 0.33812,
    },
    openingHours: {
      items: [
        {
          date: '2026-09-07',
          timeRanges: [
            { from: '2026-09-07T09:00:00', to: '2026-09-07T21:30:00' },
          ],
        },
      ],
    },
    marketingData:
      options.region === null
        ? {}
        : {
            offerRegion: options.region,
            offerRegionName: options.regionName ?? `Region ${options.region}`,
            zone: 'PEN',
          },
  };
}

class TestRunner extends LidlStoreDiscoveryRunner {
  constructor(private readonly stores: Array<Record<string, unknown>>) {
    super({
      getOrThrow: () => ({ userAgent: 'LunaShopperBot/1.0' }),
    } as unknown as ConfigService);
  }

  protected override createClient(): LidlClient {
    return new LidlClient({
      userAgent: 'LunaShopperBot/1.0',
      sleepImpl: async () => undefined,
      fetchImpl: (async (url: string) => {
        const offset = Number(
          new URL(String(url)).searchParams.get('offset') ?? 0
        );
        return new Response(
          JSON.stringify({
            meta: { total: this.stores.length },
            items: offset === 0 ? this.stores : [],
          }),
          { status: 200 }
        );
      }) as unknown as typeof fetch,
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
    warn: jest.fn(),
  } as unknown as RunContext;
}

const source = (adapterKey = 'lidl-api'): SupermarketSource =>
  ({ adapterKey, config: {}, workers: 1 }) as SupermarketSource;

/** The chain's identity, which the orchestrator reads and passes in. */
const CHAIN_IDENTITY = { externalBrandKey: 'Q151954', brandName: 'Lidl' };

describe('LidlStoreDiscoveryRunner', () => {
  // A recording report and nothing else. The run reports places and declares
  // regions; writing either is the orchestrator's (plan 0103, section 6.4), so
  // there is no repository and no `CatalogClient` to fake here.
  let report: RecordingRunReport;

  beforeEach(() => {
    report = new RecordingRunReport();
  });

  it('writes a place per shop, with the region the chain stated on it', async () => {
    const runner = new TestRunner([
      store({ ref: 'ES00215', region: 21, regionName: 'Huesca' }),
    ]);

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
      source()
    );

    expect(report.places).toHaveLength(1);
    expect(report.places[0]).toMatchObject({
      provider: 'LIDL',
      externalRef: 'ES00215',
      name: 'Shop ES00215',
      street: 'Avda. Madrid 34',
      postalCode: '22520',
      country: 'es',
      openingHours: 'Mo 09:00-21:30',
      // The chain's own identity, read by the orchestrator and passed in.
      brandKey: 'Q151954',
      tags: {
        'lidl:offerRegion': '21',
        'lidl:offerRegionName': 'Huesca',
        'lidl:zone': 'PEN',
        'addr:state': 'Aragón',
      },
    });
    // Whether the row is new, and what happens to one the owner already
    // decided on, is `discovered-place.service`'s. A run reports what the
    // source said and never a status.
    expect(report.places[0]).not.toHaveProperty('status');
  });

  it('names the region as the scope the shop is priced in', async () => {
    // What a trusted import reads to put the shop in the group the chain
    // prices it with (plan 0107, section 3.3). A shop with no region names
    // none and takes a STORE scope of its own.
    const runner = new TestRunner([
      store({ ref: 'ES1', region: 21 }),
      store({ ref: 'ES2', region: null }),
    ]);

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
      source()
    );

    expect(report.places.map((place) => place.scopeKey)).toEqual(['21', null]);
  });

  // --- The postal code filter (plan 0107, section 1) -----------------------

  it('reports only the shops in the codes it was asked for', async () => {
    // Three requests read the whole country whatever is asked of it. What the
    // filter saves is a chain wide store list being written again for every
    // code in the queue.
    const runner = new TestRunner([
      store({ ref: 'ES1', region: 21, zip: '22520' }),
      store({ ref: 'ES2', region: 26, zip: '14013' }),
      store({ ref: 'ES3', region: 21, zip: '28001' }),
    ]);

    await runner.run(
      context(),
      report,
      {
        postalCode: '14013',
        country: 'es',
        radiusMetres: 0,
        postalCodes: ['14013'],
        supermarketId: CHAIN,
        chain: CHAIN_IDENTITY,
      },
      source()
    );

    expect(report.places.map((place) => place.externalRef)).toEqual(['ES2']);
    // Only the regions of the shops it reported, so a filtered run does not
    // create scopes for shops it said nothing about.
    expect(report.scopes.map((scope) => scope.key)).toEqual(['26']);
  });

  it('reports every shop when the run names no code', async () => {
    // An empty array and an absent field are the same thing, which is every
    // shop the chain publishes.
    const stores = [
      store({ ref: 'ES1', region: 21, zip: '22520' }),
      store({ ref: 'ES2', region: 26, zip: '14013' }),
    ];

    for (const postalCodes of [undefined, []]) {
      report = new RecordingRunReport();
      await new TestRunner(stores).run(
        context(),
        report,
        {
          postalCode: '',
          country: 'es',
          radiusMetres: 0,
          postalCodes,
          supermarketId: CHAIN,
          chain: CHAIN_IDENTITY,
        },
        source()
      );
      expect(report.places).toHaveLength(2);
    }
  });

  it('names a code no shop sits on rather than refusing the run', async () => {
    // A filter that matched nothing is a run that reports nothing, and the
    // operator needs to know which code was the wrong one.
    const run = context();
    const runner = new TestRunner([
      store({ ref: 'ES1', region: 21, zip: '22520' }),
    ]);

    await runner.run(
      run,
      report,
      {
        postalCode: '99999',
        country: 'es',
        radiusMetres: 0,
        postalCodes: ['99999'],
        supermarketId: CHAIN,
        chain: CHAIN_IDENTITY,
      },
      source()
    );

    expect(report.places).toHaveLength(0);
    expect(run.setReport).toHaveBeenCalledWith(
      expect.objectContaining({
        stores: 0,
        storesInDocument: 1,
        postalCodesWithNoShop: ['99999'],
      })
    );
  });

  it('declares one scope per region, and none twice', async () => {
    const runner = new TestRunner([
      store({ ref: 'ES1', region: 21 }),
      store({ ref: 'ES2', region: 26 }),
      store({ ref: 'ES3', region: 21 }),
    ]);

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
      source()
    );

    expect(report.scopes).toEqual([
      { key: '21', kind: PriceScopeKind.REGION, name: 'Region 21' },
      { key: '26', kind: PriceScopeKind.REGION, name: 'Region 26' },
    ]);
    expect(report.places).toHaveLength(3);
  });

  it('counts a shop that names no region rather than assuming one', async () => {
    const run = context();
    const runner = new TestRunner([store({ ref: 'ES1', region: null })]);

    await runner.run(
      run,
      report,
      {
        postalCode: '',
        country: 'es',
        radiusMetres: 0,
        supermarketId: CHAIN,
        chain: CHAIN_IDENTITY,
      },
      source()
    );

    // Not one was seen in the research. A shop with no region is a shop no
    // price can reach, so it is counted rather than filled in.
    expect(report.scopes).toEqual([]);
    expect((run.setReport as jest.Mock).mock.calls[0][0]).toMatchObject({
      stores: 1,
      regionsSeen: 0,
      storesWithoutRegion: 1,
    });
  });

  it('refuses a run that does not say which chain it is reading', async () => {
    const runner = new TestRunner([]);

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

describe('StoreDiscoveryRunner', () => {
  const osm = { run: jest.fn(async () => undefined) };
  const lidl = { run: jest.fn(async () => undefined) };
  const mercadona = { run: jest.fn(async () => undefined) };
  const dispatcher = new StoreDiscoveryRunner(
    osm as unknown as OsmStoreDiscoveryRunner,
    lidl as unknown as LidlStoreDiscoveryRunner,
    mercadona as unknown as MercadonaStoreDiscoveryRunner
  );
  const input = { postalCode: '14013', country: 'es', radiusMetres: 3000 };

  beforeEach(() => {
    osm.run.mockClear();
    lidl.run.mockClear();
    mercadona.run.mockClear();
  });

  it('reads a chain that names its own shops from that chain', async () => {
    await dispatcher.run(
      context(),
      new RecordingRunReport(),
      input,
      source('lidl-api')
    );
    expect(lidl.run).toHaveBeenCalledTimes(1);
    expect(osm.run).not.toHaveBeenCalled();
  });

  it('reads Mercadona from Mercadona, which used to be the OSM case', async () => {
    // Plan 0038 asked OpenStreetMap for this chain's shops because OSM's
    // postcodes were missing two thirds of the time. That was a finding about
    // OSM; the chain publishes all 1,675 of its own with no gaps (plan 0106).
    await dispatcher.run(
      context(),
      new RecordingRunReport(),
      input,
      source('mercadona-api')
    );
    expect(mercadona.run).toHaveBeenCalledTimes(1);
    expect(osm.run).not.toHaveBeenCalled();
  });

  it('takes the OpenStreetMap case for a run with no chain behind it', async () => {
    // Every run the postal code queue starts looks like this: it is about a
    // place rather than about a chain, and it finds many chains at once.
    await dispatcher.run(context(), new RecordingRunReport(), input, null);
    expect(osm.run).toHaveBeenCalledTimes(1);

    // An adapter that publishes an assortment and no store list, and one this
    // build has never heard of, both answer the same way.
    await dispatcher.run(
      context(),
      new RecordingRunReport(),
      input,
      source('deza-web')
    );
    await dispatcher.run(
      context(),
      new RecordingRunReport(),
      input,
      source('brand-new-chain')
    );
    expect(osm.run).toHaveBeenCalledTimes(3);
    expect(lidl.run).not.toHaveBeenCalled();
    expect(mercadona.run).not.toHaveBeenCalled();
  });
});
