import type { Track, TrackMetrics, TrackPoint } from './track-types';
import type { WalkFile } from './walk-file';

export function trackMetrics(walk: WalkFile, track: Track): TrackMetrics {
  void walk;
  void track;
  throw new Error('not implemented');
}

export function positionAt(track: Track, t: number): TrackPoint {
  void track;
  void t;
  throw new Error('not implemented');
}
