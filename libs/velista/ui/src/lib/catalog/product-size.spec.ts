import { productDetailText, productSizeText } from './product-size';

/** Words for the units this spec names, and the bare key for any other. */
const translate = (key: string, args?: Record<string, unknown>) => {
  const size = String(args?.['size'] ?? '');
  switch (key) {
    case 'list.add.size.LITER':
      return `${size} L`;
    case 'list.add.size.UNIT':
      return `${size} units`;
    default:
      return key;
  }
};

describe('productSizeText', () => {
  it('says how big the packet is, in the reader’s number format', () => {
    expect(productSizeText(1.5, 'LITER', 'en', translate)).toBe('1.5 L');
    expect(productSizeText(1.5, 'LITER', 'es', translate)).toBe('1,5 L');
  });

  it('says nothing where the catalog knows no size', () => {
    expect(productSizeText(null, 'LITER', 'en', translate)).toBeNull();
    expect(productSizeText(0, 'LITER', 'en', translate)).toBeNull();
    expect(productSizeText(1, null, 'en', translate)).toBeNull();
  });

  it('says nothing for a count of one, which every product is', () => {
    expect(productSizeText(1, 'UNIT', 'en', translate)).toBeNull();
    expect(productSizeText(6, 'UNIT', 'en', translate)).toBe('6 units');
  });

  it('never lets a key reach the screen for a unit it has no words for', () => {
    expect(productSizeText(2, 'FURLONG', 'en', translate)).toBeNull();
  });
});

describe('productDetailText', () => {
  it('states the format, then the brand', () => {
    expect(
      productDetailText(
        { size: 1, unit: 'LITER', brand: 'Oatly' },
        'en',
        translate
      )
    ).toBe('1 L · Oatly');
  });

  it('states whichever of the two the catalog knows, with no separator', () => {
    expect(
      productDetailText(
        { size: null, unit: 'LITER', brand: 'Oatly' },
        'en',
        translate
      )
    ).toBe('Oatly');
    expect(
      productDetailText(
        { size: 1, unit: 'LITER', brand: null },
        'en',
        translate
      )
    ).toBe('1 L');
  });

  it('answers null when it knows neither', () => {
    expect(
      productDetailText({ size: null, unit: null, brand: ' ' }, 'en', translate)
    ).toBeNull();
  });
});
