import { GatewayError } from '@portfolio/luna-shopper-admin/data-access';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import {
  candidateMarkKey,
  candidatesOf,
  filledFieldKeys,
  fromOpenStreetMap,
  metresBetween,
  nearby,
  nearbyShops,
  pickedShop,
  placeCandidates,
  placeLines,
  placeRefusalKey,
  refHolderOf,
  refLinkPreview,
  refusedChainName,
  refusedRefHolder,
  shopWhere,
} from './place-view';

type Place = Wire.HarvestDiscoveredPlaceView;

function place(over: Partial<Place> = {}): Place {
  return {
    id: 'place-1',
    runId: null,
    provider: 'osm',
    externalRef: 'node/1',
    brandKey: 'Q925132',
    brandName: 'Dia',
    name: 'Dia Market',
    latitude: 40.4168,
    longitude: -3.7038,
    street: 'Calle Mayor 14',
    city: 'Madrid',
    postalCode: '28013',
    country: 'ES',
    website: null,
    openingHours: null,
    tags: {},
    status: 'NEW',
    supermarketLocationId: null,
    firstSeenAt: '2026-09-01T08:00:00.000Z',
    lastSeenAt: '2026-09-01T08:00:00.000Z',
    ...over,
  };
}

describe('metresBetween', () => {
  it('is zero for the same point', () => {
    expect(metresBetween(place(), place())).toBe(0);
  });

  it('measures a hundredth of a degree of latitude as about a kilometre', () => {
    const north = place({ latitude: 40.4168 + 0.01 });

    expect(metresBetween(place(), north)).toBeCloseTo(1113, 0);
  });

  /**
   * The longitude degree shrinks with latitude, and ignoring that would make two
   * places in Madrid look a third further apart than they are.
   */
  it('shrinks a degree of longitude by the latitude', () => {
    const east = place({ longitude: -3.7038 + 0.01 });

    // 0.01 degrees at 40 degrees north is about 848 metres, not 1113.
    expect(metresBetween(place(), east)).toBeCloseTo(848, -1);
  });
});

describe('nearby', () => {
  /**
   * The pair the queue exists for. `Dia` and `Maxi Dia` share one Wikidata
   * identifier, which is why grouping is on the key and never on the name.
   */
  it('pairs two of the same brand a few metres apart', () => {
    const current = place({ id: 'a', name: 'Dia Market' });
    const other = place({
      id: 'b',
      name: 'Maxi Dia',
      latitude: 40.4169,
      longitude: -3.7039,
    });

    expect(nearby(current, [other])).toEqual([other]);
  });

  /**
   * Distance alone would pair a supermarket with the bakery next door, which is
   * not a duplicate of anything.
   */
  it('does not pair different brands, however close', () => {
    const current = place({ id: 'a', brandKey: 'Q925132' });
    const other = place({ id: 'b', brandKey: 'Q217599' });

    expect(nearby(current, [other])).toEqual([]);
  });

  /**
   * Brand alone would pair two branches of one chain in different cities, which
   * is exactly what the catalog is supposed to hold two of.
   */
  it('does not pair the same brand in another city', () => {
    const current = place({ id: 'a' });
    const other = place({ id: 'b', latitude: 41.3874, longitude: 2.1686 });

    expect(nearby(current, [other])).toEqual([]);
  });

  /**
   * An absent Wikidata identifier is not a value two places share, but it is the
   * state that makes a duplicate hardest to spot automatically, so those are
   * the ones most worth putting side by side.
   */
  it('pairs two places that both have no brand key', () => {
    const current = place({ id: 'a', brandKey: null });
    const other = place({ id: 'b', brandKey: null, latitude: 40.4169 });

    expect(nearby(current, [other])).toEqual([other]);
  });
});

describe('placeLines', () => {
  it('keeps a fixed order, so a fact is always in the same position', () => {
    const full = placeLines(place()).map((line) => line.key);
    const sparse = placeLines(
      place({ street: null, city: null, postalCode: null })
    ).map((line) => line.key);

    expect(sparse).toEqual(full);
  });

  it('renders a missing value as empty rather than as the word null', () => {
    const lines = placeLines(place({ website: null }));

    expect(lines.find((line) => line.key === 'website')?.value).toBe('');
  });

  it('shows the coordinates the operator would paste into a map', () => {
    const lines = placeLines(place());

    expect(lines.find((line) => line.key === 'coordinates')?.value).toBe(
      '40.41680, -3.70380'
    );
  });
});

/** Admin plan 0034, section 1: the candidates a 409 carries, read as ours. */
describe('placeCandidates', () => {
  it('reads each candidate with the rung that found it', () => {
    const found = placeCandidates(
      {
        candidates: [
          {
            supermarketLocationId: 'loc-1',
            label: { en: 'Libertador', es: 'Libertador' },
            address: 'Avenida del Gran Capitán 12',
            postalCode: '14001',
            rung: 'EXTERNAL_REF',
          },
        ],
      },
      ['en', 'es']
    );

    expect(found).toEqual([
      {
        supermarketLocationId: 'loc-1',
        supermarketId: '',
        title: 'Libertador',
        address: 'Avenida del Gran Capitán 12',
        city: '',
        postalCode: '14001',
        metres: null,
        rung: 'EXTERNAL_REF',
        hint: false,
      },
    ]);
  });

  it('names an unlabelled shop by its address', () => {
    const found = placeCandidates(
      {
        candidates: [
          { supermarketLocationId: 'loc-1', address: 'Calle Mayor 1' },
        ],
      },
      ['en']
    );

    expect(found.map((candidate) => candidate.title)).toEqual([
      'Calle Mayor 1',
    ]);
  });

  /**
   * An id is not a name. A candidate with every field null keeps its id to
   * be linked by, and has nothing to be called by: the page then says "a
   * shop with no address".
   */
  it('never names a shop by its id, also when every field is null', () => {
    const id = '0b6f1c1e-7f5d-4a55-9d0e-0d1f4a6a9b21';
    const found = placeCandidates(
      {
        candidates: [
          {
            supermarketLocationId: id,
            supermarketId: 'chain-1',
            label: null,
            address: null,
            city: null,
            postalCode: null,
            rung: 'EXTERNAL_REF',
            metres: null,
          },
        ],
      },
      ['en']
    );

    expect(found).toEqual([
      {
        supermarketLocationId: id,
        supermarketId: 'chain-1',
        title: '',
        address: '',
        city: '',
        postalCode: '',
        metres: null,
        rung: 'EXTERNAL_REF',
        hint: false,
      },
    ]);
  });

  /** Rule D4: an error body is the least trustworthy thing on the wire. */
  it('drops what cannot be linked and survives a malformed body', () => {
    expect(placeCandidates({}, ['en'])).toEqual([]);
    expect(placeCandidates({ candidates: 'nope' }, ['en'])).toEqual([]);
    expect(
      placeCandidates({ candidates: [null, 3, { address: 'x' }] }, ['en'])
    ).toEqual([]);
  });

  it('keeps a rung it does not know, under its own name for one', () => {
    const [found] = placeCandidates(
      { candidates: [{ supermarketLocationId: 'loc-1', rung: 'PHONE' }] },
      ['en']
    );

    expect(found.rung).toBe('UNKNOWN');
  });
});

/**
 * Admin plan 0061: the candidates the list read carries, read by the same
 * mapper as the ones a refusal carries, so the panel draws one thing.
 */
describe('candidatesOf', () => {
  const listed: Wire.HarvestPlaceLocationCandidate[] = [
    {
      supermarketLocationId: 'loc-1',
      supermarketId: 'chain-1',
      label: null,
      address: 'Calle Mayor 1',
      city: 'Córdoba',
      postalCode: '14001',
      rung: 'NEARBY',
      metres: 28,
    },
    {
      supermarketLocationId: 'loc-2',
      supermarketId: 'chain-1',
      label: { es: 'Sector Sur' },
      address: 'Avenida de Cádiz 68',
      city: 'Córdoba',
      postalCode: '14013',
      rung: 'SAME_CHAIN_NEAR',
      metres: 61.8,
    },
  ];

  it('reads the chain, the city and the distance of each candidate', () => {
    expect(candidatesOf(listed, ['en', 'es'])).toEqual([
      {
        supermarketLocationId: 'loc-1',
        supermarketId: 'chain-1',
        title: 'Calle Mayor 1',
        address: 'Calle Mayor 1',
        city: 'Córdoba',
        postalCode: '14001',
        metres: 28,
        rung: 'NEARBY',
        hint: false,
      },
      {
        supermarketLocationId: 'loc-2',
        supermarketId: 'chain-1',
        title: 'Sector Sur',
        address: 'Avenida de Cádiz 68',
        city: 'Córdoba',
        postalCode: '14013',
        metres: 62,
        rung: 'SAME_CHAIN_NEAR',
        hint: true,
      },
    ]);
  });

  it('marks a shop that is only near as a hint', () => {
    expect(candidatesOf(listed, ['en']).map((found) => found.hint)).toEqual([
      false,
      true,
    ]);
  });

  /** The sentence of a hint names the distance, so it needs one. */
  it('gives a hint with no distance the generic sentence and keeps it a hint', () => {
    const [found] = candidatesOf(
      [{ supermarketLocationId: 'loc-1', rung: 'SAME_CHAIN_NEAR' }],
      ['en']
    );

    expect(found.rung).toBe('UNKNOWN');
    expect(found.hint).toBe(true);
  });

  it('answers nothing for what is not a list', () => {
    expect(candidatesOf(undefined, ['en'])).toEqual([]);
    expect(candidatesOf({ length: 2 }, ['en'])).toEqual([]);
  });
});

describe('candidateMarkKey', () => {
  it('says nothing for a place with no candidate', () => {
    expect(candidateMarkKey([])).toBeNull();
    expect(candidateMarkKey(undefined)).toBeNull();
  });

  it('says the place is probably a shop we hold on a strict rung', () => {
    expect(candidateMarkKey([{ rung: 'EXTERNAL_REF' }])).toBe(
      'harvest.places.mark.probable'
    );
    expect(
      candidateMarkKey([{ rung: 'SAME_CHAIN_NEAR' }, { rung: 'NEARBY' }])
    ).toBe('harvest.places.mark.probable');
  });

  it('says only that a shop is near when every candidate is a hint', () => {
    expect(candidateMarkKey([{ rung: 'SAME_CHAIN_NEAR' }])).toBe(
      'harvest.places.mark.near'
    );
  });
});

describe('filledFieldKeys', () => {
  it('names the fields in one fixed order, whatever order they came in', () => {
    expect(
      filledFieldKeys(['POSTAL_CODE', 'COORDINATES', 'CITY', 'ADDRESS'])
    ).toEqual([
      'harvest.places.linked.field.ADDRESS',
      'harvest.places.linked.field.CITY',
      'harvest.places.linked.field.POSTAL_CODE',
      'harvest.places.linked.field.COORDINATES',
    ]);
  });

  it('answers nothing for a link that wrote only the mark', () => {
    expect(filledFieldKeys([])).toEqual([]);
    expect(filledFieldKeys(undefined)).toEqual([]);
  });

  it('names a field it does not know once, as another field', () => {
    expect(filledFieldKeys(['CITY', 'PHONE', 'HOURS'])).toEqual([
      'harvest.places.linked.field.CITY',
      'harvest.places.linked.field.OTHER',
    ]);
  });
});

describe('refusedChainName', () => {
  it('reads the localized name of the chain the place names', () => {
    expect(
      refusedChainName({ chain: { id: 'chain-2', name: { es: 'Dia' } } }, [
        'en',
        'es',
      ])
    ).toBe('Dia');
  });

  it('answers an empty name for details it cannot read', () => {
    expect(refusedChainName({}, ['en'])).toBe('');
    expect(refusedChainName({ chain: 'Dia' }, ['en'])).toBe('');
    expect(refusedChainName({ chain: { id: 'chain-2' } }, ['en'])).toBe('');
  });
});

describe('pickedShop', () => {
  it('reads a catalog row as the shop the link form draws', () => {
    expect(
      pickedShop(
        {
          id: 'loc-1',
          label: null,
          address: 'Calle Mayor 1',
          city: 'Córdoba',
          postalCode: '14001',
        },
        ['en']
      )
    ).toEqual({
      id: 'loc-1',
      title: 'Calle Mayor 1',
      address: 'Calle Mayor 1',
      city: 'Córdoba',
      postalCode: '14001',
    });
  });

  it('answers null for a row with no id', () => {
    expect(pickedShop(undefined, ['en'])).toBeNull();
    expect(pickedShop({ address: 'x' }, ['en'])).toBeNull();
  });
});

describe('refLinkPreview', () => {
  const shop: Wire.HarvestPlaceLocationCandidate = {
    supermarketLocationId: 'loc-1',
    supermarketId: 'chain-1',
    label: null,
    address: 'Calle Mayor 1',
    city: 'Madrid',
    postalCode: '28013',
    rung: 'EXTERNAL_REF',
    metres: 4,
  };

  it('draws one line for each place with its shop and what the link fills', () => {
    const preview = refLinkPreview(
      {
        applied: false,
        linked: [{ place: place(), shop, filled: ['CITY'] }],
        skipped: [],
      },
      ['en']
    );

    expect(preview).toEqual({
      linked: [
        {
          placeId: 'place-1',
          place: 'Dia Market',
          where: 'Calle Mayor 14, Madrid',
          shop: 'Calle Mayor 1',
          filledKeys: ['harvest.places.linked.field.CITY'],
        },
      ],
      skipped: [],
    });
  });

  it('draws a skipped place with its reason', () => {
    const preview = refLinkPreview(
      {
        applied: false,
        linked: [],
        skipped: [
          {
            place: place({ name: null, street: null }),
            reason: 'PROVIDER_NOT_NAMED',
            shops: [shop],
          },
        ],
      },
      ['en']
    );

    expect(preview.skipped).toEqual([
      {
        placeId: 'place-1',
        place: 'node/1',
        where: 'Madrid',
        reasonKey: 'harvest.places.byRef.reason.PROVIDER_NOT_NAMED',
      },
    ]);
  });
});

describe('nearbyShops', () => {
  it('keeps shops within reach, nearest first', () => {
    const shops = nearbyShops(
      place(),
      [
        { id: 'far', latitude: 40.43, longitude: -3.7038 },
        { id: 'next', latitude: 40.4169, longitude: -3.7038, address: 'x' },
        { id: 'here', latitude: 40.4168, longitude: -3.7038 },
      ],
      ['en']
    );

    expect(shops.map((shop) => shop.id)).toEqual(['here', 'next']);
    expect(shops[1].metres).toBe(11);
  });

  /** The seeded shops of backend plan 0150 had no coordinates at all. */
  it('keeps a shop with no position at the same postal code', () => {
    const shops = nearbyShops(
      place(),
      [
        { id: 'same', latitude: null, longitude: null, postalCode: '28013' },
        { id: 'other', latitude: null, longitude: null, postalCode: '28001' },
      ],
      ['en']
    );

    expect(shops).toEqual([
      {
        id: 'same',
        title: '',
        address: '',
        city: '',
        postalCode: '28013',
        metres: null,
      },
    ]);
  });
});

describe('fromOpenStreetMap', () => {
  it('reads the provider without case', () => {
    expect(fromOpenStreetMap(place({ provider: 'OSM' }))).toBe(true);
    expect(fromOpenStreetMap(place({ provider: 'osm' }))).toBe(true);
    expect(fromOpenStreetMap(place({ provider: 'lidl' }))).toBe(false);
  });
});

describe('placeRefusalKey', () => {
  const refusal = (code: string) =>
    new GatewayError({ code, status: 409, correlationId: '' });

  it('names the three refusals backend plan 0152 added', () => {
    expect(placeRefusalKey(refusal('place_matches_location'))).toBe(
      'harvest.places.error.matchesLocation'
    );
    expect(placeRefusalKey(refusal('place_already_imported'))).toBe(
      'harvest.places.error.alreadyImported'
    );
    expect(placeRefusalKey(refusal('scope_not_found'))).toBe(
      'harvest.places.error.scopeNotFound'
    );
  });

  it('names the refusal backend plan 0193 added', () => {
    expect(placeRefusalKey(refusal('place_names_another_chain'))).toBe(
      'harvest.places.error.namesAnotherChain'
    );
  });

  it('leaves every other refusal to the generic sentence', () => {
    expect(placeRefusalKey(refusal('conflict'))).toBeNull();
    expect(placeRefusalKey(null)).toBeNull();
  });
});

/** Backend plan 0195: the shop that holds a reference, read from `unknown`. */
describe('the shop that holds a reference', () => {
  const held = {
    supermarketLocationId: 'loc-9',
    supermarketId: 'chain-1',
    supermarketName: { es: 'Deza' },
    label: { es: 'Deza Centro' },
    address: 'Calle Mayor 1',
    city: 'Córdoba',
    externalProvider: 'osm',
  };

  it('is named by its chain, its label and its city', () => {
    expect(refHolderOf(held, ['en', 'es'])).toEqual({
      chain: 'Deza',
      shop: 'Deza Centro',
      city: 'Córdoba',
    });
  });

  it('is named by its address when it has no label', () => {
    expect(refHolderOf({ ...held, label: null }, ['es'])?.shop).toBe(
      'Calle Mayor 1'
    );
  });

  it('has no name of its own with no label and no address, and never its id', () => {
    expect(
      refHolderOf({ ...held, label: null, address: null, city: null }, ['es'])
    ).toEqual({ chain: 'Deza', shop: '', city: '' });
  });

  it('is read from the details of the refusal', () => {
    expect(
      refusedRefHolder({ externalRef: 'node/1', heldBy: held }, ['es'])?.shop
    ).toBe('Deza Centro');
  });

  /** A holder that was deleted before the read arrives as null. */
  it('is none for a holder that is gone and for a malformed body', () => {
    expect(refusedRefHolder({ heldBy: null }, ['es'])).toBeNull();
    expect(refusedRefHolder({}, ['es'])).toBeNull();
    expect(refHolderOf('nope', ['es'])).toBeNull();
    expect(refHolderOf({}, ['es'])).toEqual({ chain: '', shop: '', city: '' });
  });
});

describe('the address line of a shop', () => {
  it('is its address, then its postal code and city', () => {
    expect(
      shopWhere({
        title: 'Consum Centro',
        address: 'Calle Cruz Conde 20',
        city: 'Córdoba',
        postalCode: '14003',
      })
    ).toBe('Calle Cruz Conde 20, 14003 Córdoba');
  });

  it('leaves the address out when it is the name already', () => {
    expect(
      shopWhere({
        title: 'Calle Mayor 1',
        address: 'Calle Mayor 1',
        city: 'Córdoba',
        postalCode: '',
      })
    ).toBe('Córdoba');
  });

  it('is empty for a shop with nothing', () => {
    expect(
      shopWhere({ title: '', address: '', city: '', postalCode: '' })
    ).toBe('');
  });
});

describe('a picked shop and a line of the bulk act', () => {
  it('never call a shop by its id', () => {
    expect(pickedShop({ id: 'loc-1' }, ['en'])?.title).toBe('');
  });
});
