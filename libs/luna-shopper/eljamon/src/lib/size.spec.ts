import { splitSize } from './size';

/**
 * One case per form the chain prints (plan 0169, section 6), plus the two the
 * capture of 2026-09-29 added: `pk-2` and `pza`. Literals, so a recapture of
 * the fixtures cannot rewrite them.
 */
describe('splitSize', () => {
  it.each([
    ['arroz bomba, 1kg', 'arroz bomba', '1kg', 1, null, false],
    [
      'crema fresca de calabaza, 330ml',
      'crema fresca de calabaza',
      '330ml',
      330,
      null,
      false,
    ],
    [
      'queso curado, 500g aprox.',
      'queso curado',
      '500g aprox.',
      500,
      null,
      false,
    ],
    ['aceite de oliva, 1,5l', 'aceite de oliva', '1,5l', 1.5, null, false],
    ['cerveza rubia, pk 6x33cl', 'cerveza rubia', 'pk 6x33cl', 198, 6, false],
    ['yogur natural, pk 3', 'yogur natural', 'pk 3', null, 3, false],
    [
      'burger vacuno alta proteínas 130g, pk-2',
      'burger vacuno alta proteínas 130g',
      'pk-2',
      null,
      2,
      false,
    ],
    ['lechuga iceberg, ud', 'lechuga iceberg', 'ud', null, null, false],
    ['bacon original, kg', 'bacon original', 'kg', null, null, true],
    [
      'jamón serrano gran reserva, pza',
      'jamón serrano gran reserva',
      'pza',
      null,
      null,
      false,
    ],
  ])('%s', (printed, name, sizeFormat, unitSize, packCount, soldByWeight) => {
    expect(splitSize(printed)).toEqual({
      name,
      sizeFormat,
      unitSize,
      packCount,
      soldByWeight,
    });
  });

  it('splits at the last comma, leaving earlier ones in the name', () => {
    expect(splitSize('patatas, fritas, 120g')).toMatchObject({
      name: 'patatas, fritas',
      sizeFormat: '120g',
    });
  });

  it('states no size for a name with no comma', () => {
    expect(splitSize('salmón ahumado suave 80g')).toEqual({
      name: 'salmón ahumado suave 80g',
      sizeFormat: null,
      unitSize: null,
      packCount: null,
      soldByWeight: false,
    });
  });
});
