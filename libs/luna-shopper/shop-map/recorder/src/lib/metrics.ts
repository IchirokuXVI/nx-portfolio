import type { Track, TrackMetrics, TrackPoint } from './track-types';
import type { WalkFile } from './walk-file';

/**
 * Section 6: the track point at or before `t`. Before the first point, the
 * first point. An empty track answers the origin at `t`.
 */
export function positionAt(track: Track, t: number): TrackPoint {
  const pts = track.points;
  if (pts.length === 0) return { t, x: 0, y: 0 };
  if (t < pts[0].t) return pts[0];
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return pts[lo];
}

/**
 * Section 6. Checkpoints are grouped by label (a checkpoint with no label is
 * grouped under ""), listed in the order each label first appears, and only
 * labels marked more than once are reported. The error is the largest
 * distance between the track's positions at any two of those marks.
 */
export function trackMetrics(walk: WalkFile, track: Track): TrackMetrics {
  const pts = track.points;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const groups = new Map<string, TrackPoint[]>();
  for (const m of walk.marks ?? []) {
    if (m.kind !== 'checkpoint') continue;
    const label = m.label ?? '';
    const list = groups.get(label) ?? [];
    list.push(positionAt(track, m.t));
    groups.set(label, list);
  }
  const checkpoints: TrackMetrics['checkpoints'] = [];
  for (const [label, at] of groups) {
    if (at.length < 2) continue;
    let errorMetres = 0;
    for (let i = 0; i < at.length; i++) {
      for (let j = i + 1; j < at.length; j++) {
        errorMetres = Math.max(
          errorMetres,
          Math.hypot(at[i].x - at[j].x, at[i].y - at[j].y)
        );
      }
    }
    checkpoints.push({ label, count: at.length, errorMetres });
  }
  return {
    steps: track.steps,
    turns: track.turns,
    distanceMetres: track.distanceMetres,
    endToStartMetres:
      first && last ? Math.hypot(last.x - first.x, last.y - first.y) : 0,
    checkpoints,
  };
}
