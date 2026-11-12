import { lineRowFacts, type LineRowShownProduct } from './list-view';

/**
 * Velista `0191`, section 2.2 as the owner's decision of 2026-11-12 reads it: the
 * size, the price of one of what the line counts, and the total of its amount.
 */
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
    total: { amount: '1,98 €', estimated: false },
    ...overrides,
  };
}

describe('lineRowFacts (velista 0191)', () => {
  it('a pack of two: the size, the pack price, the total twice it with no mark', () => {
    expect(lineRowFacts(product())).toEqual({
      size: '1 L',
      unitPrice: { amount: '0,99 €', per: null },
      total: { amount: '1,98 €', estimated: false },
      noPrice: false,
    });
  });

  it('a pack of one: the total equals the unit price, and both are drawn', () => {
    const facts = lineRowFacts(
      product({ total: { amount: '0,99 €', estimated: false } })
    );

    expect(facts.unitPrice).toEqual({ amount: '0,99 €', per: null });
    expect(facts.total).toEqual({ amount: '0,99 €', estimated: false });
  });

  it('a loose product at 750 g: the price per kilo, then the total, estimated', () => {
    const loose = product({
      size: null,
      price: { amount: '2,50 €', per: '/ kg' },
      total: { amount: '1,88 €', estimated: true },
    });

    expect(lineRowFacts(loose)).toEqual({
      size: null,
      unitPrice: { amount: '2,50 €', per: '/ kg' },
      total: { amount: '1,88 €', estimated: true },
      noPrice: false,
    });
  });

  it('any product at 0: the third line is empty, not No price', () => {
    const loose = product({
      size: null,
      price: { amount: '2,50 €', per: '/ kg' },
      total: null,
    });

    expect(lineRowFacts(loose)).toEqual({
      size: null,
      unitPrice: { amount: '2,50 €', per: '/ kg' },
      total: null,
      noPrice: false,
    });
    expect(lineRowFacts(product({ total: null }))).toMatchObject({
      total: null,
      noPrice: false,
    });
  });

  it('a kilo piece: "~2,5 kg", the piece price, the total of three pieces, estimated', () => {
    const piece = product({
      size: '~2,5 kg',
      price: { amount: '34,98 €', per: null },
      total: { amount: '104,94 €', estimated: true },
    });

    expect(lineRowFacts(piece)).toEqual({
      size: '~2,5 kg',
      unitPrice: { amount: '34,98 €', per: null },
      total: { amount: '104,94 €', estimated: true },
      noPrice: false,
    });
  });

  it('no price (a kilo piece with no piece price): line 2 empty, line 3 No price', () => {
    const piece = product({ size: '~2,5 kg', price: null, total: null });

    expect(lineRowFacts(piece)).toEqual({
      size: '~2,5 kg',
      unitPrice: null,
      total: null,
      noPrice: true,
    });
  });

  it('no price wins over a total the builder could not have counted', () => {
    expect(
      lineRowFacts(
        product({ price: null, total: { amount: '1,98 €', estimated: false } })
      )
    ).toMatchObject({ total: null, noPrice: true });
  });
});
