import type { ShopMapGrid } from './grid';
import {
  FACE_STEPS,
  coversCell,
  distancesOver,
  faceOn,
  fixtureCells,
  isBlocking,
  reachFromEntrances,
  walkableGrid,
} from './grid';
import type {
  ShopMapAnchor,
  ShopMapCell,
  ShopMapDocument,
  ShopMapFixture,
  WalkOrder,
} from './types';

/** A stop on the walk: a cell, and the distances from it to every cell. */
interface Stop {
  cell: ShopMapCell;
  dist: ShopMapGrid<number>;
}

interface PlacedSection {
  anchor: ShopMapAnchor;
  stop: Stop;
}

const byId = <T extends { id: string }>(a: T, b: T): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function isFree(grid: ShopMapGrid<boolean>, cell: ShopMapCell): boolean {
  return grid[cell.y]?.[cell.x] === true;
}

/**
 * The shortest path from `from` to `to`, both included, read back from the
 * distances out of `from`. Ties go to the first neighbour in
 * {@link FACE_STEPS} order, so the same document always draws the same route.
 */
function pathBetween(
  grid: ShopMapGrid<boolean>,
  distFrom: ShopMapGrid<number>,
  to: ShopMapCell
): ShopMapCell[] {
  const path: ShopMapCell[] = [{ x: to.x, y: to.y }];
  let cell = to;
  while (distFrom[cell.y][cell.x] > 0) {
    const want = distFrom[cell.y][cell.x] - 1;
    const back = FACE_STEPS.map((s) => ({
      x: cell.x + s.dx,
      y: cell.y + s.dy,
    })).find((n) => isFree(grid, n) && distFrom[n.y][n.x] === want);
    if (!back) break;
    path.push(back);
    cell = back;
  }
  return path.reverse();
}

/**
 * Orders the interior stops between a fixed start (index 0) and a fixed end
 * (the last index of `cost`): nearest neighbour first, then 2-opt until no
 * reversal shortens the walk. Distances are whole cells, so "shortens" is
 * exact and the loop ends.
 */
export function solvePath(cost: number[][], interior: number[]): number[] {
  const end = cost.length - 1;
  const left = [...interior];
  const order: number[] = [];
  let at = 0;
  while (left.length > 0) {
    let best = 0;
    for (let k = 1; k < left.length; k++) {
      if (cost[at][left[k]] < cost[at][left[best]]) best = k;
    }
    at = left[best];
    order.push(at);
    left.splice(best, 1);
  }

  const path = [0, ...order, end];
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < path.length - 2; i++) {
      for (let j = i + 1; j < path.length - 1; j++) {
        const before = cost[path[i - 1]][path[i]] + cost[path[j]][path[j + 1]];
        const after = cost[path[i - 1]][path[j]] + cost[path[i]][path[j + 1]];
        if (after < before) {
          const reversed = path.slice(i, j + 1).reverse();
          path.splice(i, reversed.length, ...reversed);
          improved = true;
        }
      }
    }
  }
  return path;
}

export function pathLength(cost: number[][], path: number[]): number {
  let total = 0;
  for (let k = 1; k < path.length; k++) total += cost[path[k - 1]][path[k]];
  return total;
}

/** The free cells beside a checkout that its queue can stand on. */
function checkoutCells(
  doc: ShopMapDocument,
  grid: ShopMapGrid<boolean>,
  reach: ShopMapGrid<number>,
  checkout: ShopMapFixture
): ShopMapCell[] {
  const seen = new Set<string>();
  const cells: ShopMapCell[] = [];
  for (const c of fixtureCells(doc, checkout)) {
    for (const s of FACE_STEPS) {
      const n = { x: c.x + s.dx, y: c.y + s.dy };
      const key = `${n.x},${n.y}`;
      if (seen.has(key) || !isFree(grid, n) || reach[n.y][n.x] === Infinity) {
        continue;
      }
      seen.add(key);
      cells.push(n);
    }
  }
  return cells;
}

/**
 * The walk from the entrance through every section anchor to a checkout
 * (section 4). The route starts on the first entrance by id, at its first
 * free cell reading row by row. It ends at whichever checkout makes the whole
 * walk shortest (ties to the first by id), standing on the free cell beside
 * it nearest the last section; with no reachable checkout it ends at the
 * section farthest from the entrance, and `endsAtCheckout` says so.
 *
 * Anchors the entrance cannot reach are left out of the answer, so a draft
 * that fails validation still answers a walk over what can be walked.
 */
export function walkOrder(doc: ShopMapDocument): WalkOrder {
  const grid = walkableGrid(doc);
  const empty: WalkOrder = {
    sections: [],
    products: [],
    route: [],
    endsAtCheckout: false,
  };

  const entrance = doc.fixtures
    .filter((f) => f.kind === 'entrance')
    .sort(byId)
    .map((f) => fixtureCells(doc, f).find((c) => isFree(grid, c)))
    .find((c): c is ShopMapCell => c !== undefined);
  if (!entrance) return empty;

  const start: Stop = { cell: entrance, dist: distancesOver(grid, [entrance]) };
  const reach = start.dist;
  const faceReach = reachFromEntrances(doc, grid);
  const reachable = (c: ShopMapCell | null): c is ShopMapCell =>
    c !== null && reach[c.y][c.x] !== Infinity;

  const sections: PlacedSection[] = [];
  for (const anchor of doc.anchors
    .filter((a) => a.kind === 'section')
    .sort(byId)) {
    const cell = faceOn(grid, faceReach, anchor);
    if (reachable(cell)) {
      sections.push({
        anchor,
        stop: { cell, dist: distancesOver(grid, [cell]) },
      });
    }
  }
  const stops: Stop[] = [start, ...sections.map((s) => s.stop)];
  const between = stops.map((a) =>
    stops.map((b) => a.dist[b.cell.y][b.cell.x])
  );

  const checkouts = doc.fixtures
    .filter((f) => f.kind === 'checkout')
    .sort(byId)
    .map((f) => checkoutCells(doc, grid, reach, f))
    .filter((cells) => cells.length > 0);

  let path: number[];
  let endCell: ShopMapCell | null = null;
  let endsAtCheckout = false;
  const interior = sections.map((_, k) => k + 1);

  if (checkouts.length > 0) {
    let bestLength = Infinity;
    let bestPath: number[] = [0];
    let bestCells: ShopMapCell[] = [];
    for (const cells of checkouts) {
      const toEnd = stops.map((s) =>
        Math.min(...cells.map((c) => s.dist[c.y][c.x]))
      );
      const cost = between.map((row, k) => [...row, toEnd[k]]);
      cost.push([...toEnd, 0]);
      const candidate = solvePath(cost, interior);
      const length = pathLength(cost, candidate);
      if (length < bestLength) {
        bestLength = length;
        bestPath = candidate;
        bestCells = cells;
      }
    }
    path = bestPath.slice(0, -1);
    const last = stops[path[path.length - 1]];
    endCell = bestCells.reduce((best, c) =>
      last.dist[c.y][c.x] < last.dist[best.y][best.x] ? c : best
    );
    endsAtCheckout = true;
  } else if (sections.length > 0) {
    let far = 1;
    for (let k = 2; k < stops.length; k++) {
      if (between[0][k] > between[0][far]) far = k;
    }
    const inner = interior.filter((k) => k !== far);
    const order = [0, ...inner, far];
    const cost = order.map((a) => order.map((b) => between[a][b]));
    path = solvePath(
      cost,
      inner.map((_, k) => k + 1)
    ).map((k) => order[k]);
  } else {
    path = [0];
  }

  const route: ShopMapCell[] = [{ ...start.cell }];
  const arrivals = new Map<number, number>();
  for (let k = 1; k < path.length; k++) {
    const leg = pathBetween(grid, stops[path[k - 1]].dist, stops[path[k]].cell);
    route.push(...leg.slice(1));
    arrivals.set(path[k], route.length - 1);
  }
  if (endCell) {
    const leg = pathBetween(grid, stops[path[path.length - 1]].dist, endCell);
    route.push(...leg.slice(1));
  }

  const walkedSections = path.slice(1).map((k) => {
    const { anchor } = sections[k - 1];
    return {
      anchorId: anchor.id,
      ...(anchor.sectionId ? { sectionId: anchor.sectionId } : {}),
      ...(anchor.categoryId ? { categoryId: anchor.categoryId } : {}),
      at: arrivals.get(k) ?? 0,
    };
  });

  const products = doc.anchors
    .filter((a) => a.kind === 'product')
    .sort(byId)
    .flatMap((anchor) => {
      const cell = faceOn(grid, faceReach, anchor);
      if (!reachable(cell)) return [];
      const dist = distancesOver(grid, [cell]);
      let at = 0;
      for (let k = 1; k < route.length; k++) {
        if (dist[route[k].y][route[k].x] < dist[route[at].y][route[at].x])
          at = k;
      }
      return [
        {
          anchorId: anchor.id,
          ...(anchor.itemId ? { itemId: anchor.itemId } : {}),
          ...(anchor.ean ? { ean: anchor.ean } : {}),
          sectionAnchorId: owningSection(doc, anchor, dist, sections),
          at,
        },
      ];
    })
    .sort((a, b) => a.at - b.at || (a.anchorId < b.anchorId ? -1 : 1));

  return { sections: walkedSections, products, route, endsAtCheckout };
}

/**
 * The section anchor a product belongs to: one on the same fixture, else the
 * nearest by standing distance, else none. Ties go to the first by id.
 */
function owningSection(
  doc: ShopMapDocument,
  product: ShopMapAnchor,
  dist: ShopMapGrid<number>,
  sections: PlacedSection[]
): string | null {
  const nearest = (candidates: PlacedSection[]): string | null => {
    let best: PlacedSection | null = null;
    for (const s of candidates) {
      const d = dist[s.stop.cell.y][s.stop.cell.x];
      if (d === Infinity) continue;
      if (!best || d < dist[best.stop.cell.y][best.stop.cell.x]) best = s;
    }
    return best?.anchor.id ?? null;
  };
  const fixture = [...doc.fixtures]
    .sort(byId)
    .find((f) => isBlocking(f.kind) && coversCell(f, product.at));
  if (fixture) {
    const same = nearest(
      sections.filter((s) => coversCell(fixture, s.anchor.at))
    );
    if (same) return same;
  }
  return nearest(sections);
}
