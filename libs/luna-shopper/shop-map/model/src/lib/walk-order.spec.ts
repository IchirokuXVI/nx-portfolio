import {
  copyOf,
  cornerShop,
  expectedCornerShop,
  expectedSupermarket,
  supermarketShop,
} from './__fixtures__/fixtures';
import { emptyShopMap } from './empty';
import { anchorFace, distancesFrom, walkableGrid } from './grid';
import type { ShopMapCell, ShopMapDocument } from './types';
import { walkOrder } from './walk-order';

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [
      item,
      ...rest,
    ])
  );
}

/** The shortest walk by trying every order, for checking the heuristic. */
function bruteForceLength(doc: ShopMapDocument, start: ShopMapCell): number {
  const grid = walkableGrid(doc);
  const stands = doc.anchors
    .filter((a) => a.kind === 'section')
    .map((a) => anchorFace(doc, a) as ShopMapCell);
  const distance = (a: ShopMapCell, b: ShopMapCell) =>
    distancesFrom(doc, a)[b.y][b.x];
  const ends = doc.fixtures
    .filter((f) => f.kind === 'checkout')
    .map((f) => {
      const cells: ShopMapCell[] = [];
      for (let y = f.y - 1; y <= f.y + f.h; y++) {
        for (let x = f.x - 1; x <= f.x + f.w; x++) {
          const side =
            (y === f.y - 1 || y === f.y + f.h) !==
            (x === f.x - 1 || x === f.x + f.w);
          if (side && grid[y]?.[x]) cells.push({ x, y });
        }
      }
      return cells;
    });
  let best = Infinity;
  for (const order of permutations(stands)) {
    let length = 0;
    let at = start;
    for (const stand of order) {
      length += distance(at, stand);
      at = stand;
    }
    const last = at;
    for (const cells of ends) {
      const tail = Math.min(...cells.map((c) => distance(last, c)));
      best = Math.min(best, length + tail);
    }
  }
  return best;
}

describe('walkOrder', () => {
  it('walks the corner shop as expected.json states, ending at the farthest section', () => {
    expect(walkOrder(cornerShop)).toEqual(expectedCornerShop.walk);
  });

  it('walks the supermarket as expected.json states', () => {
    const walk = walkOrder(supermarketShop);
    const want = expectedSupermarket.walk;
    expect(walk.sections).toEqual(want.sections);
    expect(walk.products).toEqual(want.products);
    expect(walk.endsAtCheckout).toBe(want.endsAtCheckout);
    expect(walk.route).toHaveLength(want.routeLength);
    expect(walk.route[0]).toEqual(want.routeStart);
    expect(walk.route[walk.route.length - 1]).toEqual(want.routeEnd);
  });

  it('finds the shortest walk on the supermarket, checked against every order', () => {
    const walk = walkOrder(supermarketShop);
    expect(walk.route.length - 1).toBe(
      bruteForceLength(supermarketShop, walk.route[0])
    );
  });

  it.each([
    ['corner shop', cornerShop],
    ['supermarket', supermarketShop],
  ])('draws a %s route of neighbouring free cells', (_, doc) => {
    const grid = walkableGrid(doc);
    const { route } = walkOrder(doc);
    route.forEach((cell, k) => {
      expect(grid[cell.y][cell.x]).toBe(true);
      if (k > 0) {
        const prev = route[k - 1];
        expect(Math.abs(prev.x - cell.x) + Math.abs(prev.y - cell.y)).toBe(1);
      }
    });
  });

  it('answers the same order whatever order the document lists things in', () => {
    const shuffled = copyOf(supermarketShop);
    shuffled.fixtures.reverse();
    shuffled.anchors.reverse();
    expect(walkOrder(shuffled)).toEqual(walkOrder(supermarketShop));
    expect(walkOrder(supermarketShop)).toEqual(walkOrder(supermarketShop));
  });

  it('starts at the first entrance by id', () => {
    const doc = copyOf(cornerShop);
    doc.fixtures.push({
      id: 'a-side',
      kind: 'entrance',
      x: 0,
      y: 3,
      w: 1,
      h: 1,
    });
    expect(walkOrder(doc).route[0]).toEqual({ x: 0, y: 3 });
  });

  it('answers nothing for a document with no entrance', () => {
    const doc = copyOf(cornerShop);
    doc.fixtures = doc.fixtures.filter((f) => f.kind !== 'entrance');
    expect(walkOrder(doc)).toEqual({
      sections: [],
      products: [],
      route: [],
      endsAtCheckout: false,
    });
  });

  it('walks straight to the checkout when there are no sections', () => {
    const doc = emptyShopMap(5, 3);
    doc.fixtures.push({ id: 'till', kind: 'checkout', x: 0, y: 0, w: 1, h: 1 });
    const walk = walkOrder(doc);
    expect(walk.endsAtCheckout).toBe(true);
    expect(walk.sections).toEqual([]);
    expect(walk.route[0]).toEqual({ x: 2, y: 2 });
    expect(walk.route).toHaveLength(4);
  });

  it('stands still on an empty shop with no checkout', () => {
    expect(walkOrder(emptyShopMap(4, 4)).route).toEqual([{ x: 2, y: 3 }]);
  });

  it('leaves out anchors the entrance cannot reach', () => {
    const doc = copyOf(cornerShop);
    doc.fixtures.push({ id: 'z-wall', kind: 'wall', x: 0, y: 5, w: 8, h: 1 });
    const walk = walkOrder(doc);
    expect(walk.sections).toEqual([]);
    expect(walk.products).toEqual([]);
    expect(walk.route).toEqual([{ x: 3, y: 6 }]);
  });

  it('gives a product with no section anywhere no section', () => {
    const doc = copyOf(cornerShop);
    doc.anchors = doc.anchors.filter((a) => a.kind !== 'section');
    const walk = walkOrder(doc);
    expect(walk.products.map((p) => p.sectionAnchorId)).toEqual([null, null]);
  });
});
