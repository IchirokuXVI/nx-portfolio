import { productGtin, readGtin, type GtinReading } from './gtin';
import cases from './gtin.cases.json';

/**
 * Every pair of `gtin.cases.json`, which is the file the curation tool's own
 * copy of this function is proven against as well (plan 0184).
 *
 * The cases live in JSON for the reason `brand-key.cases.json` does: the tool
 * is plain `.mjs` and cannot import a TypeScript module, so a second copy of
 * the function is unavoidable and a second copy of the cases is not.
 */
const CASES = cases as [string | null, GtinReading][];

describe('readGtin', () => {
  it.each(CASES)('reads %p as %p', (text, reading) => {
    expect(readGtin(text)).toEqual(reading);
  });

  it('reads a valid EAN-13 as a barcode', () => {
    expect(readGtin('4006381333931')).toEqual({
      kind: 'GTIN',
      gtin: '4006381333931',
    });
  });

  it('reads a valid EAN-8 as a barcode', () => {
    expect(readGtin('96385074')).toEqual({ kind: 'GTIN', gtin: '96385074' });
  });

  it('refuses a bad check digit', () => {
    expect(readGtin('4006381333932')).toEqual({
      kind: 'INVALID',
      reason: 'CHECK_DIGIT',
    });
  });

  it('reads 2204500000000 as an in-store code, whatever its check digit', () => {
    expect(readGtin('2204500000000')).toEqual({
      kind: 'IN_STORE',
      code: '2204500000000',
    });
  });

  it('refuses an 11 digit code', () => {
    expect(readGtin('84100100012')).toEqual({
      kind: 'INVALID',
      reason: 'LENGTH',
    });
  });

  it('keeps a 12 digit code as it is, with no leading zero added', () => {
    expect(readGtin('036000291452')).toEqual({
      kind: 'GTIN',
      gtin: '036000291452',
    });
  });

  it('trims the spaces around a code and refuses a space inside one', () => {
    expect(readGtin(' 4006381333931 ')).toEqual({
      kind: 'GTIN',
      gtin: '4006381333931',
    });
    expect(readGtin('4006381 333931')).toEqual({
      kind: 'INVALID',
      reason: 'NOT_DIGITS',
    });
  });

  it('has nothing to read in undefined, as in null', () => {
    expect(readGtin(undefined)).toEqual({ kind: 'INVALID', reason: 'EMPTY' });
  });

  it('covers the shapes the plan names', () => {
    // A guard on the file rather than on the function: a case removed from the
    // JSON would otherwise silently shrink both suites that read it.
    const inputs = CASES.map(([text]) => text);
    expect(inputs).toContain('4006381333931');
    expect(inputs).toContain('96385074');
    expect(inputs).toContain('2204500000000');
    expect(inputs).toContain('84100100012');
    expect(inputs).toContain('4006381 333931');
  });
});

describe('productGtin', () => {
  it('answers a real barcode, trimmed', () => {
    expect(productGtin(' 4006381333931 ')).toBe('4006381333931');
  });

  it('answers null for an in-store code, an invalid code and no code', () => {
    expect(productGtin('2204500000000')).toBeNull();
    expect(productGtin('84100100012')).toBeNull();
    expect(productGtin(null)).toBeNull();
    expect(productGtin(undefined)).toBeNull();
  });
});
