import {
  clampPan,
  fitScale,
  fitView,
  MAX_PX_PER_METRE,
  scaleRange,
  toScreen,
  toWorld,
  zoomAt,
} from './viewport';

describe('viewport', () => {
  const shop = { x: -2, y: 4, w: 20, h: 10 };

  it('fits the content inside the padding and centres it', () => {
    const v = fitView(shop, 400, 800);
    expect(v.s).toBeCloseTo((400 - 32) / 20);
    const [cx, cy] = toScreen(v, 8, 9);
    expect(cx).toBeCloseTo(200);
    expect(cy).toBeCloseTo(400);
  });

  it('round trips between metres and css pixels', () => {
    const v = { s: 30, tx: 12, ty: -40 };
    const [px, py] = toScreen(v, 3.25, -1.5);
    expect(toWorld(v, px, py)).toEqual([3.25, -1.5]);
  });

  it('zooms between everything and half a metre in 28 pixels', () => {
    const range = scaleRange(shop, 400, 800);
    expect(range).toEqual([fitScale(shop, 400, 800), MAX_PX_PER_METRE]);
    const v = fitView(shop, 400, 800);
    expect(zoomAt(v, 100, 0, 0, range).s).toBe(56);
    expect(zoomAt(v, 0.01, 0, 0, range).s).toBe(range[0]);
  });

  it('lets a map smaller than the closest zoom be seen whole', () => {
    const tiny = { x: 0, y: 0, w: 2, h: 1 };
    const [lo, hi] = scaleRange(tiny, 400, 400);
    expect(lo).toBe(MAX_PX_PER_METRE);
    expect(hi).toBeCloseTo(184);
  });

  it('keeps the metre under the fingers still while zooming', () => {
    const v = { s: 20, tx: 5, ty: 7 };
    const before = toWorld(v, 150, 90);
    const z = zoomAt(v, 1.7, 150, 90, [1, 100]);
    expect(z.s).toBeCloseTo(34);
    const after = toWorld(z, 150, 90);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });

  it('never pans the content out of reach', () => {
    const v = clampPan({ s: 10, tx: 5000, ty: -5000 }, shop, 400, 400);
    const [cx, cy] = toWorld(v, 200, 200);
    expect(cx).toBeCloseTo(shop.x);
    expect(cy).toBeCloseTo(shop.y + shop.h);
  });

  it('fits an empty map at the closest zoom', () => {
    expect(fitScale({ x: 0, y: 0, w: 0, h: 0 }, 400, 400)).toBe(56);
  });
});
