import {
  PlaceMatchRung,
  PostalCodeSource,
  type SupermarketLocationView,
} from '@portfolio/luna-shopper/contracts';
import {
  locationsCarryingRef,
  matchLocations,
  matchReference,
  NEAR_SHOP_METRES,
  SAME_SHOP_METRES,
  suggestLocations,
  type PlaceMatchSubject,
} from './place-matching';

const LAT = 37.88;
const LON = -4.77;

/** One degree of latitude on the sphere `distanceMetres` measures on. */
const METRES_PER_DEGREE = (6_371_000 * Math.PI) / 180;

/** The latitude that many metres north of the place. */
function north(metres: number): number {
  return LAT + metres / METRES_PER_DEGREE;
}

function place(over: Partial<PlaceMatchSubject> = {}): PlaceMatchSubject {
  return {
    provider: 'OSM',
    externalRef: 'node/1',
    latitude: LAT,
    longitude: LON,
    street: 'Avenida de Cádiz 68',
    postalCode: '14010',
    ...over,
  };
}

/** A shop of the chain, 2 km north of the place unless a case moves it. */
function shop(
  id: string,
  over: Partial<SupermarketLocationView> = {}
): SupermarketLocationView {
  return {
    id,
    supermarketId: 'chain-deza',
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
    externalRef: null,
    externalProvider: null,
    footprintM2: null,
    sections: [],
    ...over,
  } as SupermarketLocationView;
}

function at(id: string, metres: number): SupermarketLocationView {
  return shop(id, { latitude: north(metres) });
}

function rungs(
  candidates: ReturnType<typeof suggestLocations>
): Array<[string, PlaceMatchRung, number | null]> {
  return candidates.map((held) => [
    held.supermarketLocationId,
    held.rung,
    held.metres,
  ]);
}

describe('the bounds', () => {
  it('keeps the strict rung at 50 metres and puts the hint at 250', () => {
    expect(SAME_SHOP_METRES).toBe(50);
    expect(NEAR_SHOP_METRES).toBe(250);
  });
});

/**
 * The three strict rungs (plan 0152), which plan 0193 leaves as they were:
 * the 409 of a hand import reads these and nothing more.
 */
describe('matchLocations, the three strict rungs', () => {
  it('answers the shop that carries the reference, alone', () => {
    const found = matchLocations(place(), [
      shop('by-ref', { externalRef: 'node/1', externalProvider: 'OSM' }),
      at('near', 30),
    ]);

    expect(rungs(found)).toEqual([
      ['by-ref', PlaceMatchRung.EXTERNAL_REF, 2000],
    ]);
  });

  it('counts a reference whose shop names no provider', () => {
    const found = matchLocations(place(), [
      shop('bare-ref', { externalRef: 'node/1', externalProvider: null }),
    ]);

    expect(found.map((held) => held.rung)).toEqual([
      PlaceMatchRung.EXTERNAL_REF,
    ]);
  });

  it('ignores the same reference under another provider', () => {
    expect(
      matchLocations(place(), [
        shop('other', { externalRef: 'node/1', externalProvider: 'LIDL' }),
      ])
    ).toEqual([]);
  });

  it('answers a shop within 50 metres when no reference matches', () => {
    expect(rungs(matchLocations(place(), [at('near', 30)]))).toEqual([
      ['near', PlaceMatchRung.NEARBY, 30],
    ]);
  });

  it('does not answer a shop at 54.9 metres: the strict bound did not move', () => {
    expect(matchLocations(place(), [at('just-outside', 54.9)])).toEqual([]);
  });

  it('answers a shop with no position by postal code and address', () => {
    const found = matchLocations(place(), [
      shop('seeded', {
        latitude: null,
        longitude: null,
        postalCode: '14010',
        address: 'avenida de cadiz, 68',
      }),
    ]);

    expect(rungs(found)).toEqual([['seeded', PlaceMatchRung.ADDRESS, null]]);
  });

  it('carries the chain and the city of the shop on a candidate', () => {
    const [found] = matchLocations(place(), [at('near', 30)]);

    expect(found).toEqual({
      supermarketLocationId: 'near',
      supermarketId: 'chain-deza',
      label: null,
      address: 'Calle de la Feria 3',
      city: 'Córdoba',
      postalCode: '14002',
      rung: PlaceMatchRung.NEARBY,
      metres: 30,
    });
  });
});

/** The strict rungs, then the hint (plan 0193, target 6). */
describe('suggestLocations, the four rungs', () => {
  it('answers a shop at 54.9 metres as SAME_CHAIN_NEAR', () => {
    expect(rungs(suggestLocations(place(), [at('real', 54.9)]))).toEqual([
      ['real', PlaceMatchRung.SAME_CHAIN_NEAR, 55],
    ]);
  });

  it('answers a shop at 61.8 metres as SAME_CHAIN_NEAR', () => {
    expect(rungs(suggestLocations(place(), [at('real', 61.8)]))).toEqual([
      ['real', PlaceMatchRung.SAME_CHAIN_NEAR, 62],
    ]);
  });

  it('answers a shop at 250 metres and nothing at 251', () => {
    expect(
      suggestLocations(place(), [at('edge', 249.9)]).map((held) => held.rung)
    ).toEqual([PlaceMatchRung.SAME_CHAIN_NEAR]);
    expect(suggestLocations(place(), [at('beyond', 251)])).toEqual([]);
  });

  it('keeps a shop within 50 metres on its strict rung', () => {
    expect(rungs(suggestLocations(place(), [at('same', 49)]))).toEqual([
      ['same', PlaceMatchRung.NEARBY, 49],
    ]);
  });

  it('answers the strict rung first and the near shops after it, nearest first', () => {
    const found = suggestLocations(place(), [
      at('near-200', 200),
      at('strict-40', 40),
      at('far', 900),
      at('near-70', 70),
      at('strict-10', 10),
      at('near-120', 120),
    ]);

    expect(rungs(found)).toEqual([
      ['strict-10', PlaceMatchRung.NEARBY, 10],
      ['strict-40', PlaceMatchRung.NEARBY, 40],
      ['near-70', PlaceMatchRung.SAME_CHAIN_NEAR, 70],
      ['near-120', PlaceMatchRung.SAME_CHAIN_NEAR, 120],
      ['near-200', PlaceMatchRung.SAME_CHAIN_NEAR, 200],
    ]);
  });

  it('lists a near shop after the shop that carries the reference', () => {
    const found = suggestLocations(place(), [
      at('near-100', 100),
      shop('by-ref', { externalRef: 'node/1', externalProvider: 'OSM' }),
    ]);

    expect(rungs(found)).toEqual([
      ['by-ref', PlaceMatchRung.EXTERNAL_REF, 2000],
      ['near-100', PlaceMatchRung.SAME_CHAIN_NEAR, 100],
    ]);
  });

  it('names a shop once when it carries the reference and is also near', () => {
    const found = suggestLocations(place(), [
      shop('both', {
        externalRef: 'node/1',
        externalProvider: 'OSM',
        latitude: north(100),
      }),
    ]);

    expect(rungs(found)).toEqual([['both', PlaceMatchRung.EXTERNAL_REF, 100]]);
  });

  it('never answers a shop with no position on the distance rungs', () => {
    expect(
      suggestLocations(place({ street: null }), [
        shop('seeded', { latitude: null, longitude: null }),
      ])
    ).toEqual([]);
  });

  it('does not change the list it was handed', () => {
    const locations = [at('b', 200), at('a', 100)];

    suggestLocations(place(), locations);

    expect(locations.map((held) => held.id)).toEqual(['b', 'a']);
  });
});

/** Rung 1 alone, which is all a place with no chain is asked (target 7). */
describe('matchReference and locationsCarryingRef', () => {
  const shops = [
    shop('same-provider', { externalRef: 'node/1', externalProvider: 'OSM' }),
    shop('no-provider', { externalRef: 'node/1', externalProvider: null }),
    shop('other-provider', { externalRef: 'node/1', externalProvider: 'LIDL' }),
    shop('other-ref', { externalRef: 'node/2', externalProvider: 'OSM' }),
    at('ten-metres-away', 10),
  ];

  it('keeps the shops of the same provider and of none', () => {
    expect(locationsCarryingRef(place(), shops).map((held) => held.id)).toEqual(
      ['same-provider', 'no-provider']
    );
  });

  it('answers no shop on a distance, however near', () => {
    expect(
      matchReference(place(), shops).map((held) => [
        held.supermarketLocationId,
        held.rung,
      ])
    ).toEqual([
      ['same-provider', PlaceMatchRung.EXTERNAL_REF],
      ['no-provider', PlaceMatchRung.EXTERNAL_REF],
    ]);
  });
});
