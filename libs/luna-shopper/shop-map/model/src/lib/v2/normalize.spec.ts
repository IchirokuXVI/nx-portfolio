import { elJamonDocument } from '../__fixtures__/el-jamon';
import { normalizeShopMapV2 } from './normalize';
import { area, doc, mark } from './testing';
import type { MapArea } from './types';

describe('normalizeShopMapV2', () => {
  it('sorts areas and marks by id and keeps two decimals', () => {
    const d = normalizeShopMapV2(
      doc({
        areas: [
          area('b', { x: 1.23456, y: -0.004, w: 2.805, h: 1 }),
          area('a'),
        ],
        marks: [mark('z', 10.4, { x: 0.125 }), mark('y', 99.6)],
        path: [{ points: [[1.005, 2.00001]] }],
      })
    );
    expect(d.areas.map((a) => a.id)).toEqual(['a', 'b']);
    expect(d.areas[1]).toMatchObject({ x: 1.23, y: 0, w: 2.81, h: 1 });
    expect(Object.is(d.areas[1].y, -0)).toBe(false);
    expect(d.marks.map((m) => [m.id, m.logMs])).toEqual([
      ['y', 100],
      ['z', 10],
    ]);
    expect(d.path[0].points[0][1]).toBe(2);
  });

  it('keeps headings in [0, 360)', () => {
    const headings = [-10, 360, 359.999, 725.5, 0].map(
      (heading) =>
        normalizeShopMapV2(doc({ marks: [mark('m', 0, { heading })] })).marks[0]
          .heading
    );
    expect(headings).toEqual([350, 0, 0, 5.5, 0]);
  });

  it('lowercases a custom colour and leaves absent fields out', () => {
    const d = normalizeShopMapV2(
      doc({
        areas: [
          {
            ...area('a', { colour: { mode: 'custom', value: '#C0392B' } }),
            label: undefined,
          } as MapArea,
        ],
      })
    );
    expect(d.areas[0].colour).toEqual({ mode: 'custom', value: '#c0392b' });
    expect('label' in d.areas[0]).toBe(false);
    expect(Object.keys(d.areas[0])).toEqual([
      'id',
      'kind',
      'x',
      'y',
      'w',
      'h',
      'colour',
      'origin',
    ]);
  });

  it('drops empty polylines and never snaps', () => {
    const d = normalizeShopMapV2(
      doc({
        path: [{ points: [] }, { points: [[0.37, 1.13]] }, { points: [] }],
      })
    );
    expect(d.path).toEqual([{ points: [[0.37, 1.13]] }]);
  });

  it('is idempotent', () => {
    expect(normalizeShopMapV2(elJamonDocument)).toEqual(elJamonDocument);
  });
});
