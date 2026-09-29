import { emptyWalk } from './testing';
import type { WalkFile } from './walk-file';
import { parseWalkImport, WalkFileError, walkFileName } from './walk-import';

function codeOf(text: string): string | undefined {
  try {
    parseWalkImport(text);
    return undefined;
  } catch (e) {
    return e instanceof WalkFileError ? e.code : 'OTHER';
  }
}

const walk = emptyWalk({
  motion: [[0, 0, 0, 9.8, 0, 0, 0]],
  steps: [300, 100, 200],
});

describe('parseWalkImport', () => {
  it('reads a bare walk file, sorting a stream that is out of order', () => {
    const result = parseWalkImport(JSON.stringify(walk));
    expect(result.kind).toBe('walk');
    if (result.kind !== 'walk') return;
    expect(result.walk.streams.steps).toEqual([100, 200, 300]);
    expect(result.walk.id).toBe(walk.id);
  });

  it('replays the exported GeoJSON from its walk member', () => {
    const geo = { type: 'FeatureCollection', features: [], walk };
    const result = parseWalkImport(JSON.stringify(geo));
    expect(result.kind).toBe('walk');
  });

  it('ignores fields it does not know, and defaults marks and events', () => {
    const extra = { ...walk, future: { x: 1 } } as Record<string, unknown>;
    delete extra['marks'];
    delete extra['events'];
    const result = parseWalkImport(JSON.stringify(extra));
    if (result.kind !== 'walk') throw new Error('not a walk');
    expect(result.walk.marks).toEqual([]);
    expect(result.walk.events).toEqual([]);
  });

  it('drops a mark taken back by a mark-deleted event, and keeps the event', () => {
    const marked: WalkFile = {
      ...walk,
      marks: [
        { t: 1000, kind: 'entrance' },
        { t: 2500.5, kind: 'checkpoint', label: 'door' },
        { t: 4000, kind: 'checkpoint', label: 'fish' },
      ],
      events: [
        { t: 3000, kind: 'hidden' },
        { t: 4100, kind: 'mark-deleted', detail: '4000' },
        { t: 4200, kind: 'mark-deleted', detail: '2500.5' },
        { t: 4300, kind: 'mark-deleted', detail: '9999' },
        { t: 4400, kind: 'mark-deleted', detail: 'nonsense' },
      ],
    };
    const result = parseWalkImport(JSON.stringify(marked));
    if (result.kind !== 'walk') throw new Error('not a walk');
    expect(result.walk.marks).toEqual([{ t: 1000, kind: 'entrance' }]);
    expect(result.walk.events).toEqual(marked.events);
  });

  it('drops only the last of two marks at the same t for one event', () => {
    const twice: WalkFile = {
      ...walk,
      marks: [
        { t: 1000, kind: 'checkpoint', label: 'first' },
        { t: 1000, kind: 'checkpoint', label: 'second' },
      ],
      events: [{ t: 1100, kind: 'mark-deleted', detail: '1000' }],
    };
    const result = parseWalkImport(JSON.stringify(twice));
    if (result.kind !== 'walk') throw new Error('not a walk');
    expect(result.walk.marks.map((m) => m.label)).toEqual(['first']);
  });

  it('draws a plain GeoJSON as tracks in metres, with no replay', () => {
    const k = 111320 * Math.cos((40 * Math.PI) / 180);
    const geo = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [-3, 40],
              [-3, 40 + 10 / 111320],
              [-3 + 4 / k, 40 + 10 / 111320],
            ],
          },
          properties: { mode: 'pdr:own:gyro:snap', steps: 20, turns: 1 },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-3, 40] },
          properties: {},
        },
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[-3, 40]] },
        },
      ],
    };
    const result = parseWalkImport(JSON.stringify(geo));
    if (result.kind !== 'tracks') throw new Error('not tracks');
    expect(result.tracks).toHaveLength(2);
    const [a, b] = result.tracks;
    expect(a.mode).toBe('pdr:own:gyro:snap');
    expect(a.steps).toBe(20);
    expect(a.points[1].y).toBeCloseTo(10, 6);
    expect(a.points[2].x).toBeCloseTo(4, 6);
    expect(a.distanceMetres).toBeCloseTo(14, 6);
    expect(b.mode).toBe('line-2');
  });

  it.each<[string, string, string]>([
    ['not JSON', '{nope', 'NOT_JSON'],
    ['an array', '[]', 'UNKNOWN_FORMAT'],
    ['an object of another kind', '{"hello":1}', 'UNKNOWN_FORMAT'],
    [
      'another format',
      JSON.stringify({ ...walk, format: 'gpx' }),
      'UNKNOWN_FORMAT',
    ],
    [
      'version 2',
      JSON.stringify({ ...walk, version: 2 }),
      'UNSUPPORTED_VERSION',
    ],
    [
      'version 2 inside GeoJSON',
      JSON.stringify({
        type: 'FeatureCollection',
        features: [],
        walk: { ...walk, version: 2 },
      }),
      'UNSUPPORTED_VERSION',
    ],
    ['no id', JSON.stringify({ ...walk, id: 1 }), 'INVALID'],
    [
      'a short motion row',
      JSON.stringify({ ...walk, streams: { motion: [[0, 1, 2]] } }),
      'INVALID',
    ],
    [
      'a string in a row',
      JSON.stringify({ ...walk, streams: { steps: ['1'] } }),
      'INVALID',
    ],
    [
      'an unknown mark',
      JSON.stringify({ ...walk, marks: [{ t: 0, kind: 'scan' }] }),
      'INVALID',
    ],
    [
      'a GeoJSON with no LineString',
      JSON.stringify({ type: 'FeatureCollection', features: [] }),
      'INVALID',
    ],
  ])('refuses %s with %s', (_label, text, code) => {
    expect(codeOf(text)).toBe(code);
  });
});

describe('walkFileName', () => {
  const named = (name: string | undefined, startedAt: string): WalkFile => ({
    ...walk,
    name,
    startedAt,
  });
  it.each([
    [
      'Mercadona Plaza Mayor',
      '2026-09-28T10:05:00+02:00',
      'walk-20260928-1005-mercadona-plaza-mayor.geojson',
    ],
    [
      '  Día / Señor  ',
      '2026-09-28T23:59:59.123-05:00',
      'walk-20260928-2359-dia-senor.geojson',
    ],
    [undefined, '2026-09-28T08:00:00Z', 'walk-20260928-0800.geojson'],
    ['!!!', '2026-09-28T08:00:00Z', 'walk-20260928-0800.geojson'],
  ])('%s at %s is %s', (name, startedAt, file) => {
    expect(walkFileName(named(name, startedAt))).toBe(file);
  });
});
