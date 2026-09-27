import { fitOutline } from './outline';

describe('fitOutline', () => {
  it('keeps an east facing rectangle as it is, in cells', () => {
    const fitted = fitOutline(
      {
        points: [
          [0, 0],
          [20, 0],
          [20, 10],
          [0, 10],
        ],
      },
      0.5
    );
    expect(fitted.size).toEqual({ cols: 40, rows: 20 });
    expect(fitted.outline.bearing).toBe(90);
    expect(fitted.outline.points).toEqual([
      [0, 20],
      [40, 20],
      [40, 0],
      [0, 0],
    ]);
  });

  it('turns a building whose long wall runs north so the wall lies along x', () => {
    const fitted = fitOutline(
      {
        points: [
          [0, 0],
          [5, 0],
          [5, 15],
          [0, 15],
        ],
      },
      1
    );
    expect(fitted.size).toEqual({ cols: 15, rows: 5 });
    expect(fitted.outline.bearing).toBe(0);
  });

  it('turns a rotated rectangle square to the grid', () => {
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const corner = (e: number, n: number): [number, number] => [
      e * c - n * s + 100,
      e * s + n * c - 50,
    ];
    const fitted = fitOutline(
      { points: [corner(0, 0), corner(12, 0), corner(12, 4), corner(0, 4)] },
      0.5
    );
    expect(fitted.size).toEqual({ cols: 24, rows: 8 });
    expect(fitted.outline.bearing).toBe(60);
  });

  it('answers the same fit however the outline is traced', () => {
    const traced = fitOutline(
      {
        points: [
          [0, 10],
          [20, 10],
          [20, 0],
          [0, 0],
        ],
      },
      0.5
    );
    expect(traced.size).toEqual({ cols: 40, rows: 20 });
    expect(traced.outline.bearing).toBe(90);
  });

  it.each([
    [
      'fewer than three points',
      [
        [0, 0],
        [1, 1],
      ] as [number, number][],
      0.5,
    ],
    [
      'a cell of no size',
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ] as [number, number][],
      0,
    ],
  ])('refuses %s', (_, points, cell) => {
    expect(() => fitOutline({ points }, cell)).toThrow(RangeError);
  });
});
