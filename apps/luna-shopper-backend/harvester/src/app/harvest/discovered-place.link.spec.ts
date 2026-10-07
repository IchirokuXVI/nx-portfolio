import {
  DiscoveredPlaceStatus,
  PlaceLinkField,
  PlaceLinkSkipReason,
  PlaceMatchRung,
  PostalCodeSource,
  type SupermarketLocationView,
  type SupermarketPage,
  type SupermarketView,
} from '@portfolio/luna-shopper/contracts';
import {
  NotFoundException,
  PlaceAlreadyImportedException,
  PlaceNamesAnotherChainException,
} from '@portfolio/luna-shopper/platform';
import type { Repository } from 'typeorm';
import type { DiscoveredPlace } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { DiscoveredPlaceService } from './discovered-place.service';
import type { PlatformAdminService } from './platform-admin.service';

/**
 * A place links to the shop it is (plan 0193).
 *
 * The link a person makes, the candidates the list read works out, the bulk
 * link by reference and the label of an import. The pure halves have their
 * own specs next door (`place-link-fields.spec.ts`, `place-matching.spec.ts`),
 * so what is proved here is what the service does with them: which catalog
 * calls it makes, and which it must never make.
 */

const ADMIN = 'owner-1';
const LAT = 37.88;
const LON = -4.77;
const SEEN = new Date('2026-10-01T00:00:00.000Z');

/** One degree of latitude on the sphere `distanceMetres` measures on. */
const METRES_PER_DEGREE = (6_371_000 * Math.PI) / 180;

function north(metres: number): number {
  return LAT + metres / METRES_PER_DEGREE;
}

/** An OpenStreetMap place of El Jamón, as most of the first catalog's are. */
function place(overrides: Partial<DiscoveredPlace> = {}): DiscoveredPlace {
  return {
    id: 'place-1',
    runId: 'run-1',
    provider: 'OSM',
    externalRef: 'node/1',
    brandKey: null,
    brandName: 'El Jamón',
    name: 'El Jamón',
    latitude: LAT,
    longitude: LON,
    footprintM2: null,
    street: 'Avenida de Cádiz 68',
    city: 'Córdoba',
    postalCode: '14010',
    postalCodeSource: PostalCodeSource.SOURCE,
    country: 'es',
    website: null,
    openingHours: 'Mo-Sa 09:00-21:30',
    tags: {},
    scopeKey: null,
    status: DiscoveredPlaceStatus.NEW,
    supermarketLocationId: null,
    firstSeenAt: SEEN,
    lastSeenAt: SEEN,
    ...overrides,
  } as DiscoveredPlace;
}

function chain(
  id: string,
  name: string,
  externalBrandKey: string | null = null
): SupermarketView {
  return {
    id,
    name: { es: name },
    logoUrl: null,
    websiteUrl: null,
    externalBrandKey,
    defaultPriceScopeId: null,
  } as SupermarketView;
}

const ELJAMON = chain('chain-eljamon', 'El Jamón');
const DEZA = chain('chain-deza', 'Deza');
const DIA = chain('chain-dia', 'Dia', 'Q925132');

/** A shop of El Jamón that holds every field, 2 km north of the place. */
function shop(
  overrides: Partial<SupermarketLocationView> = {}
): SupermarketLocationView {
  return {
    id: 'loc-1',
    supermarketId: ELJAMON.id,
    priceScopeId: 'scope-store',
    priceScopeIds: ['scope-store'],
    label: null,
    address: 'Calle de la Feria 3',
    city: 'Córdoba',
    country: 'es',
    postalCode: '14002',
    postalCodeSource: PostalCodeSource.MANUAL,
    latitude: north(2000),
    longitude: LON,
    externalRef: 'node/900',
    externalProvider: 'OSM',
    footprintM2: 800,
    sections: [],
    ...overrides,
  } as SupermarketLocationView;
}

/** A shop with nothing but its position, as 13 El Jamón shops are. */
function bareShop(
  overrides: Partial<SupermarketLocationView> = {}
): SupermarketLocationView {
  return shop({
    address: null,
    city: null,
    country: null,
    postalCode: '14013',
    postalCodeSource: PostalCodeSource.DERIVED,
    ...overrides,
  });
}

function build(
  options: {
    known?: SupermarketView[];
    shops?: SupermarketLocationView[];
    places?: DiscoveredPlace[];
  } = {}
) {
  const known = [...(options.known ?? [ELJAMON])];
  const shops = (options.shops ?? []).map((held) => ({ ...held }));
  const rows = new Map<string, DiscoveredPlace>(
    (options.places ?? []).map((row) => [row.id, { ...row }])
  );
  const saves: DiscoveredPlace[] = [];

  const queryBuilder = {
    orderBy: () => queryBuilder,
    addOrderBy: () => queryBuilder,
    take: () => queryBuilder,
    andWhere: () => queryBuilder,
    getMany: async () => [...rows.values()].map((row) => ({ ...row })),
  };
  const places = {
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => {
      const row = rows.get(where.id);
      return row ? { ...row } : null;
    }),
    // The one `where` the service sends is the status, so the fake reads it
    // rather than answering every row: "it reads NEW places only" is then
    // something a spec below can fail on.
    find: jest.fn(
      async ({ where }: { where: { status: DiscoveredPlaceStatus } }) =>
        [...rows.values()]
          .filter((row) => row.status === where.status)
          .map((row) => ({ ...row }))
    ),
    save: jest.fn(async (row: DiscoveredPlace) => {
      rows.set(row.id, { ...row });
      saves.push({ ...row });
      return row;
    }),
    createQueryBuilder: jest.fn(() => queryBuilder),
  } as unknown as jest.Mocked<Repository<DiscoveredPlace>>;

  const catalog = {
    listSupermarkets: jest.fn(
      async (): Promise<SupermarketPage> => ({
        items: [...known],
        nextCursor: null,
      })
    ),
    createSupermarket: jest.fn(),
    createLocation: jest.fn(
      async (input: {
        supermarketId: string;
      }): Promise<SupermarketLocationView> =>
        ({ id: 'loc-created', ...input }) as SupermarketLocationView
    ),
    listAllSupermarketLocations: jest.fn(async (supermarketId: string) =>
      shops
        .filter((held) => held.supermarketId === supermarketId)
        .map((held) => ({ ...held }))
    ),
    getSupermarketLocation: jest.fn(async (id: string) => {
      const held = shops.find((candidate) => candidate.id === id);
      if (!held) {
        throw new NotFoundException('Supermarket location not found');
      }
      return { ...held };
    }),
    // It writes, so a second read answers what the first link left behind.
    updateLocation: jest.fn(
      async (input: { supermarketLocationId: string }) => {
        const { supermarketLocationId, ...patch } = input;
        const held = shops.find((c) => c.id === supermarketLocationId);
        if (!held) {
          throw new NotFoundException('Supermarket location not found');
        }
        Object.assign(held, patch);
        return { ...held };
      }
    ),
    listAllPriceScopes: jest.fn(async () => []),
  } as unknown as jest.Mocked<CatalogClient>;

  const admin = {
    requireAdmin: jest.fn(async () => ADMIN),
  } as unknown as jest.Mocked<PlatformAdminService>;

  return {
    service: new DiscoveredPlaceService(places, catalog, admin),
    places,
    catalog,
    admin,
    rows,
    shops,
    saves,
  };
}

/** Catches what a call throws, so a spec can read the details bag. */
async function refusal(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the call to be refused');
}

const link = (extra: Record<string, unknown> = {}) => ({
  userId: ADMIN,
  placeId: 'place-1',
  supermarketLocationId: 'loc-1',
  ...extra,
});

describe('DiscoveredPlaceService.link, what it fills (plan 0193)', () => {
  it('fills the address, the city, the country and a stated postal code a shop lacks', async () => {
    const harness = build({ shops: [bareShop()], places: [place()] });

    const result = await harness.service.link(link());

    expect(harness.catalog.updateLocation).toHaveBeenCalledTimes(1);
    expect(harness.catalog.updateLocation).toHaveBeenCalledWith({
      supermarketLocationId: 'loc-1',
      address: 'Avenida de Cádiz 68',
      city: 'Córdoba',
      country: 'es',
      postalCode: '14010',
      postalCodeSource: PostalCodeSource.SOURCE,
    });
    expect(result.filled).toEqual([
      PlaceLinkField.POSTAL_CODE,
      PlaceLinkField.ADDRESS,
      PlaceLinkField.CITY,
      PlaceLinkField.COUNTRY,
    ]);
  });

  it('answers the place, imported and naming its shop', async () => {
    const harness = build({ shops: [bareShop()], places: [place()] });

    const { place: view } = await harness.service.link(link());

    expect(view.status).toBe(DiscoveredPlaceStatus.IMPORTED);
    expect(view.supermarketLocationId).toBe('loc-1');
    // A decided place carries no candidates, on this read or any other.
    expect(view.candidates).toEqual([]);
    expect(harness.rows.get('place-1')?.status).toBe(
      DiscoveredPlaceStatus.IMPORTED
    );
  });

  it('writes only the mark on a shop that holds every field', async () => {
    const harness = build({ shops: [shop()], places: [place()] });

    const result = await harness.service.link(link());

    expect(result.filled).toEqual([]);
    expect(harness.catalog.updateLocation).not.toHaveBeenCalled();
    expect(harness.rows.get('place-1')?.supermarketLocationId).toBe('loc-1');
  });

  it('never overwrites a field the shop holds', async () => {
    const held = shop({
      address: 'Avda. Cádiz, 68 (local 2)',
      city: 'Cordoba',
      country: 'ES',
      postalCode: '14999',
      postalCodeSource: PostalCodeSource.MANUAL,
    });
    const harness = build({ shops: [held], places: [place()] });

    await harness.service.link(link());

    expect(harness.catalog.updateLocation).not.toHaveBeenCalled();
    expect(harness.shops[0]).toEqual(held);
  });

  it('never sends a derived postal code, also to a shop that has none', async () => {
    const harness = build({
      shops: [shop({ postalCode: null, postalCodeSource: null })],
      places: [place({ postalCodeSource: PostalCodeSource.DERIVED })],
    });

    const result = await harness.service.link(link());

    expect(result.filled).toEqual([]);
    expect(harness.catalog.updateLocation).not.toHaveBeenCalled();
  });

  it('replaces a derived code on the shop with the one the source stated', async () => {
    const harness = build({
      shops: [
        shop({
          postalCode: '14013',
          postalCodeSource: PostalCodeSource.DERIVED,
        }),
      ],
      places: [place()],
    });

    const result = await harness.service.link(link());

    expect(harness.catalog.updateLocation).toHaveBeenCalledWith({
      supermarketLocationId: 'loc-1',
      postalCode: '14010',
      postalCodeSource: PostalCodeSource.SOURCE,
    });
    expect(result.filled).toEqual([PlaceLinkField.POSTAL_CODE]);
  });

  it('never creates a shop and never writes a label', async () => {
    const harness = build({
      shops: [bareShop({ label: null })],
      places: [place({ name: 'Supermercados El Jamón' })],
    });

    await harness.service.link(link());

    expect(harness.catalog.createLocation).not.toHaveBeenCalled();
    expect(harness.catalog.createSupermarket).not.toHaveBeenCalled();
    const [sent] = harness.catalog.updateLocation.mock.calls[0];
    expect(sent).not.toHaveProperty('label');
  });

  it('leaves the place NEW when catalog refuses the write', async () => {
    const harness = build({ shops: [bareShop()], places: [place()] });
    harness.catalog.updateLocation.mockRejectedValueOnce(new Error('down'));

    await expect(harness.service.link(link())).rejects.toThrow('down');

    expect(harness.places.save).not.toHaveBeenCalled();
    expect(harness.rows.get('place-1')?.status).toBe(DiscoveredPlaceStatus.NEW);
  });
});

describe('DiscoveredPlaceService.link, the chain the named shop decides (plan 0193)', () => {
  it('links a place that resolves to the chain of the shop', async () => {
    const harness = build({ shops: [shop()], places: [place()] });

    const result = await harness.service.link(link());

    expect(result.place.status).toBe(DiscoveredPlaceStatus.IMPORTED);
  });

  it('links a place that names no brand, because the shop is the statement', async () => {
    // "Supercash Sector Sur": no brand tag, and a name that is no chain.
    const harness = build({
      known: [ELJAMON, DEZA],
      shops: [shop({ supermarketId: DEZA.id })],
      places: [place({ brandName: null, name: 'Supercash Sector Sur' })],
    });

    const result = await harness.service.link(link());

    expect(result.place.supermarketLocationId).toBe('loc-1');
  });

  it('links a place whose brand the catalog files under no chain', async () => {
    const harness = build({
      shops: [shop()],
      places: [place({ brandName: 'Proxi', name: 'El Jamón (Proxi)' })],
    });

    const result = await harness.service.link(link());

    expect(result.place.status).toBe(DiscoveredPlaceStatus.IMPORTED);
  });

  it('links a place with neither a brand nor a name', async () => {
    const harness = build({
      shops: [shop()],
      places: [place({ brandName: null, name: null })],
    });

    const result = await harness.service.link(link());

    expect(result.place.status).toBe(DiscoveredPlaceStatus.IMPORTED);
  });

  it('answers place_names_another_chain with that chain, and writes nothing', async () => {
    const harness = build({
      known: [ELJAMON, DIA],
      shops: [bareShop()],
      places: [place({ brandKey: 'Q925132', brandName: 'Dia', name: 'Dia' })],
    });

    const error = await refusal(harness.service.link(link()));

    expect(error).toBeInstanceOf(PlaceNamesAnotherChainException);
    const refused = error as PlaceNamesAnotherChainException;
    expect(refused.code).toBe('place_names_another_chain');
    expect(refused.exposesDetails).toBe(true);
    expect(refused.details).toEqual({
      chain: { id: 'chain-dia', name: { es: 'Dia' } },
    });
    expect(harness.catalog.updateLocation).not.toHaveBeenCalled();
    expect(harness.places.save).not.toHaveBeenCalled();
    expect(harness.rows.get('place-1')?.status).toBe(DiscoveredPlaceStatus.NEW);
  });

  it('asks the same question of a place that names another chain by name only', async () => {
    const harness = build({
      known: [ELJAMON, DEZA],
      shops: [shop()],
      places: [place({ brandName: 'DEZA', name: 'Deza Arroyo' })],
    });

    const error = await refusal(harness.service.link(link()));

    expect(error).toBeInstanceOf(PlaceNamesAnotherChainException);
    expect((error as PlaceNamesAnotherChainException).details).toEqual({
      chain: { id: 'chain-deza', name: { es: 'Deza' } },
    });
  });

  it('links across chains when the person says so', async () => {
    const harness = build({
      known: [ELJAMON, DIA],
      shops: [bareShop()],
      places: [place({ brandKey: 'Q925132', brandName: 'Dia', name: 'Dia' })],
    });

    const result = await harness.service.link(link({ acrossChains: true }));

    expect(result.place.status).toBe(DiscoveredPlaceStatus.IMPORTED);
    expect(result.place.supermarketLocationId).toBe('loc-1');
    expect(result.filled).toContain(PlaceLinkField.ADDRESS);
    // The answer was given, so the chains are not even read.
    expect(harness.catalog.listSupermarkets).not.toHaveBeenCalled();
  });

  it('does not take acrossChains: false for a yes', async () => {
    const harness = build({
      known: [ELJAMON, DIA],
      shops: [shop()],
      places: [place({ brandKey: 'Q925132', brandName: 'Dia', name: 'Dia' })],
    });

    await expect(
      harness.service.link(link({ acrossChains: false }))
    ).rejects.toBeInstanceOf(PlaceNamesAnotherChainException);
  });

  it('refuses an imported place, also with acrossChains', async () => {
    const harness = build({
      shops: [bareShop()],
      places: [
        place({
          status: DiscoveredPlaceStatus.IMPORTED,
          supermarketLocationId: 'loc-other',
        }),
      ],
    });

    await expect(
      harness.service.link(link({ acrossChains: true }))
    ).rejects.toBeInstanceOf(PlaceAlreadyImportedException);
    expect(harness.catalog.updateLocation).not.toHaveBeenCalled();
    expect(harness.rows.get('place-1')?.supermarketLocationId).toBe(
      'loc-other'
    );
  });

  it('still links a rejected place a person names, as before (decision E)', async () => {
    const harness = build({
      shops: [shop()],
      places: [place({ status: DiscoveredPlaceStatus.REJECTED })],
    });

    const result = await harness.service.link(link());

    expect(result.place.status).toBe(DiscoveredPlaceStatus.IMPORTED);
  });

  it('answers not found for a shop the catalog does not hold', async () => {
    const harness = build({ shops: [], places: [place()] });

    await expect(harness.service.link(link())).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(harness.places.save).not.toHaveBeenCalled();
  });

  it('asks for the admin before it reads anything', async () => {
    const harness = build({ shops: [shop()], places: [place()] });
    harness.admin.requireAdmin.mockRejectedValueOnce(new Error('not an admin'));

    await expect(harness.service.link(link())).rejects.toThrow('not an admin');
    expect(harness.places.findOne).not.toHaveBeenCalled();
  });
});

describe('DiscoveredPlaceService.list, the shops a place may be (plan 0193)', () => {
  const list = () => ({ userId: ADMIN });

  it('carries the candidates of a NEW place, strict rung first and near after', async () => {
    const harness = build({
      shops: [
        shop({ id: 'loc-far', latitude: north(900) }),
        shop({ id: 'loc-near', latitude: north(120) }),
        shop({ id: 'loc-same', latitude: north(20) }),
      ],
      places: [place()],
    });

    const page = await harness.service.list(list());

    expect(page.items[0].candidates).toEqual([
      {
        supermarketLocationId: 'loc-same',
        supermarketId: 'chain-eljamon',
        label: null,
        address: 'Calle de la Feria 3',
        city: 'Córdoba',
        postalCode: '14002',
        rung: PlaceMatchRung.NEARBY,
        metres: 20,
      },
      {
        supermarketLocationId: 'loc-near',
        supermarketId: 'chain-eljamon',
        label: null,
        address: 'Calle de la Feria 3',
        city: 'Córdoba',
        postalCode: '14002',
        rung: PlaceMatchRung.SAME_CHAIN_NEAR,
        metres: 120,
      },
    ]);
  });

  it('carries none for an imported or a rejected place, and asks catalog nothing', async () => {
    const harness = build({
      shops: [shop({ latitude: north(10) })],
      places: [
        place({
          id: 'p-imported',
          status: DiscoveredPlaceStatus.IMPORTED,
          supermarketLocationId: 'loc-1',
        }),
        place({ id: 'p-rejected', status: DiscoveredPlaceStatus.REJECTED }),
      ],
    });

    const page = await harness.service.list(list());

    expect(page.items.map((item) => item.candidates)).toEqual([[], []]);
    expect(harness.catalog.listSupermarkets).not.toHaveBeenCalled();
    expect(harness.catalog.listAllSupermarketLocations).not.toHaveBeenCalled();
  });

  it('gives a decided place none on a page that also holds a NEW one', async () => {
    const harness = build({
      shops: [shop({ latitude: north(10) })],
      places: [
        place({ id: 'p-new' }),
        place({
          id: 'p-rejected',
          externalRef: 'node/2',
          status: DiscoveredPlaceStatus.REJECTED,
        }),
        place({
          id: 'p-imported',
          externalRef: 'node/3',
          status: DiscoveredPlaceStatus.IMPORTED,
          supermarketLocationId: 'loc-1',
        }),
      ],
    });

    const page = await harness.service.list(list());

    const byId = new Map(page.items.map((item) => [item.id, item.candidates]));
    expect(byId.get('p-new')).toHaveLength(1);
    expect(byId.get('p-rejected')).toEqual([]);
    expect(byId.get('p-imported')).toEqual([]);
  });

  it('asks catalog once for the chains and once for each chain a page needs', async () => {
    const harness = build({
      known: [ELJAMON, DEZA, DIA],
      shops: [
        shop({ id: 'loc-eljamon', latitude: north(10) }),
        shop({ id: 'loc-deza', supermarketId: DEZA.id, latitude: north(10) }),
        shop({ id: 'loc-dia', supermarketId: DIA.id, latitude: north(10) }),
      ],
      places: [
        place({ id: 'p1' }),
        place({ id: 'p2', externalRef: 'node/2' }),
        place({ id: 'p3', externalRef: 'node/3' }),
        place({ id: 'p4', externalRef: 'node/4', brandName: 'Deza' }),
        place({ id: 'p5', externalRef: 'node/5', brandName: 'Deza' }),
      ],
    });

    const page = await harness.service.list(list());

    expect(harness.catalog.listSupermarkets).toHaveBeenCalledTimes(1);
    // El Jamón and Deza, once each. No place of the page names Dia.
    expect(
      harness.catalog.listAllSupermarketLocations.mock.calls
        .map(([supermarketId]) => supermarketId)
        .sort()
    ).toEqual(['chain-deza', 'chain-eljamon']);
    expect(
      page.items.map((item) => item.candidates[0]?.supermarketLocationId)
    ).toEqual([
      'loc-eljamon',
      'loc-eljamon',
      'loc-eljamon',
      'loc-deza',
      'loc-deza',
    ]);
  });

  it('finds the shop made from a place that resolves to no chain, by its reference', async () => {
    const harness = build({
      known: [ELJAMON, DEZA],
      shops: [
        shop({
          id: 'loc-supercash',
          supermarketId: DEZA.id,
          externalRef: 'node/1',
          externalProvider: 'OSM',
          latitude: LAT,
        }),
        shop({ id: 'loc-eljamon', latitude: north(5) }),
      ],
      places: [place({ brandName: null, name: 'Supercash Sector Sur' })],
    });

    const page = await harness.service.list(list());

    expect(page.items[0].candidates).toEqual([
      expect.objectContaining({
        supermarketLocationId: 'loc-supercash',
        supermarketId: 'chain-deza',
        rung: PlaceMatchRung.EXTERNAL_REF,
        metres: 0,
      }),
    ]);
  });

  it('offers a place with no chain no shop on a distance, however near', async () => {
    const harness = build({
      known: [ELJAMON, DEZA],
      shops: [
        shop({ id: 'loc-here', latitude: LAT }),
        shop({ id: 'loc-deza', supermarketId: DEZA.id, latitude: north(3) }),
      ],
      places: [place({ brandName: null, name: 'Piedra' })],
    });

    const page = await harness.service.list(list());

    expect(page.items[0].candidates).toEqual([]);
  });

  it('lists each chain once for several places with no chain', async () => {
    const harness = build({
      known: [ELJAMON, DEZA],
      shops: [shop()],
      places: [
        place({ id: 'p1', brandName: null, name: 'Piedra' }),
        place({ id: 'p2', externalRef: 'node/2', brandName: null, name: 'A' }),
        place({ id: 'p3', externalRef: 'node/3' }),
      ],
    });

    await harness.service.list(list());

    expect(harness.catalog.listSupermarkets).toHaveBeenCalledTimes(1);
    expect(harness.catalog.listAllSupermarketLocations).toHaveBeenCalledTimes(
      2
    );
  });

  it('writes nothing: a read stores no candidate and changes no status', async () => {
    const harness = build({
      shops: [shop({ latitude: north(10) })],
      places: [place()],
    });

    await harness.service.list(list());

    expect(harness.places.save).not.toHaveBeenCalled();
    expect(harness.catalog.updateLocation).not.toHaveBeenCalled();
    expect(harness.rows.get('place-1')?.status).toBe(DiscoveredPlaceStatus.NEW);
  });
});

describe('DiscoveredPlaceService.linkByRef (plan 0193)', () => {
  /** Three places whose shops were made from them, and the marks then lost. */
  function lost() {
    return build({
      known: [ELJAMON, DEZA],
      shops: [
        shop({
          id: 'loc-a',
          externalRef: 'node/a',
          externalProvider: 'OSM',
          latitude: LAT,
        }),
        // Created from a place that resolves to no chain today.
        shop({
          id: 'loc-b',
          supermarketId: DEZA.id,
          externalRef: 'node/b',
          externalProvider: 'OSM',
          address: null,
          city: null,
          postalCode: '14013',
          postalCodeSource: PostalCodeSource.DERIVED,
        }),
        shop({ id: 'loc-unrelated', latitude: north(1) }),
      ],
      places: [
        place({ id: 'p-a', externalRef: 'node/a' }),
        place({
          id: 'p-b',
          externalRef: 'node/b',
          brandName: null,
          name: 'Supercash Las Quemadas',
        }),
        // One metre from a shop of its chain, and no shop has its reference.
        place({ id: 'p-near', externalRef: 'node/near' }),
      ],
    });
  }

  it('answers what it would do, and writes nothing without apply', async () => {
    const harness = lost();

    const result = await harness.service.linkByRef({ userId: ADMIN });

    expect(result.applied).toBe(false);
    expect(
      result.linked.map((row) => [
        row.place.id,
        row.shop.supermarketLocationId,
        row.filled,
      ])
    ).toEqual([
      ['p-a', 'loc-a', []],
      [
        'p-b',
        'loc-b',
        [
          PlaceLinkField.POSTAL_CODE,
          PlaceLinkField.ADDRESS,
          PlaceLinkField.CITY,
        ],
      ],
    ]);
    expect(result.skipped).toEqual([]);
    // The dry answer shows the place as it is, not as it would be.
    expect(result.linked.map((row) => row.place.status)).toEqual([
      DiscoveredPlaceStatus.NEW,
      DiscoveredPlaceStatus.NEW,
    ]);
    expect(harness.catalog.updateLocation).not.toHaveBeenCalled();
    expect(harness.catalog.createLocation).not.toHaveBeenCalled();
    expect(harness.places.save).not.toHaveBeenCalled();
    expect([...harness.rows.values()].map((row) => row.status)).toEqual([
      DiscoveredPlaceStatus.NEW,
      DiscoveredPlaceStatus.NEW,
      DiscoveredPlaceStatus.NEW,
    ]);
  });

  it('writes nothing for apply: false either', async () => {
    const harness = lost();

    const result = await harness.service.linkByRef({
      userId: ADMIN,
      apply: false,
    });

    expect(result.applied).toBe(false);
    expect(harness.catalog.updateLocation).not.toHaveBeenCalled();
    expect(harness.places.save).not.toHaveBeenCalled();
  });

  it('links with apply, each link filling only what its shop lacks', async () => {
    const harness = lost();

    const result = await harness.service.linkByRef({
      userId: ADMIN,
      apply: true,
    });

    expect(result.applied).toBe(true);
    expect(
      result.linked.map((row) => [
        row.place.id,
        row.place.status,
        row.place.supermarketLocationId,
      ])
    ).toEqual([
      ['p-a', DiscoveredPlaceStatus.IMPORTED, 'loc-a'],
      ['p-b', DiscoveredPlaceStatus.IMPORTED, 'loc-b'],
    ]);
    expect(harness.catalog.updateLocation).toHaveBeenCalledTimes(1);
    expect(harness.catalog.updateLocation).toHaveBeenCalledWith({
      supermarketLocationId: 'loc-b',
      address: 'Avenida de Cádiz 68',
      city: 'Córdoba',
      postalCode: '14010',
      postalCodeSource: PostalCodeSource.SOURCE,
    });
    expect(harness.rows.get('p-a')?.supermarketLocationId).toBe('loc-a');
    expect(harness.rows.get('p-b')?.supermarketLocationId).toBe('loc-b');
  });

  it('links a place whatever chain it resolves to: the shop was made from it', async () => {
    const harness = build({
      known: [ELJAMON, DIA],
      shops: [shop({ externalRef: 'node/1', externalProvider: 'OSM' })],
      places: [place({ brandKey: 'Q925132', brandName: 'Dia', name: 'Dia' })],
    });

    const result = await harness.service.linkByRef({
      userId: ADMIN,
      apply: true,
    });

    expect(result.linked).toHaveLength(1);
    expect(harness.rows.get('place-1')?.supermarketLocationId).toBe('loc-1');
  });

  it('links nothing on a distance: a place one metre from a shop stays NEW', async () => {
    const harness = lost();

    const result = await harness.service.linkByRef({
      userId: ADMIN,
      apply: true,
    });

    expect(result.linked.map((row) => row.place.id)).not.toContain('p-near');
    expect(result.skipped).toEqual([]);
    expect(harness.rows.get('p-near')?.status).toBe(DiscoveredPlaceStatus.NEW);
    expect(harness.rows.get('p-near')?.supermarketLocationId).toBeNull();
  });

  it('never creates a shop', async () => {
    const harness = lost();

    await harness.service.linkByRef({ userId: ADMIN, apply: true });

    expect(harness.catalog.createLocation).not.toHaveBeenCalled();
    expect(harness.catalog.createSupermarket).not.toHaveBeenCalled();
  });

  it('finds nothing to link on a second apply', async () => {
    const harness = lost();
    await harness.service.linkByRef({ userId: ADMIN, apply: true });
    harness.catalog.updateLocation.mockClear();
    harness.places.save.mockClear();

    const again = await harness.service.linkByRef({
      userId: ADMIN,
      apply: true,
    });

    expect(again).toEqual({ applied: true, linked: [], skipped: [] });
    expect(harness.catalog.updateLocation).not.toHaveBeenCalled();
    expect(harness.places.save).not.toHaveBeenCalled();
  });

  it('skips a place whose reference two shops carry, and names both', async () => {
    const harness = build({
      shops: [
        shop({ id: 'loc-1', externalRef: 'node/1', externalProvider: 'OSM' }),
        shop({ id: 'loc-2', externalRef: 'node/1', externalProvider: 'OSM' }),
      ],
      places: [place()],
    });

    const result = await harness.service.linkByRef({
      userId: ADMIN,
      apply: true,
    });

    expect(result.linked).toEqual([]);
    expect(result.skipped).toEqual([
      {
        place: expect.objectContaining({
          id: 'place-1',
          status: DiscoveredPlaceStatus.NEW,
        }),
        reason: PlaceLinkSkipReason.SEVERAL_SHOPS,
        shops: [
          expect.objectContaining({
            supermarketLocationId: 'loc-1',
            rung: PlaceMatchRung.EXTERNAL_REF,
          }),
          expect.objectContaining({ supermarketLocationId: 'loc-2' }),
        ],
      },
    ]);
    expect(harness.places.save).not.toHaveBeenCalled();
    expect(harness.rows.get('place-1')?.status).toBe(DiscoveredPlaceStatus.NEW);
  });

  it('skips two shops with one reference also when they sit in two chains', async () => {
    const harness = build({
      known: [ELJAMON, DEZA],
      shops: [
        shop({ id: 'loc-1', externalRef: 'node/1', externalProvider: 'OSM' }),
        shop({
          id: 'loc-2',
          supermarketId: DEZA.id,
          externalRef: 'node/1',
          externalProvider: null,
        }),
      ],
      places: [place()],
    });

    const result = await harness.service.linkByRef({
      userId: ADMIN,
      apply: true,
    });

    expect(result.skipped.map((row) => row.reason)).toEqual([
      PlaceLinkSkipReason.SEVERAL_SHOPS,
    ]);
  });

  it('skips one shop that carries the reference and names no provider', async () => {
    const harness = build({
      shops: [shop({ externalRef: 'node/1', externalProvider: null })],
      places: [place()],
    });

    const result = await harness.service.linkByRef({
      userId: ADMIN,
      apply: true,
    });

    expect(result.linked).toEqual([]);
    expect(result.skipped.map((row) => [row.place.id, row.reason])).toEqual([
      ['place-1', PlaceLinkSkipReason.PROVIDER_NOT_NAMED],
    ]);
    expect(harness.places.save).not.toHaveBeenCalled();
  });

  it('reads the same reference under another provider as no shop at all', async () => {
    const harness = build({
      shops: [shop({ externalRef: 'node/1', externalProvider: 'LIDL' })],
      places: [place()],
    });

    const result = await harness.service.linkByRef({
      userId: ADMIN,
      apply: true,
    });

    expect(result).toEqual({ applied: true, linked: [], skipped: [] });
  });

  it('reads NEW places only: a rejected and an imported place are never touched', async () => {
    const harness = build({
      shops: [
        shop({ id: 'loc-r', externalRef: 'node/r', externalProvider: 'OSM' }),
        shop({ id: 'loc-i', externalRef: 'node/i', externalProvider: 'OSM' }),
      ],
      places: [
        place({
          id: 'p-rejected',
          externalRef: 'node/r',
          status: DiscoveredPlaceStatus.REJECTED,
        }),
        place({
          id: 'p-imported',
          externalRef: 'node/i',
          status: DiscoveredPlaceStatus.IMPORTED,
          supermarketLocationId: 'loc-elsewhere',
        }),
      ],
    });

    const result = await harness.service.linkByRef({
      userId: ADMIN,
      apply: true,
    });

    expect(harness.places.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: DiscoveredPlaceStatus.NEW } })
    );
    expect(result).toEqual({ applied: true, linked: [], skipped: [] });
    expect(harness.rows.get('p-rejected')?.status).toBe(
      DiscoveredPlaceStatus.REJECTED
    );
    expect(harness.rows.get('p-imported')?.supermarketLocationId).toBe(
      'loc-elsewhere'
    );
    // No undecided place, so catalog is not even asked.
    expect(harness.catalog.listSupermarkets).not.toHaveBeenCalled();
  });

  it('lists the shops of each chain once, however many places there are', async () => {
    const harness = lost();

    await harness.service.linkByRef({ userId: ADMIN });

    expect(harness.catalog.listSupermarkets).toHaveBeenCalledTimes(1);
    expect(harness.catalog.listAllSupermarketLocations).toHaveBeenCalledTimes(
      2
    );
    expect(harness.catalog.getSupermarketLocation).not.toHaveBeenCalled();
  });
});

describe('DiscoveredPlaceService.import, the label it writes (plan 0193)', () => {
  it('writes no label for an El Jamón place, whose name is the banner', async () => {
    const harness = build({
      places: [
        place({
          provider: 'ELJAMON',
          externalRef: '14010:avenida de cadiz 68',
          brandName: 'El Jamón',
          name: 'Supermercados El Jamón',
        }),
      ],
    });

    await harness.service.import({ userId: ADMIN, placeId: 'place-1' });

    expect(harness.catalog.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        supermarketId: 'chain-eljamon',
        label: null,
        address: 'Avenida de Cádiz 68',
      })
    );
  });

  it('keeps the label of a LIDL place, which names its own shop', async () => {
    const harness = build({
      known: [chain('chain-lidl', 'LIDL')],
      places: [
        place({
          provider: 'LIDL',
          externalRef: 'lidl/1234',
          brandName: 'LIDL',
          name: 'LIDL Córdoba Poniente',
        }),
      ],
    });

    await harness.service.import({ userId: ADMIN, placeId: 'place-1' });

    expect(harness.catalog.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({ label: { es: 'LIDL Córdoba Poniente' } })
    );
  });
});

/**
 * A reference that another shop holds (plan 0195).
 *
 * Catalog holds one shop for each reference and refuses a second one with
 * `location_external_ref_taken`. The refusal crosses NATS, so it reaches this
 * service as the problem object of catalog and not as an `Error`.
 */
describe('DiscoveredPlaceService, a reference another shop holds (plan 0195)', () => {
  const HOLDER = {
    supermarketLocationId: 'loc-holder',
    supermarketId: DIA.id,
    supermarketName: DIA.name,
    label: null,
    address: 'Gran Vía 1',
    city: 'Córdoba',
    externalProvider: 'OSM',
  };

  /** What `CatalogClient` rejects with when catalog refuses the reference. */
  function refTaken(heldBy: typeof HOLDER | null = HOLDER) {
    return {
      status: 409,
      code: 'location_external_ref_taken',
      message: 'Another shop already holds that external reference.',
      correlationId: 'corr-1',
      details: { externalRef: 'node/1', heldBy },
    };
  }

  /** A shop with a position and nothing else, not even a reference. */
  const noRefShop = (overrides: Partial<SupermarketLocationView> = {}) =>
    bareShop({ externalRef: null, externalProvider: null, ...overrides });

  describe('link', () => {
    it('links anyway, fills the other fields and leaves the reference empty', async () => {
      const harness = build({ shops: [noRefShop()], places: [place()] });
      harness.catalog.updateLocation.mockRejectedValueOnce(refTaken());

      const result = await harness.service.link(link());

      expect(result.filled).toEqual([
        PlaceLinkField.POSTAL_CODE,
        PlaceLinkField.ADDRESS,
        PlaceLinkField.CITY,
        PlaceLinkField.COUNTRY,
      ]);
      expect(result.refHeldBy).toEqual(HOLDER);
      expect(result.place.status).toBe(DiscoveredPlaceStatus.IMPORTED);
      expect(result.place.supermarketLocationId).toBe('loc-1');

      const [first, second] = harness.catalog.updateLocation.mock.calls;
      expect(first[0]).toMatchObject({
        externalRef: 'node/1',
        externalProvider: 'OSM',
      });
      expect(second[0]).toEqual({
        supermarketLocationId: 'loc-1',
        postalCode: '14010',
        postalCodeSource: PostalCodeSource.SOURCE,
        address: 'Avenida de Cádiz 68',
        city: 'Córdoba',
        country: 'es',
      });
      expect(harness.shops[0].externalRef).toBeNull();
      expect(harness.shops[0].externalProvider).toBeNull();
    });

    it('reads the refusal also when NATS nests it under error', async () => {
      const harness = build({ shops: [noRefShop()], places: [place()] });
      harness.catalog.updateLocation.mockRejectedValueOnce({
        error: refTaken(),
      });

      const result = await harness.service.link(link());

      expect(result.refHeldBy).toEqual(HOLDER);
      expect(result.filled).not.toContain(PlaceLinkField.EXTERNAL_REF);
    });

    it('writes only the mark when the reference was all the shop lacked', async () => {
      const harness = build({
        shops: [shop({ externalRef: null, externalProvider: null })],
        places: [place()],
      });
      harness.catalog.updateLocation.mockRejectedValueOnce(refTaken());

      const result = await harness.service.link(link());

      expect(result.filled).toEqual([]);
      expect(result.refHeldBy).toEqual(HOLDER);
      expect(harness.catalog.updateLocation).toHaveBeenCalledTimes(1);
      expect(harness.rows.get('place-1')?.status).toBe(
        DiscoveredPlaceStatus.IMPORTED
      );
    });

    it('answers a null holder when catalog could not name the shop', async () => {
      const harness = build({ shops: [noRefShop()], places: [place()] });
      harness.catalog.updateLocation.mockRejectedValueOnce(refTaken(null));

      const result = await harness.service.link(link());

      expect(result).toHaveProperty('refHeldBy', null);
    });

    it('says nothing about a holder on a link that filled the reference', async () => {
      const harness = build({ shops: [noRefShop()], places: [place()] });

      const result = await harness.service.link(link());

      expect(result.filled).toContain(PlaceLinkField.EXTERNAL_REF);
      expect(result).not.toHaveProperty('refHeldBy');
      expect(harness.catalog.updateLocation).toHaveBeenCalledTimes(1);
    });

    it('still fails on any other refusal of catalog, and leaves the place NEW', async () => {
      const harness = build({ shops: [noRefShop()], places: [place()] });
      const conflict = { ...refTaken(), code: 'conflict' };
      harness.catalog.updateLocation.mockRejectedValueOnce(conflict);

      await expect(harness.service.link(link())).rejects.toBe(conflict);

      expect(harness.catalog.updateLocation).toHaveBeenCalledTimes(1);
      expect(harness.places.save).not.toHaveBeenCalled();
    });

    it('leaves the place NEW when the write without the reference fails', async () => {
      const harness = build({ shops: [noRefShop()], places: [place()] });
      harness.catalog.updateLocation
        .mockRejectedValueOnce(refTaken())
        .mockRejectedValueOnce(new Error('down'));

      await expect(harness.service.link(link())).rejects.toThrow('down');

      expect(harness.places.save).not.toHaveBeenCalled();
      expect(harness.rows.get('place-1')?.status).toBe(
        DiscoveredPlaceStatus.NEW
      );
    });
  });

  describe('linkByRef', () => {
    it('never sends a reference, so catalog has nothing to refuse', async () => {
      // The shop the bulk act links is the one that carries the reference.
      const harness = build({
        shops: [bareShop({ externalRef: 'node/1', externalProvider: 'OSM' })],
        places: [place()],
      });

      const result = await harness.service.linkByRef({
        userId: ADMIN,
        apply: true,
      });

      expect(result.linked).toHaveLength(1);
      for (const [sent] of harness.catalog.updateLocation.mock.calls) {
        expect(sent).not.toHaveProperty('externalRef');
        expect(sent).not.toHaveProperty('externalProvider');
      }
    });
  });

  describe('import', () => {
    it('passes the refusal of catalog through, and leaves the place NEW', async () => {
      const harness = build({ places: [place()] });
      const refused = refTaken();
      harness.catalog.createLocation.mockRejectedValueOnce(refused);

      await expect(
        harness.service.import({ userId: ADMIN, placeId: 'place-1' })
      ).rejects.toBe(refused);

      expect(harness.catalog.createLocation).toHaveBeenCalledTimes(1);
      expect(harness.places.save).not.toHaveBeenCalled();
    });

    it('does not take force: false for a yes', async () => {
      const harness = build({ places: [place()] });
      const refused = refTaken();
      harness.catalog.createLocation.mockRejectedValueOnce(refused);

      await expect(
        harness.service.import({
          userId: ADMIN,
          placeId: 'place-1',
          force: false,
        })
      ).rejects.toBe(refused);

      expect(harness.catalog.createLocation).toHaveBeenCalledTimes(1);
    });

    it('refuses with the holder also with force, and creates no shop', async () => {
      // `force` answers `place_matches_location` alone. The person who sent
      // it may never have seen that another shop holds the reference.
      const harness = build({ places: [place()] });
      const refused = refTaken();
      harness.catalog.createLocation.mockRejectedValueOnce(refused);

      const failure = await harness.service
        .import({ userId: ADMIN, placeId: 'place-1', force: true })
        .catch((error: unknown) => error);

      expect(failure).toBe(refused);
      expect(failure).toMatchObject({
        status: 409,
        code: 'location_external_ref_taken',
        details: { heldBy: HOLDER },
      });
      // One call, the refused one, and it carried the reference: no second
      // write with the reference left out.
      expect(harness.catalog.createLocation).toHaveBeenCalledTimes(1);
      expect(harness.catalog.createLocation.mock.calls[0][0]).toMatchObject({
        externalRef: 'node/1',
        externalProvider: 'OSM',
      });
      expect(harness.places.save).not.toHaveBeenCalled();
      expect(harness.rows.get('place-1')?.status).toBe(
        DiscoveredPlaceStatus.NEW
      );
    });

    it('still creates the shop with force when the reference is free', async () => {
      // A shop of the chain on the same spot may be this place: without
      // force the import answers `place_matches_location`.
      const harness = build({
        shops: [noRefShop({ latitude: LAT, longitude: LON })],
        places: [place()],
      });
      await expect(
        harness.service.import({ userId: ADMIN, placeId: 'place-1' })
      ).rejects.toMatchObject({ code: 'place_matches_location' });
      expect(harness.catalog.createLocation).not.toHaveBeenCalled();

      const view = await harness.service.import({
        userId: ADMIN,
        placeId: 'place-1',
        force: true,
      });

      expect(harness.catalog.createLocation).toHaveBeenCalledTimes(1);
      expect(harness.catalog.createLocation.mock.calls[0][0]).toMatchObject({
        supermarketId: ELJAMON.id,
        externalRef: 'node/1',
        externalProvider: 'OSM',
      });
      expect(view.status).toBe(DiscoveredPlaceStatus.IMPORTED);
      expect(view.supermarketLocationId).toBe('loc-created');
    });

    it('still fails with force on any other refusal of catalog', async () => {
      const harness = build({ places: [place()] });
      harness.catalog.createLocation.mockRejectedValueOnce(new Error('down'));

      await expect(
        harness.service.import({
          userId: ADMIN,
          placeId: 'place-1',
          force: true,
        })
      ).rejects.toThrow('down');

      expect(harness.catalog.createLocation).toHaveBeenCalledTimes(1);
    });
  });
});
