import { productDetailText, productSizeText } from './product-size';

/** Words for the units this spec names, and the bare key for any other. */
const translate = (key: string, args?: Record<string, unknown>) => {
  const size = String(args?.['size'] ?? '');
  switch (key) {
    case 'list.add.size.LITER':
      return `${size} L`;
    case 'list.add.weight.KILOGRAM':
      return `~${size}\u00a0kg`;
    case 'list.add.weight.GRAM':
      return `~${size}\u00a0g`;
    case 'list.add.size.UNIT':
      return `${size} units`;
    default:
      return key;
  }
};

describe('productSizeText', () => {
  it('says how big the packet is, in the reader’s number format', () => {
    expect(productSizeText(1.5, 'LITER', 'en', translate, null)).toBe('1.5 L');
    expect(productSizeText(1.5, 'LITER', 'es', translate, null)).toBe('1,5 L');
  });

  it('says nothing where the catalog knows no size', () => {
    expect(productSizeText(null, 'LITER', 'en', translate, null)).toBeNull();
    expect(productSizeText(0, 'LITER', 'en', translate, null)).toBeNull();
    expect(productSizeText(1, null, 'en', translate, null)).toBeNull();
  });

  it('says nothing for a count of one, which every product is', () => {
    expect(productSizeText(1, 'UNIT', 'en', translate, null)).toBeNull();
    expect(productSizeText(6, 'UNIT', 'en', translate, null)).toBe('6 units');
  });

  it('says the approximate weight of a piece in kilos, in the reader’s format', () => {
    expect(productSizeText(null, 'KILOGRAM', 'es', translate, 1560)).toBe(
      '~1,56\u00a0kg'
    );
    expect(productSizeText(null, 'KILOGRAM', 'en', translate, 1560)).toBe(
      '~1.56\u00a0kg'
    );
    expect(productSizeText(null, 'KILOGRAM', 'en', translate, 1000)).toBe(
      '~1\u00a0kg'
    );
  });

  it('says a weight under a kilo in grams', () => {
    expect(productSizeText(null, 'KILOGRAM', 'es', translate, 395)).toBe(
      '~395\u00a0g'
    );
  });

  it('says a weight that rounds to a kilo in kilos, never as 1,000 grams', () => {
    expect(productSizeText(null, 'KILOGRAM', 'en', translate, 999.6)).toBe(
      '~1\u00a0kg'
    );
    expect(productSizeText(null, 'KILOGRAM', 'en', translate, 999.4)).toBe(
      '~999\u00a0g'
    );
  });

  it('says the weight of a piece priced as one, whatever its unit', () => {
    expect(productSizeText(null, 'UNIT', 'es', translate, 580)).toBe(
      '~580\u00a0g'
    );
  });

  it('falls back to the size with no weight or a weight of zero', () => {
    expect(productSizeText(1.5, 'LITER', 'en', translate, 0)).toBe('1.5 L');
    expect(productSizeText(null, 'KILOGRAM', 'en', translate, null)).toBeNull();
    expect(productSizeText(null, 'KILOGRAM', 'en', translate, 0)).toBeNull();
  });

  it('never lets a key reach the screen for a unit it has no words for', () => {
    expect(productSizeText(2, 'FURLONG', 'en', translate, null)).toBeNull();
  });
});

describe('productDetailText', () => {
  it('states the format, then the brand', () => {
    expect(
      productDetailText(
        { size: 1, unit: 'LITER', approxWeight: null, brand: 'Oatly' },
        'en',
        translate
      )
    ).toBe('1 L · Oatly');
  });

  it('states whichever of the two the catalog knows, with no separator', () => {
    expect(
      productDetailText(
        { size: null, unit: 'LITER', approxWeight: null, brand: 'Oatly' },
        'en',
        translate
      )
    ).toBe('Oatly');
    expect(
      productDetailText(
        { size: 1, unit: 'LITER', approxWeight: null, brand: null },
        'en',
        translate
      )
    ).toBe('1 L');
  });

  it('answers null when it knows neither', () => {
    expect(
      productDetailText(
        { size: null, unit: null, approxWeight: null, brand: ' ' },
        'en',
        translate
      )
    ).toBeNull();
  });
});
