import { ALIGN_METRES } from './estimators';
import type { TrackPoint } from './track-types';

export function pathLength(points: TrackPoint[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) {
    d += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y
    );
  }
  return d;
}

/**
 * Section 5.6. The first point at least 3 m from the first point decides the
 * rotation: `rotation = atan2(p.x, p.y)`, applied counterclockwise around the
 * first point, which puts that point on +y. No such point, no rotation.
 */
export function alignPoints(points: TrackPoint[]): {
  points: TrackPoint[];
  rotation: number;
} {
  if (points.length === 0) return { points: [], rotation: 0 };
  const o = points[0];
  const target = points.find(
    (p) => Math.hypot(p.x - o.x, p.y - o.y) >= ALIGN_METRES
  );
  if (!target) return { points: points.map((p) => ({ ...p })), rotation: 0 };
  const rotation = Math.atan2(target.x - o.x, target.y - o.y);
  return { points: rotatePoints(points, rotation), rotation };
}

/** Rotates counterclockwise by `angle` radians around the first point. */
export function rotatePoints(
  points: TrackPoint[],
  angle: number
): TrackPoint[] {
  if (points.length === 0) return [];
  const o = points[0];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return points.map((p) => {
    const x = p.x - o.x;
    const y = p.y - o.y;
    return { t: p.t, x: o.x + x * c - y * s, y: o.y + x * s + y * c };
  });
}

/** Degrees in [0, 360). */
export function normalizeDegrees(a: number): number {
  const r = a % 360;
  return r < 0 ? r + 360 : r;
}

export const METRES_PER_DEGREE = 111320;
