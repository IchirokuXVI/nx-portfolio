import { formatAmount, formatQuantity, formatQuantityChange } from './quantity';

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

  it('says the exact amount from a thousand, to the gram', () => {
    // 975 g added twice sums to 1975 on the server (backend 0246 section 3.3).
    expect(formatQuantity(1975, 'GRAM', 'es')).toBe('1,975 kg');
    expect(formatQuantity(1001, 'GRAM', 'en')).toBe('1.001 kg');
    expect(formatQuantity(1050, 'MILLILITER', 'es')).toBe('1,05 l');
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

describe('formatQuantityChange (velista 0182)', () => {
  it('keeps a count a signed bare number', () => {
    expect(formatQuantityChange(2, 'UNIT', 'en')).toBe('+2');
    expect(formatQuantityChange(-1, 'UNIT', 'es')).toBe('-1');
  });

  it('names a weight or a volume with its unit', () => {
    expect(formatQuantityChange(250, 'GRAM', 'en')).toBe('+250 g');
    expect(formatQuantityChange(-1500, 'GRAM', 'es')).toBe('-1,5 kg');
    expect(formatQuantityChange(50, 'MILLILITER', 'en')).toBe('+50 mL');
  });
});
