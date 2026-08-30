import nominatim from './__fixtures__/nominatim-14013.json';
import overpass from './__fixtures__/overpass-supermarkets.json';
import {
  distanceMetres,
  groupByBrand,
  normalizeGeocode,
  normalizeOverpassResponse,
} from './normalize';

describe('normalizeOverpassResponse', () => {
  const places = normalizeOverpassResponse(overpass);

  it('reads a node position directly', () => {
    expect(places[0]).toEqual({
      provider: 'OSM',
      externalRef: 'node/1156230891',
      brandKey: 'Q377705',
      brandName: 'Mercadona',
      name: 'Mercadona',
      latitude: 37.8901234,
      longitude: -4.7756789,
      street: 'Avenida del Aeropuerto 22',
      city: 'Córdoba',
      postalCode: '14004',
      website: 'https://www.mercadona.es/',
      openingHours: 'Mo-Sa 09:00-21:30',
      tags: expect.objectContaining({ shop: 'supermarket' }),
    });
  });

  it('resolves a way through its centre, since a way has no position', () => {
    const way = places.find((p) => p.externalRef.startsWith('way/'));
    expect(way).toMatchObject({
      externalRef: 'way/442100731',
      latitude: 37.8812345,
      longitude: -4.7801234,
    });
  });

  it('drops an element with no resolvable position rather than storing 0,0', () => {
    expect(places.some((p) => p.externalRef.startsWith('relation/'))).toBe(
      false
    );
    expect(places).toHaveLength(5);
  });

  it('keeps the tag bag whole, so provenance survives (section 8.2)', () => {
    const way = places.find((p) => p.externalRef === 'way/442100731');
    // `building=retail` is nothing this app reads, and it is kept anyway.
    expect(way?.tags['building']).toBe('retail');
  });

  it('reads a missing address as null, not as an empty string', () => {
    const independent = places.find((p) => p.name === 'Supermercado La Plaza');
    expect(independent).toMatchObject({
      brandKey: null,
      brandName: null,
      street: null,
      city: null,
      postalCode: null,
      website: null,
    });
  });
});

describe('groupByBrand', () => {
  const places = normalizeOverpassResponse(overpass);
  const groups = groupByBrand(places);

  it('collapses Dia and Maxi Dia into one chain by brand:wikidata', () => {
    // Matching on the NAME would split one chain into two, which is the whole
    // reason the QID is the identity (section 2.7).
    const dia = groups.get('Q925132');
    expect(dia).toHaveLength(2);
    expect(dia?.map((p) => p.brandName)).toEqual(['Dia', 'Maxi Dia']);
  });

  it('groups the two Mercadonas, node and way alike', () => {
    expect(groups.get('Q377705')).toHaveLength(2);
  });

  it('keeps independent shops as a real group under no brand', () => {
    // "No implementation is a real state": these get a Supermarket row with
    // manual prices and no source.
    expect(groups.get(null)).toHaveLength(1);
  });
});

describe('normalizeGeocode', () => {
  it('reduces the postal code answer to a centre point', () => {
    expect(normalizeGeocode(nominatim)).toEqual({
      lat: 37.8587,
      lon: -4.7863,
    });
  });

  it('ignores the bounding box, which spans most of the city (section 2.8)', () => {
    // The box is in the fixture on purpose. Querying it returns 75 elements and
    // 12 Mercadonas, none of which is actually in 14013.
    expect(normalizeGeocode(nominatim)).not.toHaveProperty('boundingbox');
  });

  it('answers null when nothing matched, rather than inventing a point', () => {
    expect(normalizeGeocode([])).toBeNull();
    expect(normalizeGeocode(null)).toBeNull();
  });
});

describe('distanceMetres', () => {
  it('measures the fallback radius re-discovery uses (section 5.5)', () => {
    // Roughly 50 m north at this latitude.
    const a = { lat: 37.8901234, lon: -4.7756789 };
    const b = { lat: 37.8905732, lon: -4.7756789 };
    expect(distanceMetres(a, b)).toBeGreaterThan(45);
    expect(distanceMetres(a, b)).toBeLessThan(55);
  });

  it('is zero for the same point', () => {
    const a = { lat: 37.8587, lon: -4.7863 };
    expect(distanceMetres(a, a)).toBe(0);
  });
});
