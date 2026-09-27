import {
  FACE_STEPS,
  coversCell,
  distancesOver,
  entranceCells,
  inBounds,
  isBlocking,
  walkableGrid,
} from './grid';
import type {
  ShopMapAnchor,
  ShopMapDocument,
  ShopMapFixture,
  ShopMapProblem,
  ShopMapProblemCode,
} from './types';

function fixtureInBounds(doc: ShopMapDocument, f: ShopMapFixture): boolean {
  return (
    [f.x, f.y, f.w, f.h].every(Number.isInteger) &&
    f.w >= 1 &&
    f.h >= 1 &&
    f.x >= 0 &&
    f.y >= 0 &&
    f.x + f.w <= doc.size.cols &&
    f.y + f.h <= doc.size.rows
  );
}

function touchesBorder(doc: ShopMapDocument, f: ShopMapFixture): boolean {
  return (
    f.x === 0 ||
    f.y === 0 ||
    f.x + f.w === doc.size.cols ||
    f.y + f.h === doc.size.rows
  );
}

function isPinned(anchor: ShopMapAnchor): boolean {
  return anchor.kind === 'section' || anchor.kind === 'product';
}

function isNamed(anchor: ShopMapAnchor): boolean {
  if (anchor.kind === 'section')
    return !!anchor.sectionId || !!anchor.categoryId;
  if (anchor.kind === 'product') return !!anchor.itemId || !!anchor.ean;
  return true;
}

/**
 * Every problem with a document (section 2); an empty list means valid.
 * Problems come grouped by code in the order of {@link ShopMapProblemCode},
 * and within a code in document order, so the same document always answers
 * the same list. A missing checkout is not a problem.
 */
export function validateShopMap(doc: ShopMapDocument): ShopMapProblem[] {
  const found = new Map<ShopMapProblemCode, ShopMapProblem[]>();
  const report = (problem: ShopMapProblem) => {
    const list = found.get(problem.code) ?? [];
    list.push(problem);
    found.set(problem.code, list);
  };

  for (const f of doc.fixtures) {
    if (!fixtureInBounds(doc, f)) report({ code: 'OUT_OF_BOUNDS', id: f.id });
  }
  for (const a of doc.anchors) {
    if (!inBounds(doc, a.at)) report({ code: 'OUT_OF_BOUNDS', id: a.id });
  }

  const blocking = doc.fixtures.filter((f) => isBlocking(f.kind));
  for (let j = 0; j < blocking.length; j++) {
    for (let i = 0; i < j; i++) {
      const a = blocking[i];
      const b = blocking[j];
      const x = Math.max(a.x, b.x);
      const y = Math.max(a.y, b.y);
      if (
        x < Math.min(a.x + a.w, b.x + b.w) &&
        y < Math.min(a.y + a.h, b.y + b.h)
      ) {
        report({ code: 'BLOCKING_OVERLAP', id: b.id, cell: { x, y } });
      }
    }
  }

  for (const f of doc.fixtures) {
    if (f.kind !== 'entrance' && f.kind !== 'exit') continue;
    if (fixtureInBounds(doc, f) && !touchesBorder(doc, f)) {
      report({ code: 'ENTRANCE_INSIDE', id: f.id });
    }
  }
  if (!doc.fixtures.some((f) => f.kind === 'entrance')) {
    report({ code: 'NO_ENTRANCE' });
  }

  const grid = walkableGrid(doc);
  for (const a of doc.anchors) {
    if (!isPinned(a) || !inBounds(doc, a.at)) continue;
    const onFixture = blocking.some((f) => coversCell(f, a.at));
    if (!onFixture) {
      report({ code: 'ANCHOR_OFF_FIXTURE', id: a.id, cell: { ...a.at } });
      continue;
    }
    const hasFreeNeighbour = FACE_STEPS.some(
      (s) => grid[a.at.y + s.dy]?.[a.at.x + s.dx] === true
    );
    if (!hasFreeNeighbour) {
      report({ code: 'ANCHOR_UNREACHABLE', id: a.id, cell: { ...a.at } });
    }
  }
  for (const a of doc.anchors) {
    if (!isNamed(a)) report({ code: 'ANCHOR_UNNAMED', id: a.id });
  }

  const entrances = entranceCells(doc);
  if (entrances.length > 0) {
    const reach = distancesOver(grid, entrances);
    search: for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        if (grid[y][x] && reach[y][x] === Infinity) {
          report({ code: 'DISCONNECTED', cell: { x, y } });
          break search;
        }
      }
    }
  }

  return PROBLEM_ORDER.flatMap((code) => found.get(code) ?? []);
}

/** The codes of section 2, in the order its table states them. */
export const PROBLEM_ORDER: readonly ShopMapProblemCode[] = [
  'OUT_OF_BOUNDS',
  'BLOCKING_OVERLAP',
  'ENTRANCE_INSIDE',
  'NO_ENTRANCE',
  'ANCHOR_OFF_FIXTURE',
  'ANCHOR_UNREACHABLE',
  'ANCHOR_UNNAMED',
  'DISCONNECTED',
];
