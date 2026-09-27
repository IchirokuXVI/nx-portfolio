import type {
  AnchorFace,
  FixtureKind,
  ShopMapAnchor,
  ShopMapCell,
  ShopMapDocument,
  ShopMapFixture,
} from './types';

/** A row major grid: `grid[y][x]`. */
export type ShopMapGrid<T> = T[][];

/**
 * The four neighbours in the order every search here visits them. A fixed
 * order is what makes routes and faces deterministic.
 */
export const FACE_STEPS: readonly {
  face: AnchorFace;
  dx: number;
  dy: number;
}[] = [
  { face: 'n', dx: 0, dy: -1 },
  { face: 's', dx: 0, dy: 1 },
  { face: 'e', dx: 1, dy: 0 },
  { face: 'w', dx: -1, dy: 0 },
];

/** Whether a fixture of this kind stops a shopper walking through it. */
export function isBlocking(kind: FixtureKind): boolean {
  return kind !== 'entrance' && kind !== 'exit';
}

export function inBounds(doc: ShopMapDocument, cell: ShopMapCell): boolean {
  return (
    Number.isInteger(cell.x) &&
    Number.isInteger(cell.y) &&
    cell.x >= 0 &&
    cell.y >= 0 &&
    cell.x < doc.size.cols &&
    cell.y < doc.size.rows
  );
}

export function coversCell(
  fixture: ShopMapFixture,
  cell: ShopMapCell
): boolean {
  return (
    cell.x >= fixture.x &&
    cell.x < fixture.x + fixture.w &&
    cell.y >= fixture.y &&
    cell.y < fixture.y + fixture.h
  );
}

/** The cells of a fixture that fall inside the grid, row by row. */
export function fixtureCells(
  doc: ShopMapDocument,
  fixture: ShopMapFixture
): ShopMapCell[] {
  const cells: ShopMapCell[] = [];
  const x0 = Math.max(0, Math.ceil(fixture.x));
  const y0 = Math.max(0, Math.ceil(fixture.y));
  const x1 = Math.min(doc.size.cols, fixture.x + fixture.w);
  const y1 = Math.min(doc.size.rows, fixture.y + fixture.h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      cells.push({ x, y });
    }
  }
  return cells;
}

function makeGrid<T>(doc: ShopMapDocument, value: T): ShopMapGrid<T> {
  const grid: ShopMapGrid<T> = [];
  for (let y = 0; y < doc.size.rows; y++) {
    grid.push(new Array<T>(doc.size.cols).fill(value));
  }
  return grid;
}

/**
 * Which cells can be walked: every cell not covered by a blocking fixture.
 * An aisle is not drawn; it is the floor between two shelves.
 */
export function walkableGrid(doc: ShopMapDocument): ShopMapGrid<boolean> {
  const grid = makeGrid(doc, true);
  for (const fixture of doc.fixtures) {
    if (!isBlocking(fixture.kind)) continue;
    for (const { x, y } of fixtureCells(doc, fixture)) {
      grid[y][x] = false;
    }
  }
  return grid;
}

function isFree(grid: ShopMapGrid<boolean>, cell: ShopMapCell): boolean {
  return grid[cell.y]?.[cell.x] === true;
}

/** Breadth first distances from several free cells at once. */
export function distancesOver(
  grid: ShopMapGrid<boolean>,
  starts: readonly ShopMapCell[]
): ShopMapGrid<number> {
  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : 0;
  const dist: ShopMapGrid<number> = [];
  for (let y = 0; y < rows; y++) {
    dist.push(new Array<number>(cols).fill(Infinity));
  }
  const queue: ShopMapCell[] = [];
  for (const start of starts) {
    if (isFree(grid, start) && dist[start.y][start.x] === Infinity) {
      dist[start.y][start.x] = 0;
      queue.push(start);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head];
    const next = dist[cell.y][cell.x] + 1;
    for (const step of FACE_STEPS) {
      const n = { x: cell.x + step.dx, y: cell.y + step.dy };
      if (isFree(grid, n) && dist[n.y][n.x] === Infinity) {
        dist[n.y][n.x] = next;
        queue.push(n);
      }
    }
  }
  return dist;
}

/**
 * Breadth first distances over free cells from `cell`, `Infinity` where
 * unreachable. A blocked or out of bounds start reaches nothing.
 */
export function distancesFrom(
  doc: ShopMapDocument,
  cell: ShopMapCell
): ShopMapGrid<number> {
  return distancesOver(walkableGrid(doc), [cell]);
}

/** The in bounds cells of every `entrance` fixture, where every walk starts. */
export function entranceCells(doc: ShopMapDocument): ShopMapCell[] {
  return doc.fixtures
    .filter((f) => f.kind === 'entrance')
    .flatMap((f) => fixtureCells(doc, f));
}

/**
 * The free cell a shopper stands on for an anchor, given the walkable grid
 * and the cells an entrance can reach.
 */
export function faceOn(
  grid: ShopMapGrid<boolean>,
  reach: ShopMapGrid<number>,
  anchor: ShopMapAnchor
): ShopMapCell | null {
  const at = anchor.at;
  if (isFree(grid, at)) return { x: at.x, y: at.y };
  const free = FACE_STEPS.map((s) => ({
    face: s.face,
    cell: { x: at.x + s.dx, y: at.y + s.dy },
  })).filter((c) => isFree(grid, c.cell));
  const stated = free.find((c) => c.face === anchor.face);
  if (stated) return stated.cell;
  const reachable = free.find((c) => reach[c.cell.y][c.cell.x] !== Infinity);
  return (reachable ?? free[0])?.cell ?? null;
}

/**
 * The free cell a shopper stands on for this anchor: the neighbour its `face`
 * names when that one is free, else the first free neighbour an entrance can
 * reach (north, south, east, west), else the first free neighbour at all. An
 * anchor on a free cell stands on its own cell. `null` when there is none.
 */
export function anchorFace(
  doc: ShopMapDocument,
  anchor: ShopMapAnchor
): ShopMapCell | null {
  const grid = walkableGrid(doc);
  return faceOn(grid, reachFromEntrances(doc, grid), anchor);
}

/**
 * Distances from every entrance. With no entrance every free cell counts as
 * reachable (distance 0), so a face can still be chosen on a draft.
 */
export function reachFromEntrances(
  doc: ShopMapDocument,
  grid: ShopMapGrid<boolean>
): ShopMapGrid<number> {
  const entrances = entranceCells(doc);
  if (entrances.length > 0) return distancesOver(grid, entrances);
  return grid.map((row) => row.map((free) => (free ? 0 : Infinity)));
}
