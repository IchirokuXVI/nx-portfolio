import type {
  MapArea,
  ShopMapDocumentV2,
} from '@portfolio/luna-shopper/shop-map/model';
import type { Box } from './viewport';

/** The drawing grid and the cells of `LiveSnapshot`: cell i covers [i·0.5, (i+1)·0.5). */
export const CELL_METRES = 0.5;

/** A cell is walked when a point of the path passed this close to its centre (model plan 0003). */
export const WALKED_REACH_METRES = 0.5;

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const cellKey = (x: number, y: number) => `${x},${y}`;

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const k =
    len2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  return Math.hypot(px - (ax + k * vx), py - (ay + k * vy));
}

/**
 * The cells the document's path walked: every cell whose centre is within
 * {@link WALKED_REACH_METRES} of a segment of a polyline. A polyline of one
 * point walks the cells around that point.
 */
export function walkedCellsOfPath(
  path: ShopMapDocumentV2['path'],
  into: Set<string> = new Set()
): Set<string> {
  const c = CELL_METRES;
  const r = WALKED_REACH_METRES;
  for (const line of path) {
    const pts = line.points;
    for (let k = 0; k < Math.max(1, pts.length - 1); k++) {
      const a = pts[k];
      const b = pts[Math.min(k + 1, pts.length - 1)];
      if (!a || !b) continue;
      const i0 = Math.floor((Math.min(a[0], b[0]) - r) / c);
      const i1 = Math.floor((Math.max(a[0], b[0]) + r) / c);
      const j0 = Math.floor((Math.min(a[1], b[1]) - r) / c);
      const j1 = Math.floor((Math.max(a[1], b[1]) + r) / c);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const key = cellKey(i, j);
          if (into.has(key)) continue;
          const d = distanceToSegment(
            (i + 0.5) * c,
            (j + 0.5) * c,
            a[0],
            a[1],
            b[0],
            b[1]
          );
          if (d <= r + 1e-9) into.add(key);
        }
      }
    }
  }
  return into;
}

/**
 * The cells as one path in metres, merging each row's runs into one
 * rectangle so a walked floor of thousands of cells stays a short string.
 */
export function cellsPath(cells: Iterable<string>): string {
  const rows = new Map<number, number[]>();
  for (const key of cells) {
    const [x, y] = key.split(',').map(Number);
    const row = rows.get(y);
    if (row) row.push(x);
    else rows.set(y, [x]);
  }
  const c = CELL_METRES;
  const parts: string[] = [];
  for (const y of [...rows.keys()].sort((a, b) => a - b)) {
    const xs = (rows.get(y) ?? []).sort((a, b) => a - b);
    let start = xs[0];
    for (let k = 1; k <= xs.length; k++) {
      if (k < xs.length && xs[k] === xs[k - 1] + 1) continue;
      const end = xs[k - 1] + 1;
      parts.push(
        `M${round2(start * c)} ${round2(y * c)}h${round2((end - start) * c)}v${c}h${round2(-(end - start) * c)}z`
      );
      start = xs[k];
    }
  }
  return parts.join('');
}

/** The box two corners span, whichever way round they are. */
export function boxOf(ax: number, ay: number, bx: number, by: number): Box {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    w: Math.abs(bx - ax),
    h: Math.abs(by - ay),
  };
}

/** A box snapped to the half metre grid when `snap` is on, else to 2 decimals. */
export function snapBox(b: Box, snap: boolean): Box {
  const q = (n: number) =>
    snap ? round2(Math.round(n / CELL_METRES) * CELL_METRES) : round2(n);
  const x0 = q(b.x);
  const y0 = q(b.y);
  return {
    x: x0,
    y: y0,
    w: round2(q(b.x + b.w) - x0),
    h: round2(q(b.y + b.h) - y0),
  };
}

/** A point on the half metre grid when `snap` is on, else to 2 decimals. */
export function snapPoint(
  x: number,
  y: number,
  snap: boolean
): [number, number] {
  const q = (n: number) =>
    snap ? round2(Math.round(n / CELL_METRES) * CELL_METRES) : round2(n);
  return [q(x), q(y)];
}

/** A box moved, keeping its size; with snap on its corner lands on the grid. */
export function movedBox(b: Box, dx: number, dy: number, snap: boolean): Box {
  const q = (n: number) =>
    snap ? round2(Math.round(n / CELL_METRES) * CELL_METRES) : round2(n);
  return { x: q(b.x + dx), y: q(b.y + dy), w: b.w, h: b.h };
}

/**
 * The corners of a box, clockwise from the top left as drawn. Corner `i`
 * moves when its handle is dragged, and the opposite one, `(i + 2) % 4`,
 * stays.
 */
export function corners(b: Box): [number, number][] {
  return [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ];
}

export function contains(b: Box, x: number, y: number): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

/** The last area in document order that holds the point, which is the one drawn on top. */
export function areaAt(
  areas: readonly MapArea[],
  x: number,
  y: number,
  skip: (a: MapArea) => boolean = () => false
): MapArea | null {
  for (let k = areas.length - 1; k >= 0; k--) {
    const a = areas[k];
    if (!skip(a) && contains(a, x, y)) return a;
  }
  return null;
}

/** The box around a set of boxes and points, zero sized when there is nothing. */
export function unionBox(
  boxes: Iterable<Box>,
  points: Iterable<[number, number]> = []
): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return minX === Infinity
    ? { x: 0, y: 0, w: 0, h: 0 }
    : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** The boxes of a set of cells, one per cell. */
export function cellBoxes(cells: Iterable<string>): Box[] {
  const out: Box[] = [];
  for (const key of cells) {
    const [x, y] = key.split(',').map(Number);
    out.push({
      x: x * CELL_METRES,
      y: y * CELL_METRES,
      w: CELL_METRES,
      h: CELL_METRES,
    });
  }
  return out;
}

/** `#rrggbb` made darker by `amount` (0.4 is 40 percent darker), for a custom area's border. */
export function darken(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (shift: number) =>
    Math.round(((n >> shift) & 0xff) * (1 - amount))
      .toString(16)
      .padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

/** The screen direction of a heading, in degrees for `rotate()`: 0 points right. */
export function headingToScreenDegrees(heading: number): number {
  const h = (heading * Math.PI) / 180;
  return (Math.atan2(Math.cos(h), -Math.sin(h)) * 180) / Math.PI;
}

/** A size in metres as a person reads it: at most 2 decimals, no trailing zeros. */
export function metres(n: number): string {
  return `${round2(n)}`;
}
