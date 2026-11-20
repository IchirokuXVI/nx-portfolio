import {
  exactAmount,
  followTyped,
  formatAmount,
  formatQuantity,
  formatQuantityChange,
  isRefused,
  parseTypedAmount,
  shortAmount,
  typedLimit,
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
  const MAX = 99_999;
  const shownMl = shortAmount(500, 'MILLILITER', 'es');
  const shownG = exactAmount(500, 'GRAM', 'es');
  const shownCount = exactAmount(2, 'UNIT', 'es');
  const shownKg = exactAmount(2000, 'GRAM', 'es');

  it('reads digits in the unit the edit started under (the owner, 2026-11-17)', () => {
    expect(parseTypedAmount('25000', shownG, 'GRAM', 0, MAX)).toBe(25_000);
    expect(parseTypedAmount('1250', shownMl, 'MILLILITER', 0, MAX)).toBe(1250);
    expect(parseTypedAmount('75', shownKg, 'GRAM', 0, MAX)).toBe(75_000);
    expect(parseTypedAmount('0,5', shownKg, 'GRAM', 0, MAX)).toBe(500);
    // A whole number over 99 under kg is read in grams.
    expect(parseTypedAmount('750', shownKg, 'GRAM', 0, MAX)).toBe(750);
    // A count keeps its rule: a whole number in the name on screen.
    const shownK = exactAmount(100_000, 'UNIT', 'es');
    expect(parseTypedAmount('20', shownK, 'UNIT', 0, MAX)).toBe(20_000);
  });

  it('reads a decimal of a count in thousands', () => {
    expect(parseTypedAmount('1,5', shownCount, 'UNIT', 0, MAX)).toBe(1500);
  });

  it('answers null for a separator under grams and for a sixth digit', () => {
    expect(parseTypedAmount('1,5', shownMl, 'MILLILITER', 0, MAX)).toBeNull();
    expect(parseTypedAmount('250000', shownG, 'GRAM', 0, MAX)).toBeNull();
    expect(parseTypedAmount('199,5', shownKg, 'GRAM', 0, MAX)).toBeNull();
  });

  it('reaches 99 999 for every unit and holds a count to it', () => {
    expect(parseTypedAmount('99999', shownG, 'GRAM', 0, MAX)).toBe(99_999);
    expect(parseTypedAmount('99,999', shownKg, 'GRAM', 0, MAX)).toBe(99_999);
    expect(parseTypedAmount('99999', shownKg, 'GRAM', 0, MAX)).toBe(99_999);
    expect(parseTypedAmount('500000', shownCount, 'UNIT', 0, MAX)).toBe(MAX);
  });

  it('reads both separators and drops spaces', () => {
    expect(parseTypedAmount('1.5', shownKg, 'GRAM', 0, MAX)).toBe(1500);
    expect(parseTypedAmount(' 1 ,25 ', shownKg, 'GRAM', 0, MAX)).toBe(1250);
  });

  it('rounds a count half up to a whole base unit', () => {
    expect(parseTypedAmount('1,0005', shownCount, 'UNIT', 0, MAX)).toBe(1001);
    expect(parseTypedAmount('1,0004', shownCount, 'UNIT', 0, MAX)).toBe(1000);
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
    expect(parseTypedAmount('0', shownG, 'GRAM', 25, MAX)).toBe(25);
  });
});

describe('followTyped (the owner, 2026-11-17, velista 0188 decision K)', () => {
  /**
   * Types `keys` one at a time after `start`, as a person does. A key the field
   * does not accept leaves the text as it was and is recorded as "refused".
   */
  function typeKeys(
    keys: string,
    unit: 'GRAM' | 'MILLILITER',
    locale = 'es',
    symbol = unit === 'GRAM' ? 'g' : 'ml',
    start = ''
  ): { text: string; symbol: string; turned: boolean | 'refused' }[] {
    const seen: {
      text: string;
      symbol: string;
      turned: boolean | 'refused';
    }[] = [];
    let text = start;
    for (const key of keys) {
      const next = followTyped(text + key, symbol, unit, locale);
      if ('refused' in next) {
        seen.push({ text, symbol, turned: 'refused' });
        continue;
      }
      text = text + key;
      symbol = next.symbol;
      seen.push({ text, symbol, turned: next.turned });
    }
    return seen;
  }

  const shown = (seen: { text: string; symbol: string }[]) =>
    seen.map(({ text, symbol }) => `${text} ${symbol}`);

  it('holds grams while 25000 is typed key by key, and never shows 2,5 kg', () => {
    const seen = typeKeys('25000', 'GRAM');
    expect(shown(seen)).toEqual(['2 g', '25 g', '250 g', '2500 g', '25000 g']);
    expect(seen.every((one) => one.turned === false)).toBe(true);
  });

  it('holds millilitres the same way', () => {
    expect(shown(typeKeys('10000', 'MILLILITER', 'en'))).toEqual([
      '1 ml',
      '10 ml',
      '100 ml',
      '1000 ml',
      '10000 ml',
    ]);
  });

  it('keeps kilos with the digits as typed: 2,5 kg and a 0 is 2,50 kg', () => {
    expect(followTyped('2,50', 'kg', 'GRAM', 'es')).toEqual({
      symbol: 'kg',
      turned: false,
    });
    expect(followTyped('2.50', 'kg', 'GRAM', 'en')).toEqual({
      symbol: 'kg',
      turned: false,
    });
  });

  it('turns a whole number over 99 under kilos into grams at once, and stays there', () => {
    // 50 kg and a 0 is 500 g; then 5000 stays under g until the edit ends.
    const seen = typeKeys('00', 'GRAM', 'es', 'kg', '50');
    expect(seen).toEqual([
      { text: '500', symbol: 'g', turned: true },
      { text: '5000', symbol: 'g', turned: false },
    ]);
    expect(followTyped('99', 'kg', 'GRAM', 'es')).toEqual({
      symbol: 'kg',
      turned: false,
    });
    expect(followTyped('100', 'l', 'MILLILITER', 'es')).toEqual({
      symbol: 'ml',
      turned: true,
    });
  });

  const whole = { refused: 'whole' };
  const decimals = { refused: 'decimals' };
  const most = { refused: 'most' };

  it('does not accept a separator under grams, and says a gram has no decimals', () => {
    expect(followTyped('1,', 'g', 'GRAM', 'es')).toEqual(whole);
    expect(followTyped(',5', 'g', 'GRAM', 'es')).toEqual(whole);
    expect(followTyped('150.', 'ml', 'MILLILITER', 'en')).toEqual(whole);
    expect(followTyped('1234567,', 'g', 'GRAM', 'es')).toEqual(whole);
    expect(shown(typeKeys('1,5', 'GRAM'))).toEqual(['1 g', '1 g', '15 g']);
  });

  it('does not accept a key that would leave decimals under grams: 99,5 into 199,5 is over the most', () => {
    expect(followTyped('99,5', 'kg', 'GRAM', 'es')).toEqual({
      symbol: 'kg',
      turned: false,
    });
    expect(followTyped('199,5', 'kg', 'GRAM', 'es')).toEqual(most);
    expect(followTyped('150,', 'kg', 'GRAM', 'es')).toEqual(most);
  });

  it('does not accept a sixth digit (the most), nor a fourth decimal under kilos (decimals)', () => {
    expect(followTyped('99999', 'g', 'GRAM', 'es')).toEqual({
      symbol: 'g',
      turned: false,
    });
    expect(followTyped('999999', 'g', 'GRAM', 'es')).toEqual(most);
    expect(followTyped('250000', 'g', 'GRAM', 'es')).toEqual(most);
    expect(followTyped('250000', 'kg', 'GRAM', 'es')).toEqual(most);
    expect(followTyped('1 kg 23456', 'kg', 'GRAM', 'es')).toEqual(most);
    expect(followTyped('99,999', 'kg', 'GRAM', 'es')).toEqual({
      symbol: 'kg',
      turned: false,
    });
    expect(followTyped('1,0005', 'kg', 'GRAM', 'es')).toEqual(decimals);
    // Six digits and four decimals: the decimals are what to fix.
    expect(followTyped('99,9999', 'kg', 'GRAM', 'es')).toEqual(decimals);
    expect(followTyped('1.2345', 'l', 'MILLILITER', 'en')).toEqual(decimals);
    expect(followTyped('99999', 'kg', 'GRAM', 'es')).toEqual({
      symbol: 'g',
      turned: true,
    });
  });

  it('goes back to grams when emptied, and stays in kilos while a digit is left', () => {
    expect(followTyped('', 'kg', 'GRAM', 'es')).toEqual({
      symbol: 'g',
      turned: true,
    });
    expect(followTyped('5', 'kg', 'GRAM', 'es')).toEqual({
      symbol: 'kg',
      turned: false,
    });
    expect(followTyped('', 'g', 'GRAM', 'es')).toEqual({
      symbol: 'g',
      turned: false,
    });
  });

  it('turns nothing that is not a number under kilos', () => {
    expect(followTyped('1,2,3', 'kg', 'GRAM', 'es')).toEqual({
      symbol: 'kg',
      turned: false,
    });
  });

  it('never turns a count', () => {
    expect(followTyped('1000', '', 'UNIT', 'es')).toEqual({
      symbol: '',
      turned: false,
    });
    expect(followTyped('1,5', '', 'UNIT', 'es')).toEqual({
      symbol: 'K',
      turned: false,
    });
    // A count refuses no key: a typed count over the most is held when the edit ends.
    expect(followTyped('1234567', '', 'UNIT', 'es')).toEqual({
      symbol: '',
      turned: false,
    });
  });
});

describe('isRefused (the owner, 2026-11-17)', () => {
  it('tells a refused key from an accepted one', () => {
    expect(isRefused(followTyped('1,', 'g', 'GRAM', 'es'))).toBe(true);
    expect(isRefused(followTyped('15', 'g', 'GRAM', 'es'))).toBe(false);
  });
});

describe('typedLimit (the owner, 2026-11-17)', () => {
  it('says the most in the unit the field reads in, through Intl for the locale', () => {
    expect(typedLimit(99_999, 'g', 'GRAM', 'en')).toBe('99,999 g');
    expect(typedLimit(99_999, 'g', 'GRAM', 'es')).toBe('99.999 g');
    expect(typedLimit(99_999, 'kg', 'GRAM', 'en')).toBe('99.999 kg');
    expect(typedLimit(99_999, 'kg', 'GRAM', 'es')).toBe('99,999 kg');
    expect(typedLimit(99_999, 'ml', 'MILLILITER', 'es')).toBe('99.999 ml');
    expect(typedLimit(99_999, '', 'UNIT', 'en')).toBe('99,999');
    expect(typedLimit(99_999, 'K', 'UNIT', 'es')).toBe('99.999');
  });
});

describe('typedSymbol (velista 0188, decision K)', () => {
  it('holds the unit the edit started under', () => {
    const ml = shortAmount(500, 'MILLILITER', 'es');
    expect(typedSymbol('1', ml, 'MILLILITER', 'es')).toBe('ml');
    expect(typedSymbol('1500', ml, 'MILLILITER', 'es')).toBe('ml');
    const l = exactAmount(1500, 'MILLILITER', 'es');
    expect(typedSymbol('1,5', l, 'MILLILITER', 'es')).toBe('l');
    expect(typedSymbol('150', l, 'MILLILITER', 'es')).toBe('ml');
    expect(typedSymbol('1,5', exactAmount(2, 'UNIT', 'es'), 'UNIT', 'es')).toBe(
      'K'
    );
  });
});
