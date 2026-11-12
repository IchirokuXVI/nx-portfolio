import {
  exactAmount,
  formatAmount,
  formatQuantity,
  formatQuantityChange,
  parseTypedAmount,
  shortAmount,
  typedSymbol,
} from './quantity';

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

describe('shortAmount (velista 0188, S4)', () => {
  const short = (
    q: number,
    unit: 'UNIT' | 'GRAM' | 'MILLILITER',
    locale = 'es'
  ) => {
    const words = shortAmount(q, unit, locale);
    return [words.figure, words.symbol, words.long];
  };

  it('reads below a thousand in the base unit', () => {
    expect(short(999, 'GRAM')).toEqual(['999', 'g', false]);
    expect(short(950, 'MILLILITER')).toEqual(['950', 'ml', false]);
    expect(short(12, 'UNIT')).toEqual(['12', '', false]);
    expect(short(0, 'UNIT')).toEqual(['0', '', false]);
  });

  it('moves up one name from a thousand, half up on the integer', () => {
    expect(short(1000, 'GRAM')).toEqual(['1', 'kg', false]);
    expect(short(1250, 'GRAM')).toEqual(['1,25', 'kg', false]);
    expect(short(1275, 'GRAM')).toEqual(['1,28', 'kg', false]);
    expect(short(1500, 'MILLILITER')).toEqual(['1,5', 'l', false]);
    expect(short(1250, 'GRAM', 'en')).toEqual(['1.25', 'kg', false]);
  });

  it('reads a count in thousands with K in Spanish and k in English', () => {
    expect(short(2010, 'UNIT', 'es')).toEqual(['2,01', 'K', false]);
    expect(short(2010, 'UNIT', 'en')).toEqual(['2.01', 'k', false]);
    expect(short(2010, 'UNIT', 'fr')).toEqual(['2,01', 'k', false]);
  });

  it('marks a six character figure as long', () => {
    expect(short(125_250, 'GRAM')).toEqual(['125,25', 'kg', true]);
  });

  it('never reads a thousand of the top name', () => {
    expect(short(999_995, 'UNIT')).toEqual(['999,99', 'K', true]);
    expect(short(999_999, 'GRAM')).toEqual(['999,99', 'kg', true]);
  });

  it('speaks the exact amount', () => {
    expect(shortAmount(750, 'GRAM', 'es').spoken).toBe('750 gramos');
    expect(shortAmount(750, 'GRAM', 'en').spoken).toBe('750 grams');
    expect(shortAmount(1275, 'GRAM', 'es').spoken).toBe('1,275 kilogramos');
    expect(shortAmount(1500, 'MILLILITER', 'en').spoken).toBe('1.5 liters');
    expect(shortAmount(12, 'UNIT', 'es').spoken).toBe('12');
  });
});

describe('exactAmount (velista 0188, S5)', () => {
  it('reads up to three decimals of the top name for a weight or a volume', () => {
    expect(exactAmount(1275, 'GRAM', 'es')).toMatchObject({
      figure: '1,275',
      symbol: 'kg',
    });
    expect(exactAmount(999_999, 'GRAM', 'es')).toMatchObject({
      figure: '999,999',
      symbol: 'kg',
    });
    expect(exactAmount(750, 'MILLILITER', 'en')).toMatchObject({
      figure: '750',
      symbol: 'ml',
    });
  });

  it('keeps a count plain under 100 000 and reads it in thousands from there', () => {
    expect(exactAmount(99_999, 'UNIT', 'es')).toMatchObject({
      figure: '99999',
      symbol: '',
    });
    expect(exactAmount(123_456, 'UNIT', 'es')).toMatchObject({
      figure: '123,456',
      symbol: 'K',
    });
    expect(exactAmount(123_456, 'UNIT', 'en')).toMatchObject({
      figure: '123.456',
      symbol: 'k',
    });
  });

  it('speaks in both locales', () => {
    expect(exactAmount(1275, 'GRAM', 'es').spoken).toBe('1,275 kilogramos');
    expect(exactAmount(1275, 'GRAM', 'en').spoken).toBe('1.275 kilograms');
  });
});

describe('parseTypedAmount (velista 0188, S10 and decision K)', () => {
  const MAX = 999_999;
  const shownMl = shortAmount(500, 'MILLILITER', 'es');
  const shownCount = exactAmount(2, 'UNIT', 'es');
  const shownKg = exactAmount(2000, 'GRAM', 'es');

  it('reads a decimal under the base name one name up', () => {
    expect(parseTypedAmount('1,5', shownMl, 'MILLILITER', 0, MAX)).toBe(1500);
    expect(parseTypedAmount('1,5', shownCount, 'UNIT', 0, MAX)).toBe(1500);
  });

  it('reads a whole number in the name on screen', () => {
    expect(parseTypedAmount('750', shownKg, 'GRAM', 0, MAX)).toBe(750_000);
    expect(parseTypedAmount('750', shownMl, 'MILLILITER', 0, MAX)).toBe(750);
    expect(parseTypedAmount('0,5', shownKg, 'GRAM', 0, MAX)).toBe(500);
  });

  it('reads both separators and drops spaces', () => {
    expect(parseTypedAmount('1.5', shownMl, 'MILLILITER', 0, MAX)).toBe(1500);
    expect(parseTypedAmount(' 1 ,25 ', shownKg, 'GRAM', 0, MAX)).toBe(1250);
  });

  it('rounds half up to a whole base unit', () => {
    expect(parseTypedAmount('1,0005', shownKg, 'GRAM', 0, MAX)).toBe(1001);
    expect(parseTypedAmount('1,0004', shownKg, 'GRAM', 0, MAX)).toBe(1000);
  });

  it('answers null for text that is not a number', () => {
    expect(parseTypedAmount('1,2,3', shownKg, 'GRAM', 0, MAX)).toBeNull();
    expect(parseTypedAmount('abc', shownKg, 'GRAM', 0, MAX)).toBeNull();
    expect(parseTypedAmount('', shownKg, 'GRAM', 0, MAX)).toBeNull();
    expect(parseTypedAmount(',', shownKg, 'GRAM', 0, MAX)).toBeNull();
  });

  it('holds the amount to the range', () => {
    expect(parseTypedAmount('1000000', shownCount, 'UNIT', 0, MAX)).toBe(MAX);
    expect(parseTypedAmount('0', shownCount, 'UNIT', 1, MAX)).toBe(1);
  });
});

describe('typedSymbol (velista 0188, decision K)', () => {
  it('follows the separator while typing', () => {
    const shown = shortAmount(500, 'MILLILITER', 'es');
    expect(typedSymbol('1', shown, 'MILLILITER', 'es')).toBe('ml');
    expect(typedSymbol('1,', shown, 'MILLILITER', 'es')).toBe('l');
    expect(typedSymbol('1,5', shown, 'MILLILITER', 'es')).toBe('l');
    expect(typedSymbol('1,5', exactAmount(2, 'UNIT', 'es'), 'UNIT', 'es')).toBe(
      'K'
    );
  });
});
