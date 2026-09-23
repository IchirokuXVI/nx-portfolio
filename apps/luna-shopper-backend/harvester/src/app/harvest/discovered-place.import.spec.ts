import {
  DiscoveredPlaceStatus,
  PlaceMatchRung,
  PostalCodeSource,
  PriceScopeKind,
  type PriceScopeView,
  type SupermarketLocationView,
  type SupermarketPage,
  type SupermarketView,
} from '@portfolio/luna-shopper/contracts';
import {
  NotFoundException,
  PlaceAlreadyImportedException,
  PlaceMatchesLocationException,
  ScopeNotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type { Repository } from 'typeorm';
import type { DiscoveredPlace } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { DiscoveredPlaceService } from './discovered-place.service';
import type { PlatformAdminService } from './platform-admin.service';

const ADMIN = 'owner-1';

function place(overrides: Partial<DiscoveredPlace> = {}): DiscoveredPlace {
  return {
    id: 'place-1',
    runId: 'run-1',
    // LIDL's own store list rather than OpenStreetMap, because creating a
    // chain now needs a provider that says what language it names things in
    // (plan 0111, section 8). Everything else about this fixture is a LIDL
    // shop already. The OSM case has its own test below.
    provider: 'LIDL',
    externalRef: 'node/1',
    brandKey: null,
    brandName: 'LIDL',
    name: 'LIDL Córdoba',
    latitude: 37.88,
    longitude: -4.77,
    street: null,
    city: 'Córdoba',
    postalCode: '14013',
    postalCodeSource: null,
    country: 'es',
    website: null,
    openingHours: null,
    tags: {},
    scopeKey: null,
    status: DiscoveredPlaceStatus.NEW,
    supermarketLocationId: null,
    firstSeenAt: new Date('2026-09-01T00:00:00.000Z'),
    lastSeenAt: new Date('2026-09-01T00:00:00.000Z'),
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
    name: { en: name, es: name },
    logoUrl: null,
    websiteUrl: null,
    externalBrandKey,
    defaultPriceScopeId: null,
  } as SupermarketView;
}

function build(
  options: {
    known?: SupermarketView[];
    locations?: SupermarketLocationView[];
    scopes?: PriceScopeView[];
  } = {}
) {
  const known = [...(options.known ?? [])];
  const shops = [...(options.locations ?? [])];
  const scopes = [...(options.scopes ?? [])];
  const rows = new Map<string, DiscoveredPlace>();
  let locations = 0;

  const places = {
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => {
      return rows.get(where.id) ?? null;
    }),
    save: jest.fn(async (row: DiscoveredPlace) => {
      rows.set(row.id, { ...row });
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
    createSupermarket: jest.fn(
      async (input: {
        name: { en?: string; es?: string };
        externalBrandKey?: string | null;
      }): Promise<SupermarketView> => {
        const created = chain(
          `chain-${known.length + 1}`,
          input.name.es ?? input.name.en ?? '',
          input.externalBrandKey ?? null
        );
        known.push(created);
        return created;
      }
    ),
    createLocation: jest.fn(
      async (input: {
        supermarketId: string;
      }): Promise<SupermarketLocationView> =>
        ({
          id: `loc-${++locations}`,
          supermarketId: input.supermarketId,
        }) as SupermarketLocationView
    ),
    listAllSupermarketLocations: jest.fn(async (supermarketId: string) =>
      shops.filter((shop) => shop.supermarketId === supermarketId)
    ),
    getSupermarketLocation: jest.fn(async (id: string) => {
      const shop = shops.find((held) => held.id === id);
      if (!shop) {
        throw new NotFoundException('Supermarket location not found');
      }
      return { ...shop };
    }),
    updateLocation: jest.fn(
      async (input: { supermarketLocationId: string }) =>
        ({
          ...shops.find((held) => held.id === input.supermarketLocationId),
          ...input,
        }) as unknown as SupermarketLocationView
    ),
    listAllPriceScopes: jest.fn(async (supermarketId: string) =>
      scopes.filter((scope) => scope.supermarketId === supermarketId)
    ),
  } as unknown as jest.Mocked<CatalogClient>;

  const admin = {
    requireAdmin: jest.fn(async () => ADMIN),
  } as unknown as jest.Mocked<PlatformAdminService>;

  const service = new DiscoveredPlaceService(places, catalog, admin);
  return {
    service,
    catalog,
    known,
    rows,
    add: (row: DiscoveredPlace) => rows.set(row.id, row),
  };
}

/**
 * What importing a place does about the chain it belongs to.
 *
 * The screen imports a selection four places at a time, so these are the two
 * ways one chain used to become several: a place with no `brand:wikidata` never
 * matched anything, and four overlapping calls each created what none of them
 * could see yet.
 */
describe('DiscoveredPlaceService import, the chain it resolves', () => {
  it('creates one chain for several places of a brand catalog does not know', async () => {
    const harness = build();
    harness.add(place({ id: 'p1', name: 'LIDL Córdoba' }));
    harness.add(place({ id: 'p2', name: 'LIDL Sevilla' }));
    harness.add(place({ id: 'p3', name: 'LIDL Málaga' }));

    for (const placeId of ['p1', 'p2', 'p3']) {
      await harness.service.import({ userId: ADMIN, placeId });
    }

    expect(harness.catalog.createSupermarket).toHaveBeenCalledTimes(1);
    expect(harness.catalog.createLocation).toHaveBeenCalledTimes(3);
    const chains = harness.catalog.createLocation.mock.calls.map(
      ([input]) => input.supermarketId
    );
    expect(new Set(chains).size).toBe(1);
  });

  it('writes the chain name once, under the language the source prints in', async () => {
    // Plan 0111, section 8. It used to be written into both keys, and a copy is
    // indistinguishable from a translation in the row: nothing could list the
    // chains still waiting for one, and `missingLocales` reported a coverage
    // that was a duplicate. A reader of either language still sees the proper
    // noun, through the fallback, which is what the copy was giving them.
    const harness = build();
    harness.add(place({ id: 'p1' }));

    await harness.service.import({ userId: ADMIN, placeId: 'p1' });

    expect(harness.catalog.createSupermarket).toHaveBeenCalledWith(
      expect.objectContaining({ name: { es: 'LIDL' } })
    );
  });

  it('labels the shop once, under the language the source prints in', async () => {
    // The third copy of the same string into both keys, and the one plan 0111
    // section 8's own example is about: "Mercadona Alicante" is a shop, not a
    // chain.
    const harness = build();
    harness.add(place({ id: 'p1', name: 'LIDL Córdoba' }));

    await harness.service.import({ userId: ADMIN, placeId: 'p1' });

    expect(harness.catalog.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({ label: { es: 'LIDL Córdoba' } })
    );
  });

  it('leaves the shop unlabelled when the provider states no language', async () => {
    // A label is nullable and is a convenience over the address, so unlike a
    // chain name it costs nothing to leave absent. The import still lands.
    const harness = build({ known: [chain('chain-lidl', 'LIDL')] });
    harness.add(place({ id: 'p1', provider: 'OSM', name: 'LIDL Córdoba' }));

    await harness.service.import({ userId: ADMIN, placeId: 'p1' });

    expect(harness.catalog.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({ label: null })
    );
  });

  it('refuses to name a chain from a provider that states no language', async () => {
    // OpenStreetMap's `name` tag is written by mappers in the local language of
    // wherever the shop is, so `osm-places` answers a null `printedLocale` and
    // there is no key to file the string under. Guessing one is what plan 0111
    // removes, so this joins the refusal an unnamed place already gets: the
    // operator creates the chain and passes its id.
    const harness = build();
    harness.add(place({ id: 'p1', provider: 'OSM' }));

    await expect(
      harness.service.import({ userId: ADMIN, placeId: 'p1' })
    ).rejects.toThrow(/do not say what language/);
    expect(harness.catalog.createSupermarket).not.toHaveBeenCalled();
  });

  it('attaches an OSM place to a chain catalog already holds', async () => {
    // The refusal is about *naming a new* chain, not about OpenStreetMap. A
    // place whose brand catalog already knows never needs a name written.
    const harness = build({ known: [chain('chain-lidl', 'LIDL')] });
    harness.add(place({ id: 'p1', provider: 'OSM' }));

    await harness.service.import({ userId: ADMIN, placeId: 'p1' });

    expect(harness.catalog.createSupermarket).not.toHaveBeenCalled();
    expect(harness.catalog.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({ supermarketId: 'chain-lidl' })
    );
  });

  it('creates the chain an operator names for an OSM place (plan 0153)', async () => {
    // The operator supplies the language OpenStreetMap cannot. Catalog gives
    // the chain its NATIONAL default, so the harvester asks for the chain only.
    const harness = build();
    harness.add(place({ id: 'p1', provider: 'OSM', brandKey: 'Q6135982' }));

    await harness.service.import({
      userId: ADMIN,
      placeId: 'p1',
      newChain: { name: ' El Jamón ', locale: 'es' },
    });

    expect(harness.catalog.createSupermarket).toHaveBeenCalledTimes(1);
    expect(harness.catalog.createSupermarket).toHaveBeenCalledWith({
      name: { es: 'El Jamón' },
      externalBrandKey: 'Q6135982',
    });
    const created =
      await harness.catalog.createSupermarket.mock.results[0].value;
    expect(harness.catalog.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({ supermarketId: created.id })
    );
  });

  it('reuses a chain of the name the operator typed rather than making a second', async () => {
    const harness = build({ known: [chain('chain-jamon', 'El Jamón')] });
    harness.add(place({ id: 'p1', provider: 'OSM' }));

    await harness.service.import({
      userId: ADMIN,
      placeId: 'p1',
      newChain: { name: 'el jamón', locale: 'es' },
    });

    expect(harness.catalog.createSupermarket).not.toHaveBeenCalled();
    expect(harness.catalog.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({ supermarketId: 'chain-jamon' })
    );
  });

  it('keeps the chain the place itself matches over the one named', async () => {
    const harness = build({ known: [chain('chain-lidl', 'LIDL')] });
    harness.add(place({ id: 'p1', provider: 'OSM' }));

    await harness.service.import({
      userId: ADMIN,
      placeId: 'p1',
      newChain: { name: 'Lidl Supermercados', locale: 'es' },
    });

    expect(harness.catalog.createSupermarket).not.toHaveBeenCalled();
    expect(harness.catalog.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({ supermarketId: 'chain-lidl' })
    );
  });

  it('refuses newChain beside supermarketId', async () => {
    const harness = build({ known: [chain('chain-lidl', 'LIDL')] });
    harness.add(place({ id: 'p1', provider: 'OSM' }));

    await expect(
      harness.service.import({
        userId: ADMIN,
        placeId: 'p1',
        supermarketId: 'chain-lidl',
        newChain: { name: 'LIDL', locale: 'es' },
      })
    ).rejects.toBeInstanceOf(ValidationException);
    expect(harness.catalog.createLocation).not.toHaveBeenCalled();
  });

  it('creates one chain when four imports overlap', async () => {
    const harness = build();
    const ids = ['p1', 'p2', 'p3', 'p4'];
    for (const id of ids) {
      harness.add(place({ id }));
    }

    await Promise.all(
      ids.map((placeId) => harness.service.import({ userId: ADMIN, placeId }))
    );

    expect(harness.catalog.createSupermarket).toHaveBeenCalledTimes(1);
  });

  it('creates one chain when four imports of a keyed brand overlap', async () => {
    const harness = build();
    const ids = ['p1', 'p2', 'p3', 'p4'];
    for (const id of ids) {
      harness.add(place({ id, brandKey: 'Q151954' }));
    }

    await Promise.all(
      ids.map((placeId) => harness.service.import({ userId: ADMIN, placeId }))
    );

    expect(harness.catalog.createSupermarket).toHaveBeenCalledTimes(1);
  });

  it('attaches a place with no brand key to the chain of that name', async () => {
    const harness = build({ known: [chain('chain-lidl', 'LIDL')] });
    harness.add(place({ id: 'p1' }));

    await harness.service.import({ userId: ADMIN, placeId: 'p1' });

    expect(harness.catalog.createSupermarket).not.toHaveBeenCalled();
    expect(harness.catalog.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({ supermarketId: 'chain-lidl' })
    );
  });

  it('matches the name whatever its case and spacing', async () => {
    const harness = build({ known: [chain('chain-lidl', '  lidl  ')] });
    harness.add(place({ id: 'p1', brandName: 'LIDL' }));

    await harness.service.import({ userId: ADMIN, placeId: 'p1' });

    expect(harness.catalog.createSupermarket).not.toHaveBeenCalled();
  });

  it('prefers the brand key over a chain of the same name', async () => {
    const harness = build({
      known: [
        chain('chain-named', 'Dia'),
        chain('chain-keyed', 'Dia', 'Q925132'),
      ],
    });
    harness.add(place({ id: 'p1', brandKey: 'Q925132', brandName: 'Dia' }));

    await harness.service.import({ userId: ADMIN, placeId: 'p1' });

    expect(harness.catalog.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({ supermarketId: 'chain-keyed' })
    );
  });

  it('keeps two differently named independent shops apart', async () => {
    const harness = build();
    harness.add(
      place({ id: 'p1', brandName: null, name: 'Alimentación Paco' })
    );
    harness.add(place({ id: 'p2', brandName: null, name: 'Alimentación Ana' }));

    await harness.service.import({ userId: ADMIN, placeId: 'p1' });
    await harness.service.import({ userId: ADMIN, placeId: 'p2' });

    expect(harness.catalog.createSupermarket).toHaveBeenCalledTimes(2);
  });

  it('takes the chain the caller named and resolves nothing', async () => {
    const harness = build();
    harness.add(place({ id: 'p1' }));

    await harness.service.import({
      userId: ADMIN,
      placeId: 'p1',
      supermarketId: 'chain-picked',
    });

    expect(harness.catalog.createSupermarket).not.toHaveBeenCalled();
    expect(harness.catalog.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({ supermarketId: 'chain-picked' })
    );
  });

  it('uses the chain another writer created when the create loses a race', async () => {
    const harness = build();
    harness.add(place({ id: 'p1' }));
    // The unique index on `externalBrandKey` refusing a second row, or any
    // other writer getting there first.
    harness.catalog.createSupermarket.mockImplementationOnce(async () => {
      harness.known.push(chain('chain-lidl', 'LIDL'));
      throw new Error('duplicate key value violates a unique constraint');
    });

    await harness.service.import({ userId: ADMIN, placeId: 'p1' });

    expect(harness.catalog.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({ supermarketId: 'chain-lidl' })
    );
  });
});

/** A catalog shop of the LIDL chain, 2 km from the fixture place by default. */
function shop(
  overrides: Partial<SupermarketLocationView> = {}
): SupermarketLocationView {
  return {
    id: 'loc-seeded',
    supermarketId: 'chain-lidl',
    priceScopeId: 'scope-store',
    priceScopeIds: ['scope-store'],
    label: { es: 'LIDL Libertador' },
    address: 'Avenida del Libertador Simón Bolívar 5',
    city: 'Córdoba',
    country: 'es',
    postalCode: '14013',
    postalCodeSource: PostalCodeSource.MANUAL,
    latitude: 37.9,
    longitude: -4.77,
    externalRef: null,
    externalProvider: null,
    ...overrides,
  };
}

function scope(
  id: string,
  externalKey: string | null,
  kind = PriceScopeKind.LOCAL_AREA
): PriceScopeView {
  return {
    id,
    supermarketId: 'chain-lidl',
    kind,
    externalKey,
  } as PriceScopeView;
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

describe('DiscoveredPlaceService import, the scope the run declared (plan 0152)', () => {
  const LIDL = chain('chain-lidl', 'LIDL');

  it('imports a Mercadona place into its warehouse scope', async () => {
    const mercadona = chain('chain-merc', 'Mercadona');
    const harness = build({
      known: [mercadona],
      scopes: [
        { ...scope('scope-4149', '4149'), supermarketId: 'chain-merc' },
        { ...scope('scope-4661', '4661'), supermarketId: 'chain-merc' },
      ],
    });
    harness.add(
      place({
        id: 'p1',
        provider: 'MERCADONA',
        brandName: 'Mercadona',
        scopeKey: '4661',
      })
    );

    await harness.service.import({ userId: ADMIN, placeId: 'p1' });

    expect(harness.catalog.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        supermarketId: 'chain-merc',
        priceScopeId: 'scope-4661',
      })
    );
  });

  it('imports a LIDL place into its offer region', async () => {
    const harness = build({
      known: [LIDL],
      scopes: [scope('scope-21', '21', PriceScopeKind.REGION)],
    });
    harness.add(place({ id: 'p1', scopeKey: '21' }));

    await harness.service.import({ userId: ADMIN, placeId: 'p1' });

    expect(harness.catalog.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({ priceScopeId: 'scope-21' })
    );
  });

  it('reads the key from the tag on a row written before the column', async () => {
    const harness = build({
      known: [LIDL],
      scopes: [scope('scope-21', '21', PriceScopeKind.REGION)],
    });
    harness.add(
      place({ id: 'p1', scopeKey: null, tags: { 'lidl:offerRegion': '21' } })
    );

    await harness.service.import({ userId: ADMIN, placeId: 'p1' });

    expect(harness.catalog.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({ priceScopeId: 'scope-21' })
    );
  });

  it('lets a named scope win over the declared one', async () => {
    const harness = build({
      known: [LIDL],
      scopes: [scope('scope-21', '21', PriceScopeKind.REGION)],
    });
    harness.add(place({ id: 'p1', scopeKey: '21' }));

    await harness.service.import({
      userId: ADMIN,
      placeId: 'p1',
      priceScopeId: 'scope-picked',
    });

    expect(harness.catalog.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({ priceScopeId: 'scope-picked' })
    );
    expect(harness.catalog.listAllPriceScopes).not.toHaveBeenCalled();
  });

  it('names no scope for a place that declares none', async () => {
    // Catalog then gives the shop a STORE scope of its own, as before.
    const harness = build({ known: [LIDL] });
    harness.add(place({ id: 'p1' }));

    await harness.service.import({ userId: ADMIN, placeId: 'p1' });

    expect(harness.catalog.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({ priceScopeId: undefined })
    );
  });

  it('answers scope_not_found with the key when the chain does not hold it', async () => {
    const harness = build({ known: [LIDL], scopes: [scope('scope-3', '3')] });
    harness.add(place({ id: 'p1', scopeKey: '21' }));

    const error = await refusal(
      harness.service.import({ userId: ADMIN, placeId: 'p1' })
    );

    expect(error).toBeInstanceOf(ScopeNotFoundException);
    expect((error as ScopeNotFoundException).details).toEqual({
      scopeKey: '21',
    });
    expect(harness.catalog.createLocation).not.toHaveBeenCalled();
  });
});

describe('DiscoveredPlaceService import, a shop the catalog holds (plan 0152)', () => {
  const LIDL = chain('chain-lidl', 'LIDL');

  it('finds a shop by the same externalRef first', async () => {
    const harness = build({
      known: [LIDL],
      locations: [
        shop({
          id: 'loc-ref',
          externalRef: 'node/1',
          externalProvider: 'LIDL',
        }),
        // Also within 50 metres, which a lower rung would find. The first rung
        // that finds anything answers alone.
        shop({ id: 'loc-near', latitude: 37.8801, longitude: -4.77 }),
      ],
    });
    harness.add(place({ id: 'p1' }));

    const error = await refusal(
      harness.service.import({ userId: ADMIN, placeId: 'p1' })
    );

    expect(error).toBeInstanceOf(PlaceMatchesLocationException);
    expect((error as PlaceMatchesLocationException).details).toEqual({
      candidates: [
        {
          supermarketLocationId: 'loc-ref',
          label: { es: 'LIDL Libertador' },
          address: 'Avenida del Libertador Simón Bolívar 5',
          postalCode: '14013',
          rung: PlaceMatchRung.EXTERNAL_REF,
        },
      ],
    });
    expect(harness.catalog.createLocation).not.toHaveBeenCalled();
  });

  it('ignores the same ref from another provider', async () => {
    const harness = build({
      known: [LIDL],
      locations: [shop({ externalRef: 'node/1', externalProvider: 'OSM' })],
    });
    harness.add(place({ id: 'p1' }));

    await harness.service.import({ userId: ADMIN, placeId: 'p1' });

    expect(harness.catalog.createLocation).toHaveBeenCalled();
  });

  it('finds a shop of the same chain within 50 metres', async () => {
    // 0.0003 degrees of latitude is about 33 metres.
    const harness = build({
      known: [LIDL],
      locations: [
        shop({ id: 'loc-near', latitude: 37.8803, longitude: -4.77 }),
      ],
    });
    harness.add(place({ id: 'p1' }));

    const error = await refusal(
      harness.service.import({ userId: ADMIN, placeId: 'p1' })
    );

    expect(error).toBeInstanceOf(PlaceMatchesLocationException);
    expect(
      (error as PlaceMatchesLocationException).details?.['candidates']
    ).toEqual([
      expect.objectContaining({
        supermarketLocationId: 'loc-near',
        rung: PlaceMatchRung.NEARBY,
      }),
    ]);
  });

  it('does not match a shop 100 metres away', async () => {
    const harness = build({
      known: [LIDL],
      locations: [shop({ latitude: 37.8809, longitude: -4.77 })],
    });
    harness.add(place({ id: 'p1' }));

    await harness.service.import({ userId: ADMIN, placeId: 'p1' });

    expect(harness.catalog.createLocation).toHaveBeenCalled();
  });

  it('finds a shop with no coordinates by postal code and address', async () => {
    // The seeded Libertador: no ref, no coordinates, typed by hand.
    const harness = build({
      known: [LIDL],
      locations: [
        shop({
          id: 'loc-seeded',
          latitude: null,
          longitude: null,
          address: 'Avenida del Libertador Simón Bolívar, 5',
        }),
      ],
    });
    harness.add(
      place({
        id: 'p1',
        street: 'avenida del libertador simon bolivar 5',
        postalCode: '14013',
      })
    );

    const error = await refusal(
      harness.service.import({ userId: ADMIN, placeId: 'p1' })
    );

    expect(
      (error as PlaceMatchesLocationException).details?.['candidates']
    ).toEqual([
      expect.objectContaining({
        supermarketLocationId: 'loc-seeded',
        rung: PlaceMatchRung.ADDRESS,
      }),
    ]);
  });

  it('does not match an address in another postal code', async () => {
    const harness = build({
      known: [LIDL],
      locations: [
        shop({ latitude: null, longitude: null, postalCode: '14010' }),
      ],
    });
    harness.add(
      place({
        id: 'p1',
        street: 'Avenida del Libertador Simón Bolívar 5',
        postalCode: '14013',
      })
    );

    await harness.service.import({ userId: ADMIN, placeId: 'p1' });

    expect(harness.catalog.createLocation).toHaveBeenCalled();
  });

  it('matches only shops of the place’s own chain', async () => {
    const harness = build({
      known: [LIDL],
      locations: [
        shop({
          supermarketId: 'chain-other',
          latitude: 37.88,
          longitude: -4.77,
        }),
      ],
    });
    harness.add(place({ id: 'p1' }));

    await harness.service.import({ userId: ADMIN, placeId: 'p1' });

    expect(harness.catalog.createLocation).toHaveBeenCalled();
  });

  it('creates a new shop anyway with force', async () => {
    const harness = build({
      known: [LIDL],
      locations: [shop({ latitude: 37.88, longitude: -4.77 })],
    });
    harness.add(place({ id: 'p1' }));

    const view = await harness.service.import({
      userId: ADMIN,
      placeId: 'p1',
      force: true,
    });

    expect(harness.catalog.createLocation).toHaveBeenCalled();
    expect(view.status).toBe(DiscoveredPlaceStatus.IMPORTED);
  });

  it('refuses a place that is already imported', async () => {
    const harness = build({ known: [LIDL] });
    harness.add(
      place({
        id: 'p1',
        status: DiscoveredPlaceStatus.IMPORTED,
        supermarketLocationId: 'loc-1',
      })
    );

    await expect(
      harness.service.import({ userId: ADMIN, placeId: 'p1' })
    ).rejects.toBeInstanceOf(PlaceAlreadyImportedException);
  });
});

describe('DiscoveredPlaceService link (plan 0152, section 3)', () => {
  const LIDL = chain('chain-lidl', 'LIDL');

  it('fills the coordinates and ref the shop lacks, and marks the place imported', async () => {
    const harness = build({
      known: [LIDL],
      locations: [shop({ id: 'loc-seeded', latitude: null, longitude: null })],
    });
    harness.add(place({ id: 'p1', postalCodeSource: PostalCodeSource.SOURCE }));

    const view = await harness.service.link({
      userId: ADMIN,
      placeId: 'p1',
      supermarketLocationId: 'loc-seeded',
    });

    // The shop's postal code is kept: it has one already.
    expect(harness.catalog.updateLocation).toHaveBeenCalledWith({
      supermarketLocationId: 'loc-seeded',
      latitude: 37.88,
      longitude: -4.77,
      externalRef: 'node/1',
      externalProvider: 'LIDL',
    });
    expect(view.status).toBe(DiscoveredPlaceStatus.IMPORTED);
    expect(view.supermarketLocationId).toBe('loc-seeded');
    expect(harness.catalog.createLocation).not.toHaveBeenCalled();
  });

  it('fills a missing postal code with the provenance the place carries', async () => {
    const harness = build({
      known: [LIDL],
      locations: [shop({ postalCode: null, postalCodeSource: null })],
    });
    harness.add(place({ id: 'p1', postalCodeSource: PostalCodeSource.SOURCE }));

    await harness.service.link({
      userId: ADMIN,
      placeId: 'p1',
      supermarketLocationId: 'loc-seeded',
    });

    expect(harness.catalog.updateLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        postalCode: '14013',
        postalCodeSource: PostalCodeSource.SOURCE,
      })
    );
  });

  it('never sends a derived postal code', async () => {
    const harness = build({
      known: [LIDL],
      locations: [shop({ postalCode: null, postalCodeSource: null })],
    });
    harness.add(
      place({ id: 'p1', postalCodeSource: PostalCodeSource.DERIVED })
    );

    await harness.service.link({
      userId: ADMIN,
      placeId: 'p1',
      supermarketLocationId: 'loc-seeded',
    });

    const [input] = harness.catalog.updateLocation.mock.calls[0];
    expect(input).not.toHaveProperty('postalCode');
  });

  it('overwrites nothing on a shop that has every field', async () => {
    const harness = build({
      known: [LIDL],
      locations: [shop({ externalRef: 'lidl/99', externalProvider: 'LIDL' })],
    });
    harness.add(place({ id: 'p1' }));

    await harness.service.link({
      userId: ADMIN,
      placeId: 'p1',
      supermarketLocationId: 'loc-seeded',
    });

    expect(harness.catalog.updateLocation).not.toHaveBeenCalled();
    expect(harness.rows.get('p1')?.status).toBe(DiscoveredPlaceStatus.IMPORTED);
  });

  it('refuses a shop of another chain', async () => {
    const harness = build({
      known: [LIDL, chain('chain-other', 'Dia')],
      locations: [shop({ supermarketId: 'chain-other' })],
    });
    harness.add(place({ id: 'p1' }));

    await expect(
      harness.service.link({
        userId: ADMIN,
        placeId: 'p1',
        supermarketLocationId: 'loc-seeded',
      })
    ).rejects.toBeInstanceOf(ValidationException);
    expect(harness.rows.get('p1')?.status).toBe(DiscoveredPlaceStatus.NEW);
  });

  it('refuses a place that is already imported', async () => {
    const harness = build({ known: [LIDL], locations: [shop()] });
    harness.add(place({ id: 'p1', status: DiscoveredPlaceStatus.IMPORTED }));

    await expect(
      harness.service.link({
        userId: ADMIN,
        placeId: 'p1',
        supermarketLocationId: 'loc-seeded',
      })
    ).rejects.toBeInstanceOf(PlaceAlreadyImportedException);
  });
});

describe('DiscoveredPlaceService import, the postal code it sends (plan 0152, section 4)', () => {
  const LIDL = chain('chain-lidl', 'LIDL');

  it('sends a stated code with its provenance', async () => {
    const harness = build({ known: [LIDL] });
    harness.add(place({ id: 'p1', postalCodeSource: PostalCodeSource.SOURCE }));

    await harness.service.import({ userId: ADMIN, placeId: 'p1' });

    expect(harness.catalog.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        postalCode: '14013',
        postalCodeSource: PostalCodeSource.SOURCE,
      })
    );
  });

  it('sends no code for a derived one, so catalog derives it again', async () => {
    const harness = build({ known: [LIDL] });
    harness.add(
      place({ id: 'p1', postalCodeSource: PostalCodeSource.DERIVED })
    );

    await harness.service.import({ userId: ADMIN, placeId: 'p1' });

    const [input] = harness.catalog.createLocation.mock.calls[0];
    expect(input).not.toHaveProperty('postalCode');
    expect(input).not.toHaveProperty('postalCodeSource');
    expect(input).toEqual(
      expect.objectContaining({ country: 'es', latitude: 37.88 })
    );
  });
});

describe('DiscoveredPlaceService reject (plan 0152, section 5)', () => {
  it('answers place_already_imported for an imported place', async () => {
    const harness = build();
    harness.add(
      place({
        id: 'p1',
        status: DiscoveredPlaceStatus.IMPORTED,
        supermarketLocationId: 'loc-1',
      })
    );

    await expect(
      harness.service.reject({ userId: ADMIN, placeId: 'p1' })
    ).rejects.toBeInstanceOf(PlaceAlreadyImportedException);
    expect(harness.rows.get('p1')?.status).toBe(DiscoveredPlaceStatus.IMPORTED);
  });

  it('rejects a new place', async () => {
    const harness = build();
    harness.add(place({ id: 'p1' }));

    const view = await harness.service.reject({ userId: ADMIN, placeId: 'p1' });

    expect(view.status).toBe(DiscoveredPlaceStatus.REJECTED);
  });
});
