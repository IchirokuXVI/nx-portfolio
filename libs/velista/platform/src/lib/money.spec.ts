import { formatMoney } from './money';

/**
 * A money string, formatted once (velista `0062`, section 3.1).
 *
 * Three cases and they are the three the plan names: a locale it knows, a null
 * currency, and a zero price, which is a real price and not an absent one.
 */
describe('formatMoney', () => {
  it('formats in the locale it is handed', () => {
    // Which side the symbol lands on and which separator is used are the
    // locale's, so the two answers are asserted loosely on shape and exactly on
    // the digits.
    const en = formatMoney(0.95, 'EUR', 'en');
    const es = formatMoney(0.95, 'EUR', 'es');

    expect(en).toContain('0.95');
    expect(en).toMatch(/€/);
    expect(es).toContain('0,95');
    expect(es).toMatch(/€/);
  });

  it('formats a null currency as the bare number', () => {
    // Inventing EUR would be a guess written into the one field people trust
    // literally. Two decimals, so 2.5 does not read as a quantity.
    expect(formatMoney(2.5, null, 'en')).toBe('2.50');
    expect(formatMoney(2.5, null, 'es')).toBe('2,50');
  });

  it('formats zero as a price, because zero is a price', () => {
    expect(formatMoney(0, 'EUR', 'en')).toContain('0.00');
    expect(formatMoney(0, null, 'en')).toBe('0.00');
  });

  it('falls back to digits and the code on an unrecognised currency', () => {
    // `Intl` throws a RangeError for a code it does not know. The fallback is
    // ugly and correct, and a row with no price where the server sent one would
    // be worse.
    expect(formatMoney(1.5, 'NOT-A-CODE', 'en')).toBe('1.50 NOT-A-CODE');
  });
});
