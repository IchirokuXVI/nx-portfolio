import {
  DiscoveredPlaceStatus,
  type SupermarketLocationView,
  type SupermarketPage,
  type SupermarketView,
} from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type { DiscoveredPlace } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { DiscoveredPlaceService } from './discovered-place.service';
import type { PlatformAdminService } from './platform-admin.service';
import type { ObservedPlace } from './run-report';

/**
 * A shop's size from its mapped outline (plan 0176).
 *
 * The number travels from the run to the place, and from the place to the
 * location on import. It is written whenever a place carries one, and a place
 * that carries none never clears it.
 */
describe('DiscoveredPlaceService, the footprint (plan 0176)', () => {
  const ADMIN = 'owner-1';
  const SEEN = new Date('2026-09-01T00:00:00.000Z');

  /** The Mercadona on Calle Escritor Conde de Zamora, mapped as a building. */
  function observed(over: Partial<ObservedPlace> = {}): ObservedPlace {
    return {
      provider: 'OSM',
      externalRef: 'way/533825505',
      brandKey: 'Q377705',
      brandName: 'Mercadona',
      name: 'Mercadona',
      latitude: 37.8774935,
      longitude: -4.80156355,
      footprintM2: 3002,
      street: 'Calle Escritor Conde de Zamora',
      city: 'Córdoba',
      postalCode: '14004',
      postalCodeSource: null,
      country: 'es',
      website: null,
      openingHours: null,
      tags: {},
      ...over,
    };
  }

  function chain(
    id: string,
    name: string,
    key: string | null
  ): SupermarketView {
    return {
      id,
      name: { en: name, es: name },
      logoUrl: null,
      websiteUrl: null,
      externalBrandKey: key,
      defaultPriceScopeId: null,
    } as SupermarketView;
  }

  function location(
    over: Partial<SupermarketLocationView> = {}
  ): SupermarketLocationView {
    return {
      id: 'loc-seeded',
      supermarketId: 'chain-mercadona',
      priceScopeId: 'scope-1',
      priceScopeIds: ['scope-1'],
      label: null,
      address: 'Calle Escritor Conde de Zamora',
      city: 'Córdoba',
      country: 'es',
      postalCode: '14004',
      postalCodeSource: null,
      latitude: 37.8774935,
      longitude: -4.80156355,
      externalRef: 'way/533825505',
      externalProvider: 'OSM',
      footprintM2: null,
      sections: [],
      ...over,
    };
  }

  function build(
    options: {
      existing?: Partial<DiscoveredPlace>;
      shops?: SupermarketLocationView[];
      updateFails?: boolean;
    } = {}
  ) {
    const known = [chain('chain-mercadona', 'Mercadona', 'Q377705')];
    const shops = [...(options.shops ?? [])];
    const stored: DiscoveredPlace[] = [];
    if (options.existing) {
      stored.push({ ...options.existing } as DiscoveredPlace);
    }

    const places = {
      findOne: jest.fn(
        async ({
          where,
        }: {
          where: { provider?: string; externalRef?: string; id?: string };
        }) => {
          const row = stored.find((held) =>
            where.id
              ? held.id === where.id
              : held.provider === where.provider &&
                held.externalRef === where.externalRef
          );
          return row ? { ...row } : null;
        }
      ),
      create: jest.fn(
        (row: Partial<DiscoveredPlace>) =>
          ({ id: `place-${stored.length + 1}`, ...row }) as DiscoveredPlace
      ),
      save: jest.fn(async (row: DiscoveredPlace) => {
        const at = stored.findIndex((held) => held.id === row.id);
        if (at === -1) {
          stored.push({ ...row });
        } else {
          stored[at] = { ...row };
        }
        return row;
      }),
    } as unknown as Repository<DiscoveredPlace>;

    const updates: unknown[] = [];
    const creates: unknown[] = [];
    const catalog = {
      listSupermarkets: jest.fn(
        async (): Promise<SupermarketPage> => ({
          items: [...known],
          nextCursor: null,
        })
      ),
      createLocation: jest.fn(async (input: { supermarketId: string }) => {
        creates.push(input);
        return location({ id: 'loc-new', ...input });
      }),
      listAllSupermarketLocations: jest.fn(async () => [] as never[]),
      getSupermarketLocation: jest.fn(async (id: string) => ({
        ...(shops.find((shop) => shop.id === id) as SupermarketLocationView),
      })),
      updateLocation: jest.fn(
        async (input: { supermarketLocationId: string }) => {
          if (options.updateFails) {
            throw new Error('catalog is down');
          }
          updates.push(input);
          return location(input);
        }
      ),
      resolveNearestPostalCode: jest.fn(async () => ({ nearest: null })),
    } as unknown as jest.Mocked<CatalogClient>;

    const admin = {
      requireAdmin: jest.fn(async () => ADMIN),
    } as unknown as jest.Mocked<PlatformAdminService>;

    return {
      service: new DiscoveredPlaceService(places, catalog, admin),
      stored,
      updates,
      creates,
    };
  }

  const options = { runId: 'run-1', deriveMaxMetres: 5000, autoImport: false };

  /** A place a run imported before its outline was measured. */
  const imported = (footprintM2: number | null): Partial<DiscoveredPlace> => ({
    id: 'place-1',
    provider: 'OSM',
    externalRef: 'way/533825505',
    status: DiscoveredPlaceStatus.IMPORTED,
    supermarketLocationId: 'loc-seeded',
    footprintM2,
    firstSeenAt: SEEN,
    lastSeenAt: SEEN,
  });

  it('records the size a run measured on a new place', async () => {
    const harness = build();

    await harness.service.observe([observed()], options);

    expect(harness.stored[0].footprintM2).toBe(3002);
  });

  it('keeps the size when a run meets the place with none', async () => {
    const harness = build({
      existing: { ...imported(3002), status: DiscoveredPlaceStatus.NEW },
    });

    await harness.service.observe([observed({ footprintM2: null })], options);

    expect(harness.stored[0].footprintM2).toBe(3002);
    expect(harness.updates).toEqual([]);
  });

  it('gives a shop already ours the size a later run measured', async () => {
    const harness = build({ existing: imported(null) });

    await harness.service.observe([observed()], options);

    expect(harness.updates).toEqual([
      { supermarketLocationId: 'loc-seeded', footprintM2: 3002 },
    ]);
    expect(harness.stored[0].footprintM2).toBe(3002);
  });

  it('sends nothing when the size did not change', async () => {
    const harness = build({ existing: imported(3002) });

    await harness.service.observe([observed()], options);

    expect(harness.updates).toEqual([]);
  });

  it('never clears a shop’s size over a place that carries none', async () => {
    const harness = build({ existing: imported(3002) });

    await harness.service.observe([observed({ footprintM2: null })], options);

    expect(harness.updates).toEqual([]);
    expect(harness.stored[0].footprintM2).toBe(3002);
  });

  it('keeps the old size on the place when catalog refuses, so the next run tries again', async () => {
    const harness = build({ existing: imported(null), updateFails: true });

    const result = await harness.service.observe([observed()], options);

    expect(result.refreshed).toBe(1);
    expect(harness.stored[0].footprintM2).toBeNull();
  });

  it('sends the size when a place is imported', async () => {
    const harness = build({
      existing: {
        ...observed(),
        id: 'place-1',
        status: DiscoveredPlaceStatus.NEW,
        supermarketLocationId: null,
        firstSeenAt: SEEN,
        lastSeenAt: SEEN,
      } as Partial<DiscoveredPlace>,
    });

    await harness.service.import({
      userId: ADMIN,
      placeId: 'place-1',
      supermarketId: 'chain-mercadona',
    });

    expect(harness.creates[0]).toMatchObject({ footprintM2: 3002 });
  });

  it('sends no size for a place mapped as a point', async () => {
    const harness = build({
      existing: {
        ...observed({ externalRef: 'node/1156230891', footprintM2: null }),
        id: 'place-1',
        status: DiscoveredPlaceStatus.NEW,
        supermarketLocationId: null,
        firstSeenAt: SEEN,
        lastSeenAt: SEEN,
      } as Partial<DiscoveredPlace>,
    });

    await harness.service.import({
      userId: ADMIN,
      placeId: 'place-1',
      supermarketId: 'chain-mercadona',
    });

    expect(harness.creates[0]).not.toHaveProperty('footprintM2');
  });

  it('fills the size a linked shop lacks, and keeps one it has', async () => {
    const bare = build({
      shops: [location()],
      existing: {
        ...observed(),
        id: 'place-1',
        status: DiscoveredPlaceStatus.NEW,
        supermarketLocationId: null,
        firstSeenAt: SEEN,
        lastSeenAt: SEEN,
      } as Partial<DiscoveredPlace>,
    });
    await bare.service.link({
      userId: ADMIN,
      placeId: 'place-1',
      supermarketLocationId: 'loc-seeded',
    });
    expect(bare.updates).toEqual([
      { supermarketLocationId: 'loc-seeded', footprintM2: 3002 },
    ]);

    const sized = build({
      shops: [location({ footprintM2: 2990 })],
      existing: {
        ...observed(),
        id: 'place-1',
        status: DiscoveredPlaceStatus.NEW,
        supermarketLocationId: null,
        firstSeenAt: SEEN,
        lastSeenAt: SEEN,
      } as Partial<DiscoveredPlace>,
    });
    await sized.service.link({
      userId: ADMIN,
      placeId: 'place-1',
      supermarketLocationId: 'loc-seeded',
    });
    expect(sized.updates).toEqual([]);
  });
});
