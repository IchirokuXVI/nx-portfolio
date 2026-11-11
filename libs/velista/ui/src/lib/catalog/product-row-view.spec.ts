import { type ProductOffer } from '@portfolio/velista/models';
import { measurePriceWords, type PricedProduct } from './product-row-view';

/**
 * Velista `0191`, decision D: the second fact line of a compact row, for each way a
 * product is sold.
 */
function offer(overrides: Partial<ProductOffer> = {}): ProductOffer {
  return {
    price: 2.5,
    currency: 'EUR',
    unitPrice: null,
    unitPriceLabel: null,
    comparablePrice: null,
    comparableBasis: null,
    piecePrice: null,
    observedAt: null,
    sourceKind: 'SCRAPED',
    ...overrides,
  } as ProductOffer;
}

const translate = (key: string): string =>
  key.startsWith('catalog.per.')
    ? `/ ${key.slice('catalog.per.'.length)}`
    : key;

function product(overrides: Partial<PricedProduct> = {}): PricedProduct {
  return {
    unit: 'UNIT',
    size: null,
    approxWeight: null,
    unitBasis: null,
    ...overrides,
  };
}

/** The words, with the no break space `Intl` puts before the euro sign made plain. */
function words(o: ProductOffer | null, p: PricedProduct | null) {
  const answer = measurePriceWords(o, p, 'es-ES', translate);
  return answer === null
    ? null
    : { ...answer, amount: answer.amount.replace(/\s/g, ' ') };
}

describe('measurePriceWords (velista 0191, decision D)', () => {
  it('a product sold by the kilo answers its price per kilo', () => {
    expect(words(offer(), product({ unit: 'KILOGRAM' }))).toEqual({
      amount: '2,50 €',
      per: '/ KILOGRAM',
    });
  });

  it('a product sold by the litre answers its price per litre', () => {
    expect(words(offer({ price: 1.2 }), product({ unit: 'LITER' }))).toEqual({
      amount: '1,20 €',
      per: '/ LITER',
    });
  });

  it('a kilo piece answers its price per kilo, not the piece', () => {
    expect(
      words(
        offer({ price: 13.99, unitPrice: 13.99, piecePrice: 34.98 }),
        product({ unit: 'KILOGRAM', approxWeight: 2500 })
      )
    ).toEqual({ amount: '13,99 €', per: '/ KILOGRAM' });
  });

  it('a pack answers the unit price with its basis', () => {
    expect(
      words(
        offer({ price: 3.5, unitPrice: 4.67 }),
        product({ unit: 'GRAM', size: 750, unitBasis: 'KILOGRAM' })
      )
    ).toEqual({ amount: '4,67 €', per: '/ KILOGRAM' });
  });

  it('a pack whose unit price equals its price still draws it', () => {
    expect(
      words(
        offer({ price: 0.99, unitPrice: 0.99 }),
        product({ unit: 'LITER', size: 1, unitBasis: 'LITER' })
      )
    ).toEqual({ amount: '0,99 €', per: '/ LITER' });
  });

  it('a pack with no basis, or no unit price, answers null', () => {
    expect(
      words(offer({ unitPrice: 4.67 }), product({ size: 6, unitBasis: null }))
    ).toBeNull();
    expect(
      words(offer({ unitPrice: null }), product({ size: 6, unitBasis: 'UNIT' }))
    ).toBeNull();
  });

  it('an offer with no price answers null', () => {
    expect(words(offer({ price: null }), product({ unit: 'KILOGRAM' }))).toBe(
      null
    );
    expect(words(null, product())).toBeNull();
  });
});
