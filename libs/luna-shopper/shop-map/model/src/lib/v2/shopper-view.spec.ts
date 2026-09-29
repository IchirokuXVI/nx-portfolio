import { elJamonDocument } from '../__fixtures__/el-jamon';
import { rasterize } from './raster';
import { shopperView, traceRings, walkwayCells } from './shopper-view';
import { area, doc, line, mark } from './testing';

/** Twice the signed area of a ring as drawn with y downwards: positive is clockwise. */
function turning(ring: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum;
}

function isOrthogonal(ring: [number, number][]): boolean {
  return ring.every((p, i) => {
    const q = ring[(i + 1) % ring.length];
    return p[0] === q[0] || p[1] === q[1];
  });
}

describe('traceRings', () => {
  it('traces one cell as a clockwise square', () => {
    expect(traceRings([[true]])).toEqual([
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    ]);
  });

  it('keeps two cells that touch at a corner apart', () => {
    const rings = traceRings([
      [true, false],
      [false, true],
    ]);
    expect(rings).toHaveLength(2);
    expect(rings.every((r) => r.length === 4)).toBe(true);
  });

  it('traces a hole the other way round', () => {
    const rings = traceRings([
      [true, true, true],
      [true, false, true],
      [true, true, true],
    ]);
    expect(rings).toHaveLength(2);
    expect(turning(rings[0])).toBeGreaterThan(0);
    expect(turning(rings[1])).toBeLessThan(0);
  });
});

describe('walkwayCells', () => {
  const twoAisles = (gap: number, extra = [] as ReturnType<typeof area>[]) =>
    rasterize(
      doc({
        areas: extra,
        path: [{ points: line(0, 6, 0) }, { points: line(0, 6, gap) }],
      })
    );
  const rings = (gap: number, extra: ReturnType<typeof area>[] = []) =>
    traceRings(walkwayCells(twoAisles(gap, extra))).length;

  it('closes a gap under 1 m', () => {
    // Walked 2.5 m apart, each aisle reaches 0.75 m: one 0.5 m row between.
    expect(rings(2.5)).toBe(1);
  });

  it('leaves a gap of 1 m open', () => {
    expect(rings(3)).toBe(2);
  });

  it('never closes a gap over a blocking area', () => {
    expect(rings(2.5, [area('shelf', { x: -2, y: 1, w: 10, h: 0.5 })])).toBe(2);
  });
});

describe('shopperView', () => {
  it('answers an empty view for an empty document', () => {
    expect(shopperView(doc())).toEqual({
      walkway: [],
      areas: [],
      notes: [],
      bounds: { x: 0, y: 0, w: 0, h: 0 },
    });
  });

  it('draws the walkway around the walk and around floor drawn by hand', () => {
    const view = shopperView(
      doc({
        areas: [area('floor', { kind: 'path', x: 20, y: 0, w: 1, h: 3 })],
        path: [{ points: line(0, 4, 0) }],
      })
    );
    expect(view.walkway).toHaveLength(2);
    expect(view.walkway.every(isOrthogonal)).toBe(true);
    expect(view.walkway.every((r) => turning(r) > 0)).toBe(true);
    expect(view.areas).toEqual([]);
    // The floor drawn by hand, 0.75 m around it, on the 0.5 m cells.
    const floor = view.walkway[1];
    expect(Math.min(...floor.map((p) => p[0]))).toBe(19);
    expect(Math.max(...floor.map((p) => p[0]))).toBe(22);
  });

  it('shows every area but floor, with its section, label and colour, and no origin', () => {
    const view = shopperView(
      doc({
        areas: [
          area('b', { section: 'Pan', label: 'Horno' }),
          area('a', { kind: 'entrance', colour: { mode: 'category' } }),
          area('c', { kind: 'path' }),
        ],
      })
    );
    expect(view.areas).toEqual([
      {
        id: 'a',
        kind: 'entrance',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        colour: { mode: 'category' },
      },
      {
        id: 'b',
        kind: 'shelf',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        section: 'Pan',
        label: 'Horno',
        colour: { mode: 'default' },
      },
    ]);
  });

  it('shows note marks only, and never the path', () => {
    const view = shopperView(
      doc({
        marks: [
          mark('s', 0),
          mark('c', 0, { kind: 'counter' }),
          mark('n', 0, { kind: 'note', text: 'Cajas', x: 3, y: 4 }),
        ],
        path: [{ points: line(0, 2, 0) }],
      })
    );
    expect(view.notes).toEqual([{ id: 'n', x: 3, y: 4, text: 'Cajas' }]);
    expect('path' in view).toBe(false);
  });

  it('bounds everything it shows', () => {
    const view = shopperView(elJamonDocument);
    const { x, y, w, h } = view.bounds;
    const inside = (px: number, py: number) =>
      px >= x - 1e-9 &&
      px <= x + w + 1e-9 &&
      py >= y - 1e-9 &&
      py <= y + h + 1e-9;
    expect(view.walkway.length).toBeGreaterThan(0);
    expect(view.walkway.flat().every(([px, py]) => inside(px, py))).toBe(true);
    expect(
      view.areas.every((a) => inside(a.x, a.y) && inside(a.x + a.w, a.y + a.h))
    ).toBe(true);
    expect(view.areas).toHaveLength(
      elJamonDocument.areas.filter((a) => a.kind !== 'path').length
    );
    expect(view.notes.map((n) => n.text).sort()).toEqual(['Cajas', 'Entrada']);
  });
});
