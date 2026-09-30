import { elJamonDocument, elJamonWalkOrder } from '../__fixtures__/el-jamon';
import { area, doc, line } from './testing';
import type { MapArea, ShopMapDocumentV2 } from './types';
import { walkOrderV2 } from './walk-order';

/** A corridor walked along y = 0 from x = 0 to x = 12, shelves above it. */
function corridor(extra: MapArea[] = [], reversed = false): ShopMapDocumentV2 {
  const points = line(0, 12, 0);
  return doc({
    areas: [
      area('s1', { x: 2, y: -1.5, section: 'Pan' }),
      area('s2', { x: 6, y: -1.5, section: 'Leche' }),
      area('s3', { x: 10, y: -1.5, section: 'Fruta' }),
      ...extra,
    ],
    path: [{ points: reversed ? points.reverse() : points }],
  });
}

const names = (d: ShopMapDocumentV2) =>
  walkOrderV2(d).sections.map((s) => s.name);

describe('walkOrderV2', () => {
  it('answers nothing for an empty document', () => {
    expect(walkOrderV2(doc())).toEqual({
      sections: [],
      startsAtEntrance: false,
      endsAtCheckout: false,
    });
  });

  it('walks from the first walked point to the last one without an entrance or checkout', () => {
    const order = walkOrderV2(corridor());
    expect(order.sections.map((s) => s.name)).toEqual([
      'Pan',
      'Leche',
      'Fruta',
    ]);
    expect(order.startsAtEntrance).toBe(false);
    expect(order.endsAtCheckout).toBe(false);
    expect(names(corridor([], true))).toEqual(['Fruta', 'Leche', 'Pan']);
  });

  it('starts at the entrance and ends at a checkout, and says so', () => {
    const order = walkOrderV2(
      corridor([
        area('door', { kind: 'entrance', x: 11, y: 0.5, w: 2, h: 0.5 }),
        area('till', { kind: 'checkout', x: -1.5, y: 0.6, w: 1, h: 1 }),
      ])
    );
    expect(order.sections.map((s) => s.name)).toEqual([
      'Fruta',
      'Leche',
      'Pan',
    ]);
    expect(order.startsAtEntrance).toBe(true);
    expect(order.endsAtCheckout).toBe(true);
  });

  it('gives each stop its distance along the walk in metres', () => {
    const order = walkOrderV2(corridor());
    const at = order.sections.map((s) => s.atMetres);
    expect(at[0]).toBeGreaterThan(0);
    // Shelves 4 m apart; the walk steps round each shelf's corner cell.
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(4);
    expect(at[1] - at[0]).toBeLessThanOrEqual(5);
    expect(at[2] - at[1]).toBe(at[1] - at[0]);
  });

  it('makes two areas with the same section name one stop at the first of them', () => {
    const order = walkOrderV2(
      corridor([area('s0', { x: 11, y: 0.6, section: ' pan ' })])
    );
    expect(order.sections).toHaveLength(3);
    const pan = order.sections.find((s) => s.areaIds.includes('s0'));
    expect(pan).toMatchObject({ name: 'pan', areaIds: ['s0', 's1'] });
    // The stop stands at s0, the first by id, at the far end of the walk.
    expect(order.sections[order.sections.length - 1]).toBe(pan);
  });

  it('ends at the checkout that makes the walk shortest', () => {
    const order = walkOrderV2(
      corridor([
        area('door', { kind: 'entrance', x: -1, y: 0.5, w: 1, h: 0.5 }),
        area('far', { kind: 'checkout', x: -1.5, y: 0.6 }),
        area('near', { kind: 'checkout', x: 12.5, y: 0.6 }),
      ])
    );
    expect(order.endsAtCheckout).toBe(true);
    expect(order.sections.map((s) => s.name)).toEqual([
      'Pan',
      'Leche',
      'Fruta',
    ]);
  });

  it('leaves out a section nobody can walk to', () => {
    expect(
      names(corridor([area('island', { x: 40, y: 40, section: 'Lejos' })]))
    ).toEqual(['Pan', 'Leche', 'Fruta']);
  });

  it('walks over floor drawn by hand where the walk did not go', () => {
    const d = corridor([
      area('aisle', { kind: 'path', x: 5.5, y: -8, w: 1, h: 6 }),
      area('back', { x: 7, y: -7, section: 'Congelados' }),
    ]);
    expect(names(d)).toContain('Congelados');
  });

  it('answers the expected walk order of the El Jamón document', () => {
    const order = walkOrderV2(elJamonDocument);
    expect(order).toEqual(elJamonWalkOrder);
    expect(order.startsAtEntrance).toBe(true);
    expect(order.endsAtCheckout).toBe(true);
    const sectioned = new Set(
      elJamonDocument.areas
        .filter((a) => a.section)
        .map((a) => a.section?.trim().toLowerCase())
    );
    expect(order.sections).toHaveLength(sectioned.size);
    const at = order.sections.map((s) => s.atMetres);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(
      order.sections.find((s) => s.name === 'Higiene y perfumería')?.areaIds
    ).toHaveLength(2);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(walkOrderV2(elJamonDocument))).toBe(
      JSON.stringify(walkOrderV2(structuredClone(elJamonDocument)))
    );
  });
});
