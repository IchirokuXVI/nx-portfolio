import { METRES_PER_DEGREE, pathLength } from './geometry';
import type { Track, TrackPoint } from './track-types';
import type { StreamName, WalkFile, WalkMark } from './walk-file';

export type WalkFileErrorCode =
  | 'NOT_JSON'
  | 'UNKNOWN_FORMAT'
  | 'UNSUPPORTED_VERSION'
  | 'INVALID';

export class WalkFileError extends Error {
  constructor(
    public readonly code: WalkFileErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'WalkFileError';
  }
}

export type WalkImport =
  | { kind: 'walk'; walk: WalkFile }
  | { kind: 'tracks'; tracks: Track[] };

/** The least number of values in a row of each stream, `t` included. */
const ROW_WIDTH: Record<Exclude<StreamName, 'steps'>, number> = {
  motion: 7,
  game: 5,
  absolute: 5,
  magnetic: 4,
  location: 4,
  pose: 8,
  pressure: 2,
};

const MARK_KINDS: readonly WalkMark['kind'][] = [
  'entrance',
  'checkout',
  'checkpoint',
  'note',
];

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function invalid(message: string): never {
  throw new WalkFileError('INVALID', message);
}

function rowTime(row: number[] | number): number {
  return typeof row === 'number' ? row : row[0];
}

/** Stable sort by `t`, only when a stream is out of order. */
function sortedByTime<T extends number[] | number>(rows: T[]): T[] {
  for (let i = 1; i < rows.length; i++) {
    if (rowTime(rows[i]) < rowTime(rows[i - 1])) {
      return rows
        .map((row, index) => ({ row, index }))
        .sort((a, b) => rowTime(a.row) - rowTime(b.row) || a.index - b.index)
        .map((e) => e.row);
    }
  }
  return rows;
}

/** The event that takes back a mark already saved (velista plan 0127). */
export const MARK_DELETED = 'mark-deleted';

/**
 * The marks left once every `mark-deleted` event is applied.
 *
 * A recording that saves as it goes cannot take a saved mark out again, so it writes
 * `{ kind: 'mark-deleted', detail: <the mark's t> }` instead. Events are applied in
 * the order they are listed, and each one removes the last mark still standing whose
 * `t` is the detail read as a number. An event that matches no mark removes nothing.
 * The order of the marks that are left is kept.
 */
export function withoutDeletedMarks(
  marks: readonly WalkMark[],
  events: WalkFile['events']
): WalkMark[] {
  const left = [...marks];
  for (const event of events) {
    if (event.kind !== MARK_DELETED || event.detail === undefined) continue;
    const t = Number(event.detail);
    if (!Number.isFinite(t)) continue;
    for (let i = left.length - 1; i >= 0; i--) {
      if (left[i].t === t) {
        left.splice(i, 1);
        break;
      }
    }
  }
  return left;
}

/**
 * Checks a parsed walk file and answers it. Refuses a `format` other than
 * `shop-walk` and a `version` other than 1; ignores fields it does not know.
 * `marks` and `events` default to empty lists. A stream whose rows are out of
 * `t` order is stably sorted by `t`, and a mark taken back by a `mark-deleted`
 * event is dropped (`withoutDeletedMarks`); those are the only changes a read
 * makes. The events are kept as they are.
 */
export function readWalkFile(value: unknown): WalkFile {
  if (!isObject(value)) invalid('A walk file is a JSON object');
  if (value['format'] !== 'shop-walk') {
    throw new WalkFileError(
      'UNKNOWN_FORMAT',
      `Not a shop walk file (format ${JSON.stringify(value['format'])})`
    );
  }
  if (value['version'] !== 1) {
    throw new WalkFileError(
      'UNSUPPORTED_VERSION',
      `Walk file version ${JSON.stringify(value['version'])} is not supported`
    );
  }
  if (typeof value['id'] !== 'string') invalid('id must be a string');
  if (typeof value['startedAt'] !== 'string') {
    invalid('startedAt must be a string');
  }
  if (!isNumber(value['durationMs'])) invalid('durationMs must be a number');
  const source = value['source'];
  if (
    !isObject(source) ||
    (source['platform'] !== 'web' && source['platform'] !== 'android') ||
    typeof source['app'] !== 'string' ||
    typeof source['appVersion'] !== 'string'
  ) {
    invalid('source must name a platform, an app and its version');
  }
  const settings = value['settings'];
  if (
    !isObject(settings) ||
    !isNumber(settings['stepMetres']) ||
    !isNumber(settings['cellMetres'])
  ) {
    invalid('settings must carry stepMetres and cellMetres');
  }
  const origin = value['origin'];
  if (
    origin !== undefined &&
    (!isObject(origin) ||
      !isNumber(origin['lat']) ||
      !isNumber(origin['lon']) ||
      !isNumber(origin['accuracyMetres']))
  ) {
    invalid('origin must carry lat, lon and accuracyMetres');
  }
  const rawStreams = value['streams'];
  if (!isObject(rawStreams)) invalid('streams must be an object');
  const streams: WalkFile['streams'] = {};
  for (const [name, width] of Object.entries(ROW_WIDTH) as [
    Exclude<StreamName, 'steps'>,
    number,
  ][]) {
    const rows = rawStreams[name];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) invalid(`streams.${name} must be an array`);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (
        !Array.isArray(row) ||
        row.length < width ||
        !row.every((v) => isNumber(v))
      ) {
        invalid(`streams.${name}[${i}] must be ${width} numbers`);
      }
    }
    streams[name] = sortedByTime(rows as number[][]);
  }
  const steps = rawStreams['steps'];
  if (steps !== undefined) {
    if (!Array.isArray(steps) || !steps.every((v) => isNumber(v))) {
      invalid('streams.steps must be an array of numbers');
    }
    streams.steps = sortedByTime(steps as number[]);
  }
  const marks = value['marks'] ?? [];
  if (!Array.isArray(marks)) invalid('marks must be an array');
  marks.forEach((m, i) => {
    if (
      !isObject(m) ||
      !isNumber(m['t']) ||
      !MARK_KINDS.includes(m['kind'] as WalkMark['kind']) ||
      (m['label'] !== undefined && typeof m['label'] !== 'string')
    ) {
      invalid(`marks[${i}] is not a mark`);
    }
  });
  const events = value['events'] ?? [];
  if (!Array.isArray(events)) invalid('events must be an array');
  return {
    ...(value as unknown as WalkFile),
    streams,
    marks: withoutDeletedMarks(
      marks as WalkMark[],
      events as WalkFile['events']
    ),
    events: events as WalkFile['events'],
  };
}

function lineStrings(
  collection: Json
): { mode: string; props: Json; coords: [number, number][] }[] {
  const features = collection['features'];
  if (!Array.isArray(features)) invalid('features must be an array');
  const lines: { mode: string; props: Json; coords: [number, number][] }[] = [];
  features.forEach((f, i) => {
    if (!isObject(f) || !isObject(f['geometry'])) return;
    const g = f['geometry'];
    if (g['type'] !== 'LineString') return;
    const coords = g['coordinates'];
    if (
      !Array.isArray(coords) ||
      !coords.every(
        (c) =>
          Array.isArray(c) && c.length >= 2 && isNumber(c[0]) && isNumber(c[1])
      )
    ) {
      invalid(`features[${i}] has invalid coordinates`);
    }
    const props = isObject(f['properties']) ? f['properties'] : {};
    const mode =
      typeof props['mode'] === 'string'
        ? props['mode']
        : `line-${lines.length + 1}`;
    lines.push({ mode, props, coords: coords as [number, number][] });
  });
  return lines;
}

/**
 * A plain GeoJSON's `LineString`s as tracks, drawn as they are: metres
 * around the first coordinate of the first line (equirectangular), +y north,
 * `t` the point's index, not aligned, one segment of confidence 1.
 */
function tracksFromGeoJson(collection: Json): Track[] {
  const lines = lineStrings(collection);
  if (lines.length === 0) invalid('The GeoJSON holds no LineString');
  const ref = lines.find((l) => l.coords.length > 0)?.coords[0] ?? [0, 0];
  const [lon0, lat0] = ref;
  const kx = METRES_PER_DEGREE * Math.cos((lat0 * Math.PI) / 180);
  return lines.map(({ mode, props, coords }) => {
    const points: TrackPoint[] = coords.map(([lon, lat], i) => ({
      t: i,
      x: (lon - lon0) * kx,
      y: (lat - lat0) * METRES_PER_DEGREE,
    }));
    return {
      mode,
      points,
      steps: isNumber(props['steps']) ? props['steps'] : 0,
      turns: isNumber(props['turns']) ? props['turns'] : 0,
      distanceMetres: pathLength(points),
      rotation: 0,
      segments: [
        {
          fromIndex: 0,
          toIndex: Math.max(0, points.length - 1),
          confidence: 1,
        },
      ],
    };
  });
}

/**
 * Section 3 import: the exported GeoJSON (replayed from its `walk` member), a
 * bare walk file, or a plain GeoJSON `FeatureCollection` whose `LineString`s
 * are drawn with no replay. Throws `WalkFileError`.
 */
export function parseWalkImport(text: string): WalkImport {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new WalkFileError('NOT_JSON', 'The file is not JSON');
  }
  if (!isObject(value)) {
    throw new WalkFileError('UNKNOWN_FORMAT', 'The file is not a JSON object');
  }
  if (value['type'] === 'FeatureCollection') {
    if (value['walk'] !== undefined) {
      return { kind: 'walk', walk: readWalkFile(value['walk']) };
    }
    return { kind: 'tracks', tracks: tracksFromGeoJson(value) };
  }
  if (value['format'] !== undefined) {
    return { kind: 'walk', walk: readWalkFile(value) };
  }
  throw new WalkFileError(
    'UNKNOWN_FORMAT',
    'Neither a walk file nor a GeoJSON FeatureCollection'
  );
}

function kebab(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * `walk-<YYYYMMDD>-<HHmm>-<name in kebab case>.geojson`, section 3. The date
 * and time are the local ones written in `startedAt` (its offset is not
 * applied). No name, or a name with no letter or digit, drops that part.
 */
export function walkFileName(walk: WalkFile): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(walk.startedAt);
  const stamp = m ? `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}` : '00000000-0000';
  const name = walk.name ? kebab(walk.name) : '';
  return `walk-${stamp}${name ? `-${name}` : ''}.geojson`;
}
