import type { ShopMapGrid } from '../grid';
import { byId, round2 } from './normalize';
import type { ShopMapRaster } from './raster';
import { RASTER_CELL_METRES, rasterize } from './raster';
import type {
  ShopMapDocumentV2,
  ShopperArea,
  ShopperNote,
  ShopperView,
} from './types';

/**
 * The walkway cells: the free cells of the raster, plus every cell no
 * blocking area covers that sits in a gap under 1 m, which at 0.5 m cells is
 * one cell with free cells on both sides along a row or a column.
 */
export function walkwayCells(r: ShopMapRaster): ShopMapGrid<boolean> {
  const free = (x: number, y: number) => r.free[y]?.[x] === true;
  return r.free.map((row, y) =>
    row.map(
      (isFree, x) =>
        isFree ||
        (!r.blocked[y][x] &&
          ((free(x - 1, y) && free(x + 1, y)) ||
            (free(x, y - 1) && free(x, y + 1))))
    )
  );
}

/** A step along a boundary, in vertex units, y downwards. */
interface Edge {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

const key = (x: number, y: number) => `${x},${y}`;

/**
 * The boundary of a set of cells as closed rings of vertices. Every boundary
 * side becomes an edge with its cell on the right as drawn, so outer rings
 * run clockwise and holes the other way. Where two cells touch only at a
 * corner the trace turns right, keeping them in separate rings. Straight runs
 * are merged, and rings are found reading the grid row by row, so the answer
 * is deterministic.
 */
export function traceRings(cells: ShopMapGrid<boolean>): [number, number][][] {
  const has = (x: number, y: number) => cells[y]?.[x] === true;
  const edges: Edge[] = [];
  for (let y = 0; y < cells.length; y++) {
    for (let x = 0; x < cells[y].length; x++) {
      if (!cells[y][x]) continue;
      if (!has(x, y - 1)) edges.push({ x, y, dx: 1, dy: 0 });
      if (!has(x + 1, y)) edges.push({ x: x + 1, y, dx: 0, dy: 1 });
      if (!has(x, y + 1)) edges.push({ x: x + 1, y: y + 1, dx: -1, dy: 0 });
      if (!has(x - 1, y)) edges.push({ x, y: y + 1, dx: 0, dy: -1 });
    }
  }
  const from = new Map<string, Edge[]>();
  for (const e of edges) {
    const k = key(e.x, e.y);
    const list = from.get(k);
    if (list) list.push(e);
    else from.set(k, [e]);
  }
  const used = new Set<Edge>();
  const rings: [number, number][][] = [];
  for (const first of edges) {
    if (used.has(first)) continue;
    const vertices: [number, number][] = [];
    let e = first;
    for (;;) {
      used.add(e);
      vertices.push([e.x, e.y]);
      const nx = e.x + e.dx;
      const ny = e.y + e.dy;
      const out = (from.get(key(nx, ny)) ?? []).filter((o) => !used.has(o));
      // Right turn as drawn, then straight on, then left.
      const turns = [
        { dx: -e.dy, dy: e.dx },
        { dx: e.dx, dy: e.dy },
        { dx: e.dy, dy: -e.dx },
      ];
      const next = turns
        .map((t) => out.find((o) => o.dx === t.dx && o.dy === t.dy))
        .find((o): o is Edge => o !== undefined);
      if (!next) break;
      e = next;
    }
    rings.push(simplify(vertices));
  }
  return rings;
}

/** Drops every vertex that sits on a straight run. */
function simplify(ring: [number, number][]): [number, number][] {
  const n = ring.length;
  return ring.filter((p, i) => {
    const a = ring[(i + n - 1) % n];
    const b = ring[(i + 1) % n];
    return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]);
  });
}

/**
 * What a shopper is drawn (shop-map plan 0002, section 5): the walkway as
 * polygons, every area except `path` ones, the note marks, and the bounds of
 * all of it. The walked path and the section and counter marks are left out:
 * the areas they made are shown instead.
 */
export function shopperView(doc: ShopMapDocumentV2): ShopperView {
  const raster = rasterize(doc);
  const cell = RASTER_CELL_METRES;
  const walkway = traceRings(walkwayCells(raster)).map((ring) =>
    ring.map(
      ([x, y]) =>
        [round2(raster.x0 + x * cell), round2(raster.y0 + y * cell)] as [
          number,
          number,
        ]
    )
  );

  const areas: ShopperArea[] = [];
  for (const a of [...doc.areas].sort(byId)) {
    if (a.kind === 'path') continue;
    areas.push({
      id: a.id,
      kind: a.kind,
      x: a.x,
      y: a.y,
      w: a.w,
      h: a.h,
      ...(a.section !== undefined ? { section: a.section } : {}),
      ...(a.label !== undefined ? { label: a.label } : {}),
      colour: a.colour,
    });
  }
  const notes: ShopperNote[] = [...doc.marks]
    .sort(byId)
    .filter((m) => m.kind === 'note')
    .map((m) => ({ id: m.id, x: m.x, y: m.y, text: m.text }));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const ring of walkway) for (const [x, y] of ring) take(x, y);
  for (const a of areas) {
    take(a.x, a.y);
    take(a.x + a.w, a.y + a.h);
  }
  for (const n of notes) take(n.x, n.y);
  const bounds =
    minX === Infinity
      ? { x: 0, y: 0, w: 0, h: 0 }
      : {
          x: round2(minX),
          y: round2(minY),
          w: round2(maxX - minX),
          h: round2(maxY - minY),
        };

  return { walkway, areas, notes, bounds };
}
