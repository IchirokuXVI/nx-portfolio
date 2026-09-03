import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { metresBetween, nearby, placeLines } from './place-view';

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
