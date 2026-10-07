import {
  PlaceLinkField,
  PostalCodeSource,
  type SupermarketLocationView,
} from '@portfolio/luna-shopper/contracts';
import {
  missingFields,
  postalCodeFields,
  type PlaceLinkSubject,
} from './place-link-fields';

/** An El Jamón place as the chain's own shop list states it. */
function place(over: Partial<PlaceLinkSubject> = {}): PlaceLinkSubject {
  return {
    provider: 'ELJAMON',
    externalRef: '14010:avenida de cadiz 68',
    latitude: 37.8661,
    longitude: -4.7812,
    street: 'Avenida de Cádiz 68',
    city: 'Córdoba',
    country: 'es',
    postalCode: '14010',
    postalCodeSource: PostalCodeSource.SOURCE,
    footprintM2: null,
    ...over,
  };
}

/** A shop that holds every field a link could fill. */
function shop(
  over: Partial<SupermarketLocationView> = {}
): SupermarketLocationView {
  return {
    id: 'loc-1',
    supermarketId: 'chain-eljamon',
    priceScopeId: 'scope-store',
    priceScopeIds: ['scope-store'],
    label: null,
    address: 'Avda. de Cádiz, 68',
    city: 'Cordoba',
    country: 'es',
    postalCode: '14013',
    postalCodeSource: PostalCodeSource.MANUAL,
    latitude: 37.8662,
    longitude: -4.7813,
    externalRef: 'node/77',
    externalProvider: 'OSM',
    footprintM2: 900,
    sections: [],
    ...over,
  } as SupermarketLocationView;
}

/**
 * What a link fills on a shop, and what it leaves alone (plan 0193, targets 1
 * to 3). Pure, so every case is one call.
 */
describe('missingFields (plan 0193)', () => {
  it('fills nothing on a shop that holds every field', () => {
    expect(missingFields(place({ footprintM2: 1200 }), shop())).toEqual({
      patch: {},
      filled: [],
    });
  });

  describe('the address, the city and the country', () => {
    const TEXT_FIELDS = [
      ['address', 'street', PlaceLinkField.ADDRESS, 'Avenida de Cádiz 68'],
      ['city', 'city', PlaceLinkField.CITY, 'Córdoba'],
      ['country', 'country', PlaceLinkField.COUNTRY, 'es'],
    ] as const;

    it.each(TEXT_FIELDS)(
      'fills %s when the shop holds null',
      (onShop, _onPlace, field, value) => {
        expect(missingFields(place(), shop({ [onShop]: null }))).toEqual({
          patch: { [onShop]: value },
          filled: [field],
        });
      }
    );

    it.each(TEXT_FIELDS)(
      'fills %s when the shop holds only white space',
      (onShop, _onPlace, field, value) => {
        for (const held of ['', '   ', '\t\n']) {
          expect(missingFields(place(), shop({ [onShop]: held }))).toEqual({
            patch: { [onShop]: value },
            filled: [field],
          });
        }
      }
    );

    it.each(TEXT_FIELDS)(
      'keeps %s when the shop holds a value, also a different one',
      (onShop) => {
        const { patch } = missingFields(place(), shop());
        expect(patch).not.toHaveProperty(onShop);
      }
    );

    it.each(TEXT_FIELDS)(
      'sends no %s that the place does not hold itself',
      (onShop, onPlace) => {
        for (const held of [null, '', '  ']) {
          expect(
            missingFields(place({ [onPlace]: held }), shop({ [onShop]: null }))
          ).toEqual({ patch: {}, filled: [] });
        }
      }
    );
  });

  describe('the four fields of plan 0152, which keep their rule', () => {
    it('fills the coordinates when the shop has none', () => {
      expect(
        missingFields(place(), shop({ latitude: null, longitude: null }))
      ).toEqual({
        patch: { latitude: 37.8661, longitude: -4.7812 },
        filled: [PlaceLinkField.COORDINATES],
      });
    });

    it('keeps the coordinates a shop has', () => {
      const { patch } = missingFields(place(), shop());
      expect(patch).not.toHaveProperty('latitude');
      expect(patch).not.toHaveProperty('longitude');
    });

    it('fills the reference and its provider when the shop has neither', () => {
      expect(
        missingFields(
          place(),
          shop({ externalRef: null, externalProvider: null })
        )
      ).toEqual({
        patch: {
          externalRef: '14010:avenida de cadiz 68',
          externalProvider: 'ELJAMON',
        },
        filled: [PlaceLinkField.EXTERNAL_REF],
      });
    });

    it('keeps the reference a shop has, so two places can name one shop', () => {
      // The El Jamón place of a shop that came from OpenStreetMap: the shop
      // keeps the OpenStreetMap reference it holds.
      const { patch, filled } = missingFields(place(), shop());
      expect(patch).not.toHaveProperty('externalRef');
      expect(patch).not.toHaveProperty('externalProvider');
      expect(filled).not.toContain(PlaceLinkField.EXTERNAL_REF);
    });

    it('fills the size when the shop has none and the place has one', () => {
      expect(
        missingFields(place({ footprintM2: 1200 }), shop({ footprintM2: null }))
      ).toEqual({
        patch: { footprintM2: 1200 },
        filled: [PlaceLinkField.FOOTPRINT],
      });
    });

    it('keeps the size a shop has', () => {
      const { patch } = missingFields(place({ footprintM2: 1200 }), shop());
      expect(patch).not.toHaveProperty('footprintM2');
    });
  });

  /**
   * The postal code: what the shop holds against what the place holds. A
   * derived code on the shop is a guess catalog made and counts as empty. A
   * derived code on the place is never sent, whatever the shop holds.
   */
  describe('the postal code', () => {
    const SENT = {
      patch: { postalCode: '14010', postalCodeSource: PostalCodeSource.SOURCE },
      filled: [PlaceLinkField.POSTAL_CODE],
    };
    const NOTHING = { patch: {}, filled: [] };

    const onShop = {
      none: { postalCode: null, postalCodeSource: null },
      DERIVED: {
        postalCode: '14013',
        postalCodeSource: PostalCodeSource.DERIVED,
      },
      SOURCE: {
        postalCode: '14013',
        postalCodeSource: PostalCodeSource.SOURCE,
      },
      MANUAL: {
        postalCode: '14013',
        postalCodeSource: PostalCodeSource.MANUAL,
      },
    } as const;
    const onPlace = {
      SOURCE: {
        postalCode: '14010',
        postalCodeSource: PostalCodeSource.SOURCE,
      },
      DERIVED: {
        postalCode: '14010',
        postalCodeSource: PostalCodeSource.DERIVED,
      },
      none: { postalCode: null, postalCodeSource: null },
    } as const;

    it.each([
      ['none', 'SOURCE', SENT],
      ['none', 'DERIVED', NOTHING],
      ['none', 'none', NOTHING],
      ['DERIVED', 'SOURCE', SENT],
      ['DERIVED', 'DERIVED', NOTHING],
      ['DERIVED', 'none', NOTHING],
      ['SOURCE', 'SOURCE', NOTHING],
      ['SOURCE', 'DERIVED', NOTHING],
      ['SOURCE', 'none', NOTHING],
      ['MANUAL', 'SOURCE', NOTHING],
      ['MANUAL', 'DERIVED', NOTHING],
      ['MANUAL', 'none', NOTHING],
    ] as const)(
      'a shop with a %s code against a place with a %s code',
      (shopCode, placeCode, expected) => {
        expect(
          missingFields(place(onPlace[placeCode]), shop(onShop[shopCode]))
        ).toEqual(expected);
      }
    );

    it('states a guessed code that happens to be right, so it stops being a guess', () => {
      expect(
        missingFields(
          place(),
          shop({
            postalCode: '14010',
            postalCodeSource: PostalCodeSource.DERIVED,
          })
        )
      ).toEqual(SENT);
    });

    it('sends a code with no recorded provenance as stated, as an import does', () => {
      // A row written before the provenance column has a code and a null
      // source. `postalCodeFields` is the one door, and it reads that as the
      // source's own word.
      expect(
        missingFields(place({ postalCodeSource: null }), shop(onShop.DERIVED))
      ).toEqual(SENT);
    });
  });

  it('never writes a label, a scope or anything a person types', () => {
    const { patch } = missingFields(
      place({ footprintM2: 1200 }),
      shop({
        label: null,
        address: null,
        city: null,
        country: null,
        postalCode: null,
        postalCodeSource: null,
        latitude: null,
        longitude: null,
        externalRef: null,
        externalProvider: null,
        footprintM2: null,
      })
    );

    expect(Object.keys(patch).sort()).toEqual([
      'address',
      'city',
      'country',
      'externalProvider',
      'externalRef',
      'footprintM2',
      'latitude',
      'longitude',
      'postalCode',
      'postalCodeSource',
    ]);
  });

  it('names every field of a bare shop, in one order', () => {
    const { filled } = missingFields(
      place({ footprintM2: 1200 }),
      shop({
        address: null,
        city: null,
        country: null,
        postalCode: null,
        postalCodeSource: null,
        latitude: null,
        longitude: null,
        externalRef: null,
        externalProvider: null,
        footprintM2: null,
      })
    );

    expect(filled).toEqual([
      PlaceLinkField.COORDINATES,
      PlaceLinkField.EXTERNAL_REF,
      PlaceLinkField.POSTAL_CODE,
      PlaceLinkField.FOOTPRINT,
      PlaceLinkField.ADDRESS,
      PlaceLinkField.CITY,
      PlaceLinkField.COUNTRY,
    ]);
  });
});

describe('postalCodeFields, the only door', () => {
  it('sends nothing for a derived code', () => {
    expect(
      postalCodeFields({
        postalCode: '14010',
        postalCodeSource: PostalCodeSource.DERIVED,
      })
    ).toEqual({});
  });

  it('sends a stated code with its provenance', () => {
    expect(
      postalCodeFields({
        postalCode: '14010',
        postalCodeSource: PostalCodeSource.MANUAL,
      })
    ).toEqual({
      postalCode: '14010',
      postalCodeSource: PostalCodeSource.MANUAL,
    });
  });
});
