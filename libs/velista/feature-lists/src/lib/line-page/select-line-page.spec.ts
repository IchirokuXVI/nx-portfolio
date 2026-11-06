import type {
  CatalogItem,
  Line,
  LineProductPriceRead,
  ProductShopPrice,
  ShoppingListSummary,
} from '@portfolio/velista/models';
import { selectLinePage, type LinePageInput } from './select-line-page';

/**
 * What the line page says, asserted against the function that decides it
 * (velista plan `0135`, sections 2, 3, 3.1 and 3.2).
 */

const ME = 'user-me';
const LIST_ID = 'list-1';
const MERCADONA = 'chain-mercadona';
const CARREFOUR = 'chain-carrefour';

function line(overrides: Partial<Line> = {}): Line {
  return {
    id: 'ln-1',
    listId: LIST_ID,
    content: 'Shampoo',
    quantity: 3,
    itemIds: ['normal', 'classic'],
    productGroupId: null,
    groupItemIds: [],
    favoriteItemId: null,
    preferredSupermarketId: null,
    position: 1,
    approvalStatus: 'APPROVED',
    boughtCount: 12,
    lastSettlementOutcome: null,
    claimed: false,
    named: true,
    claimedByUserId: null,
    createdByUserId: ME,
    approvedByUserId: ME,
    version: 1,
    ...overrides,
  };
}

function list(): ShoppingListSummary {
  return {
    id: LIST_ID,
    zoneId: 'zone-1',
    name: 'Weekly shop',
    createdByUserId: ME,
    autoApproveLines: false,
    lineCount: 12,
    wantedCount: 7,
    myPermissions: ['READ', 'WRITE', 'DECIDE', 'MANAGE'],
  } as ShoppingListSummary;
}

function item(id: string, en: string, brand: string | null): CatalogItem {
  return {
    id,
    name: { en, es: '' },
    brand,
    size: 400,
    unit: 'MILLILITER',
    productGroupId: null,
    categories: [],
    offer: null,
    chainPrices: [],
    imageUrl: null,
    unitBasis: 'LITER',
  } as unknown as CatalogItem;
}

const CATALOG: Record<string, CatalogItem> = {
  normal: item('normal', 'Shampoo for normal hair', 'Deliplus'),
  classic: item('classic', 'Classic care shampoo', 'Pantene'),
};

function price(
  supermarketId: string,
  amount: number,
  unit: number
): ProductShopPrice {
  return {
    supermarketId,
    chain: { en: supermarketId === MERCADONA ? 'Mercadona' : 'Carrefour', es: '' },
    logoUrl: null,
    kind: 'priced',
    offer: {
      price: amount,
      unitPrice: unit,
      currency: 'EUR',
      priceScopeId: 'scope',
    } as ProductShopPrice['offer'],
    cheapest: false,
  };
}

const PRICES: Record<string, LineProductPriceRead> = {
  normal: [price(MERCADONA, 2.15, 5.38), price(CARREFOUR, 2.6, 6.5)],
  classic: [price(CARREFOUR, 3.45, 8.96)],
};

function input(overrides: Partial<LinePageInput> = {}): LinePageInput {
  return {
    line: line(),
    list: list(),
    zoneName: 'Home',
    itemNameOf: (itemId) => CATALOG[itemId] ?? null,
    namesUnavailable: false,
    nameOf: (userId) => (userId === 'user-marta' ? 'Marta' : null),
    callerUserId: ME,
    locale: 'en',
    priceOf: (itemId) => PRICES[itemId],
    supermarketNameOf: (id) => (id === CARREFOUR ? 'Carrefour' : null),
    alsoOn: null,
    commentCount: null,
    canEdit: true,
    canStep: true,
    // The key and its arguments, so a spec reads what was asked for.
    translate: (key, args) =>
      args === undefined ? key : `${key} ${JSON.stringify(args)}`,
    ...overrides,
  };
}

describe('selectLinePage', () => {
  it('answers null with no line, which the page draws as loading or missing', () => {
    expect(selectLinePage(input({ line: undefined }))).toBeNull();
  });

  it('says where the line is and how many', () => {
    const page = selectLinePage(input());

    expect(page).toMatchObject({
      content: 'Shampoo',
      quantity: 3,
      listName: 'Weekly shop',
      zoneName: 'Home',
      boughtCount: 12,
      canStep: true,
    });
  });

  describe('who added it', () => {
    it('uses the word for the reader', () => {
      expect(selectLinePage(input())?.addedBy).toBe('list.page.you');
    });

    it('uses the name the group knows', () => {
      const page = selectLinePage(
        input({ line: line({ createdByUserId: 'user-marta' }) })
      );
      expect(page?.addedBy).toBe('Marta');
    });

    it('says somebody for an author the group cannot name, and for no author', () => {
      for (const createdByUserId of ['user-gone', '']) {
        const page = selectLinePage(input({ line: line({ createdByUserId }) }));
        expect(page?.addedBy).toBe('list.page.someone');
      }
    });
  });

  describe('the cards', () => {
    it('draws one card for each product with its lowest price and its chain', () => {
      const cards = selectLinePage(input())?.cards ?? [];

      expect(cards.map((card) => card.itemId)).toEqual(['normal', 'classic']);
      expect(cards[0]).toMatchObject({
        name: 'Shampoo for normal hair',
        priceKind: 'priced',
        cheapest: true,
        favorite: false,
      });
      expect(cards[0].price?.amount).toContain('2.15');
      expect(cards[0].chain).toBe('Mercadona');
      expect(cards[0].unit?.amount).toContain('5.38');
      expect(cards[0].unit?.per).toBe('catalog.per.LITER');
      expect(cards[1].cheapest).toBe(false);
    });

    describe('a kilo piece (velista 0179)', () => {
      const CHEESE = {
        ...item('cheese', 'Cured cheese', null),
        size: null,
        unit: 'KILOGRAM',
        approxWeight: 1560,
        unitBasis: 'KILOGRAM',
      } as CatalogItem;

      function cheeseCard(
        piecePrice: number | null,
        known: CatalogItem | null = CHEESE
      ) {
        const offer = {
          price: 13.42,
          unitPrice: 13.42,
          piecePrice,
          currency: 'EUR',
          priceScopeId: 'scope',
        } as ProductShopPrice['offer'];
        return selectLinePage(
          input({
            line: line({ itemIds: ['cheese'] }),
            itemNameOf: (itemId) => (itemId === 'cheese' ? known : null),
            priceOf: () => [
              { ...price(MERCADONA, 13.42, 13.42), offer },
            ],
          })
        )?.cards[0];
      }

      it('draws the piece price, and the price per kilo in the caption', () => {
        const card = cheeseCard(20.94);
        expect(card?.price).toEqual({ amount: '€20.94', per: null });
        expect(card?.chain).toBe('Mercadona');
        expect(card?.unit).toEqual({
          amount: '€13.42',
          per: 'catalog.per.KILOGRAM',
        });
      });

      it('draws no price for a kilo piece with a price and no piece price', () => {
        const card = cheeseCard(null);
        expect(card?.priceKind).toBe('noPrice');
        expect(card?.price).toBeNull();
      });

      it('never calls a kilo piece with no piece price the cheapest', () => {
        // A kilo of the cheese costs less than a litre of the shampoo, so the
        // comparison picks it; with no piece price it is drawn unpriced.
        const cheapestOf = (piecePrice: number | null) =>
          selectLinePage(
            input({
              line: line({ itemIds: ['cheese', 'normal'] }),
              itemNameOf: (itemId) =>
                itemId === 'cheese' ? CHEESE : (CATALOG[itemId] ?? null),
              priceOf: (itemId) =>
                itemId === 'cheese'
                  ? [
                      {
                        ...price(MERCADONA, 1, 1),
                        offer: {
                          price: 1,
                          unitPrice: 1,
                          piecePrice,
                          currency: 'EUR',
                          priceScopeId: 'scope',
                        } as ProductShopPrice['offer'],
                      },
                    ]
                  : PRICES[itemId],
            })
          )?.cards.find((card) => card.itemId === 'cheese');

        expect(cheapestOf(1.56)).toMatchObject({
          priceKind: 'priced',
          cheapest: true,
        });
        expect(cheapestOf(null)).toMatchObject({
          priceKind: 'noPrice',
          cheapest: false,
        });
      });

      it('draws the piece price while the catalog has not named the product', () => {
        const card = cheeseCard(20.94, null);
        expect(card?.price).toEqual({ amount: '€20.94', per: null });
        expect(card?.unit).toEqual({
          amount: '€13.42',
          per: 'catalog.per.KILOGRAM',
        });
      });
    });

    it('puts the cheapest first on a line with no favourite', () => {
      // The line holds the dearer product first.
      const cards =
        selectLinePage(input({ line: line({ itemIds: ['classic', 'normal'] }) }))
          ?.cards ?? [];

      expect(cards.map((card) => card.itemId)).toEqual(['normal', 'classic']);
      expect(cards.map((card) => card.cheapest)).toEqual([true, false]);
    });

    it('puts the favourite first and leaves the word on the lowest price', () => {
      const cards =
        selectLinePage(input({ line: line({ favoriteItemId: 'classic' }) }))
          ?.cards ?? [];

      expect(cards.map((card) => card.itemId)).toEqual(['classic', 'normal']);
      expect(cards.map((card) => card.favorite)).toEqual([true, false]);
      expect(cards.map((card) => card.cheapest)).toEqual([false, true]);
    });

    it('shows the prices of the supermarket of the line, with no chain in the caption', () => {
      const cards =
        selectLinePage(
          input({ line: line({ preferredSupermarketId: CARREFOUR }) })
        )?.cards ?? [];

      expect(cards[0].price?.amount).toContain('2.60');
      expect(cards[0].chain).toBeNull();
      expect(cards[0].unit?.per).toBe('catalog.per.LITER');
    });

    it('says a product is not sold at the supermarket of the line', () => {
      const cards =
        selectLinePage(
          input({ line: line({ preferredSupermarketId: MERCADONA }) })
        )?.cards ?? [];

      expect(cards[1]).toMatchObject({
        itemId: 'classic',
        priceKind: 'notSold',
        price: null,
        chain: null,
        unit: null,
      });
    });

    it('draws a product whose prices were not read as loading, never as no price', () => {
      const cards =
        selectLinePage(input({ priceOf: () => undefined }))?.cards ?? [];

      expect(cards.map((card) => card.priceKind)).toEqual([
        'loading',
        'loading',
      ]);
    });

    it('keeps a product the catalog has not named, with no name', () => {
      const cards =
        selectLinePage(input({ itemNameOf: () => null }))?.cards ?? [];

      expect(cards).toHaveLength(2);
      expect(cards[0].name).toBeNull();
      expect(cards[0].detail).toBeNull();
    });
  });

  describe('a line with no products', () => {
    const empty = () => selectLinePage(input({ line: line({ itemIds: [] }) }));

    it('has no cards and no supermarket row', () => {
      expect(empty()?.cards).toEqual([]);
      expect(empty()?.supermarket).toBeNull();
    });

    it('never says the names failed, because there are none to fail', () => {
      const page = selectLinePage(
        input({ line: line({ itemIds: [] }), namesUnavailable: true })
      );
      expect(page?.namesUnavailable).toBe(false);
    });
  });

  describe('the supermarket row', () => {
    it('says any with none chosen', () => {
      expect(selectLinePage(input())?.supermarket).toEqual({
        name: null,
        canChange: true,
      });
    });

    it('names the supermarket of the line', () => {
      const page = selectLinePage(
        input({ line: line({ preferredSupermarketId: CARREFOUR }) })
      );
      expect(page?.supermarket?.name).toBe('Carrefour');
    });

    it('has a word for a supermarket nobody can name', () => {
      const page = selectLinePage(
        input({ line: line({ preferredSupermarketId: 'chain-unknown' }) })
      );
      expect(page?.supermarket?.name).toBe('list.supermarket.other');
    });

    it('does not open for a reader who may not edit', () => {
      const page = selectLinePage(input({ canEdit: false }));
      expect(page?.supermarket?.canChange).toBe(false);
      expect(page?.canEdit).toBe(false);
    });
  });

  it('keeps `alsoOn` null when nobody asked, and the answer when somebody did', () => {
    expect(selectLinePage(input())?.alsoOn).toBeNull();

    const alsoOn = {
      places: [{ listId: 'l2', listName: 'Party list', zoneName: 'Home' }],
      hasMore: false,
    };
    expect(selectLinePage(input({ alsoOn }))?.alsoOn).toBe(alsoOn);
  });
});
