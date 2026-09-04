import { formatMoney, parseMoney } from './money';

describe('formatMoney', () => {
  it('groups the units and pads the fraction to the column scale', () => {
    expect(formatMoney('1234.5', 2, 'en')).toBe('1,234.50');
  });

  /**
   * The rule the whole file exists for. A value the server sent with four
   * decimals is a value the database holds with four decimals, and a field
   * declared with two must not hide the other two: that is the same class of
   * mistake as recomputing `unitPrice`.
   */
  it('never truncates a fraction longer than the scale', () => {
    expect(formatMoney('1.2345', 2, 'en')).toBe('1.2345');
  });

  it('carries the sign', () => {
    expect(formatMoney('-4', 2, 'en')).toBe('-4.00');
  });

  it('answers nothing for a value that is not a decimal', () => {
    expect(formatMoney(null, 2, 'en')).toBe('');
    expect(formatMoney('about three', 2, 'en')).toBe('');
    expect(formatMoney('1,234.50', 2, 'en')).toBe('');
  });

  /**
   * A price is compared against another price, so the digits have to survive
   * exactly. `0.1 + 0.2` is the reason this is asserted rather than assumed.
   */
  it('keeps a value a float could not hold', () => {
    expect(formatMoney('0.1', 4, 'en')).toBe('0.1000');
    expect(formatMoney('9007199254740993.07', 2, 'en')).toContain('.07');
  });
});

describe('parseMoney', () => {
  it('pads what was typed to the column scale', () => {
    expect(parseMoney('4', 2)).toEqual({ ok: true, value: '4.00' });
    expect(parseMoney('4.5', 4)).toEqual({ ok: true, value: '4.5000' });
  });

  it('accepts a comma for the point', () => {
    expect(parseMoney('4,5', 2)).toEqual({ ok: true, value: '4.50' });
  });

  it('drops leading zeroes without eating the last one', () => {
    expect(parseMoney('007', 2)).toEqual({ ok: true, value: '7.00' });
    expect(parseMoney('0', 2)).toEqual({ ok: true, value: '0.00' });
  });

  /**
   * Refused rather than rounded. The server would round it too, and quietly
   * storing a different number from the one on screen is what makes an operator
   * stop trusting the field.
   */
  it('refuses more decimals than the column has', () => {
    expect(parseMoney('1.239', 2)).toEqual({
      ok: false,
      problem: 'too-precise',
    });
  });

  it('refuses a thousands separator rather than guessing what it meant', () => {
    expect(parseMoney('1,234.50', 2)).toEqual({
      ok: false,
      problem: 'not-a-number',
    });
  });

  it('refuses anything that is not a number', () => {
    expect(parseMoney('', 2)).toEqual({ ok: false, problem: 'not-a-number' });
    expect(parseMoney('free', 2)).toEqual({
      ok: false,
      problem: 'not-a-number',
    });
  });
});
