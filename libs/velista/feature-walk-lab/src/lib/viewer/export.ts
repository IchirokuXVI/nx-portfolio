import {
  availableModes,
  computeTrack,
  walkFileName,
  walkToGeoJson,
  type ModeId,
  type Track,
  type TrackOptions,
  type WalkFile,
} from '@portfolio/luna-shopper/shop-map/recorder';
import { computeTracksInTurns } from './compute-tracks';
import { sortModes } from './mode-style';

/** The mode the marks go on when nobody chose one: the recorder of plan 0001. */
export const DEFAULT_MODE = 'pdr:own:gyro:snap';

/** The mode marks are placed on: the one asked for if the walk has it, else the default. */
export function pickMode(
  modes: readonly ModeId[],
  preferred?: ModeId
): ModeId | null {
  if (preferred && modes.includes(preferred)) {
    return preferred;
  }
  if (modes.includes(DEFAULT_MODE)) {
    return DEFAULT_MODE;
  }
  return sortModes(modes)[0] ?? null;
}

/** The exported file, section 3: its name and its text. */
export interface WalkExport {
  fileName: string;
  text: string;
}

/**
 * The GeoJSON file of section 3, from tracks already computed.
 *
 * Tracks that failed are left out rather than failing the export: the walk inside the
 * file is what replays, and a missing line is recomputed on import.
 */
export function exportWalk(
  walk: WalkFile,
  tracks: readonly Track[],
  selectedMode: ModeId | null
): WalkExport {
  const geojson = walkToGeoJson(walk, [...tracks], selectedMode ?? '');
  return { fileName: walkFileName(walk), text: JSON.stringify(geojson) };
}

/**
 * Every mode computed a turn at a time, then the file. For the list's Export, which
 * has no tracks at hand.
 */
export async function computeAndExport(
  walk: WalkFile,
  options: TrackOptions,
  cancelled: () => boolean = () => false
): Promise<WalkExport> {
  const modes = sortModes(availableModes(walk));
  const tracks: Track[] = [];

  await computeTracksInTurns(
    walk,
    modes,
    options,
    (result) => {
      if (result.track) {
        tracks.push(result.track);
      }
    },
    cancelled,
    computeTrack
  );

  return exportWalk(walk, tracks, pickMode(modes));
}
