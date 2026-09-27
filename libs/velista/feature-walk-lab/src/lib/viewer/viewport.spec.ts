import {
  boundsOf,
  IDENTITY,
  MAX_SCALE,
  panBy,
  pinch,
  thin,
  zoomAt,
  type View,
} from './viewport';

const apply = (view: View, x: number, y: number) => ({
  x: x * view.scale + view.x,
  y: y * view.scale + view.y,
});

describe('viewport', () => {
  it('keeps the point under the zoom where it was', () => {
    const view = zoomAt({ scale: 2, x: 10, y: -5 }, 1.5, 40, 30);
    // The world point drawn at (40, 30) before the zoom.
    const world = { x: (40 - 10) / 2, y: (30 + 5) / 2 };

    const drawn = apply(view, world.x, world.y);
    expect(drawn.x).toBeCloseTo(40);
    expect(drawn.y).toBeCloseTo(30);
    expect(view.scale).toBe(3);
  });

  it('stops zooming at the limits', () => {
    expect(zoomAt(IDENTITY, 1000, 0, 0).scale).toBe(MAX_SCALE);
  });

  it('pans', () => {
    expect(panBy(IDENTITY, 3, -2)).toEqual({ scale: 1, x: 3, y: -2 });
  });

  it('keeps the content under both fingers during a pinch', () => {
    const before = [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
    ] as const;
    const after = [
      { x: 0, y: 20 },
      { x: 40, y: 20 },
    ] as const;

    const view = pinch(IDENTITY, before, after);

    expect(view.scale).toBeCloseTo(2);
    const a = apply(view, 10, 10);
    const b = apply(view, 30, 10);
    expect(a.x).toBeCloseTo(0);
    expect(a.y).toBeCloseTo(20);
    expect(b.x).toBeCloseTo(40);
    expect(b.y).toBeCloseTo(20);
  });

  it('bounds the points with a minimum size, and survives none', () => {
    expect(
      boundsOf([
        { x: 0, y: 0 },
        { x: 10, y: 1 },
      ])
    ).toEqual({ minX: 0, minY: -1.5, maxX: 10, maxY: 2.5 });
    expect(boundsOf([])).toEqual({ minX: -2, minY: -2, maxX: 2, maxY: 2 });
  });

  it('thins a long line to the limit, keeping both ends', () => {
    const line = Array.from({ length: 1001 }, (_, i) => i);
    const thinned = thin(line, 11);

    expect(thinned).toHaveLength(11);
    expect(thinned[0]).toBe(0);
    expect(thinned[10]).toBe(1000);
    expect(thin(line.slice(0, 5), 11)).toHaveLength(5);
  });
});
