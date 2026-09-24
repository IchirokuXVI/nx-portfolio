import type {
  CatalogItem,
  CatalogSuggestion,
  ChainPrice,
  ProductOffer,
} from '@portfolio/velista/models';
import { formatMoney } from '@portfolio/velista/platform';
import {
  suggestionCardView,
  type SuggestionCardOptions,
} from './suggestion-card-view';

/**
 * What one card says (velista `0101`). Each rule the canvas settles is one test
 * here, because the view function is where the rule lives and the template only
 * places what it decided.
 *
 * The translator echoes the key and its arguments, so an assertion names the
 * copy it expects without depending on the words.
 */
const NOW = new Date('2026-09-24T12:00:00.000Z');

const options: SuggestionCardOptions = {
  locale: 'en',
  now: NOW,
  translate: (key, args) =>
    args === undefined ? key : `${key} ${JSON.stringify(args)}`,
};

function offer(
  price: number | null,
  overrides: Partial<ProductOffer> = {}
): ProductOffer {
  return {
    price,
    currency: 'EUR',
    unitPrice: null,
    unitPriceLabel: null,
    observedAt: null,
    sourceKind: 'OFFICIAL_WEB',
    stale: false,
    priceScopeId: 'scope',
    ...overrides,
  };
}

function chain(id: string, name: string, price: number | null): ChainPrice {
  return {
    chain: { id, name: { es: name, en: name } },
    offer: offer(price, { priceScopeId: `scope-${id}` }),
  };
}

function product(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: 'item-1',
    name: { es: 'Leche entera', en: 'Whole milk' },
    brand: 'Hacendado',
    size: 1,
    unit: 'LITER',
    productGroupId: null,
    category: 'DAIRY',
    offer: null,
    chainPrices: [],
    imageUrl: null,
    packCount: null,
    unitBasis: null,
    ...overrides,
  };
}

function itemCard(overrides: Partial<CatalogItem> = {}) {
  const suggestion: CatalogSuggestion = {
    kind: 'item',
    item: product(overrides),
  };
  return suggestionCardView(suggestion, options);
}

function money(amount: number): string {
  return formatMoney(amount, 'EUR', 'en');
}

describe('suggestionCardView, an item', () => {
  it('reads the name in the reader’s language, and brand and size under it', () => {
    const card = itemCard();

    expect(card.name).toBe('Whole milk');
    expect(card.meta).toBe('Hacendado · list.add.size.LITER {"size":"1"}');
    expect(card.group).toBe(false);
    expect(card.productId).toBe('item-1');
  });

  it('says nothing about price, and draws no foot, for a product with none', () => {
    // `Edge`: no dash and no reserved blank. The card falls back to the height of
    // its own photograph.
    const card = itemCard();

    expect(card.price).toBeNull();
    expect(card.aside).toBeNull();
    expect(card.chains).toBeNull();
    expect(card.foot).toBe(false);
  });

  it('quotes the price of this packet', () => {
    expect(itemCard({ offer: offer(0.95) }).price).toBe(money(0.95));
  });

  describe('the price per unit (rule 5)', () => {
    it('is drawn when it differs from the price', () => {
      const card = itemCard({
        size: 6,
        offer: offer(6.54, { unitPrice: 1.09 }),
        unitBasis: 'LITER',
      });

      expect(card.aside).toBe(`catalog.unit.LITER {"price":"${money(1.09)}"}`);
    });

    it('is not drawn when it is the same number, a one litre carton', () => {
      const card = itemCard({
        offer: offer(0.95, { unitPrice: 0.95 }),
        unitBasis: 'LITER',
      });

      expect(card.aside).toBeNull();
    });

    it('is not drawn without a basis to name, rather than guessing one', () => {
      const card = itemCard({ offer: offer(6.54, { unitPrice: 1.09 }) });

      expect(card.aside).toBeNull();
    });
  });

  describe('a stale price', () => {
    const stale = offer(1.35, {
      stale: true,
      observedAt: new Date('2026-09-12T12:00:00.000Z'),
      unitPrice: 1.35,
    });

    it('is marked stale, and its age takes the second line’s trailing slot', () => {
      const card = itemCard({ offer: stale, unitBasis: 'LITER' });

      expect(card.stale).toBe(true);
      expect(card.aside).toBe('list.add.card.seen {"when":"12 days ago"}');
    });

    it('is fresh when the server did not say otherwise', () => {
      expect(itemCard({ offer: offer(1.35) }).stale).toBe(false);
    });
  });

  describe('the chains (rule 6)', () => {
    const five = [
      chain('mercadona', 'Mercadona', 1.19),
      chain('carrefour', 'Carrefour', 1.25),
      chain('dia', 'Dia', 1.29),
      chain('lidl', 'Lidl', 1.32),
      chain('deza', 'Deza', 1.38),
    ];

    it('names the cheapest chain and no other', () => {
      const card = itemCard({ offer: offer(1.19), chainPrices: five });

      expect(card.chains?.lead).toBe('Mercadona');
      expect(card.chains?.marks.map((mark) => mark.initial)).toEqual([
        'M',
        'C',
        'D',
      ]);
      expect(card.chains?.more).toBe(2);
      expect(card.chains?.label).toBe('list.add.card.soldAtMany {"count":5}');
    });

    it('names the one chain in the button’s words when there is one', () => {
      const card = itemCard({
        offer: offer(0.95),
        chainPrices: [chain('dia', 'Dia', 0.95)],
      });

      expect(card.chains?.more).toBe(0);
      expect(card.chains?.label).toBe('list.add.card.soldAt {"chain":"Dia"}');
    });

    it('lists every chain with its own price when opened, the cheapest marked', () => {
      const card = itemCard({ offer: offer(1.19), chainPrices: five });

      expect(
        card.shops.map((shop) => [shop.name, shop.price, shop.best])
      ).toEqual([
        ['Mercadona', money(1.19), true],
        ['Carrefour', money(1.25), false],
        ['Dia', money(1.29), false],
        ['Lidl', money(1.32), false],
        ['Deza', money(1.38), false],
      ]);
    });

    it('says how old a stale chain price is on its own row', () => {
      const card = itemCard({
        offer: offer(1.19),
        chainPrices: [
          {
            chain: { id: 'deza', name: { es: 'Deza', en: 'Deza' } },
            offer: offer(1.38, {
              stale: true,
              observedAt: new Date('2026-09-12T12:00:00.000Z'),
            }),
          },
        ],
      });

      expect(card.shops[0]?.note).toBe(
        'list.add.card.seen {"when":"12 days ago"}'
      );
    });
  });

  describe('the pack (backend 0162)', () => {
    it('reads "Pack 6" from the count, and names it to the add button', () => {
      const card = itemCard({ packCount: 6, size: 6 });

      expect(card.pack).toBe('list.add.card.pack {"count":6}');
      expect(card.pickLabel).toContain('list.add.card.pack {\\"count\\":6}');
    });

    it('draws no pack for a product that is not one', () => {
      expect(itemCard().pack).toBeNull();
    });
  });

  it('names the product, its brand and its size to the add button', () => {
    expect(itemCard().pickLabel).toBe(
      'list.add.card.add {"name":"Whole milk, Hacendado, list.add.size.LITER {\\"size\\":\\"1\\"}"}'
    );
  });
});

describe('suggestionCardView, a group (rule 4)', () => {
  function groupCard(
    count: number,
    members: readonly CatalogItem[],
    floor: ProductOffer | null = offer(0.89)
  ) {
    return suggestionCardView(
      {
        kind: 'group',
        group: { id: 'group-milk', name: { es: 'Leche', en: 'Milk' } },
        itemIds: Array.from({ length: count }, (_unused, index) => `i${index}`),
        offer: floor,
        members,
      },
      options
    );
  }

  const five = ['Hacendado', 'Dia', 'Asturiana', 'Puleva', 'Milbona'].map(
    (brand, index) =>
      product({ id: `i${index}`, brand, offer: offer(0.89 + index / 10) })
  );

  it('labels its price as a floor, "from", and not as the price of a thing', () => {
    expect(groupCard(6, five).price).toBe(
      `list.add.card.from {"price":"${money(0.89)}"}`
    );
  });

  it('says it is one line, cheapest of the count at the shop', () => {
    expect(groupCard(6, five).meta).toBe('list.add.card.groupLine {"count":6}');
  });

  it('reveals at most five products with a count of the rest', () => {
    const card = groupCard(6, five);

    expect(card.members).toHaveLength(5);
    expect(card.members[0]).toEqual({
      id: 'i0',
      name: 'Whole milk',
      brand: 'Hacendado',
      price: money(0.89),
    });
    expect(card.reveal).toBe('list.add.card.groupProducts {"count":6}');
    expect(card.membersMore).toBe('list.add.card.groupMore {"count":1}');
  });

  it('says no "and N more" when the five are all of them', () => {
    expect(groupCard(5, five).membersMore).toBeNull();
  });

  it('draws no reveal and no foot when the server sent no members', () => {
    const card = groupCard(6, []);

    expect(card.reveal).toBeNull();
    expect(card.foot).toBe(false);
  });

  it('names no chain and links to no product', () => {
    const card = groupCard(6, five);

    expect(card.chains).toBeNull();
    expect(card.productId).toBeNull();
    expect(card.group).toBe(true);
  });

  it('draws no price for a group nobody prices', () => {
    expect(groupCard(6, five, null).price).toBeNull();
  });
});
