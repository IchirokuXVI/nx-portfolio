import {
  boxOf,
  cellsPath,
  darken,
  headingToScreenDegrees,
  movedBox,
  snapBox,
  unionBox,
  walkedCellsOfPath,
} from './geometry';

describe('geometry', () => {
  it('walks the cells within half a metre of the path', () => {
    const cells = walkedCellsOfPath([
      {
        points: [
          [0.25, 0.25],
          [1.75, 0.25],
        ],
      },
    ]);
    // The line runs through the centres of row 0; rows 1 and -1 are 0.5 m away.
    expect(cells.has('-1,0')).toBe(true);
    expect(cells.has('4,0')).toBe(true);
    expect(cells.has('-1,1')).toBe(false);
    expect(cells.has('1,-1')).toBe(true);
    expect(cells.has('1,0')).toBe(true);
    expect(cells.has('1,1')).toBe(true);
    expect(cells.has('1,2')).toBe(false);
    expect(cells.has('5,0')).toBe(false);
  });

  it('walks the cells around a path of one point', () => {
    const cells = walkedCellsOfPath([{ points: [[0.25, 0.25]] }]);
    expect(cells.has('0,0')).toBe(true);
    expect(cells.has('1,1')).toBe(false);
  });

  it('merges a row of cells into one rectangle', () => {
    expect(cellsPath(['0,0', '1,0', '2,0', '5,0', '0,1'])).toBe(
      'M0 0h1.5v0.5h-1.5zM2.5 0h0.5v0.5h-0.5zM0 0.5h0.5v0.5h-0.5z'
    );
  });

  it('snaps a box to the half metre grid only with the switch on', () => {
    const b = boxOf(1.12, 2.9, 0.31, 1.26);
    expect(b).toEqual({
      x: 0.31,
      y: 1.26,
      w: expect.closeTo(0.81),
      h: expect.closeTo(1.64),
    });
    expect(snapBox(b, true)).toEqual({ x: 0.5, y: 1.5, w: 0.5, h: 1.5 });
    expect(snapBox(b, false)).toEqual({ x: 0.31, y: 1.26, w: 0.81, h: 1.64 });
  });

  it('moves a box without changing its size', () => {
    expect(movedBox({ x: 1, y: 1, w: 2.8, h: 1.4 }, 0.37, -0.2, true)).toEqual({
      x: 1.5,
      y: 1,
      w: 2.8,
      h: 1.4,
    });
  });

  it('darkens a custom colour by 40 percent for its border', () => {
    expect(darken('#ffffff', 0.4)).toBe('#999999');
    expect(darken('#c0392b', 0.4)).toBe('#73221a');
  });

  it('points a heading the way the model faces it, (-sin h, cos h) with +y down', () => {
    expect(headingToScreenDegrees(0)).toBeCloseTo(90);
    expect(headingToScreenDegrees(90)).toBeCloseTo(180);
    expect(headingToScreenDegrees(270)).toBeCloseTo(0);
    expect(Math.abs(headingToScreenDegrees(180))).toBeCloseTo(90);
    expect(headingToScreenDegrees(180)).toBeLessThan(0);
  });

  it('bounds boxes and points together', () => {
    expect(unionBox([{ x: 1, y: 1, w: 2, h: 2 }], [[-1, 5]])).toEqual({
      x: -1,
      y: 1,
      w: 4,
      h: 4,
    });
    expect(unionBox([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});
