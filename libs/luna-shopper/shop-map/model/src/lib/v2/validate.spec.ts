import { elJamonDocument } from '../__fixtures__/el-jamon';
import { area, doc, mark } from './testing';
import { PROBLEM_ORDER_V2, validateShopMapV2 } from './validate';

describe('validateShopMapV2', () => {
  it('accepts an empty document, and one with no entrance or checkout', () => {
    expect(validateShopMapV2(doc())).toEqual([]);
    expect(
      validateShopMapV2(doc({ areas: [area('a', { section: 'Pan' })] }))
    ).toEqual([]);
  });

  it('accepts the El Jamón document', () => {
    expect(validateShopMapV2(elJamonDocument)).toEqual([]);
  });

  it('refuses an area under 0.3 m on a side', () => {
    const d = doc({
      areas: [
        area('ok', { w: 0.3, h: 0.3 }),
        area('thin', { x: 5, w: 0.29 }),
        area('flat', { x: 9, h: 0.1 }),
        area('broken', { x: 12, w: Number.NaN }),
      ],
    });
    expect(validateShopMapV2(d)).toEqual([
      { code: 'AREA_TOO_SMALL', id: 'thin' },
      { code: 'AREA_TOO_SMALL', id: 'flat' },
      { code: 'AREA_TOO_SMALL', id: 'broken' },
    ]);
  });

  it('refuses two blocking areas overlapping by more than 0.1 m, once per pair', () => {
    const d = doc({
      areas: [
        area('a', { w: 2, h: 2 }),
        area('touching', { x: 2, w: 2, h: 2 }),
        area('tolerated', { y: 1.9, w: 2, h: 1 }),
        area('over', { x: 1.5, y: 1.5, kind: 'counter' }),
      ],
    });
    expect(validateShopMapV2(d)).toEqual([
      { code: 'BLOCKING_OVERLAP', id: 'over', otherId: 'a' },
      { code: 'BLOCKING_OVERLAP', id: 'over', otherId: 'touching' },
      { code: 'BLOCKING_OVERLAP', id: 'over', otherId: 'tolerated' },
    ]);
  });

  it('lets a path or an entrance overlap anything', () => {
    const d = doc({
      areas: [
        area('shelf', { w: 3, h: 3 }),
        area('floor', { kind: 'path', w: 3, h: 3 }),
        area('door', { kind: 'entrance', w: 3, h: 3 }),
        area('till', { kind: 'checkout', x: 2.95, w: 1 }),
      ],
    });
    expect(validateShopMapV2(d)).toEqual([]);
  });

  it('refuses a section on anything but a shelf or a counter', () => {
    const d = doc({
      areas: [
        area('shelf', { section: 'Pan' }),
        area('counter', { x: 2, kind: 'counter', section: 'Carne' }),
        area('till', { x: 4, kind: 'checkout', section: 'Cajas' }),
        area('floor', { x: 6, kind: 'path', section: '' }),
      ],
    });
    expect(validateShopMapV2(d)).toEqual([
      { code: 'SECTION_ON_WRONG_KIND', id: 'till' },
      { code: 'SECTION_ON_WRONG_KIND', id: 'floor' },
    ]);
  });

  it('refuses a custom colour that is not #rrggbb', () => {
    const d = doc({
      areas: [
        area('ok', { colour: { mode: 'custom', value: '#c0392b' } }),
        area('upper', { x: 2, colour: { mode: 'custom', value: '#C0392B' } }),
        area('short', { x: 4, colour: { mode: 'custom', value: '#abc' } }),
        area('named', { x: 6, colour: { mode: 'custom', value: 'red' } }),
        area('category', { x: 8, colour: { mode: 'category' } }),
      ],
    });
    expect(validateShopMapV2(d)).toEqual([
      { code: 'BAD_COLOUR', id: 'short' },
      { code: 'BAD_COLOUR', id: 'named' },
    ]);
  });

  it('refuses a section or counter mark with empty text, never a note', () => {
    const d = doc({
      marks: [
        mark('named', 0),
        mark('blank', 0, { text: '  ' }),
        mark('counter', 0, { kind: 'counter', text: '' }),
        mark('note', 0, { kind: 'note', text: '' }),
      ],
    });
    expect(validateShopMapV2(d)).toEqual([
      { code: 'MARK_UNNAMED', id: 'blank' },
      { code: 'MARK_UNNAMED', id: 'counter' },
    ]);
  });

  it('reports the codes in the order of section 2', () => {
    const d = doc({
      areas: [
        area('a', { kind: 'blocked', section: 'x', w: 0.2 }),
        area('b', { colour: { mode: 'custom', value: 'nope' } }),
      ],
      marks: [mark('m', 0, { text: '' })],
    });
    expect(validateShopMapV2(d).map((p) => p.code)).toEqual([
      'AREA_TOO_SMALL',
      'BLOCKING_OVERLAP',
      'SECTION_ON_WRONG_KIND',
      'BAD_COLOUR',
      'MARK_UNNAMED',
    ]);
    expect(PROBLEM_ORDER_V2).toEqual(validateShopMapV2(d).map((p) => p.code));
  });
});
