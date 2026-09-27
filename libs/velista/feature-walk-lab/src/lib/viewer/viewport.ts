/**
 * Pinch zoom and drag pan, as arithmetic (recorder plan 0002, section 7.3).
 *
 * The plot draws the world in metres inside a `<g>` carrying
 * `translate(x, y) scale(scale)`, so a world point `w` is drawn at `w * scale + (x, y)`
 * in the SVG's own units. Every function here answers a new view and changes nothing.
 */

export interface View {
  scale: number;
  x: number;
  y: number;
}

export const IDENTITY: View = { scale: 1, x: 0, y: 0 };

/** Never closer than this, nor further out: a zoom that loses the drawing helps nobody. */
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 40;

/** Zoom by `factor` keeping the point under `(cx, cy)` where it is. */
export function zoomAt(view: View, factor: number, cx: number, cy: number): View {
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  const applied = scale / view.scale;

  return {
    scale,
    x: cx - (cx - view.x) * applied,
    y: cy - (cy - view.y) * applied,
  };
}

export function panBy(view: View, dx: number, dy: number): View {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

export interface Point {
  x: number;
  y: number;
}

/**
 * One step of a two finger gesture: the pinch scales around the midpoint and the
 * midpoint's movement pans, so the content stays under both fingers.
 */
export function pinch(
  view: View,
  before: readonly [Point, Point],
  after: readonly [Point, Point]
): View {
  const d0 = distance(before[0], before[1]);
  const d1 = distance(after[0], after[1]);
  const m0 = midpoint(before[0], before[1]);
  const m1 = midpoint(after[0], after[1]);

  const zoomed = d0 > 0 ? zoomAt(view, d1 / d0, m0.x, m0.y) : view;
  return panBy(zoomed, m1.x - m0.x, m1.y - m0.y);
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The box around every point given, with at least `minSize` on each side. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(points: Iterable<Point>, minSize = 4): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      continue;
    }
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  if (minX === Infinity) {
    minX = minY = -minSize / 2;
    maxX = maxY = minSize / 2;
  }

  const growX = Math.max(0, minSize - (maxX - minX)) / 2;
  const growY = Math.max(0, minSize - (maxY - minY)) / 2;

  return {
    minX: minX - growX,
    minY: minY - growY,
    maxX: maxX + growX,
    maxY: maxY + growY,
  };
}

/**
 * At most `limit` points of a line, keeping the first and the last.
 *
 * A camera track is a point per frame, tens of thousands on a long walk, and an SVG
 * polyline of that size makes every pan stutter on a phone. What is drawn is thinned;
 * what is measured never is.
 */
export function thin<T>(points: readonly T[], limit: number): readonly T[] {
  if (points.length <= limit || limit < 2) {
    return points;
  }

  const out: T[] = [];
  const step = (points.length - 1) / (limit - 1);
  for (let i = 0; i < limit; i++) {
    out.push(points[Math.round(i * step)]);
  }
  return out;
}
