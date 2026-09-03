import { parseBarcode, parseSearchTerm } from './search-term';

/**
 * The parsing half of the search, which is the half that decides what a query
 * *is* before any SQL runs. The matching half needs real Postgres and lives in
 * `catalog-search.integration.spec.ts`.
 */
describe('parseSearchTerm', () => {
  it('answers null when there is nothing to search for', () => {
    expect(parseSearchTerm(undefined)).toBeNull();
    expect(parseSearchTerm('   ')).toBeNull();
    // Every character a separator, so no words survive the split.
    expect(parseSearchTerm('!!! ???')).toBeNull();
  });

  it('matches every word as a prefix, because the composer asks after three characters', () => {
    expect(parseSearchTerm('lech ent')?.tsquery).toBe('lech:* & ent:*');
  });

  it('carries no barcode for words', () => {
    expect(parseSearchTerm('leche entera')?.ean).toBeNull();
  });

  it('carries the barcode when the whole query is one', () => {
    const term = parseSearchTerm('8480000181077');

    expect(term?.ean).toBe('8480000181077');
    // Kept as text as well, and not turned into a barcode-only query: the
    // matching is a disjunction, so a product actually named for a number stays
    // findable.
    expect(term?.raw).toBe('8480000181077');
    expect(term?.tsquery).toBe('8480000181077:*');
  });
});

describe('parseBarcode', () => {
  it.each(['12345678', '123456789012', '8480000181077', '12345678901234'])(
    'accepts %s',
    (code) => {
      expect(parseBarcode(code)).toBe(code);
    }
  );

  it('drops the separators a printed or pasted code arrives with', () => {
    expect(parseBarcode('8 480000 181077')).toBe('8480000181077');
    expect(parseBarcode('8480000-181077')).toBe('8480000181077');
  });

  it('refuses a digit run that is no barcode length', () => {
    // What somebody means by "500" is a quantity, and treating it as a code
    // would be claiming the query names one product.
    expect(parseBarcode('500')).toBeNull();
    expect(parseBarcode('123456789')).toBeNull();
    expect(parseBarcode('123456789012345')).toBeNull();
  });

  it('refuses anything that is not digits alone', () => {
    expect(parseBarcode('leche')).toBeNull();
    expect(parseBarcode('8480000181077 leche')).toBeNull();
    expect(parseBarcode('')).toBeNull();
  });
});
