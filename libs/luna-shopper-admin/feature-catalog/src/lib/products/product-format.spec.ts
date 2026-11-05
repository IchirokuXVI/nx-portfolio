import { formatSize } from './product-format';

/**
 * The size of a product with no size (admin plan 0068, criterion 4): the
 * weight of one piece, or "by the kilo". The sizes of packs, and the price
 * and unit price formats, are held in `product-list-gateway.spec.ts`.
 */
describe('formatSize, for a product with no size', () => {
  it('writes the weight of a piece of a kilo or more in kilograms', () => {
    expect(
      formatSize(
        { unitSize: null, defaultUnit: 'KILOGRAM', approxWeight: 1560 },
        'en'
      )
    ).toBe('approx. 1.56 kg');
  });

  it('writes the weight of a lighter piece in grams, whatever its unit', () => {
    expect(
      formatSize(
        { unitSize: null, defaultUnit: 'KILOGRAM', approxWeight: 395 },
        'en'
      )
    ).toBe('approx. 395 g');
    expect(
      formatSize(
        { unitSize: null, defaultUnit: 'UNIT', approxWeight: 395 },
        'en'
      )
    ).toBe('approx. 395 g');
  });

  it('keeps two decimals of a kilogram at most', () => {
    expect(
      formatSize(
        { unitSize: null, defaultUnit: 'UNIT', approxWeight: 1000 },
        'en'
      )
    ).toBe('approx. 1 kg');
    expect(
      formatSize(
        { unitSize: null, defaultUnit: 'UNIT', approxWeight: 1234 },
        'en'
      )
    ).toBe('approx. 1.23 kg');
  });

  it('says "by the kilo" for a product sold by the kilo with no weight', () => {
    expect(
      formatSize(
        { unitSize: null, defaultUnit: 'KILOGRAM', approxWeight: null },
        'en'
      )
    ).toBe('by the kilo');
    expect(formatSize({ defaultUnit: 'KILOGRAM' }, 'en')).toBe('by the kilo');
  });

  it('keeps 999 g in grams, and writes 1000 g as a kilogram', () => {
    expect(
      formatSize(
        { unitSize: null, defaultUnit: 'UNIT', approxWeight: 999 },
        'en'
      )
    ).toBe('approx. 999 g');
    expect(
      formatSize(
        { unitSize: null, defaultUnit: 'KILOGRAM', approxWeight: 1000 },
        'en'
      )
    ).toBe('approx. 1 kg');
  });

  it('reads a weight of zero or less as no weight', () => {
    for (const approxWeight of [0, -250]) {
      expect(
        formatSize(
          { unitSize: null, defaultUnit: 'KILOGRAM', approxWeight },
          'en'
        )
      ).toBe('by the kilo');
      expect(
        formatSize({ unitSize: null, defaultUnit: 'UNIT', approxWeight }, 'en')
      ).toBe('');
    }
  });

  it('lets a size win over a weight beside it', () => {
    expect(
      formatSize(
        { unitSize: 250, defaultUnit: 'GRAM', approxWeight: 1560 },
        'en'
      )
    ).toBe('250 g');
  });

  it('writes nothing for any other product with no size', () => {
    expect(formatSize({ unitSize: null, defaultUnit: 'UNIT' }, 'en')).toBe('');
    expect(formatSize({ unitSize: null, defaultUnit: 'GRAM' }, 'en')).toBe('');
  });

  it('leaves a product with a size as it was', () => {
    expect(formatSize({ unitSize: 250, defaultUnit: 'GRAM' }, 'en')).toBe(
      '250 g'
    );
    expect(
      formatSize({ unitSize: 6, defaultUnit: 'LITER', packCount: 6 }, 'en')
    ).toBe('6 x 1 L');
  });
});
