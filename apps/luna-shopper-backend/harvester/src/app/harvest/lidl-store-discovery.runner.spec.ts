import type { ConfigService } from '@nestjs/config';
import {
  DiscoveredPlaceStatus,
  PriceScopeKind,
  type PriceScopeView,
  type SupermarketView,
} from '@portfolio/luna-shopper/contracts';
import { LidlClient } from '@portfolio/luna-shopper/lidl';
import type { Repository } from 'typeorm';
import type { DiscoveredPlace, SupermarketSource } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { LidlStoreDiscoveryRunner } from './lidl-store-discovery.runner';
import { OsmStoreDiscoveryRunner } from './osm-store-discovery.runner';
import type { RunContext } from './run-context';
import { StoreDiscoveryRunner } from './store-discovery.runner';

/**
 * Store discovery against the chain's own list (plan 0089, section 9).
 *
 * **Nothing here reaches a network.** What it pins: the region every shop
 * names becomes a price scope and a tag on the place, no shop is created in
 * catalog, and a place the owner already decided on keeps its status.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const RUN = '33333333-3333-4333-8333-333333333333';

function store(options: {
  ref: string;
  region: number | null;
  regionName?: string;
}): Record<string, unknown> {
  return {
    objectNumber: options.ref,
    storeName: `Shop ${options.ref}`,
    address: {
      streetName: 'Avda. Madrid,',
      streetNumber: '34',
      city: 'Fraga',
      zip: '22520',
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
  constructor(
    places: Repository<DiscoveredPlace>,
    catalog: CatalogClient,
    private readonly stores: Array<Record<string, unknown>>
  ) {
    super(places, catalog, {
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

describe('LidlStoreDiscoveryRunner', () => {
  let saved: Array<Partial<DiscoveredPlace>>;
  let existing: Partial<DiscoveredPlace> | null;
  let places: Repository<DiscoveredPlace>;
  let created: Array<{ externalKey: string | null; kind: PriceScopeKind }>;
  let catalog: CatalogClient;

  beforeEach(() => {
    saved = [];
    existing = null;
    created = [];
    places = {
      findOne: jest.fn(async () => existing),
      create: jest.fn((row: Partial<DiscoveredPlace>) => row),
      save: jest.fn(async (row: Partial<DiscoveredPlace>) => {
        saved.push(row);
        return row;
      }),
    } as unknown as Repository<DiscoveredPlace>;
    catalog = {
      listPriceScopes: jest.fn(async () => ({ items: [], nextCursor: null })),
      createPriceScope: jest.fn(
        async (
          supermarketId: string,
          kind: PriceScopeKind,
          externalKey: string | null
        ) => {
          created.push({ externalKey, kind });
          return { id: `scope-${externalKey}`, externalKey } as PriceScopeView;
        }
      ),
      getSupermarket: jest.fn(
        async () =>
          ({
            id: CHAIN,
            name: { es: 'Lidl', en: 'Lidl' },
            externalBrandKey: 'Q151954',
          }) as SupermarketView
      ),
    } as unknown as CatalogClient;
  });

  it('writes a place per shop, with the region the chain stated on it', async () => {
    const runner = new TestRunner(places, catalog, [
      store({ ref: 'ES00215', region: 21, regionName: 'Huesca' }),
    ]);

    await runner.run(
      context(),
      { postalCode: '', country: 'es', radiusMetres: 0, supermarketId: CHAIN },
      source()
    );

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      provider: 'LIDL',
      externalRef: 'ES00215',
      name: 'Shop ES00215',
      street: 'Avda. Madrid 34',
      postalCode: '22520',
      country: 'es',
      status: DiscoveredPlaceStatus.NEW,
      openingHours: 'Mo 09:00-21:30',
      // The chain's own identity, read from catalog rather than typed here.
      brandKey: 'Q151954',
      tags: {
        'lidl:offerRegion': '21',
        'lidl:offerRegionName': 'Huesca',
        'lidl:zone': 'PEN',
        'addr:state': 'Aragón',
      },
    });
  });

  it('creates one price scope per region, and none twice', async () => {
    const runner = new TestRunner(places, catalog, [
      store({ ref: 'ES1', region: 21 }),
      store({ ref: 'ES2', region: 26 }),
      store({ ref: 'ES3', region: 21 }),
    ]);

    await runner.run(
      context(),
      { postalCode: '', country: 'es', radiusMetres: 0, supermarketId: CHAIN },
      source()
    );

    expect(created).toEqual([
      { externalKey: '21', kind: PriceScopeKind.REGION },
      { externalKey: '26', kind: PriceScopeKind.REGION },
    ]);
    expect(saved).toHaveLength(3);
  });

  it('never overwrites a decision the owner already made', async () => {
    existing = {
      id: 'place-1',
      status: DiscoveredPlaceStatus.REJECTED,
      supermarketLocationId: null,
    } as Partial<DiscoveredPlace>;
    const runner = new TestRunner(places, catalog, [
      store({ ref: 'ES1', region: 21 }),
    ]);

    await runner.run(
      context(),
      { postalCode: '', country: 'es', radiusMetres: 0, supermarketId: CHAIN },
      source()
    );

    // The description is refreshed and the status is the owner's.
    expect(saved[0]).toMatchObject({
      id: 'place-1',
      status: DiscoveredPlaceStatus.REJECTED,
      name: 'Shop ES1',
    });
  });

  it('counts a shop that names no region rather than assuming one', async () => {
    const run = context();
    const runner = new TestRunner(places, catalog, [
      store({ ref: 'ES1', region: null }),
    ]);

    await runner.run(
      run,
      { postalCode: '', country: 'es', radiusMetres: 0, supermarketId: CHAIN },
      source()
    );

    // Not one was seen in the research. A shop with no region is a shop no
    // price can reach, so it is reported rather than filled in.
    expect(created).toEqual([]);
    expect((run.setReport as jest.Mock).mock.calls[0][0]).toMatchObject({
      stores: 1,
      regionsSeen: 0,
      storesWithoutRegion: 1,
    });
  });

  it('refuses a run that does not say which chain it is reading', async () => {
    const runner = new TestRunner(places, catalog, []);

    await expect(
      runner.run(
        context(),
        { postalCode: '14013', country: 'es', radiusMetres: 3000 },
        source()
      )
    ).rejects.toThrow(/which chain/);
  });
});

describe('StoreDiscoveryRunner', () => {
  const osm = { run: jest.fn(async () => undefined) };
  const lidl = { run: jest.fn(async () => undefined) };
  const dispatcher = new StoreDiscoveryRunner(
    osm as unknown as OsmStoreDiscoveryRunner,
    lidl as unknown as LidlStoreDiscoveryRunner
  );
  const input = { postalCode: '14013', country: 'es', radiusMetres: 3000 };

  beforeEach(() => {
    osm.run.mockClear();
    lidl.run.mockClear();
  });

  it('reads a chain that names its own shops from that chain', async () => {
    await dispatcher.run(context(), input, source('lidl-api'));
    expect(lidl.run).toHaveBeenCalledTimes(1);
    expect(osm.run).not.toHaveBeenCalled();
  });

  it('takes the OpenStreetMap case for a run with no chain behind it', async () => {
    // Every run the postal code queue starts looks like this: it is about a
    // place rather than about a chain, and it finds many chains at once.
    await dispatcher.run(context(), input, null);
    expect(osm.run).toHaveBeenCalledTimes(1);

    await dispatcher.run(context(), input, source('mercadona-api'));
    expect(osm.run).toHaveBeenCalledTimes(2);
    expect(lidl.run).not.toHaveBeenCalled();
  });
});
