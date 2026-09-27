import { computeTrack } from './engine';
import { METRES_PER_DEGREE } from './geometry';
import { positionAt } from './metrics';
import { availableModes } from './modes';
import type { ModeId, Track, TrackPoint } from './track-types';
import type { WalkFile } from './walk-file';

/** The modes whose bearing places the file in the world, in order (section 3). */
export const BEARING_MODES: readonly ModeId[] = ['pdr:own:absolute', 'gps'];

/**
 * The aligned +y direction in degrees clockwise from north: the bearing of
 * the first of `pdr:own:absolute`, `gps` the file can compute, taken from the
 * tracks given when one of them is that mode, else computed with the default
 * options. 0 when neither can be computed.
 */
export function walkBearing(walk: WalkFile, tracks: Track[]): number {
  const available = availableModes(walk);
  for (const mode of BEARING_MODES) {
    const given = tracks.find((t) => t.mode === mode);
    if (given?.bearing !== undefined) return given.bearing;
    if (available.includes(mode)) {
      const b = computeTrack(walk, mode).bearing;
      if (b !== undefined) return b;
    }
  }
  return 0;
}

function round7(v: number): number {
  return Math.round(v * 1e7) / 1e7;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Section 3: a local point, rotated by `bearing` into east and north and
 * placed at the origin with an equirectangular projection. Without an origin
 * the projection is centred on `[0, 0]`.
 */
export function projectPoint(
  p: { x: number; y: number },
  bearingDegrees: number,
  origin: { lat: number; lon: number } | undefined
): [number, number] {
  const b = (bearingDegrees * Math.PI) / 180;
  const east = p.x * Math.cos(b) + p.y * Math.sin(b);
  const north = -p.x * Math.sin(b) + p.y * Math.cos(b);
  const lat0 = origin?.lat ?? 0;
  const lon0 = origin?.lon ?? 0;
  const lat = lat0 + north / METRES_PER_DEGREE;
  const lon =
    lon0 + east / (METRES_PER_DEGREE * Math.cos((lat0 * Math.PI) / 180));
  return [round7(lon), round7(lat)];
}

/**
 * The file on disk, section 3: one `LineString` per track, one `Point` per
 * mark on the selected mode's track (the first track when the selected one
 * was not given and cannot be computed), and the walk file as the foreign
 * member `walk`. Coordinates are rounded to 7 decimals and distances to 2.
 */
export function walkToGeoJson(
  walk: WalkFile,
  tracks: Track[],
  selectedMode: ModeId
): object {
  const bearing = round2(walkBearing(walk, tracks));
  const origin = walk.origin;
  const features: object[] = tracks.map((track) => ({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: track.points.map((p) => projectPoint(p, bearing, origin)),
    },
    properties: {
      mode: track.mode,
      steps: track.steps,
      turns: track.turns,
      distanceMetres: round2(track.distanceMetres),
    },
  }));
  let selected: Track | undefined = tracks.find((t) => t.mode === selectedMode);
  if (!selected && availableModes(walk).includes(selectedMode)) {
    selected = computeTrack(walk, selectedMode);
  }
  selected ??= tracks[0];
  for (const mark of walk.marks ?? []) {
    const at: TrackPoint = selected
      ? positionAt(selected, mark.t)
      : { t: mark.t, x: 0, y: 0 };
    const properties: Record<string, unknown> = { mark: mark.kind };
    if (mark.label !== undefined) properties['label'] = mark.label;
    properties['t'] = mark.t;
    properties['mode'] = selected?.mode ?? selectedMode;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: projectPoint(at, bearing, origin),
      },
      properties,
    });
  }
  return {
    type: 'FeatureCollection',
    localFrame: !origin,
    bearing,
    features,
    walk,
  };
}
