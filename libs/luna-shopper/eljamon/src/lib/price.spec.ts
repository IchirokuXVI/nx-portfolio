import { parseSpanishPrice, parseUnitPrice } from './price';

describe('parseSpanishPrice', () => {
  it.each([
    ['3,49 €', 3.49],
    ['3,49\u00a0€', 3.49],
    ['3,49&nbsp;€', 3.49],
    ['1.234,5 €', 1234.5],
    ['65 €', 65],
  ])('%s', (printed, expected) => {
    expect(parseSpanishPrice(printed)).toBe(expected);
  });

  it('answers null rather than zero for text with no price', () => {
    expect(parseSpanishPrice('')).toBeNull();
    expect(parseSpanishPrice('POR SÓLO')).toBeNull();
    expect(parseSpanishPrice(null)).toBeNull();
  });
});

describe('parseUnitPrice', () => {
  it('splits the amount from the unit, keeping the label verbatim', () => {
    expect(parseUnitPrice(' 15,31 €/Kilo ')).toEqual({
      unitPrice: 15.31,
      unitPriceLabel: 'Kilo',
    });
    expect(parseUnitPrice('1,36\u00a0€/100gr')).toEqual({
      unitPrice: 1.36,
      unitPriceLabel: '100gr',
    });
  });

  it('answers null when either half is missing', () => {
    expect(parseUnitPrice('15,31 €')).toBeNull();
    expect(parseUnitPrice('/Kilo')).toBeNull();
  });
});
