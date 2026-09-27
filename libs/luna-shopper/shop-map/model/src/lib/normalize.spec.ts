import { copyOf, supermarketShop } from './__fixtures__/fixtures';
import { normalizeShopMap } from './normalize';
import type { ShopMapDocument } from './types';

describe('normalizeShopMap', () => {
  it('sorts fixtures and anchors by id', () => {
    const shuffled = copyOf(supermarketShop);
    shuffled.fixtures.reverse();
    shuffled.anchors.reverse();
    const normal = normalizeShopMap(shuffled);
    const ids = normal.fixtures.map((f) => f.id);
    expect(ids).toEqual([...ids].sort());
    expect(normal.anchors.map((a) => a.id)).toEqual(
      supermarketShop.anchors.map((a) => a.id).sort()
    );
  });

  it('makes two equal documents serialize equal', () => {
    const a: ShopMapDocument = {
      anchors: [
        { text: 'x', kind: 'note', id: 'n', at: { y: 1, x: 2 } },
        { id: 'm', kind: 'note', at: { x: 0, y: 0 }, face: undefined },
      ],
      fixtures: [{ h: 1, w: 1, y: 0, x: 0, kind: 'shelf', id: 'b' }],
      size: { rows: 4, cols: 4 },
      cell: 0.5,
      version: 1,
    };
    const b: ShopMapDocument = {
      version: 1,
      cell: 0.5,
      size: { cols: 4, rows: 4 },
      fixtures: [{ id: 'b', kind: 'shelf', x: 0, y: 0, w: 1, h: 1 }],
      anchors: [
        { id: 'm', kind: 'note', at: { x: 0, y: 0 } },
        { id: 'n', kind: 'note', at: { x: 2, y: 1 }, text: 'x' },
      ],
    };
    expect(JSON.stringify(normalizeShopMap(a))).toBe(
      JSON.stringify(normalizeShopMap(b))
    );
  });

  it('rounds every grid number to a whole cell', () => {
    const doc = copyOf(supermarketShop);
    doc.fixtures[0].x = 6.2;
    doc.anchors[0].at.y = 2.6;
    doc.outline = {
      points: [
        [-0.2, 0],
        [9.7, 0],
        [9.7, 4.4],
      ],
      bearing: 12.5,
    };
    const normal = normalizeShopMap(doc);
    expect(normal.fixtures.find((f) => f.id === 'deli')?.x).toBe(6);
    expect(normal.anchors.find((a) => a.id === 'a-produce')?.at.y).toBe(3);
    expect(normal.outline).toEqual({
      points: [
        [0, 0],
        [10, 0],
        [10, 4],
      ],
      bearing: 12.5,
    });
    expect(Object.is(normal.outline?.points[0][0], 0)).toBe(true);
  });

  it('leaves an already normal document as it is', () => {
    const once = normalizeShopMap(supermarketShop);
    expect(normalizeShopMap(once)).toEqual(once);
  });
});
