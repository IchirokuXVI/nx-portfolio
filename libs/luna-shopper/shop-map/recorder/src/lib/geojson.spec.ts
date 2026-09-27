import { projectPoint, walkToGeoJson } from './geojson';
import { emptyWalk } from './testing';
import type { Track } from './track-types';

const track = (mode: string, bearing?: number): Track => ({
  mode,
  points: [
    { t: 0, x: 0, y: 0 },
    { t: 1000, x: 0, y: 10 },
  ],
  steps: 14,
  turns: 0,
  distanceMetres: 10.004,
  rotation: 0,
  ...(bearing !== undefined ? { bearing } : {}),
  segments: [{ fromIndex: 0, toIndex: 1, confidence: 1 }],
});

interface Geo {
  type: string;
  localFrame: boolean;
  bearing: number;
  features: {
    geometry: { type: string; coordinates: unknown };
    properties: Record<string, unknown>;
  }[];
  walk: unknown;
}

describe('projectPoint', () => {
  it.each([
    [0, { x: 0, y: 10 }, [0, 10]], // +y is north
    [90, { x: 0, y: 10 }, [10, 0]], // +y is east
    [90, { x: 10, y: 0 }, [0, -10]], // +x is south
    [
      212.5,
      { x: 0, y: 10 },
      [
        10 * Math.sin((212.5 * Math.PI) / 180),
        10 * Math.cos((212.5 * Math.PI) / 180),
      ],
    ],
  ])('bearing %f turns %j into east, north %j', (bearing, p, [east, north]) => {
    const origin = { lat: 40, lon: -3 };
    const [lon, lat] = projectPoint(p, bearing, origin);
    expect((lat - 40) * 111320).toBeCloseTo(north, 1);
    expect((lon + 3) * 111320 * Math.cos((40 * Math.PI) / 180)).toBeCloseTo(
      east,
      1
    );
  });
});

describe('walkToGeoJson', () => {
  it('writes one LineString per track, one Point per mark, and the walk', () => {
    const walk = emptyWalk();
    walk.origin = { lat: 40, lon: -3, accuracyMetres: 12 };
    walk.marks = [
      { t: 0, kind: 'checkpoint', label: 'door' },
      { t: 5000, kind: 'checkout' },
    ];
    const geo = walkToGeoJson(
      walk,
      [track('pdr:own:gyro:snap'), track('pdr:own:absolute', 90)],
      'pdr:own:gyro:snap'
    ) as Geo;
    expect(geo.type).toBe('FeatureCollection');
    expect(geo.localFrame).toBe(false);
    expect(geo.bearing).toBe(90);
    expect(geo.walk).toBe(walk);
    expect(geo.features.map((f) => f.geometry.type)).toEqual([
      'LineString',
      'LineString',
      'Point',
      'Point',
    ]);
    expect(geo.features[0].properties).toEqual({
      mode: 'pdr:own:gyro:snap',
      steps: 14,
      turns: 0,
      distanceMetres: 10,
    });
    expect(geo.features[2].properties).toEqual({
      mark: 'checkpoint',
      label: 'door',
      t: 0,
      mode: 'pdr:own:gyro:snap',
    });
    // The checkout at t 5000 sits on the selected track's last point, 10 m
    // along +y, which the bearing turns east.
    const [lon, lat] = geo.features[3].geometry.coordinates as number[];
    expect(lat).toBeCloseTo(40, 6);
    expect(lon).toBeGreaterThan(-3);
  });

  it('starts at 0,0 in a local frame with bearing 0 when nothing knows it', () => {
    const geo = walkToGeoJson(
      emptyWalk(),
      [track('pdr:own:gyro')],
      'pdr:own:gyro'
    ) as Geo;
    expect(geo.localFrame).toBe(true);
    expect(geo.bearing).toBe(0);
    expect((geo.features[0].geometry.coordinates as number[][])[0]).toEqual([
      0, 0,
    ]);
  });
});
