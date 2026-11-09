import { lineAmountText, toLineAmountUnit } from './line-amount-text';

describe('lineAmountText (backend plan 0246, section 6)', () => {
  it('draws a count as a number', () => {
    expect(lineAmountText(2, 'UNIT', 'en')).toBe('2');
  });

  it('draws grams below a thousand and kilos from one, with at most one decimal', () => {
    expect(lineAmountText(750, 'GRAM', 'en')).toBe('750 g');
    expect(lineAmountText(1000, 'GRAM', 'en')).toBe('1 kg');
    expect(lineAmountText(1500, 'GRAM', 'en')).toBe('1.5 kg');
    expect(lineAmountText(12500, 'GRAM', 'en')).toBe('12.5 kg');
  });

  it('follows the decimal mark of the locale', () => {
    expect(lineAmountText(1500, 'GRAM', 'es')).toBe('1,5 kg');
  });

  it('draws millilitres and litres the same way', () => {
    expect(lineAmountText(330, 'MILLILITER', 'en')).toBe('330 mL');
    expect(lineAmountText(1500, 'MILLILITER', 'en')).toBe('1.5 L');
  });

  it('reads a missing or unknown unit as pieces', () => {
    expect(toLineAmountUnit(undefined)).toBe('UNIT');
    expect(toLineAmountUnit('KILOGRAM')).toBe('UNIT');
    expect(lineAmountText(3, undefined, 'en')).toBe('3');
  });
});
