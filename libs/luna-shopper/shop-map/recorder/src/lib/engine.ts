import type { ModeId, Track, TrackOptions } from './track-types';
import type { StreamName, WalkFile } from './walk-file';

export interface TrackEngine {
  push(stream: StreamName, row: number[] | number): void;
  track(): Track;
}

export function createTrackEngine(
  mode: ModeId,
  walk: Pick<WalkFile, 'settings' | 'origin'>,
  options?: TrackOptions
): TrackEngine {
  void mode;
  void walk;
  void options;
  throw new Error('not implemented');
}

export function computeTrack(
  walk: WalkFile,
  mode: ModeId,
  options?: TrackOptions
): Track {
  void walk;
  void mode;
  void options;
  throw new Error('not implemented');
}
