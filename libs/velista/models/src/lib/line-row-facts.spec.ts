import { lineRowFacts, type LineRowShownProduct } from './list-view';

/** Velista `0191`, section 2.2: the three facts of a compact row, decided once. */
function product(
  overrides: Partial<LineRowShownProduct> = {}
): LineRowShownProduct {
  return {
    kind: 'shown',
    itemId: 'p',
    name: 'Leche entera',
    brandSize: 'Hacendado · 1 L',
    imageUrl: null,
    favorite: false,
    others: 0,
    price: { amount: '0,99 €', per: null },
    brand: 'Hacendado',
    size: '1 L',
    perMeasure: { amount: '0,99 €', per: '/ L' },
    askedCost: null,
    ...overrides,
  };
}

describe('lineRowFacts (velista 0191)', () => {
  it('a pack: the size, the measure price equal to the price, the price with no mark', () => {
    expect(lineRowFacts(product(), 2)).toEqual({
      size: '1 L',
      perMeasure: { amount: '0,99 €', per: '/ L' },
      price: { amount: '0,99 €', estimated: false },
      priceBlank: false,
    });
  });

  it('a loose product at 750 g: the asked cost, estimated', () => {
    const loose = product({
      size: null,
      price: { amount: '2,50 €', per: '/ kg' },
      perMeasure: { amount: '2,50 €', per: '/ kg' },
      askedCost: { amount: '1,88 €', estimated: true },
    });

    expect(lineRowFacts(loose, 750)).toEqual({
      size: null,
      perMeasure: { amount: '2,50 €', per: '/ kg' },
      price: { amount: '1,88 €', estimated: true },
      priceBlank: false,
    });
  });

  it('a loose product at 0: the third line is blank, not No price', () => {
    const loose = product({
      size: null,
      price: { amount: '2,50 €', per: '/ kg' },
      perMeasure: { amount: '2,50 €', per: '/ kg' },
      askedCost: null,
    });

    expect(lineRowFacts(loose, 0)).toEqual({
      size: null,
      perMeasure: { amount: '2,50 €', per: '/ kg' },
      price: null,
      priceBlank: true,
    });
  });

  it('a loose product above 0 with no cost is No price', () => {
    const loose = product({
      price: { amount: '2,50 €', per: '/ kg' },
      askedCost: null,
    });

    expect(lineRowFacts(loose, 750)).toMatchObject({
      price: null,
      priceBlank: false,
    });
  });

  it('a kilo piece: "~2,5 kg", the price per kilo, the piece price', () => {
    const piece = product({
      size: '~2,5 kg',
      perMeasure: { amount: '13,99 €', per: '/ kg' },
      price: { amount: '34,98 €', per: null },
    });

    expect(lineRowFacts(piece, 1)).toEqual({
      size: '~2,5 kg',
      perMeasure: { amount: '13,99 €', per: '/ kg' },
      price: { amount: '34,98 €', estimated: false },
      priceBlank: false,
    });
  });

  it('a kilo piece with no piece price: price null', () => {
    const piece = product({
      size: '~2,5 kg',
      perMeasure: { amount: '13,99 €', per: '/ kg' },
      price: null,
    });

    expect(lineRowFacts(piece, 1)).toMatchObject({
      price: null,
      priceBlank: false,
    });
  });

  it('a product with no unit basis: measure null', () => {
    expect(lineRowFacts(product({ perMeasure: null }), 1).perMeasure).toBe(
      null
    );
  });
});
