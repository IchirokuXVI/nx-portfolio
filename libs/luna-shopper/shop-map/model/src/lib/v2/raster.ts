import type { ShopMapGrid } from '../grid';
import type { ShopMapCell } from '../types';
import type { MapArea, ShopMapDocumentV2 } from './types';
import { isBlockingArea } from './validate';

/** Metres per cell of the raster that `walkOrderV2` and `shopperView` read. */
export const RASTER_CELL_METRES = 0.5;
/** A cell is floor when the walk or a `path` area passed this close to its centre. */
export const WALKED_REACH_METRES = 0.75;

/**
 * A version 2 document rasterized at {@link RASTER_CELL_METRES}. Cell
 * `(x, y)` covers `[x0 + x·cell, x0 + (x+1)·cell)` and the same along y. The
 * origin sits on a multiple of the cell, so the same document always
 * rasterizes to the same cells.
 */
export interface ShopMapRaster {
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  /** A blocking area covers the cell's centre. */
  blocked: ShopMapGrid<boolean>;
  /** Not blocked, and the walk or a `path` area passed within reach of the centre. */
  free: ShopMapGrid<boolean>;
}

function grid<T>(cols: number, rows: number, value: T): ShopMapGrid<T> {
  const g: ShopMapGrid<T> = [];
  for (let y = 0; y < rows; y++) g.push(new Array<T>(cols).fill(value));
  return g;
}

/** Distance from a point to a rectangle, 0 inside it. */
export function distanceToArea(px: number, py: number, a: MapArea): number {
  const dx = Math.max(a.x - px, 0, px - (a.x + a.w));
  const dy = Math.max(a.y - py, 0, py - (a.y + a.h));
  return Math.hypot(dx, dy);
}

function distanceToSegment(
  px: number,
  py: number,
  [ax, ay]: [number, number],
  [bx, by]: [number, number]
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

export function rasterize(doc: ShopMapDocumentV2): ShopMapRaster {
  const cell = RASTER_CELL_METRES;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const a of doc.areas) {
    xs.push(a.x, a.x + a.w);
    ys.push(a.y, a.y + a.h);
  }
  for (const line of doc.path) {
    for (const [x, y] of line.points) {
      xs.push(x);
      ys.push(y);
    }
  }
  if (xs.length === 0) {
    return { x0: 0, y0: 0, cols: 0, rows: 0, blocked: [], free: [] };
  }
  const pad = 2 * cell;
  const x0 = Math.floor((Math.min(...xs) - pad) / cell) * cell;
  const y0 = Math.floor((Math.min(...ys) - pad) / cell) * cell;
  const cols = Math.ceil((Math.max(...xs) + pad - x0) / cell);
  const rows = Math.ceil((Math.max(...ys) + pad - y0) / cell);
  const centre = (i: number, origin: number) => origin + (i + 0.5) * cell;

  const blocked = grid(cols, rows, false);
  for (const a of doc.areas) {
    if (!isBlockingArea(a.kind)) continue;
    for (let y = 0; y < rows; y++) {
      const cy = centre(y, y0);
      if (cy < a.y || cy >= a.y + a.h) continue;
      for (let x = 0; x < cols; x++) {
        const cx = centre(x, x0);
        if (cx >= a.x && cx < a.x + a.w) blocked[y][x] = true;
      }
    }
  }

  const near = grid(cols, rows, false);
  const reach = WALKED_REACH_METRES;
  const mark = (
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    within: (cx: number, cy: number) => boolean
  ) => {
    const i0 = Math.max(0, Math.floor((minX - reach - x0) / cell));
    const i1 = Math.min(cols - 1, Math.floor((maxX + reach - x0) / cell));
    const j0 = Math.max(0, Math.floor((minY - reach - y0) / cell));
    const j1 = Math.min(rows - 1, Math.floor((maxY + reach - y0) / cell));
    for (let y = j0; y <= j1; y++) {
      for (let x = i0; x <= i1; x++) {
        if (!near[y][x] && within(centre(x, x0), centre(y, y0))) {
          near[y][x] = true;
        }
      }
    }
  };
  for (const line of doc.path) {
    const pts = line.points;
    for (let k = 0; k < Math.max(1, pts.length - 1); k++) {
      const a = pts[k];
      const b = pts[Math.min(k + 1, pts.length - 1)];
      mark(
        Math.min(a[0], b[0]),
        Math.min(a[1], b[1]),
        Math.max(a[0], b[0]),
        Math.max(a[1], b[1]),
        (cx, cy) => distanceToSegment(cx, cy, a, b) <= reach + 1e-9
      );
    }
  }
  for (const a of doc.areas) {
    if (a.kind !== 'path') continue;
    mark(
      a.x,
      a.y,
      a.x + a.w,
      a.y + a.h,
      (cx, cy) => distanceToArea(cx, cy, a) <= reach + 1e-9
    );
  }

  const free = grid(cols, rows, false);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) free[y][x] = near[y][x] && !blocked[y][x];
  }
  return { x0, y0, cols, rows, blocked, free };
}

/** The centre of a cell, in metres. */
export function cellCentre(r: ShopMapRaster, c: ShopMapCell): [number, number] {
  return [
    r.x0 + (c.x + 0.5) * RASTER_CELL_METRES,
    r.y0 + (c.y + 0.5) * RASTER_CELL_METRES,
  ];
}

/** How far from an area the cell a shopper stands on for it may be. */
export const STAND_REACH_METRES = 1.5;

/**
 * The free cell nearest to something, measured from the cell's centre,
 * among the cells `allowed` accepts and no farther than `reach`. Ties go to
 * the first reading row by row. `null` when no cell qualifies.
 */
export function nearestCell(
  r: ShopMapRaster,
  distance: (cx: number, cy: number) => number,
  allowed: (c: ShopMapCell) => boolean,
  reach = STAND_REACH_METRES
): ShopMapCell | null {
  let best: ShopMapCell | null = null;
  let bestD = reach + 1e-9;
  for (let y = 0; y < r.rows; y++) {
    for (let x = 0; x < r.cols; x++) {
      if (!r.free[y][x]) continue;
      const c = { x, y };
      if (!allowed(c)) continue;
      const [cx, cy] = cellCentre(r, c);
      const d = distance(cx, cy);
      if (d < bestD - 1e-9) {
        bestD = d;
        best = c;
      }
    }
  }
  return best;
}
