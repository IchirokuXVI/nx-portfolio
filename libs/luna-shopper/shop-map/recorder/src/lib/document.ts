import type {
  AnchorFace,
  FixtureKind,
  ShopMapAnchor,
  ShopMapDocument,
  ShopMapFixture,
} from '@portfolio/luna-shopper/shop-map/model';
import { headingStep } from './recorder';
import type { Cell, Heading, Walk } from './walk';

export interface WalkToDocumentOptions {
  size?: { cols: number; rows: number };
  outline?: ShopMapDocument['outline'];
  /** Which side a scanned product sits on, 'right' by default. */
  hand?: 'right' | 'left';
  /** The document's informative `cell`, 0.5 by default. */
  cellMetres?: number;
}

const PAD = 2;

type Kind = 'floor' | 'walk' | FixtureKind;

const RIGHT_OF: Record<Heading, Heading> = { n: 'e', e: 's', s: 'w', w: 'n' };
const LEFT_OF: Record<Heading, Heading> = { n: 'w', w: 's', s: 'e', e: 'n' };
const OPPOSITE: Record<Heading, AnchorFace> = {
  n: 's',
  s: 'n',
  e: 'w',
  w: 'e',
};

function isFree(k: Kind): boolean {
  return k === 'floor' || k === 'walk' || k === 'entrance' || k === 'exit';
}

function segmentCells(s: Walk['segments'][number]): Cell[] {
  const d = headingStep(s.heading);
  const n = Math.abs(s.to.x - s.from.x) + Math.abs(s.to.y - s.from.y);
  const cells: Cell[] = [];
  for (let i = 0; i <= n; i++) {
    cells.push({ x: s.from.x + i * d.x, y: s.from.y + i * d.y });
  }
  return cells;
}

/**
 * Recorder plan 0001 section 3: a draft document from a walk.
 *
 * The walk's cells have `y` growing north, the document's rows grow down, so
 * a walk cell `(x, y)` becomes column `x - minX + 2` and row `maxY - y + 2`,
 * where the box is over every segment cell, mark, scan and note. The size is
 * that box plus two cells on every side, or `options.size`, or the outline's
 * bounding box; anything that falls outside is dropped.
 *
 * 1. Walked cells are floor. Each segment lays a shelf on both sides of each
 *    of its cells, wherever the side cell is not walked.
 * 2. Each `entrance` or `exit` mark (or, without an entrance mark, the first
 *    segment's first cell) is carried to the nearest border (ties: top,
 *    bottom, left, right) through a corridor cleared of shelves, and becomes
 *    a one cell fixture there.
 * 3. A `checkout` or `counter` mark becomes a one cell fixture, with its
 *    label, on the side cell to the right of the first segment through the
 *    mark's cell (else the left one); a mark on no segment draws nothing, and
 *    so does a `checkpoint`.
 * 4. A scan becomes a product anchor with `ean` on the side cell to the
 *    `hand` of its heading (else the other side), which becomes a shelf if it
 *    was floor, facing the scan's cell. A note becomes a note anchor.
 * 5. Free cells that no entrance reaches become shelf, so the draft is always
 *    connected.
 * 6. Shelf cells merge into rectangles, greedily: the first free cell in row
 *    major order grows right, then down while the whole run matches. Other
 *    fixtures stay one cell each. Ids are `<kind>-<n>` in that order, anchors
 *    `product-<n>` and `note-<n>` in walk order.
 */
export function walkToDocument(
  walk: Walk,
  options: WalkToDocumentOptions = {}
): ShopMapDocument {
  const cells: Cell[] = [
    ...walk.segments.flatMap(segmentCells),
    ...walk.marks.map((m) => m.at),
    ...walk.scans.map((s) => s.at),
    ...walk.notes.map((n) => n.at),
  ];
  if (cells.length === 0) cells.push({ x: 0, y: 0 });
  const minX = Math.min(...cells.map((c) => c.x));
  const maxX = Math.max(...cells.map((c) => c.x));
  const minY = Math.min(...cells.map((c) => c.y));
  const maxY = Math.max(...cells.map((c) => c.y));
  let size = {
    cols: maxX - minX + 1 + 2 * PAD,
    rows: maxY - minY + 1 + 2 * PAD,
  };
  if (options.size) {
    size = { ...options.size };
  } else if (options.outline && options.outline.points.length > 0) {
    size = {
      cols: Math.max(
        1,
        Math.ceil(Math.max(...options.outline.points.map((p) => p[0])))
      ),
      rows: Math.max(
        1,
        Math.ceil(Math.max(...options.outline.points.map((p) => p[1])))
      ),
    };
  }
  const toDoc = (c: Cell): Cell => ({
    x: c.x - minX + PAD,
    y: maxY - c.y + PAD,
  });
  const inside = (c: Cell) =>
    c.x >= 0 && c.y >= 0 && c.x < size.cols && c.y < size.rows;
  /** A walk heading as a step in document coordinates (rows grow down). */
  const docStep = (h: Heading): Cell => {
    const d = headingStep(h);
    return { x: d.x, y: -d.y };
  };

  const grid: Kind[][] = Array.from({ length: size.rows }, () =>
    Array.from({ length: size.cols }, (): Kind => 'floor')
  );
  const get = (c: Cell): Kind | undefined => grid[c.y]?.[c.x];
  const set = (c: Cell, k: Kind) => {
    if (inside(c)) grid[c.y][c.x] = k;
  };
  const labels = new Map<string, string>();

  // 1. Walked cells, then the shelves beside them.
  const walked = walk.segments.map((s) => segmentCells(s).map(toDoc));
  for (const run of walked) for (const c of run) set(c, 'walk');
  walk.segments.forEach((s, i) => {
    const sides = [docStep(RIGHT_OF[s.heading]), docStep(LEFT_OF[s.heading])];
    for (const c of walked[i]) {
      for (const d of sides) {
        const side = { x: c.x + d.x, y: c.y + d.y };
        if (get(side) === 'floor') set(side, 'shelf');
      }
    }
  });

  // 2. Entrances and exits, carried to the border through a corridor.
  const doors: { at: Cell; kind: 'entrance' | 'exit' }[] = walk.marks
    .filter((m) => m.kind === 'entrance' || m.kind === 'exit')
    .map((m) => ({ at: m.at, kind: m.kind as 'entrance' | 'exit' }));
  if (!doors.some((d) => d.kind === 'entrance')) {
    doors.unshift({ at: walk.segments[0]?.from ?? cells[0], kind: 'entrance' });
  }
  for (const door of doors) {
    const e = toDoc(door.at);
    if (!inside(e)) continue;
    const ways: { dist: number; step: Cell }[] = [
      { dist: e.y, step: { x: 0, y: -1 } },
      { dist: size.rows - 1 - e.y, step: { x: 0, y: 1 } },
      { dist: e.x, step: { x: -1, y: 0 } },
      { dist: size.cols - 1 - e.x, step: { x: 1, y: 0 } },
    ];
    const best = ways.reduce((a, b) => (b.dist < a.dist ? b : a));
    let c = e;
    for (let i = 0; i < best.dist; i++) {
      if (get(c) !== 'entrance' && get(c) !== 'exit') set(c, 'walk');
      c = { x: c.x + best.step.x, y: c.y + best.step.y };
    }
    set(c, door.kind);
  }

  // 3. Checkouts and counters, beside the walk.
  const segmentAt = (at: Cell) =>
    walk.segments.find((s) =>
      segmentCells(s).some((c) => c.x === at.x && c.y === at.y)
    );
  for (const m of walk.marks) {
    if (m.kind !== 'checkout' && m.kind !== 'counter') continue;
    const seg = segmentAt(m.at);
    if (!seg) continue;
    const at = toDoc(m.at);
    for (const h of [RIGHT_OF[seg.heading], LEFT_OF[seg.heading]]) {
      const d = docStep(h);
      const side = { x: at.x + d.x, y: at.y + d.y };
      const k = get(side);
      if (k === 'floor' || k === 'shelf') {
        set(side, m.kind);
        if (m.label) labels.set(`${side.x},${side.y}`, m.label);
        break;
      }
    }
  }

  // 4. Scans and notes.
  const anchors: ShopMapAnchor[] = [];
  let products = 0;
  for (const s of walk.scans) {
    const at = toDoc(s.at);
    const first = options.hand === 'left' ? LEFT_OF : RIGHT_OF;
    const second = options.hand === 'left' ? RIGHT_OF : LEFT_OF;
    for (const h of [first[s.heading], second[s.heading]]) {
      const d = docStep(h);
      const side = { x: at.x + d.x, y: at.y + d.y };
      const k = get(side);
      if (k === undefined || (isFree(k) && k !== 'floor')) continue;
      if (k === 'floor') set(side, 'shelf');
      anchors.push({
        id: `product-${++products}`,
        kind: 'product',
        at: side,
        face: OPPOSITE[h],
        ean: s.ean,
      });
      break;
    }
  }
  walk.notes.forEach((n, i) => {
    const at = toDoc(n.at);
    if (inside(at)) {
      anchors.push({ id: `note-${i + 1}`, kind: 'note', at, text: n.text });
    }
  });

  // 5. Free cells no entrance reaches become shelf.
  const reached = grid.map((row) => row.map(() => false));
  const queue: Cell[] = [];
  grid.forEach((row, y) =>
    row.forEach((k, x) => {
      if (k === 'entrance') {
        reached[y][x] = true;
        queue.push({ x, y });
      }
    })
  );
  const steps = [
    { x: 0, y: -1 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
  ];
  for (let q = 0; q < queue.length; q++) {
    for (const d of steps) {
      const c = { x: queue[q].x + d.x, y: queue[q].y + d.y };
      const k = get(c);
      if (k !== undefined && isFree(k) && !reached[c.y][c.x]) {
        reached[c.y][c.x] = true;
        queue.push(c);
      }
    }
  }
  grid.forEach((row, y) =>
    row.forEach((k, x) => {
      if (isFree(k) && !reached[y][x]) row[x] = 'shelf';
    })
  );

  // 6. Fixtures.
  const fixtures: ShopMapFixture[] = [];
  const counters = new Map<string, number>();
  const taken = grid.map((row) => row.map(() => false));
  for (let y = 0; y < size.rows; y++) {
    for (let x = 0; x < size.cols; x++) {
      const k = grid[y][x];
      if (k === 'floor' || k === 'walk' || taken[y][x]) continue;
      let w = 1;
      let h = 1;
      if (k === 'shelf') {
        while (x + w < size.cols && grid[y][x + w] === k && !taken[y][x + w]) {
          w++;
        }
        const rowMatches = (yy: number) => {
          for (let xx = x; xx < x + w; xx++) {
            if (grid[yy][xx] !== k || taken[yy][xx]) return false;
          }
          return true;
        };
        while (y + h < size.rows && rowMatches(y + h)) h++;
      }
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) taken[yy][xx] = true;
      }
      const n = (counters.get(k) ?? 0) + 1;
      counters.set(k, n);
      const label = labels.get(`${x},${y}`);
      fixtures.push({
        id: `${k}-${n}`,
        kind: k,
        x,
        y,
        w,
        h,
        ...(label ? { label } : {}),
      });
    }
  }

  return {
    version: 1,
    cell: options.cellMetres ?? 0.5,
    size,
    ...(options.outline ? { outline: options.outline } : {}),
    fixtures,
    anchors,
  };
}
