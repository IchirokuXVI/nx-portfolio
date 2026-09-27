import { emptyShopMap } from './empty';
import { parallelAisles } from './templates';
import { validateShopMap } from './validate';

describe('parallelAisles', () => {
  it('lays shelf pairs back to back with the gap between pairs', () => {
    expect(parallelAisles(8, 4, 2, 2)).toEqual([
      { id: 'aisle-1-a', kind: 'shelf', x: 1, y: 0, w: 1, h: 4 },
      { id: 'aisle-1-b', kind: 'shelf', x: 2, y: 0, w: 1, h: 4 },
      { id: 'aisle-2-a', kind: 'shelf', x: 5, y: 0, w: 1, h: 4 },
      { id: 'aisle-2-b', kind: 'shelf', x: 6, y: 0, w: 1, h: 4 },
    ]);
  });

  it.each([
    [6, 10, 1, 1, 2],
    [14, 8, 3, 2, 6],
    [20, 12, 6, 1, 12],
  ])(
    'fits %dx%d with %d pairs and a gap of %d',
    (cols, rows, count, gap, shelves) => {
      const fixtures = parallelAisles(cols, rows, count, gap);
      expect(fixtures).toHaveLength(shelves);
      for (const f of fixtures) {
        expect(f.x).toBeGreaterThanOrEqual(0);
        expect(f.x + f.w).toBeLessThanOrEqual(cols);
        expect(f.h).toBe(rows);
      }
    }
  );

  it('answers the same fixtures every time', () => {
    expect(parallelAisles(20, 10, 4, 2)).toEqual(parallelAisles(20, 10, 4, 2));
  });

  it('makes a valid shop once placed below a cross aisle', () => {
    const doc = emptyShopMap(14, 10);
    doc.fixtures.push(
      ...parallelAisles(14, 6, 3, 2).map((f) => ({ ...f, y: f.y + 2 }))
    );
    expect(validateShopMap(doc)).toEqual([]);
  });

  it.each([
    ['too narrow a grid', 4, 4, 2, 1],
    ['no pairs', 10, 4, 0, 1],
    ['no gap', 10, 4, 2, 0],
    ['a fractional count', 10, 4, 1.5, 1],
  ])('refuses %s', (_, cols, rows, count, gap) => {
    expect(() => parallelAisles(cols, rows, count, gap)).toThrow(RangeError);
  });
});
