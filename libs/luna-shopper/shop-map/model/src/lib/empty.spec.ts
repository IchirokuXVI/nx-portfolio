import { emptyShopMap } from './empty';
import { validateShopMap } from './validate';

describe('emptyShopMap', () => {
  it.each([
    [1, 1],
    [2, 5],
    [40, 30],
  ])('answers a valid %dx%d document', (cols, rows) => {
    const doc = emptyShopMap(cols, rows);
    expect(doc.version).toBe(1);
    expect(doc.cell).toBe(0.5);
    expect(doc.size).toEqual({ cols, rows });
    expect(doc.anchors).toEqual([]);
    expect(validateShopMap(doc)).toEqual([]);
  });

  it('puts its one entrance in the middle of the bottom border', () => {
    expect(emptyShopMap(10, 6).fixtures).toEqual([
      { id: 'entrance', kind: 'entrance', x: 5, y: 5, w: 1, h: 1 },
    ]);
  });

  it.each([
    [0, 4],
    [4, -1],
    [2.5, 4],
  ])('refuses a %dx%d grid', (cols, rows) => {
    expect(() => emptyShopMap(cols, rows)).toThrow(RangeError);
  });
});
