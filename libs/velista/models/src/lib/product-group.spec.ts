import type { ComparableBasis } from './catalog-browse';
import type { CatalogItem, CatalogSuggestion, ProductOffer } from './domain';
import {
  cheaperInGroup,
  compareGroupOffers,
  productSuggestions,
  similarProducts,
} from './product-group';

function offer(
  price: number | null,
  unitPrice: number | null,
  comparable: readonly [number, ComparableBasis] | null = null
): ProductOffer {
  return {
    price,
    currency: 'EUR',
    unitPrice,
    unitPriceLabel: null,
    comparablePrice: comparable?.[0] ?? null,
    comparableBasis: comparable?.[1] ?? null,
    observedAt: null,
    sourceKind: 'OFFICIAL_WEB',
    stale: false,
    priceScopeId: 'scope-1',
    piecePrice: null,
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
    categories: [
      {
        id: 'cat-uncategorised',
        parentId: 'cat-other',
        slug: 'uncategorised',
        name: { en: 'Not yet categorised', es: 'Sin categoría' },
      },
    ],
    offer: priced,
    chainPrices: [],
    imageUrl: null,
    packCount: null,
    unitBasis: null,
    approxWeight: null,
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

  it('orders two offers per kilo by their comparable figure', () => {
    const dear = offer(1, 9, [4, 'KILOGRAM']);
    const cheap = offer(3, 9, [2, 'KILOGRAM']);

    expect([dear, cheap].sort(compareGroupOffers)).toEqual([cheap, dear]);
  });

  it('orders a per kilo offer and a per unit offer by price alone', () => {
    const perKilo = offer(2, null, [0.5, 'KILOGRAM']);
    const perUnit = offer(1, null, [3, 'UNIT']);

    expect([perKilo, perUnit].sort(compareGroupOffers)).toEqual([
      perUnit,
      perKilo,
    ]);
  });

  it('ignores the chain unit price', () => {
    const lowLabel = offer(2, 0.1, [4, 'LITER']);
    const highLabel = offer(2, 9, [3, 'LITER']);

    expect([lowLabel, highLabel].sort(compareGroupOffers)).toEqual([
      highLabel,
      lowLabel,
    ]);
  });

  it('still puts an offer with a till price before one without', () => {
    const unpriced = offer(null, null, [0.1, 'KILOGRAM']);
    const priced = offer(5, null, [9, 'KILOGRAM']);

    expect([unpriced, priced].sort(compareGroupOffers)).toEqual([
      priced,
      unpriced,
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

  it('marks a cheaper sibling per kilo', () => {
    const kilos = [
      item('a', offer(3, null, [6, 'KILOGRAM'])),
      item('b', offer(4, null, [5, 'KILOGRAM'])),
    ];

    expect(cheaperInGroup('a', offer(3, null, [6, 'KILOGRAM']), kilos)).toBe(
      true
    );
    expect(cheaperInGroup('b', offer(4, null, [5, 'KILOGRAM']), kilos)).toBe(
      false
    );
  });

  it('never marks a sibling of another basis, however low its figure', () => {
    const mixed = [
      item('eggs-one', offer(0.3, null, [0.3, 'UNIT'])),
      item('eggs-dozen', offer(2.2, 0.18, [2.2, 'KILOGRAM'])),
    ];

    expect(
      cheaperInGroup('eggs-dozen', offer(2.2, 0.18, [2.2, 'KILOGRAM']), mixed)
    ).toBe(false);
  });

  it('never marks across a figure on one side and none on the other', () => {
    const one = [item('a', offer(0.5, null, [1, 'LITER']))];

    expect(cheaperInGroup('b', offer(2, null), one)).toBe(false);
  });

  it('does not mark a tie of the comparable figure', () => {
    const tied = [item('a', offer(1, null, [2, 'LITER']))];

    expect(cheaperInGroup('b', offer(3, null, [2, 'LITER']), tied)).toBe(false);
  });

  it('never marks a product with no price', () => {
    expect(cheaperInGroup('c', null, members)).toBe(false);
    expect(cheaperInGroup('c', offer(null, 5), members)).toBe(false);
  });
});
