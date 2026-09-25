import type { CatalogItem, CatalogSuggestion, ProductOffer } from './domain';
import {
  cheaperInGroup,
  compareGroupOffers,
  productSuggestions,
  similarProducts,
} from './product-group';

function offer(price: number | null, unitPrice: number | null): ProductOffer {
  return {
    price,
    currency: 'EUR',
    unitPrice,
    unitPriceLabel: null,
    observedAt: null,
    sourceKind: 'OFFICIAL_WEB',
    stale: false,
    priceScopeId: 'scope-1',
  };
}

function item(id: string, priced: ProductOffer | null): CatalogItem {
  return {
    id,
    name: { en: id, es: id },
    brand: null,
    size: null,
    unit: 'UNIT',
    productGroupId: 'group-1',
    category: 'OTHER',
    offer: priced,
    chainPrices: [],
    imageUrl: null,
    packCount: null,
    unitBasis: null,
  };
}

describe('productSuggestions', () => {
  it('keeps the products and drops every group', () => {
    const product: CatalogSuggestion = { kind: 'item', item: item('a', null) };
    const found: CatalogSuggestion[] = [
      {
        kind: 'group',
        group: { id: 'group-1', name: { en: 'Milk', es: 'Leche' } },
        itemIds: ['a'],
        offer: null,
        members: [],
        synonyms: { en: [], es: [] },
      },
      product,
    ];

    expect(productSuggestions(found)).toEqual([product]);
  });
});

describe('compareGroupOffers', () => {
  it('puts a till price first, then the lower unit price, then the lower price', () => {
    const rows = [
      offer(null, 0.5),
      offer(2, 1.2),
      offer(1, 1),
      null,
      offer(0.9, 1),
    ];

    expect([...rows].sort(compareGroupOffers)).toEqual([
      offer(0.9, 1),
      offer(1, 1),
      offer(2, 1.2),
      offer(null, 0.5),
      null,
    ]);
  });
});

describe('similarProducts', () => {
  it('leaves out the named products and orders the rest cheapest first', () => {
    const members = [
      item('dear', offer(3, 3)),
      item('self', offer(1, 1)),
      item('unpriced', null),
      item('cheap', offer(2, 2)),
    ];

    expect(
      similarProducts(members, ['self']).map((member) => member.id)
    ).toEqual(['cheap', 'dear', 'unpriced']);
  });
});

describe('cheaperInGroup', () => {
  const members = [item('a', offer(1.2, 1.2)), item('b', offer(0.9, 0.9))];

  it('is true when another member has a lower unit price', () => {
    expect(cheaperInGroup('a', offer(1.2, 1.2), members)).toBe(true);
  });

  it('is false for the cheapest member and on a tie', () => {
    expect(cheaperInGroup('b', offer(0.9, 0.9), members)).toBe(false);
    expect(cheaperInGroup('c', offer(0.9, 0.9), members)).toBe(false);
  });

  it('compares pack prices when a unit price is missing', () => {
    expect(cheaperInGroup('c', offer(1, null), members)).toBe(true);
  });

  it('never marks a product with no price', () => {
    expect(cheaperInGroup('c', null, members)).toBe(false);
    expect(cheaperInGroup('c', offer(null, 5), members)).toBe(false);
  });
});
