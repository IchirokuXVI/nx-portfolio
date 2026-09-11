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

const ADMIN = 'owner-1';

/**
 * What importing a place does about the chain it belongs to.
 *
 * The screen imports a selection four places at a time, so these are the two
 * ways one chain used to become several: a place with no `brand:wikidata` never
 * matched anything, and four overlapping calls each created what none of them
 * could see yet.
 */
describe('DiscoveredPlaceService import, the chain it resolves', () => {
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

  function build(options: { known?: SupermarketView[] } = {}) {
    const known = [...(options.known ?? [])];
    const rows = new Map<string, DiscoveredPlace>();
    let locations = 0;

    const places = {
      findOne: jest.fn(async ({ where }: { where: { id: string } }) => {
        return rows.get(where.id) ?? null;
      }),
      save: jest.fn(async (row: DiscoveredPlace) => row),
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
    } as unknown as jest.Mocked<CatalogClient>;

    const admin = {
      requireAdmin: jest.fn(async () => ADMIN),
    } as unknown as jest.Mocked<PlatformAdminService>;

    const service = new DiscoveredPlaceService(places, catalog, admin);
    return {
      service,
      catalog,
      known,
      add: (row: DiscoveredPlace) => rows.set(row.id, row),
    };
  }

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
