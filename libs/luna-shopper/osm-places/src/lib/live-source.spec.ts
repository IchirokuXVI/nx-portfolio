import { OsmPlacesClient } from './osm-places.client';

/**
 * The one opt in live test (plan 0038, section 9). Never runs in CI: Nominatim
 * and Overpass are volunteer funded, and every other test here is offline.
 *
 *   LUNA_LIVE_SOURCE_TEST=1 npx nx test luna-shopper/osm-places
 *
 * It asserts only that the shape still holds. Not the count: OSM is edited by
 * people, so the number of supermarkets near a point changes legitimately, and a
 * test that fails on that gets disabled.
 */
const live = process.env['LUNA_LIVE_SOURCE_TEST'] === '1' ? describe : describe.skip;

const USER_AGENT =
  'LunaShopper/0.1 (+https://velista.app; personal price comparison; contact@velista.app)';

live('OpenStreetMap, live', () => {
  jest.setTimeout(90_000);

  it('still geocodes a postal code to a point, and still finds shops near it', async () => {
    const client = new OsmPlacesClient({ userAgent: USER_AGENT });

    const centre = await client.geocodePostalCode('14013', 'es');
    if (!centre) {
      throw new Error('Nominatim found no point for 14013; the shape changed.');
    }
    expect(typeof centre.lat).toBe('number');
    expect(typeof centre.lon).toBe('number');

    const places = await client.findSupermarkets(centre, 3000);
    expect(places.length).toBeGreaterThan(0);

    // Every element has a position: that was 100% of the 353 element sample, and
    // it is the assumption the whole radius design rests on.
    for (const place of places) {
      expect(Number.isFinite(place.latitude)).toBe(true);
      expect(Number.isFinite(place.longitude)).toBe(true);
      expect(place.externalRef).toMatch(/^(node|way|relation)\/\d+$/);
      expect(place.tags['shop']).toBe('supermarket');
    }

    // At least one carries the tag the whole chain identity rests on.
    expect(places.some((p) => p.brandKey !== null)).toBe(true);
  });
});
