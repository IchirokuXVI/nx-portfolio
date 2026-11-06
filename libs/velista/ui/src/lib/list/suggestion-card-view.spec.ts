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
 * What one search card says (velista `0101`, drawn as the one card since `0162`).
 * Each rule the canvas settles is one test
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
    categories: [
      {
        id: 'cat-milk',
        parentId: 'cat-eggs-milk-and-butter',
        slug: 'milk',
        name: { en: 'Milk', es: 'Leche' },
      },
    ],
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

    expect(card.row.name).toBe('Whole milk');
    expect(card.row.detail).toBe(
      'Hacendado · list.add.size.LITER {"size":"1"}'
    );
    expect(card.group).toBeNull();
    expect(card.productId).toBe('item-1');
  });

  it('carries the photo of the product, and none when it has none', () => {
    expect(
      itemCard({ imageUrl: 'https://img.test/milk.jpg' }).row.imageUrl
    ).toBe('https://img.test/milk.jpg');
    expect(itemCard().row.imageUrl).toBeNull();
  });

  it('has no price, no unit price and no chain line for a product with none', () => {
    const card = itemCard();

    expect(card.row.price).toBeNull();
    expect(card.row.unitPrice).toBeNull();
    expect(card.row.seen).toBeNull();
    expect(card.row.chains).toBeNull();
    expect(card.shops).toEqual([]);
    expect(card.row.label).toContain('catalog.row.noPrice');
  });

  it('quotes the price of this packet', () => {
    expect(itemCard({ offer: offer(0.95) }).row.price).toEqual({
      amount: money(0.95),
      per: null,
    });
  });

  describe('the price per unit (rule 5)', () => {
    it('is drawn when it differs from the price', () => {
      const card = itemCard({
        size: 6,
        offer: offer(6.54, { unitPrice: 1.09 }),
        unitBasis: 'LITER',
      });

      expect(card.row.unitPrice).toEqual({
        amount: money(1.09),
        per: 'catalog.per.LITER',
      });
    });

    it('is not drawn when it is the same number, a one litre carton', () => {
      const card = itemCard({
        offer: offer(0.95, { unitPrice: 0.95 }),
        unitBasis: 'LITER',
      });

      expect(card.row.unitPrice).toBeNull();
    });

    it('is not drawn without a basis to name, rather than guessing one', () => {
      const card = itemCard({ offer: offer(6.54, { unitPrice: 1.09 }) });

      expect(card.row.unitPrice).toBeNull();
    });
  });

  describe('a stale price', () => {
    const stale = offer(1.35, {
      stale: true,
      observedAt: new Date('2026-09-12T12:00:00.000Z'),
      unitPrice: 1.35,
    });

    it('is marked stale, and its age takes the unit price’s place', () => {
      const card = itemCard({ offer: stale, unitBasis: 'LITER' });

      expect(card.row.stale).toBe(true);
      expect(card.row.seen).toBe('12 days ago');
      expect(card.row.unitPrice).toBeNull();
    });

    it('is fresh when the server did not say otherwise', () => {
      expect(itemCard({ offer: offer(1.35) }).row.stale).toBe(false);
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

      expect(card.row.chains?.lead).toBe('Mercadona');
      expect(card.row.chains?.marks.map((mark) => mark.initial)).toEqual([
        'M',
        'C',
        'D',
      ]);
      expect(card.row.chains?.more).toBe(2);
      expect(card.row.chains?.label).toBe(
        'list.add.card.soldAtMany {"count":5}'
      );
    });

    it('names the one chain in the button’s words when there is one', () => {
      const card = itemCard({
        offer: offer(0.95),
        chainPrices: [chain('dia', 'Dia', 0.95)],
      });

      expect(card.row.chains?.more).toBe(0);
      expect(card.row.chains?.label).toBe(
        'list.add.card.soldAt {"chain":"Dia"}'
      );
    });

    it('lists every chain with its own price when opened, the cheapest marked', () => {
      const card = itemCard({ offer: offer(1.19), chainPrices: five });

      expect(
        card.shops.map((shop) => [shop.name, shop.price, shop.best])
      ).toEqual([
        ['Mercadona', { amount: money(1.19), per: null }, true],
        ['Carrefour', { amount: money(1.25), per: null }, false],
        ['Dia', { amount: money(1.29), per: null }, false],
        ['Lidl', { amount: money(1.32), per: null }, false],
        ['Deza', { amount: money(1.38), per: null }, false],
      ]);
    });

    it('prices each chain of a kilo piece by the piece (velista 0179)', () => {
      const piece = (id: string, name: string, kilo: number, one: number) => ({
        chain: { id, name: { es: name, en: name } },
        offer: offer(kilo, { priceScopeId: `scope-${id}`, piecePrice: one }),
      });
      const card = itemCard({
        size: null,
        unit: 'KILOGRAM',
        approxWeight: 1560,
        offer: offer(13.42, { piecePrice: 20.94 }),
        chainPrices: [
          piece('mercadona', 'Mercadona', 13.42, 20.94),
          piece('dia', 'Dia', 14.1, 22),
        ],
      });

      expect(card.shops.map((shop) => shop.price)).toEqual([
        { amount: money(20.94), per: null },
        { amount: money(22), per: null },
      ]);
    });

    it('says each chain of a loose product prices it by the kilo (velista 0179)', () => {
      const card = itemCard({
        size: null,
        unit: 'KILOGRAM',
        approxWeight: null,
        offer: offer(2.49),
        chainPrices: [chain('mercadona', 'Mercadona', 2.49)],
      });

      expect(card.shops[0]?.price).toEqual({
        amount: money(2.49),
        per: 'catalog.per.KILOGRAM',
      });
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
    it('puts "Pack 6" on the detail line, and names it to the add button', () => {
      const card = itemCard({ packCount: 6, size: 6 });

      expect(card.row.detail).toBe(
        'Hacendado · list.add.size.LITER {"size":"6"} · list.add.card.pack {"count":6}'
      );
      expect(card.pickLabel).toContain('list.add.card.pack {\\"count\\":6}');
    });

    it('draws no pack for a product that is not one', () => {
      expect(itemCard().row.detail).not.toContain('list.add.card.pack');
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
        synonyms: { en: [], es: [] },
      },
      options
    );
  }

  const five = ['Hacendado', 'Dia', 'Asturiana', 'Puleva', 'Milbona'].map(
    (brand, index) =>
      product({ id: `i${index}`, brand, offer: offer(0.89 + index / 10) })
  );

  it('labels its price as a floor, "from", and not as the price of a thing', () => {
    const card = groupCard(6, five);

    expect(card.row.price).toEqual({ amount: money(0.89), per: null });
    expect(card.row.label).toBe(
      `Milk, list.add.card.groupBadge, list.add.card.from ${money(0.89)}`
    );
  });

  it('says what choosing it adds', () => {
    expect(groupCard(6, five).row.detail).toBe(
      'list.add.groupAdds {"count":6}'
    );
  });

  it('reveals at most five products with a count of the rest', () => {
    const card = groupCard(6, five);

    expect(card.group?.members).toHaveLength(5);
    expect(card.group?.members[0]).toEqual({
      id: 'i0',
      name: 'Whole milk',
      brand: 'Hacendado',
      price: money(0.89),
    });
    expect(card.group?.reveal).toBe('list.add.card.groupProducts {"count":6}');
    expect(card.group?.more).toBe('list.add.card.groupMore {"count":1}');
  });

  it('says no "and N more" when the five are all of them', () => {
    expect(groupCard(5, five).group?.more).toBeNull();
  });

  it('draws no reveal when the server sent no members', () => {
    expect(groupCard(6, []).group?.reveal).toBeNull();
  });

  it('names no chain, has no photo and links to no product', () => {
    const card = groupCard(6, five);

    expect(card.row.chains).toBeNull();
    expect(card.row.imageUrl).toBeNull();
    expect(card.shops).toEqual([]);
    expect(card.productId).toBeNull();
    expect(card.group).not.toBeNull();
  });

  it('draws no price for a group nobody prices', () => {
    expect(groupCard(6, five, null).row.price).toBeNull();
  });

  describe('a group of products sold by the kilo (velista 0179)', () => {
    const pieces = [20.94, 22].map((one, index) =>
      product({
        id: `p${index}`,
        size: null,
        unit: 'KILOGRAM',
        approxWeight: 1560,
        offer: offer(13.42 + index, {
          priceScopeId: `scope-${index}`,
          piecePrice: one,
        }),
      })
    );
    const loose = [
      product({
        id: 'l0',
        size: null,
        unit: 'KILOGRAM',
        approxWeight: null,
        offer: offer(2.49),
      }),
    ];

    it('prices the floor of kilo pieces by its member, the piece price', () => {
      const card = groupCard(2, pieces, pieces[0].offer);

      expect(card.row.price).toEqual({ amount: money(20.94), per: null });
      expect(card.group?.members.map((member) => member.price)).toEqual([
        money(20.94),
        money(22),
      ]);
    });

    it('prices the floor by its offer alone when no member shown has it', () => {
      const card = groupCard(
        3,
        pieces,
        offer(12, { priceScopeId: 'scope-other', piecePrice: 18.72 })
      );

      expect(card.row.price).toEqual({ amount: money(18.72), per: null });
    });

    it('says a loose member and its floor are priced by the kilo', () => {
      const card = groupCard(1, loose, loose[0].offer);

      expect(card.row.price).toEqual({
        amount: money(2.49),
        per: 'catalog.per.KILOGRAM',
      });
      expect(card.row.label).toContain(
        `list.add.card.from ${money(2.49)} catalog.per.KILOGRAM`
      );
      expect(card.group?.members[0]?.price).toBe(
        `${money(2.49)} catalog.per.KILOGRAM`
      );
    });
  });
});
