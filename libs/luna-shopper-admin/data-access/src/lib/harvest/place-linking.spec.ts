import type { Wire } from '@portfolio/luna-shopper-admin/models';
import {
  asRefHolder,
  chainOfPlace,
  decideByRef,
  linkFields,
  refHolder,
  strictShops,
  suggestShops,
  type LinkableChain,
  type LinkableShop,
} from './place-linking';

/**
 * The rules the memory harvester shares with the real one (backend plan 0193,
 * targets 1 to 8; admin plan 0061, target 10).
 *
 * The screens are shown and tested with nothing listening, so a rule that is
 * wrong here is a screen that looks right in a spec and wrong against a
 * server. Each case below is a case of the backend plan.
 */

type Place = Wire.HarvestDiscoveredPlaceView;

const CHAINS: readonly LinkableChain[] = [
  { id: 'deza', name: { es: 'Deza' }, brandKey: 'Q-DEZA' },
  { id: 'jamon', name: { es: 'Supermercados El Jamón' }, brandKey: null },
];

/** A place at the origin of the test, which every distance is measured from. */
function place(over: Partial<Place> = {}): Place {
  return {
    id: 'place-1',
    runId: null,
    provider: 'osm',
    externalRef: 'node/1',
    brandKey: 'Q-DEZA',
    brandName: 'Deza',
    name: 'Deza',
    latitude: 37.88,
    longitude: -4.78,
    street: 'Avenida de Cádiz 68',
    city: 'Córdoba',
    postalCode: '14013',
    postalCodeSource: 'SOURCE',
    country: 'ES',
    website: null,
    openingHours: null,
    tags: {},
    scopeKey: null,
    status: 'NEW',
    supermarketLocationId: null,
    firstSeenAt: '2026-10-01T00:00:00.000Z',
    lastSeenAt: '2026-10-01T00:00:00.000Z',
    candidates: [],
    ...over,
  };
}

/**
 * One metre of latitude on the sphere the harvester measures on, so a shop
 * can be put a known distance north.
 */
const METRE = 180 / (Math.PI * 6_371_000);

function shop(over: Partial<LinkableShop> = {}): LinkableShop {
  return {
    id: 'shop-1',
    supermarketId: 'deza',
    label: null,
    address: 'Avenida de Cádiz 68',
    city: 'Córdoba',
    country: 'ES',
    postalCode: '14013',
    postalCodeSource: 'SOURCE',
    latitude: 37.88,
    longitude: -4.78,
    externalRef: null,
    externalProvider: null,
    footprintM2: null,
    ...over,
  };
}

const north = (metres: number) => 37.88 + metres * METRE;

describe('the chain a place names', () => {
  it('is the chain that holds its brand key', () => {
    expect(chainOfPlace(place(), CHAINS)?.id).toBe('deza');
  });

  it('is the chain whose name is the printed brand, with no key', () => {
    const found = chainOfPlace(
      place({ brandKey: null, brandName: '  supermercados   EL JAMÓN ' }),
      CHAINS
    );

    expect(found?.id).toBe('jamon');
  });

  /**
   * The harvester folds case and white space, and nothing else. A twin that
   * folded an accent away found a chain that the server does not find.
   */
  it.each(['Supermercados El Jamon', 'Supermercados-El-Jamón'])(
    'is none for %s, which differs in more than case and white space',
    (brandName) => {
      expect(
        chainOfPlace(place({ brandKey: null, brandName }), CHAINS)
      ).toBeNull();
    }
  );

  it('reads the name of the place when it prints no brand', () => {
    expect(
      chainOfPlace(
        place({ brandKey: null, brandName: null, name: 'deza' }),
        CHAINS
      )?.id
    ).toBe('deza');
  });

  it('is none for a brand the catalog files under no chain', () => {
    expect(
      chainOfPlace(place({ brandKey: null, brandName: 'Supercash' }), CHAINS)
    ).toBeNull();
  });
});

describe('the shops a place may be', () => {
  it('names the shop that carries its reference, on the first rung', () => {
    const found = suggestShops(
      place(),
      [shop({ externalRef: 'node/1', externalProvider: 'osm' })],
      CHAINS
    );

    expect(found).toEqual([
      expect.objectContaining({
        supermarketLocationId: 'shop-1',
        supermarketId: 'deza',
        rung: 'EXTERNAL_REF',
        metres: 0,
      }),
    ]);
  });

  it('does not take a reference that another provider gave', () => {
    const found = strictShops(
      place(),
      [
        shop({
          externalRef: 'node/1',
          externalProvider: 'ELJAMON',
          latitude: north(400),
        }),
      ],
      true
    );

    expect(found).toEqual([]);
  });

  it('names a shop of the chain within fifty metres, on the second rung', () => {
    const found = suggestShops(
      place(),
      [shop({ latitude: north(30) })],
      CHAINS
    );

    expect(found.map((row) => [row.rung, row.metres])).toEqual([
      ['NEARBY', 30],
    ]);
  });

  it('names a shop with no position at the same address, on the third rung', () => {
    const found = suggestShops(
      place(),
      [
        shop({
          latitude: null,
          longitude: null,
          address: 'AVENIDA DE CADIZ, 68',
        }),
      ],
      CHAINS
    );

    expect(found.map((row) => [row.rung, row.metres])).toEqual([
      ['ADDRESS', null],
    ]);
  });

  /**
   * The bound is on the distance as it was measured. Both shops read "50 m",
   * and only the one inside the bound is the same shop.
   */
  it('takes a shop at 49.6 m as the same shop, and a shop at 50.4 m as a hint', () => {
    const inside = suggestShops(
      place(),
      [shop({ latitude: north(49.6) })],
      CHAINS
    );
    const outside = suggestShops(
      place(),
      [shop({ latitude: north(50.4) })],
      CHAINS
    );

    expect(inside.map((row) => [row.rung, row.metres])).toEqual([
      ['NEARBY', 50],
    ]);
    expect(outside.map((row) => [row.rung, row.metres])).toEqual([
      ['SAME_CHAIN_NEAR', 50],
    ]);
    expect(
      strictShops(place(), [shop({ latitude: north(50.4) })], true)
    ).toEqual([]);
  });

  /** The two real shops at 54.9 m and 61.8 m of the backend plan. */
  it('names a shop at 55 metres as a hint, and a shop at 251 metres not at all', () => {
    const found = suggestShops(
      place(),
      [
        shop({ id: 'far', latitude: north(251) }),
        shop({ id: 'near', latitude: north(55) }),
      ],
      CHAINS
    );

    expect(found.map((row) => [row.supermarketLocationId, row.rung])).toEqual([
      ['near', 'SAME_CHAIN_NEAR'],
    ]);
  });

  it('answers the strict shops first and the hints after them, nearest first', () => {
    const found = suggestShops(
      place(),
      [
        shop({ id: 'hint-far', latitude: north(200) }),
        shop({ id: 'hint-near', latitude: north(80) }),
        shop({ id: 'strict', latitude: north(10) }),
      ],
      CHAINS
    );

    expect(found.map((row) => row.supermarketLocationId)).toEqual([
      'strict',
      'hint-near',
      'hint-far',
    ]);
  });

  it('reads the shops of the chain of the place, and no other chain', () => {
    const found = suggestShops(
      place(),
      [shop({ supermarketId: 'jamon', latitude: north(10) })],
      CHAINS
    );

    expect(found).toEqual([]);
  });

  /** Target 7: a reference is an identity, and it needs no chain. */
  it('finds the shop made from a place that names no chain, by reference only', () => {
    const unnamed = place({ brandKey: null, brandName: 'Supercash' });
    const shops = [
      shop({
        id: 'made-from-it',
        supermarketId: 'deza',
        externalRef: 'node/1',
        externalProvider: 'osm',
      }),
      shop({ id: 'only-near', supermarketId: 'jamon', latitude: north(10) }),
    ];

    expect(
      suggestShops(unnamed, shops, CHAINS).map((row) => [
        row.supermarketLocationId,
        row.rung,
      ])
    ).toEqual([['made-from-it', 'EXTERNAL_REF']]);
  });
});

describe('what a link fills', () => {
  it('fills nothing on a shop that holds everything', () => {
    expect(linkFields(place(), shop({ externalRef: 'node/9' })).filled).toEqual(
      []
    );
  });

  it('fills the address, the city and the country that the shop lacks', () => {
    const bare = shop({
      externalRef: 'node/9',
      address: null,
      city: '  ',
      country: null,
    });

    const { patch, filled } = linkFields(place(), bare);

    expect(filled).toEqual(['ADDRESS', 'CITY', 'COUNTRY']);
    expect(patch).toEqual({
      address: 'Avenida de Cádiz 68',
      city: 'Córdoba',
      country: 'ES',
    });
  });

  it('fills no field that the place itself lacks', () => {
    const bare = shop({ externalRef: 'node/9', city: null });

    expect(linkFields(place({ city: null }), bare).filled).toEqual([]);
  });

  it('fills the reference with its provider, and the position', () => {
    const { patch, filled } = linkFields(
      place(),
      shop({ latitude: null, longitude: null })
    );

    expect(filled).toEqual(['COORDINATES', 'EXTERNAL_REF']);
    expect(patch).toEqual({
      latitude: 37.88,
      longitude: -4.78,
      externalRef: 'node/1',
      externalProvider: 'osm',
    });
  });

  it.each([
    // the shop holds, the place holds, what the link does
    [null, null, 'SOURCE', true],
    ['14005', 'DERIVED', 'SOURCE', true],
    ['14005', 'SOURCE', 'SOURCE', false],
    ['14005', 'MANUAL', 'SOURCE', false],
    ['14005', 'DERIVED', 'DERIVED', false],
    [null, null, 'DERIVED', false],
    // A row from before the provenance column: a code with no source reads
    // as stated.
    ['14005', 'DERIVED', null, true],
  ] as const)(
    'a shop with code %s (%s) and a place whose code is %s: filled %s',
    (code, source, placeSource, fills) => {
      const { patch, filled } = linkFields(
        place({ postalCodeSource: placeSource }),
        shop({
          externalRef: 'node/9',
          postalCode: code,
          postalCodeSource: source,
        })
      );

      expect(filled.includes('POSTAL_CODE')).toBe(fills);
      if (fills) {
        expect(patch).toEqual({
          postalCode: '14013',
          postalCodeSource: 'SOURCE',
        });
      }
    }
  );

  /** The provider goes with a reference that is being filled, and only then. */
  it('leaves the provider that a shop with no reference already names', () => {
    const { patch, filled } = linkFields(
      place(),
      shop({ externalRef: null, externalProvider: 'ELJAMON' })
    );

    expect(filled).toEqual(['EXTERNAL_REF']);
    expect(patch).toEqual({ externalRef: 'node/1' });
  });

  it('writes no provider on a shop that holds its reference', () => {
    const { patch, filled } = linkFields(
      place(),
      shop({ externalRef: 'node/9', externalProvider: null })
    );

    expect(filled).toEqual([]);
    expect(patch).toEqual({});
  });

  it('fills the floor area of a shop that has none, after the postal code', () => {
    const { patch, filled } = linkFields(
      place(),
      shop({ externalRef: 'node/9', postalCode: null, city: null }),
      420
    );

    expect(filled).toEqual(['POSTAL_CODE', 'FOOTPRINT', 'CITY']);
    expect(patch.footprintM2).toBe(420);
  });

  it('keeps the floor area that a shop holds, and fills none from a place with none', () => {
    const sized = shop({ externalRef: 'node/9', footprintM2: 900 });
    const bare = shop({ externalRef: 'node/9' });

    expect(linkFields(place(), sized, 420).filled).toEqual([]);
    expect(linkFields(place(), bare).filled).toEqual([]);
    expect(linkFields(place(), bare, null).filled).toEqual([]);
  });

  it('fills no postal code from a place that has none', () => {
    expect(
      linkFields(
        place({ postalCode: null, postalCodeSource: null }),
        shop({
          externalRef: 'node/9',
          postalCode: null,
          postalCodeSource: null,
        })
      ).filled
    ).toEqual([]);
  });
});

describe('the bulk link, one place at a time', () => {
  const carrying = (over: Partial<LinkableShop> = {}) =>
    shop({ externalRef: 'node/1', externalProvider: 'osm', ...over });

  it('links the one shop that carries the reference and names the provider', () => {
    expect(decideByRef(place(), [carrying(), shop({ id: 'other' })])).toEqual({
      kind: 'link',
      shop: expect.objectContaining({ id: 'shop-1' }),
    });
  });

  it('leaves alone a place whose reference no shop carries', () => {
    expect(decideByRef(place(), [shop()])).toBeNull();
  });

  it('skips a place that two shops carry the reference of', () => {
    const decision = decideByRef(place(), [
      carrying(),
      carrying({ id: 'shop-2' }),
    ]);

    expect(decision).toEqual({
      kind: 'skip',
      reason: 'SEVERAL_SHOPS',
      shops: [
        expect.objectContaining({ id: 'shop-1' }),
        expect.objectContaining({ id: 'shop-2' }),
      ],
    });
  });

  it('skips a place whose shop names no provider for the reference', () => {
    expect(
      decideByRef(place(), [carrying({ externalProvider: null })])
    ).toEqual(
      expect.objectContaining({ kind: 'skip', reason: 'PROVIDER_NOT_NAMED' })
    );
  });

  it('does not count a shop that names another provider', () => {
    expect(
      decideByRef(place(), [carrying({ externalProvider: 'ELJAMON' })])
    ).toBeNull();
  });
});

/** Backend plan 0195: the catalog holds one shop for each reference. */
describe('the shop that holds a reference', () => {
  const held = shop({
    id: 'holder',
    supermarketId: 'jamon',
    externalRef: 'node/1',
    externalProvider: 'ELJAMON',
    label: { es: 'El Jamón Centro' },
  });

  it('is any shop with that reference, whatever its chain and its provider', () => {
    expect(refHolder('node/1', [shop({ id: 'other' }), held])?.id).toBe(
      'holder'
    );
  });

  it('is never the shop that is being written', () => {
    expect(refHolder('node/1', [held], 'holder')).toBeNull();
  });

  it('is none for a reference that no shop holds, and for no reference', () => {
    expect(refHolder('node/2', [held])).toBeNull();
    expect(refHolder(null, [shop({ externalRef: null })])).toBeNull();
    expect(refHolder('', [shop({ externalRef: '' })])).toBeNull();
  });

  it('is named with its chain, as catalog names it in the refusal', () => {
    expect(asRefHolder(held, CHAINS)).toEqual({
      supermarketLocationId: 'holder',
      supermarketId: 'jamon',
      supermarketName: { es: 'Supermercados El Jamón' },
      label: { es: 'El Jamón Centro' },
      address: 'Avenida de Cádiz 68',
      city: 'Córdoba',
      externalProvider: 'ELJAMON',
    });
  });
});
