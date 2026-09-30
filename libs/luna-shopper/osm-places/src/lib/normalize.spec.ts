import nominatim from './__fixtures__/nominatim-14013.json';
import multipolygon from './__fixtures__/overpass-multipolygon.json';
import overpass from './__fixtures__/overpass-supermarkets.json';
import {
  distanceMetres,
  groupByBrand,
  normalizeElement,
  normalizeGeocode,
  normalizeOverpassResponse,
} from './normalize';

describe('normalizeOverpassResponse', () => {
  const places = normalizeOverpassResponse(overpass);

  it('reads a node position directly, and gives a node no size', () => {
    expect(places[0]).toEqual({
      provider: 'OSM',
      externalRef: 'node/1156230891',
      brandKey: 'Q377705',
      brandName: 'Mercadona',
      name: 'Mercadona',
      latitude: 37.884755,
      longitude: -4.7915435,
      footprintM2: null,
      street: null,
      city: null,
      postalCode: null,
      website: 'https://www.mercadona.es',
      openingHours: null,
      tags: expect.objectContaining({ shop: 'supermarket' }),
    });
  });

  it('puts a way at the middle of its bounds, where out center put it', () => {
    const way = places.find((p) => p.externalRef === 'way/533825505');
    // bounds 37.8771879..37.8777991 by -4.8020443..-4.8010828
    expect(way?.latitude).toBeCloseTo(37.8774935, 7);
    expect(way?.longitude).toBeCloseTo(-4.80156355, 7);
  });

  it('keeps every place of the capture, nodes and ways alike', () => {
    expect(places).toHaveLength(26);
    expect(places.filter((p) => p.externalRef.startsWith('way/'))).toHaveLength(
      3
    );
  });

  it('keeps the tag bag whole, so provenance survives (section 8.2)', () => {
    const way = places.find((p) => p.externalRef === 'way/533825505');
    // `building=yes` and `phone` are nothing this app reads, and they are kept.
    expect(way?.tags['building']).toBe('yes');
    expect(way?.tags['phone']).toBe('+34 957 73 18 29');
  });

  it('keeps no outline, only the number', () => {
    const way = places.find((p) => p.externalRef === 'way/533825505');
    expect(Object.keys(way ?? {})).not.toContain('geometry');
    expect(Object.keys(way ?? {})).not.toContain('bounds');
  });

  it('reads a missing address as null, not as an empty string', () => {
    const independent = places.find((p) => p.name === 'Piedra');
    expect(independent).toMatchObject({
      brandKey: null,
      brandName: null,
      street: null,
      city: null,
      postalCode: null,
      website: null,
      openingHours: 'Mo-Sa 09:00-21:00',
    });
  });
});

/**
 * The footprint of a shop mapped as an outline (backend plan 0176).
 *
 * The reference numbers are the area iD's measurement panel shows for each
 * outline: d3's spherical `geoArea` scaled to the Earth's surface. They were
 * worked out once from the same captured points with the spherical formula
 * iD uses, which shares no code with the planar one under test.
 */
describe('footprintM2', () => {
  const places = normalizeOverpassResponse(overpass);
  const footprint = (ref: string) =>
    places.find((p) => p.externalRef === ref)?.footprintM2;

  it('measures a mapped building within 5 percent of what iD shows', () => {
    // The Mercadona on Calle Escritor Conde de Zamora: iD shows 3,002 m².
    const area = footprint('way/533825505') ?? 0;
    expect(Math.abs(area - 3002) / 3002).toBeLessThan(0.05);
  });

  it('rounds to whole square metres', () => {
    expect(footprint('way/533825505')).toBe(3002);
    expect(footprint('way/379954498')).toBe(1868);
    expect(footprint('way/593426260')).toBe(3150);
  });

  it('gives every node no size, a shop inside a larger building included', () => {
    const nodes = places.filter((p) => p.externalRef.startsWith('node/'));
    expect(nodes).toHaveLength(23);
    expect(nodes.every((p) => p.footprintM2 === null)).toBe(true);
  });

  it('joins a multipolygon ring drawn as two ways before measuring it', () => {
    // relation/3013098, the Dia at Leganés: one outer ring split across two
    // member ways. iD shows 1,151 m².
    const [dia] = normalizeOverpassResponse(multipolygon);
    expect(dia.externalRef).toBe('relation/3013098');
    expect(Math.abs((dia.footprintM2 ?? 0) - 1151) / 1151).toBeLessThan(0.05);
    // A relation is placed at the middle of its bounds, like a way.
    expect(dia.latitude).toBeCloseTo((40.3418323 + 40.3423703) / 2, 7);
  });

  /** A square of about 100 m a side at Córdoba's latitude, as a closed ring. */
  function square(lat: number, lon: number, sideDeg: number) {
    return [
      { lat, lon },
      { lat, lon: lon + sideDeg },
      { lat: lat + sideDeg, lon: lon + sideDeg },
      { lat: lat + sideDeg, lon },
      { lat, lon },
    ];
  }

  it('subtracts an inner ring from the outer one', () => {
    const outer = square(37.88, -4.8, 0.001);
    const inner = square(37.8803, -4.7997, 0.0004);
    const withHole = normalizeElement({
      type: 'relation',
      id: 1,
      bounds: { minlat: 37.88, minlon: -4.8, maxlat: 37.881, maxlon: -4.799 },
      members: [
        { type: 'way', ref: 10, role: 'outer', geometry: outer },
        { type: 'way', ref: 11, role: 'inner', geometry: inner },
      ],
      tags: { shop: 'supermarket', type: 'multipolygon' },
    });
    const solid = normalizeElement({
      type: 'way',
      id: 2,
      geometry: outer,
      tags: { shop: 'supermarket' },
    });
    const hole = normalizeElement({
      type: 'way',
      id: 3,
      geometry: inner,
      tags: { shop: 'supermarket' },
    });
    expect(withHole?.footprintM2).toBe(
      (solid?.footprintM2 ?? 0) - (hole?.footprintM2 ?? 0)
    );
  });

  /** A relation around the square at 37.88, -4.8, with the given members. */
  function relation(tags: Record<string, string>, members: unknown[]) {
    return normalizeElement({
      type: 'relation',
      id: 20,
      bounds: { minlat: 37.88, minlon: -4.8, maxlat: 37.881, maxlon: -4.799 },
      members,
      tags: { shop: 'supermarket', ...tags },
    });
  }

  function wayMember(ref: number, role: string, geometry: unknown[]) {
    return { type: 'way', ref, role, geometry };
  }

  it('gives a site relation no size, since its members are not one outline', () => {
    // A building and its car park grouped as a site, with empty roles.
    const place = relation({ type: 'site' }, [
      wayMember(30, '', square(37.88, -4.8, 0.001)),
      wayMember(31, '', square(37.8812, -4.8, 0.0008)),
    ]);
    expect(place).not.toBeNull();
    expect(place?.footprintM2).toBeNull();
  });

  it('gives a building relation no size, since its parts repeat its outline', () => {
    const place = relation({ type: 'building' }, [
      wayMember(32, 'outline', square(37.88, -4.8, 0.001)),
      wayMember(33, 'part', square(37.88, -4.8, 0.0005)),
      wayMember(34, 'part', square(37.8805, -4.7995, 0.0005)),
    ]);
    expect(place).not.toBeNull();
    expect(place?.footprintM2).toBeNull();
  });

  it('gives a multipolygon no size when any of its rings does not close', () => {
    const outer = square(37.88, -4.8, 0.001);
    const openInner = square(37.8803, -4.7997, 0.0004).slice(0, 4);
    expect(
      relation({ type: 'multipolygon' }, [
        wayMember(40, 'outer', outer),
        wayMember(41, 'inner', openInner),
      ])?.footprintM2
    ).toBeNull();
    expect(
      relation({ type: 'multipolygon' }, [
        wayMember(42, 'outer', outer),
        wayMember(43, 'outer', square(37.882, -4.8, 0.0005).slice(0, 4)),
      ])?.footprintM2
    ).toBeNull();
  });

  describe('a ring split across member ways', () => {
    const [p0, p1, p2, p3] = square(37.88, -4.8, 0.001);
    const a = [p0, p1];
    const b = [p1, p2];
    const c = [p2, p3, p0];
    const rev = (way: typeof a) => [...way].reverse();
    const whole = normalizeElement({
      type: 'way',
      id: 50,
      geometry: [p0, p1, p2, p3, p0],
      tags: { shop: 'supermarket' },
    })?.footprintM2;
    const measure = (ways: (typeof a)[]) =>
      relation(
        { type: 'multipolygon' },
        ways.map((way, i) => wayMember(60 + i, 'outer', way))
      )?.footprintM2;

    it.each([
      ['forward', [a, b, c]],
      ['with later ways reversed', [a, rev(b), rev(c)]],
      ['with the first way reversed', [rev(a), b, c]],
      ['shuffled', [b, a, rev(c)]],
      ['shuffled, joining at the start', [b, rev(a), rev(c)]],
    ])('gives the unsplit area when given %s', (_, ways) => {
      expect(whole).toBeGreaterThan(0);
      expect(measure(ways)).toBe(whole);
    });

    it('gives no size when a piece is missing and the ring has a gap', () => {
      expect(measure([a, c])).toBeNull();
    });
  });

  it('gives an outline that does not close no size, and still places it', () => {
    const open = square(37.88, -4.8, 0.001).slice(0, 4);
    const place = normalizeElement({
      type: 'way',
      id: 4,
      geometry: open,
      tags: { shop: 'supermarket' },
    });
    expect(place?.footprintM2).toBeNull();
    // No bounds, so the centre is the mean of the points it has.
    expect(place?.latitude).toBeCloseTo(37.8805, 7);
  });

  it('drops a relation with no resolvable position rather than storing 0,0', () => {
    expect(
      normalizeElement({ type: 'relation', id: 88123, tags: { shop: 'x' } })
    ).toBeNull();
  });

  it('still reads a way answered in the old out center shape', () => {
    const place = normalizeElement({
      type: 'way',
      id: 5,
      center: { lat: 37.8812345, lon: -4.7801234 },
      tags: { shop: 'supermarket' },
    });
    expect(place).toMatchObject({
      latitude: 37.8812345,
      longitude: -4.7801234,
      footprintM2: null,
    });
  });
});

describe('groupByBrand', () => {
  const places = normalizeOverpassResponse(overpass);
  const groups = groupByBrand(places);

  it('collapses ALDI and Aldi into one chain by brand:wikidata', () => {
    // Matching on the NAME would split one chain into two, which is the whole
    // reason the QID is the identity (section 2.7).
    const aldi = groups.get('Q41171373');
    expect(aldi).toHaveLength(3);
    expect(new Set(aldi?.map((p) => p.brandName))).toEqual(
      new Set(['ALDI', 'Aldi'])
    );
  });

  it('groups the three Mercadonas, nodes and a way alike', () => {
    expect(groups.get('Q377705')).toHaveLength(3);
  });

  it('keeps independent shops as a real group under no brand', () => {
    // "No implementation is a real state": these get a Supermarket row with
    // manual prices and no source.
    expect(groups.get(null)).toHaveLength(10);
  });
});

describe('normalizeGeocode', () => {
  it('reduces the postal code answer to a centre point and its name', () => {
    expect(normalizeGeocode(nominatim)).toEqual({
      lat: 37.8589573,
      lon: -4.7860875,
      displayName: '14013, Distrito Sur, Córdoba, Andalucía, España',
    });
  });

  /**
   * The name is kept where the bounding box is discarded, because the two are
   * not alike (plan 0097, section 4): the box is a wrong search area, and the
   * name is the only name this system will ever have for a postal code.
   */
  it('answers a null name when the provider sent none', () => {
    expect(normalizeGeocode([{ lat: '37.8', lon: '-4.7' }])).toEqual({
      lat: 37.8,
      lon: -4.7,
      displayName: null,
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
