import {
  formatDistance,
  nearbyPickedShop,
  recentShopDay,
  type NearbyShop,
} from './nearby-shops';

const SHOP: NearbyShop = {
  id: 'loc-1',
  supermarketId: 'sm-1',
  chain: { en: 'Mercadona', es: 'Mercadona' },
  label: null,
  address: 'Calle Mayor 3',
  city: 'Córdoba',
  postalCode: '14001',
  inProfile: true,
  distanceMetres: 120,
  excluded: false,
};

/** The pieces of velista `0103` that are pure: the pick, a distance, a day. */
describe('nearby shops', () => {
  it('takes the pick the server named from the candidates, and never makes one', () => {
    expect(
      nearbyPickedShop({
        candidates: [SHOP],
        pick: { locationId: 'loc-1', distanceMetres: 120 },
        noPick: null,
      })
    ).toBe(SHOP);
    // A near, clear shop the server did not pick is not picked here either.
    expect(
      nearbyPickedShop({ candidates: [SHOP], pick: null, noPick: 'AMBIGUOUS' })
    ).toBeNull();
    // A pick that names no candidate cannot be named in the message, so no pick.
    expect(
      nearbyPickedShop({
        candidates: [SHOP],
        pick: { locationId: 'elsewhere', distanceMetres: 90 },
        noPick: null,
      })
    ).toBeNull();
  });

  it('prints a distance in metres in both languages', () => {
    expect(formatDistance(120, 'en')).toBe('120 m');
    expect(formatDistance(749.6, 'es')).toBe('750 m');
  });

  it('names a day as a word, a weekday or a date, capitalised in Spanish too', () => {
    const now = new Date(2026, 8, 24, 18, 0);

    expect(recentShopDay(new Date(2026, 8, 24, 1, 0), 'es', now)).toEqual({
      kind: 'today',
    });
    expect(recentShopDay(new Date(2026, 8, 23, 23, 0), 'es', now)).toEqual({
      kind: 'yesterday',
    });
    expect(recentShopDay(new Date(2026, 8, 22, 12, 0), 'es', now)).toEqual({
      kind: 'date',
      text: 'Martes',
    });
    expect(recentShopDay(new Date(2026, 8, 2, 12, 0), 'es', now)).toEqual({
      kind: 'date',
      text: '2 sept',
    });
  });
});
