import {
  DiscoveredPlaceStatus,
  PostalCodeSource,
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
 * A trusted source writing its own shops into the catalog (plan 0107, section
 * 3).
 *
 * The run is the caller here rather than an admin, so there is no gate to pass
 * and no screen in the middle. What decides is the chain's `autoImportPlaces`
 * column, which reaches `observe` as `autoImport`, and the completeness check,
 * which is pure and has its own spec next door.
 */
describe('DiscoveredPlaceService.observe, the trusted path (plan 0107)', () => {
  /** A shop a chain named, complete enough to import. */
  function observed(over: Partial<ObservedPlace> = {}): ObservedPlace {
    return {
      provider: 'LIDL',
      externalRef: 'lidl/1234',
      brandKey: null,
      brandName: 'LIDL',
      name: 'LIDL Córdoba Poniente',
      latitude: 37.8882,
      longitude: -4.8035,
      street: 'Avenida del Aeropuerto',
      city: 'Córdoba',
      postalCode: '14013',
      postalCodeSource: PostalCodeSource.SOURCE,
      country: 'es',
      website: null,
      openingHours: null,
      tags: {},
      scopeKey: null,
      ...over,
    };
  }

  function chain(id: string, name: string): SupermarketView {
    return {
      id,
      name: { en: name, es: name },
      logoUrl: null,
      websiteUrl: null,
      externalBrandKey: null,
      defaultPriceScopeId: null,
    } as SupermarketView;
  }

  function build(options: { existing?: Partial<DiscoveredPlace> } = {}) {
    const known: SupermarketView[] = [chain('chain-lidl', 'LIDL')];
    const stored: DiscoveredPlace[] = [];
    if (options.existing) {
      stored.push(options.existing as DiscoveredPlace);
    }
    let locations = 0;

    const places = {
      findOne: jest.fn(
        async ({
          where,
        }: {
          where: { provider?: string; externalRef?: string; id?: string };
        }) =>
          stored.find((row) =>
            where.id
              ? row.id === where.id
              : row.provider === where.provider &&
                row.externalRef === where.externalRef
          ) ?? null
      ),
      create: jest.fn(
        (row: Partial<DiscoveredPlace>) =>
          ({ id: `place-${stored.length + 1}`, ...row }) as DiscoveredPlace
      ),
      save: jest.fn(async (row: DiscoveredPlace) => {
        const at = stored.findIndex((held) => held.id === row.id);
        if (at === -1) {
          stored.push(row);
        } else {
          stored[at] = row;
        }
        return row;
      }),
    } as unknown as Repository<DiscoveredPlace>;

    const catalog = {
      listSupermarkets: jest.fn(
        async (): Promise<SupermarketPage> => ({
          items: [...known],
          nextCursor: null,
        })
      ),
      createSupermarket: jest.fn(async () => chain('chain-new', 'New')),
      createLocation: jest.fn(
        async (input: {
          supermarketId: string;
        }): Promise<SupermarketLocationView> =>
          ({
            id: `loc-${++locations}`,
            supermarketId: input.supermarketId,
          }) as SupermarketLocationView
      ),
      // Never reached: every place here states its own postal code, and one
      // that does not is refused by the check rather than derived.
      resolveNearestPostalCode: jest.fn(async () => ({ nearest: null })),
    } as unknown as jest.Mocked<CatalogClient>;

    const admin = {
      requireAdmin: jest.fn(async () => 'owner-1'),
    } as unknown as jest.Mocked<PlatformAdminService>;

    return {
      service: new DiscoveredPlaceService(places, catalog, admin),
      catalog,
      admin,
      stored,
    };
  }

  const options = (over: Record<string, unknown> = {}) => ({
    runId: 'run-1',
    deriveMaxMetres: 5000,
    autoImport: true,
    ...over,
  });

  it('writes a location and marks the place imported', async () => {
    const harness = build();

    const result = await harness.service.observe([observed()], options());

    expect(result.imported).toBe(1);
    expect(result.blocked).toEqual([]);
    expect(harness.catalog.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        supermarketId: 'chain-lidl',
        postalCode: '14013',
        country: 'es',
        externalRef: 'lidl/1234',
        externalProvider: 'LIDL',
      })
    );
    expect(harness.stored[0].status).toBe(DiscoveredPlaceStatus.IMPORTED);
    expect(harness.stored[0].supermarketLocationId).toBe('loc-1');
  });

  it('asks nobody for permission, because the caller is a run', async () => {
    const harness = build();

    await harness.service.observe([observed()], options());

    expect(harness.admin.requireAdmin).not.toHaveBeenCalled();
  });

  it('puts the shop in the scope the source declared for it', async () => {
    const harness = build();

    await harness.service.observe([observed({ scopeKey: 'ES-12' })], {
      ...options(),
      scopeIdFor: (key: string) => (key === 'ES-12' ? 'scope-12' : null),
    });

    expect(harness.catalog.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({ priceScopeId: 'scope-12' })
    );
  });

  it('names no scope when the source declared none', async () => {
    // Catalog then gives the location the STORE scope it gives any location
    // that names none (section 3.3).
    const harness = build();

    await harness.service.observe([observed()], options());

    expect(harness.catalog.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({ priceScopeId: undefined })
    );
  });

  it('leaves an incomplete place in the queue and names what it lacks', async () => {
    const harness = build();

    const result = await harness.service.observe(
      [observed({ country: null, brandName: null })],
      options()
    );

    expect(harness.catalog.createLocation).not.toHaveBeenCalled();
    expect(result.imported).toBe(0);
    expect(result.blocked).toEqual([
      { externalRef: 'lidl/1234', missing: ['country', 'chain'] },
    ]);
    // An ordinary NEW row in the review queue, which is the existing screen
    // doing the existing job. Nothing is rejected (D4).
    expect(harness.stored[0].status).toBe(DiscoveredPlaceStatus.NEW);
  });

  it('imports a shop the chain published no name for', async () => {
    // Mercadona's store finder publishes none at all, so a required name sent
    // every one of its 1,675 shops to the review queue. The location is created
    // with no label, and velista draws the address under the chain's name,
    // which is what it already does for every shop with no name of its own.
    const harness = build();

    const result = await harness.service.observe(
      [observed({ name: null })],
      options()
    );

    expect(result.imported).toBe(1);
    expect(result.blocked).toEqual([]);
    expect(harness.catalog.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        label: null,
        address: 'Avenida del Aeropuerto',
        city: 'Córdoba',
      })
    );
  });

  it('refuses a place whose postal code was derived rather than stated', async () => {
    const harness = build();

    const result = await harness.service.observe(
      [observed({ postalCode: null })],
      options()
    );

    expect(harness.catalog.createLocation).not.toHaveBeenCalled();
    expect(result.blocked).toEqual([
      { externalRef: 'lidl/1234', missing: ['postalCode'] },
    ]);
  });

  it('writes nothing for a place that is already imported (D6)', async () => {
    // Re-running a chain must not rewrite a location an operator has since
    // edited, and must not create a second one.
    const harness = build({
      existing: {
        id: 'place-1',
        provider: 'LIDL',
        externalRef: 'lidl/1234',
        status: DiscoveredPlaceStatus.IMPORTED,
        supermarketLocationId: 'loc-old',
      },
    });

    const result = await harness.service.observe([observed()], options());

    expect(harness.catalog.createLocation).not.toHaveBeenCalled();
    expect(result.imported).toBe(0);
    expect(harness.stored[0].supermarketLocationId).toBe('loc-old');
  });

  it('writes nothing for a place the owner rejected', async () => {
    const harness = build({
      existing: {
        id: 'place-1',
        provider: 'LIDL',
        externalRef: 'lidl/1234',
        status: DiscoveredPlaceStatus.REJECTED,
        supermarketLocationId: null,
      },
    });

    const result = await harness.service.observe([observed()], options());

    expect(harness.catalog.createLocation).not.toHaveBeenCalled();
    expect(result.imported).toBe(0);
  });

  it('imports nothing at all when the source is not trusted (D3)', async () => {
    // Which is every radius search: OpenStreetMap has no row to carry the flag,
    // and its data is why the review queue exists. The place is complete here,
    // so the only thing stopping the import is the switch.
    const harness = build();

    const result = await harness.service.observe(
      [observed({ provider: 'OSM', externalRef: 'node/1' })],
      options({ autoImport: false })
    );

    expect(harness.catalog.createLocation).not.toHaveBeenCalled();
    expect(result.imported).toBe(0);
    expect(result.blocked).toEqual([]);
    expect(harness.stored[0].status).toBe(DiscoveredPlaceStatus.NEW);
  });

  it('keeps the run when catalog refuses one shop', async () => {
    // A shop catalog refused is one shop. The run found the rest and the row is
    // still in the queue for a person, so losing an eighteen minute walk over
    // one address would be the wrong trade.
    const harness = build();
    harness.catalog.createLocation.mockRejectedValueOnce(
      new Error('catalog is down')
    );

    const result = await harness.service.observe(
      [
        observed({ externalRef: 'lidl/1' }),
        observed({ externalRef: 'lidl/2' }),
      ],
      options()
    );

    expect(result.created).toBe(2);
    expect(result.imported).toBe(1);
    expect(harness.stored[0].status).toBe(DiscoveredPlaceStatus.NEW);
    expect(harness.stored[1].status).toBe(DiscoveredPlaceStatus.IMPORTED);
  });
});
