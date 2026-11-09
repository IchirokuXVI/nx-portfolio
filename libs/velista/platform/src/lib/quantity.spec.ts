import { formatAmount, formatQuantity } from './quantity';

describe('formatQuantity (velista 0182, criterion 3)', () => {
  it('draws a count as ×N in both languages', () => {
    expect(formatQuantity(2, 'UNIT', 'en')).toBe('×2');
    expect(formatQuantity(2, 'UNIT', 'es')).toBe('×2');
  });

  it('draws grams below a thousand', () => {
    expect(formatQuantity(750, 'GRAM', 'en')).toBe('750 g');
    expect(formatQuantity(750, 'GRAM', 'es')).toBe('750 g');
    expect(formatQuantity(975, 'GRAM', 'es')).toBe('975 g');
  });

  it('draws kilos from a thousand: 1000 as 1 kg, 12500 as 12,5 kg', () => {
    expect(formatQuantity(1000, 'GRAM', 'en')).toBe('1 kg');
    expect(formatQuantity(1000, 'GRAM', 'es')).toBe('1 kg');
    expect(formatQuantity(1500, 'GRAM', 'en')).toBe('1.5 kg');
    expect(formatQuantity(1500, 'GRAM', 'es')).toBe('1,5 kg');
    expect(formatQuantity(12500, 'GRAM', 'en')).toBe('12.5 kg');
    expect(formatQuantity(12500, 'GRAM', 'es')).toBe('12,5 kg');
  });

  it('keeps the quarter kilo the coarse step lands on', () => {
    expect(formatQuantity(1250, 'GRAM', 'es')).toBe('1,25 kg');
    expect(formatQuantity(1750, 'GRAM', 'en')).toBe('1.75 kg');
  });

  it('draws millilitres below a thousand and litres from it', () => {
    expect(formatQuantity(500, 'MILLILITER', 'en')).toBe('500 mL');
    expect(formatQuantity(500, 'MILLILITER', 'es')).toBe('500 ml');
    expect(formatQuantity(1000, 'MILLILITER', 'en')).toBe('1 L');
    expect(formatQuantity(1500, 'MILLILITER', 'es')).toBe('1,5 l');
  });
});

describe('formatAmount', () => {
  it('says a count as its bare number, for a sentence', () => {
    expect(formatAmount(3, 'UNIT', 'en')).toBe('3');
  });

  it('says a weight or a volume as formatQuantity draws it', () => {
    expect(formatAmount(250, 'GRAM', 'es')).toBe('250 g');
    expect(formatAmount(2000, 'MILLILITER', 'es')).toBe('2 l');
  });
});
