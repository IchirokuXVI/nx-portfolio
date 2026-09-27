import type { ModeId, Track } from './track-types';
import type { WalkFile } from './walk-file';

export function walkToGeoJson(
  walk: WalkFile,
  tracks: Track[],
  selectedMode: ModeId
): object {
  void walk;
  void tracks;
  void selectedMode;
  throw new Error('not implemented');
}
