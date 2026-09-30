import type {
  LiveMapHandle,
  LiveMapOptions,
  LivePoint,
  LiveSnapshot,
  LiveTracking,
} from './live-types';
import type { MapArea, MapMark, WalkEvent } from './types';
import { isBlockingArea, overlapMetres } from './validate';

/**
 * The live map (shop-map plan 0003). Every rule decides on a 0.5 m grid of
 * cells, where cell (i, j) covers [i·0.5, (i+1)·0.5) metres along x and the
 * same along y, and every area it emits is a rectangle snapped to the cells
 * it covers. Thresholds are named here so a second walk can move them.
 */

/** Metres per cell. */
export const LIVE_CELL_METRES = 0.5;
/** A cell is walked when its centre is this close to a point pushed while tracking is good. */
export const WALKED_RADIUS_METRES = 0.5;
/** Two good points this close are one step, and the cells along the segment between them are walked too. */
export const JOIN_METRES = 2;
/** A suggestion is 1 to 4 cells across (0.5 to 2 m)... */
export const SUGGESTION_MAX_ACROSS_CELLS = 4;
/** ...and at least 4 cells (2 m) long. */
export const SUGGESTION_MIN_LONG_CELLS = 4;
/** A section mark looks this far towards the side the phone faced for shelf cells (1.5 m). */
export const SECTION_REACH_CELLS = 3;
/** The same reach in metres. */
export const SECTION_REACH_METRES = SECTION_REACH_CELLS * LIVE_CELL_METRES;
/** How deep a section run fills a shelf nobody drew, when no aisle bounds it (1 m). */
export const SECTION_DEPTH_CELLS = 2;
/** The walking direction is read over this much of the path behind the person. */
export const DIRECTION_METRES = 1;
/** A turn of more than this... */
export const TURN_DEGREES = 45;
/** ...held for this far ends a section run. */
export const TURN_HELD_METRES = 2;
/** A counter mark places a counter this long and this deep... */
export const COUNTER_LONG_METRES = 2;
export const COUNTER_SHORT_METRES = 1;
/** ...with its near side this far from the person. */
export const COUNTER_GAP_METRES = 0.5;
/** A cell counts as covered by an area overlapping it by more than this both ways, the overlap tolerance of `validateShopMapV2`. */
const COVER_METRES = 0.1;

const CELL = LIVE_CELL_METRES;
const EPS = 1e-9;

type Axis = 'x' | 'y';
type Cell = { x: number; y: number };

const key = (i: number, j: number) => `${i},${j}`;
const cellOf = (v: number) => Math.floor(v / CELL + EPS);
const snap = (v: number) => Math.round(v / CELL) * CELL;
const r2 = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
};

/** The unit vector a heading points along: 0 is +y, clockwise as drawn. */
function headingVector(heading: number): [number, number] {
  const h = (heading * Math.PI) / 180;
  return [-Math.sin(h), Math.cos(h)];
}

/** The vector from a point to the nearest point of an area. */
function toShelf(shelf: MapArea, x: number, y: number): [number, number] {
  return [
    Math.max(shelf.x, Math.min(shelf.x + shelf.w, x)) - x,
    Math.max(shelf.y, Math.min(shelf.y + shelf.h, y)) - y,
  ];
}

/** Whether a mark stood within 1.5 m of a shelf with its heading towards it. */
function markFaces(mark: MapMark, shelf: MapArea): boolean {
  const [vx, vy] = toShelf(shelf, mark.x, mark.y);
  if (Math.hypot(vx, vy) > SECTION_REACH_METRES + EPS) return false;
  const [hx, hy] = headingVector(mark.heading);
  return hx * vx + hy * vy > EPS;
}

/**
 * Whether a mark stood within 1.5 m of a strip across its length, with its
 * heading towards it. Distance along the strip does not count, so the mark
 * that named a strip still names it after a crossing cut the strip short.
 */
function facesAcross(mark: MapMark, shelf: MapArea, acrossY: boolean): boolean {
  const [vx, vy] = toShelf(shelf, mark.x, mark.y);
  const v = acrossY ? vy : vx;
  if (Math.abs(v) > SECTION_REACH_METRES + EPS) return false;
  const [hx, hy] = headingVector(mark.heading);
  return (acrossY ? hy : hx) * v > EPS;
}

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

/** A rectangle of whole cells, inclusive. */
interface CellRect {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}

const rectMetres = (r: CellRect) => ({
  x: r2(r.i0 * CELL),
  y: r2(r.j0 * CELL),
  w: r2((r.i1 - r.i0 + 1) * CELL),
  h: r2((r.j1 - r.j0 + 1) * CELL),
});

const cellsOfArea = (a: MapArea): CellRect => ({
  i0: Math.round(a.x / CELL),
  j0: Math.round(a.y / CELL),
  i1: Math.round((a.x + a.w) / CELL) - 1,
  j1: Math.round((a.y + a.h) / CELL) - 1,
});

/** Whether an area overlaps a cell by more than the tolerance both ways. */
function covers(a: MapArea, i: number, j: number): boolean {
  const ix = Math.min(a.x + a.w, (i + 1) * CELL) - Math.max(a.x, i * CELL);
  const iy = Math.min(a.y + a.h, (j + 1) * CELL) - Math.max(a.y, j * CELL);
  return ix > COVER_METRES + EPS && iy > COVER_METRES + EPS;
}

/** A section run in progress, in cells: along its axis from `start` to `end`, across over `c0..c1`. */
interface Run {
  section: string;
  area: MapArea;
  axis: Axis;
  /** +1 or -1 along the axis once the person moves, 0 before. */
  dir: number;
  start: number;
  end: number;
  c0: number;
  c1: number;
  turned: number;
  /** Metres walked while farther from the band than a mark looks. */
  away: number;
  /** An adopted shelf's own cells along the axis, which walking back never takes away. */
  base: [number, number] | null;
}

interface Strip {
  /** Along its length. */
  l0: number;
  l1: number;
  /** Across. */
  a: number;
  b: number;
}

class LiveMap implements LiveMapHandle {
  private tracking: LiveTracking = 'good';
  private readonly areas = new Map<string, MapArea>();
  private readonly walked = new Set<string>();
  private readonly dismissed = new Set<string>();
  /** Path areas made by walking across a suggested shelf, which later crossings extend. */
  private readonly crossings = new Set<string>();
  private events: WalkEvent[] = [];
  private next: number;
  private run: Run | null = null;
  private prev: LivePoint | null = null;
  /** Good points since tracking was last good, enough to read the walking direction. */
  private recent: LivePoint[] = [];
  private lastLogMs = 0;
  /** Section marks, from the document and as they are saved, for naming a tapped shelf. */
  private readonly sectionMarks: MapMark[] = [];
  private coveredCache: Set<string> | null = null;
  private suggestionCache: LiveSnapshot['suggestions'] | null = null;
  private readonly makesPath: boolean;
  private readonly prefix: string;

  constructor(options: LiveMapOptions) {
    this.prefix = options.settings.idPrefix;
    this.next = options.settings.idSeed ?? 1;
    this.makesPath = options.settings.walkingAcrossMakesPath ?? true;
    const start = options.document;
    for (const a of start.areas) this.areas.set(a.id, a);
    for (const m of start.marks)
      if (m.kind === 'section') this.sectionMarks.push(m);
    for (const line of start.path) {
      let last: [number, number] | null = null;
      for (const p of line.points) {
        this.markWalked(p[0], p[1], last);
        last = p;
      }
    }
  }

  // The handle.

  push(point: LivePoint): void {
    this.lastLogMs = point.logMs;
    if (this.tracking !== 'good') return;
    const prev = this.prev;
    this.markWalked(point.x, point.y, prev ? [prev.x, prev.y] : null);
    if (this.makesPath) this.crossShelves(point);
    if (this.run) this.followRun(point, prev);
    this.prev = point;
    this.recent.push(point);
    while (
      this.recent.length > 2 &&
      Math.hypot(this.recent[1].x - point.x, this.recent[1].y - point.y) >=
        DIRECTION_METRES * 3
    ) {
      this.recent.shift();
    }
  }

  setTracking(state: LiveTracking): void {
    this.tracking = state;
    if (state !== 'good') {
      this.prev = null;
      this.recent = [];
    }
  }

  mark(mark: MapMark): void {
    this.emit({ type: 'mark-put', mark });
    this.lastLogMs = Math.max(this.lastLogMs, mark.logMs);
    if (mark.kind === 'note') return;
    // A mark saved while tracking is not good may be metres off: it names nothing.
    if (mark.kind === 'section' && this.tracking === 'good') {
      this.sectionMarks.push(mark);
    }
    const ended = this.run;
    this.run = null;
    if (this.tracking !== 'good') return;
    if (mark.kind === 'section') this.startRun(mark, ended);
    else this.placeCounter(mark);
  }

  sectionLeft(): void {
    this.run = null;
    this.emit({ type: 'section-left', logMs: this.lastLogMs });
  }

  acceptSuggestion(id: string): void {
    const s = this.suggestions().find((x) => x.id === id);
    if (!s) return;
    const shelf: MapArea = {
      id: this.newId(),
      kind: 'shelf',
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      colour: { mode: 'default' },
      origin: 'suggested',
    };
    const section = this.sectionNear(shelf);
    this.putArea(section ? { ...shelf, section } : shelf);
  }

  dismissSuggestion(id: string): void {
    this.dismissed.add(id);
    this.suggestionCache = null;
  }

  snapshot(): LiveSnapshot {
    const walkedCells: Cell[] = [...this.walked]
      .map((k) => {
        const [x, y] = k.split(',').map(Number);
        return { x, y };
      })
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const events = this.events;
    this.events = [];
    return {
      walkedCells,
      suggestions: this.suggestions().map((s) => ({ ...s })),
      sectionRun: this.run
        ? { section: this.run.section, areaId: this.run.area.id }
        : null,
      events,
    };
  }

  // Bookkeeping.

  private newId(): string {
    return `${this.prefix}${this.next++}`;
  }

  /** Queues an event. A put of the same area as the event just before replaces it. */
  private emit(event: WalkEvent): void {
    const last = this.events[this.events.length - 1];
    if (
      event.type === 'area-put' &&
      last?.type === 'area-put' &&
      last.area.id === event.area.id
    ) {
      this.events[this.events.length - 1] = event;
      return;
    }
    this.events.push(event);
  }

  private putArea(area: MapArea): void {
    this.areas.set(area.id, area);
    this.emit({ type: 'area-put', area });
    this.coveredCache = null;
    this.suggestionCache = null;
  }

  private removeArea(id: string): void {
    this.areas.delete(id);
    this.emit({ type: 'area-removed', id });
    this.coveredCache = null;
    this.suggestionCache = null;
  }

  private covered(): Set<string> {
    if (this.coveredCache) return this.coveredCache;
    const set = new Set<string>();
    for (const a of this.areas.values()) {
      for (let j = cellOf(a.y) - 1; j <= cellOf(a.y + a.h) + 1; j++) {
        for (let i = cellOf(a.x) - 1; i <= cellOf(a.x + a.w) + 1; i++) {
          if (covers(a, i, j)) set.add(key(i, j));
        }
      }
    }
    this.coveredCache = set;
    return set;
  }

  private coveredByOther(i: number, j: number, except: string): boolean {
    for (const a of this.areas.values()) {
      if (a.id !== except && covers(a, i, j)) return true;
    }
    return false;
  }

  private isWalked(i: number, j: number): boolean {
    return this.walked.has(key(i, j));
  }

  /** Walks the cells near a point, and along the step from the one before when it is close. */
  private markWalked(
    x: number,
    y: number,
    from: [number, number] | null
  ): void {
    const joined =
      from !== null && Math.hypot(x - from[0], y - from[1]) <= JOIN_METRES;
    const [ax, ay] = joined && from ? from : [x, y];
    const r = WALKED_RADIUS_METRES;
    for (
      let j = cellOf(Math.min(ay, y) - r);
      j <= cellOf(Math.max(ay, y) + r);
      j++
    ) {
      for (
        let i = cellOf(Math.min(ax, x) - r);
        i <= cellOf(Math.max(ax, x) + r);
        i++
      ) {
        const cx = (i + 0.5) * CELL;
        const cy = (j + 0.5) * CELL;
        if (distanceToSegment(cx, cy, ax, ay, x, y) <= r + EPS) {
          if (!this.walked.has(key(i, j))) {
            this.walked.add(key(i, j));
            this.suggestionCache = null;
          }
        }
      }
    }
  }

  // Suggestions.

  private suggestions(): LiveSnapshot['suggestions'] {
    if (this.suggestionCache) return this.suggestionCache;
    let i0 = Infinity;
    let j0 = Infinity;
    let i1 = -Infinity;
    let j1 = -Infinity;
    for (const k of this.walked) {
      const [i, j] = k.split(',').map(Number);
      i0 = Math.min(i0, i);
      j0 = Math.min(j0, j);
      i1 = Math.max(i1, i);
      j1 = Math.max(j1, j);
    }
    const out: LiveSnapshot['suggestions'] = [];
    if (i0 !== Infinity) {
      const covered = this.covered();
      const open = (i: number, j: number) =>
        !this.isWalked(i, j) && !covered.has(key(i, j));
      // Strips along x: gaps down each column. Strips along y: gaps along each row.
      const alongX = this.strips(
        i0,
        i1,
        j0,
        j1,
        (l, a) => open(l, a),
        (l, a) => this.isWalked(l, a)
      ).map((s) => ({ i0: s.l0, i1: s.l1, j0: s.a, j1: s.b }));
      const alongY = this.strips(
        j0,
        j1,
        i0,
        i1,
        (l, a) => open(a, l),
        (l, a) => this.isWalked(a, l)
      ).map((s) => ({ i0: s.a, i1: s.b, j0: s.l0, j1: s.l1 }));
      const overlaps = (p: CellRect, q: CellRect) =>
        p.i0 <= q.i1 && q.i0 <= p.i1 && p.j0 <= q.j1 && q.j0 <= p.j1;
      const kept: CellRect[] = [...alongX];
      for (const r of alongY) {
        if (!kept.some((k) => overlaps(k, r))) kept.push(r);
      }
      kept.sort((p, q) => p.j0 - q.j0 || p.i0 - q.i0);
      for (const r of kept) {
        const id = `suggestion:${r.i0},${r.j0},${r.i1},${r.j1}`;
        if (!this.dismissed.has(id)) out.push({ id, ...rectMetres(r) });
      }
    }
    this.suggestionCache = out;
    return out;
  }

  /**
   * Strips along one axis: for each line `l` across `l0..l1`, the gaps of
   * open cells `a..b` with a walked cell on both sides and 1 to 4 cells across,
   * joined across consecutive lines while they overlap (keeping the rows all
   * of them share), kept when at least 4 lines long.
   */
  private strips(
    l0: number,
    l1: number,
    a0: number,
    a1: number,
    open: (l: number, a: number) => boolean,
    walked: (l: number, a: number) => boolean
  ): Strip[] {
    const done: Strip[] = [];
    let current: Strip[] = [];
    for (let l = l0; l <= l1 + 1; l++) {
      const gaps: [number, number][] = [];
      if (l <= l1) {
        let a = a0;
        while (a <= a1) {
          if (open(l, a) && walked(l, a - 1)) {
            let b = a;
            while (b + 1 <= a1 + 1 && open(l, b + 1)) b++;
            if (walked(l, b + 1) && b - a + 1 <= SUGGESTION_MAX_ACROSS_CELLS) {
              gaps.push([a, b]);
            }
            a = b + 1;
          } else {
            a++;
          }
        }
      }
      const next: Strip[] = [];
      const used = new Set<Strip>();
      for (const [a, b] of gaps) {
        const s = current.find(
          (c) => !used.has(c) && Math.max(c.a, a) <= Math.min(c.b, b)
        );
        if (s) {
          used.add(s);
          next.push({
            l0: s.l0,
            l1: l,
            a: Math.max(s.a, a),
            b: Math.min(s.b, b),
          });
        } else {
          next.push({ l0: l, l1: l, a, b });
        }
      }
      for (const c of current) {
        if (!used.has(c) && c.l1 - c.l0 + 1 >= SUGGESTION_MIN_LONG_CELLS) {
          done.push(c);
        }
      }
      current = next;
    }
    return done;
  }

  // Walking across a suggested shelf.

  private crossShelves(p: LivePoint): void {
    for (const a of [...this.areas.values()]) {
      if (a.kind !== 'shelf' || a.origin !== 'suggested') continue;
      if (p.x < a.x || p.x >= a.x + a.w || p.y < a.y || p.y >= a.y + a.h) {
        continue;
      }
      // Crossing the shelf the run is filling ends the run: its rectangle no
      // longer stands for the pieces the crossing leaves.
      if (this.run?.area.id === a.id) this.run = null;
      const r = cellsOfArea(a);
      // The slab spans the shelf from the face the person came in through:
      // entering over a top or bottom edge crosses it along y. Coming in over
      // a corner, or with no point before, the longer side is its length.
      const prev = this.prev;
      const overTopOrBottom =
        prev !== null &&
        (prev.y < a.y || prev.y >= a.y + a.h) &&
        prev.x >= a.x &&
        prev.x < a.x + a.w;
      const overLeftOrRight =
        prev !== null &&
        (prev.x < a.x || prev.x >= a.x + a.w) &&
        prev.y >= a.y &&
        prev.y < a.y + a.h;
      // The entry face decides only when the shelf is a strip's depth that
      // way (2 m at most). Clipping the end of a long gondola enters over its
      // short side, and must cut one column, not the whole length.
      const strip = SUGGESTION_MAX_ACROSS_CELLS * CELL + EPS;
      const alongX =
        overTopOrBottom && a.h <= strip
          ? true
          : overLeftOrRight && a.w <= strip
            ? false
            : a.w >= a.h;
      const [lo, hi] = alongX ? [r.i0, r.i1] : [r.j0, r.j1];
      const at = alongX ? p.x : p.y;
      const s0 = Math.max(
        lo,
        Math.ceil((at - WALKED_RADIUS_METRES) / CELL - 0.5 - EPS)
      );
      const s1 = Math.min(
        hi,
        Math.floor((at + WALKED_RADIUS_METRES) / CELL - 0.5 + EPS)
      );
      const piece = (from: number, to: number): CellRect =>
        alongX
          ? { i0: from, i1: to, j0: r.j0, j1: r.j1 }
          : { i0: r.i0, i1: r.i1, j0: from, j1: to };
      const pieces = [
        s0 > lo ? piece(lo, s0 - 1) : null,
        s1 < hi ? piece(s1 + 1, hi) : null,
      ].filter((x): x is CellRect => x !== null);
      if (pieces.length === 0) this.removeArea(a.id);
      pieces.forEach((pc, k) =>
        this.putArea({
          ...a,
          id: k === 0 ? a.id : this.newId(),
          ...rectMetres(pc),
        })
      );
      this.putCrossing(piece(s0, s1), alongX);
    }
  }

  /** A path over the crossed cells, joined to a crossing it touches along the shelf. */
  private putCrossing(cells: CellRect, alongX: boolean): void {
    for (const id of this.crossings) {
      const c = this.areas.get(id);
      if (!c) continue;
      const q = cellsOfArea(c);
      const sameAcross = alongX
        ? q.j0 === cells.j0 && q.j1 === cells.j1
        : q.i0 === cells.i0 && q.i1 === cells.i1;
      const touches = alongX
        ? q.i0 <= cells.i1 + 1 && cells.i0 <= q.i1 + 1
        : q.j0 <= cells.j1 + 1 && cells.j0 <= q.j1 + 1;
      if (sameAcross && touches) {
        const joined: CellRect = {
          i0: Math.min(q.i0, cells.i0),
          j0: Math.min(q.j0, cells.j0),
          i1: Math.max(q.i1, cells.i1),
          j1: Math.max(q.j1, cells.j1),
        };
        this.putArea({ ...c, ...rectMetres(joined) });
        return;
      }
    }
    const id = this.newId();
    this.crossings.add(id);
    this.putArea({
      id,
      kind: 'path',
      ...rectMetres(cells),
      colour: { mode: 'default' },
      origin: 'suggested',
    });
  }

  // Section runs.

  /**
   * The section a tapped shelf takes: the run in progress when the person is
   * within 1.5 m of the shelf, else the latest section mark within 1.5 m of it.
   */
  private sectionNear(shelf: MapArea): string | null {
    const near = (x: number, y: number) =>
      Math.hypot(...toShelf(shelf, x, y)) <= SECTION_REACH_METRES + EPS;
    const run = this.run;
    if (run && this.prev && near(this.prev.x, this.prev.y)) {
      // Only when the shelf is on the run's side of the person.
      const person = run.axis === 'x' ? this.prev.y : this.prev.x;
      const band = ((run.c0 + run.c1 + 1) / 2) * CELL;
      const middle =
        run.axis === 'x' ? shelf.y + shelf.h / 2 : shelf.x + shelf.w / 2;
      if (Math.sign(band - person) === Math.sign(middle - person)) {
        return run.section;
      }
    }
    for (let k = this.sectionMarks.length - 1; k >= 0; k--) {
      const m = this.sectionMarks[k];
      if (m.text.trim() !== '' && markFaces(m, shelf)) return m.text;
    }
    return null;
  }

  /** A shelf a section mark may name: a tapped suggestion or an earlier run, never one drawn by hand. */
  private adoptable(i: number, j: number): MapArea | null | undefined {
    for (const a of this.areas.values()) {
      // Floor drawn by hand, a crossing path and an entrance are walked on.
      if (!isBlockingArea(a.kind) || !covers(a, i, j)) continue;
      return a.kind === 'shelf' &&
        (a.origin === 'suggested' || a.origin === 'section-run')
        ? a
        : null;
    }
    return undefined;
  }

  /** The walking direction over the last metre, or null while standing still. */
  private walkingDirection(x: number, y: number): [number, number] | null {
    for (let k = this.recent.length - 1; k >= 0; k--) {
      const q = this.recent[k];
      const d = Math.hypot(x - q.x, y - q.y);
      if (d >= DIRECTION_METRES) return [(x - q.x) / d, (y - q.y) / d];
    }
    return null;
  }

  private startRun(mark: MapMark, ended: Run | null = null): void {
    const phone = headingVector(mark.heading);
    const walking = this.walkingDirection(mark.x, mark.y);
    const axis: Axis = walking
      ? Math.abs(walking[0]) >= Math.abs(walking[1])
        ? 'x'
        : 'y'
      : Math.abs(phone[0]) >= Math.abs(phone[1])
        ? 'y'
        : 'x';
    // Across the run, towards the side the phone faced.
    const across = axis === 'x' ? phone[1] : phone[0];
    const side = across >= 0 ? 1 : -1;
    const pi = cellOf(mark.x);
    const pj = cellOf(mark.y);
    const at = (along: number, c: number): [number, number] =>
      axis === 'x' ? [along, c] : [c, along];
    const along = axis === 'x' ? pi : pj;
    const person = axis === 'x' ? pj : pi;
    const free = (c: number) => {
      const [i, j] = at(along, c);
      return !this.isWalked(i, j) && !this.covered().has(key(i, j));
    };
    let first: number | null = null;
    for (let k = 1; k <= SECTION_REACH_CELLS; k++) {
      const c = person + k * side;
      const [ci, cj] = at(along, c);
      const shelf = this.adoptable(ci, cj);
      if (shelf) {
        const named = shelf.section?.trim().toLowerCase() ?? '';
        // A shelf with another section's name is that section's face, even a
        // tapped strip: the other face of one unit carries its own section.
        if (named === '' || named === mark.text.trim().toLowerCase()) {
          this.adoptRun(mark, shelf, axis, along, walking);
          return;
        }
        // The run just ended overshot into this section: cut it at the
        // person and look again.
        if (ended && ended.area.id === shelf.id && ended.base === null) {
          this.cutRun(ended, mark);
          this.startRun(mark);
          return;
        }
        // The other face of a tapped strip: split it along its length and
        // name the half facing the person. Any other named shelf is left alone.
        const half = this.otherFace(shelf, mark, axis);
        if (half) this.adoptRun(mark, half, axis, along, walking);
        return;
      }
      // Any other area, a drawn shelf among them, ends the search.
      if (shelf === null) return;
      if (free(c)) {
        first = c;
        break;
      }
    }
    if (first === null) return;
    // The open cells behind it. Between two aisles the run fills its half.
    let length = 1;
    while (
      length <= SUGGESTION_MAX_ACROSS_CELLS &&
      free(first + length * side)
    ) {
      length++;
    }
    const [bi, bj] = at(along, first + length * side);
    const bounded =
      length <= SUGGESTION_MAX_ACROSS_CELLS && this.isWalked(bi, bj);
    const depth = bounded
      ? Math.max(1, Math.floor(length / 2))
      : Math.min(length, SECTION_DEPTH_CELLS);
    const last = first + (depth - 1) * side;
    const dir = walking ? Math.sign(axis === 'x' ? walking[0] : walking[1]) : 0;
    const run: Run = {
      section: mark.text,
      area: {
        id: this.newId(),
        kind: 'shelf',
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        section: mark.text,
        colour: { mode: 'default' },
        origin: 'section-run',
      },
      axis,
      dir,
      start: along,
      end: along,
      c0: Math.min(first, last),
      c1: Math.max(first, last),
      turned: 0,
      away: 0,
      base: null,
    };
    this.run = run;
    this.putRun(run);
  }

  /** Ends a run at the cell before the person along its axis, or removes it when nothing is left. */
  private cutRun(run: Run, mark: MapMark): void {
    const along = cellOf(run.axis === 'x' ? mark.x : mark.y);
    const dir = run.dir !== 0 ? run.dir : Math.sign(run.end - run.start) || 1;
    const end = along - dir;
    if ((end - run.start) * dir < 0) {
      this.removeArea(run.area.id);
      return;
    }
    run.end = end;
    this.putRun(run);
  }

  /** A section mark facing a tapped or earlier run shelf names it, and the run grows from it. */
  private adoptRun(
    mark: MapMark,
    shelf: MapArea,
    axis: Axis,
    along: number,
    walking: [number, number] | null
  ): void {
    const r = cellsOfArea(shelf);
    const [lo, hi] = axis === 'x' ? [r.i0, r.i1] : [r.j0, r.j1];
    const [c0, c1] = axis === 'x' ? [r.j0, r.j1] : [r.i0, r.i1];
    const at = Math.max(lo, Math.min(hi, along));
    // A shelf already named the same keeps its spelling.
    const section = shelf.section?.trim() ? shelf.section : mark.text;
    const area: MapArea = { ...shelf, section };
    this.run = {
      section,
      area,
      axis,
      dir: walking ? Math.sign(axis === 'x' ? walking[0] : walking[1]) : 0,
      start: at,
      end: at,
      c0,
      c1,
      turned: 0,
      away: 0,
      base: [lo, hi],
    };
    this.putArea(area);
  }

  /**
   * Splits a tapped strip named from its other side along the run's axis, and
   * puts the half facing the person as a new unnamed `suggested` shelf. The
   * far half keeps its id and its section. The side that named it is the
   * latest mark with its name that stood within 1.5 m facing it. `null` when
   * the strip is one cell across, when no such mark exists, or when it stood
   * on the person's side (a second section along the same face).
   */
  private otherFace(shelf: MapArea, mark: MapMark, axis: Axis): MapArea | null {
    if (shelf.origin !== 'suggested') return null;
    const r = cellsOfArea(shelf);
    // The strip runs along the run's axis, so it splits across the other one.
    const acrossY = axis === 'x';
    const [a0, a1] = acrossY ? [r.j0, r.j1] : [r.i0, r.i1];
    if (a1 - a0 + 1 < 2) return null;
    const middle = acrossY ? shelf.y + shelf.h / 2 : shelf.x + shelf.w / 2;
    const sideOf = (m: MapMark) => Math.sign((acrossY ? m.y : m.x) - middle);
    const key = (t: string | undefined) => t?.trim().toLowerCase() ?? '';
    const namer = [...this.sectionMarks]
      .reverse()
      .find(
        (m) =>
          m.id !== mark.id &&
          key(m.text) === key(shelf.section) &&
          facesAcross(m, shelf, acrossY)
      );
    const mine = sideOf(mark);
    if (!namer || mine === 0 || sideOf(namer) !== -mine) return null;
    const count = a1 - a0 + 1;
    const nearCells = Math.floor(count / 2);
    // The person's half runs from the edge on their side.
    const [n0, n1, f0, f1] =
      mine < 0
        ? [a0, a0 + nearCells - 1, a0 + nearCells, a1]
        : [a1 - nearCells + 1, a1, a0, a1 - nearCells];
    const piece = (c0: number, c1: number): CellRect =>
      acrossY
        ? { i0: r.i0, i1: r.i1, j0: c0, j1: c1 }
        : { i0: c0, i1: c1, j0: r.j0, j1: r.j1 };
    this.putArea({ ...shelf, ...rectMetres(piece(f0, f1)) });
    const near: MapArea = {
      id: this.newId(),
      kind: 'shelf',
      ...rectMetres(piece(n0, n1)),
      colour: { mode: 'default' },
      origin: 'suggested',
    };
    this.putArea(near);
    return near;
  }

  private runRect(run: Run): CellRect {
    const a0 = Math.min(run.start, run.end, run.base?.[0] ?? Infinity);
    const a1 = Math.max(run.start, run.end, run.base?.[1] ?? -Infinity);
    return run.axis === 'x'
      ? { i0: a0, i1: a1, j0: run.c0, j1: run.c1 }
      : { i0: run.c0, i1: run.c1, j0: a0, j1: a1 };
  }

  private putRun(run: Run): void {
    const m = rectMetres(this.runRect(run));
    const a = run.area;
    if (a.x === m.x && a.y === m.y && a.w === m.w && a.h === m.h) return;
    run.area = { ...a, ...m };
    this.putArea(run.area);
  }

  /**
   * Whether the run may reach along-cell `l`: no other area covers its band
   * there, and the band is not all walked, which would make it aisle.
   */
  private runMayCover(run: Run, l: number): boolean {
    let open = false;
    for (let c = run.c0; c <= run.c1; c++) {
      const [i, j] = run.axis === 'x' ? [l, c] : [c, l];
      if (this.coveredByOther(i, j, run.area.id)) return false;
      if (!this.isWalked(i, j)) open = true;
    }
    return open;
  }

  private followRun(p: LivePoint, prev: LivePoint | null): void {
    const run = this.run as Run;
    const unit = run.axis === 'x' ? [run.dir, 0] : [0, run.dir];
    // The turn is read over the last metre of walking, so dense points and a
    // single step of jitter neither end a run nor keep one alive.
    const walking = this.walkingDirection(p.x, p.y);
    const step = prev ? Math.hypot(p.x - prev.x, p.y - prev.y) : 0;
    if (walking && run.dir !== 0 && step > EPS) {
      const cos = walking[0] * unit[0] + walking[1] * unit[1];
      const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
      if (angle > TURN_DEGREES && angle < 180 - TURN_DEGREES) {
        run.turned += step;
        if (run.turned >= TURN_HELD_METRES) {
          this.run = null;
          return;
        }
      } else {
        run.turned = 0;
      }
    }
    const along = cellOf(run.axis === 'x' ? p.x : p.y);
    // Beside the run: no farther across from its band than a section mark looks.
    const across = cellOf(run.axis === 'x' ? p.y : p.x);
    const apart = Math.max(run.c0 - across, across - run.c1, 0);
    if (apart > SECTION_REACH_CELLS) {
      if (prev) run.away += Math.hypot(p.x - prev.x, p.y - prev.y);
      if (run.away >= TURN_HELD_METRES) this.run = null;
      return;
    }
    run.away = 0;
    if (run.dir === 0) {
      if (along === run.start) return;
      run.dir = Math.sign(along - run.start);
    }
    const ahead = (along - run.start) * run.dir;
    if (ahead <= 0) {
      run.end = run.start;
    } else if ((along - run.end) * run.dir < 0) {
      // Walking back along the run shortens it to where the person is.
      run.end = along;
    } else {
      while (run.end !== along && this.runMayCover(run, run.end + run.dir)) {
        run.end += run.dir;
      }
    }
    this.putRun(run);
  }

  // Counters.

  private placeCounter(mark: MapMark): void {
    const [dx, dy] = headingVector(mark.heading);
    const facingX = Math.abs(dx) >= Math.abs(dy);
    const w = facingX ? COUNTER_SHORT_METRES : COUNTER_LONG_METRES;
    const h = facingX ? COUNTER_LONG_METRES : COUNTER_SHORT_METRES;
    let x: number;
    let y: number;
    if (facingX) {
      const near = mark.x + Math.sign(dx) * COUNTER_GAP_METRES;
      x = snap(dx >= 0 ? near : near - w);
      y = snap(mark.y - h / 2);
    } else {
      const near = mark.y + Math.sign(dy) * COUNTER_GAP_METRES;
      y = snap(dy >= 0 ? near : near - h);
      x = snap(mark.x - w / 2);
    }
    const counter: MapArea = {
      id: '',
      kind: 'counter',
      x: r2(x),
      y: r2(y),
      w,
      h,
      ...(mark.text.trim() !== '' ? { section: mark.text } : {}),
      colour: { mode: 'default' },
      origin: 'counter-mark',
    };
    for (const a of this.areas.values()) {
      if (
        isBlockingArea(a.kind) &&
        overlapMetres(a, counter) > COVER_METRES + EPS
      ) {
        return;
      }
    }
    this.putArea({ ...counter, id: this.newId() });
  }
}

/**
 * The live map of shop-map plan 0003: fed tracked points, marks and the
 * tracking state, it answers the walked cells, the shelf suggestions, the
 * section run in progress and the events to append to the walk log.
 *
 * It emits `mark-put` for every mark, `area-put` and `area-removed` for what
 * the rules make and change, and `section-left`. It emits no path: the
 * recording screen appends the points the tracking guard keeps. Nothing is
 * painted while tracking is not `good`. No rule changes a shelf drawn by
 * hand: a `suggested` shelf is cut when walked across, and a section mark
 * names the `suggested` or `section-run` shelf it faces.
 */
export function createLiveMap(options: LiveMapOptions): LiveMapHandle {
  return new LiveMap(options);
}
