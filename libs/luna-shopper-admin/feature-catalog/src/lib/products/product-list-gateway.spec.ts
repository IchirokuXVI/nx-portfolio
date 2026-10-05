import { GatewayError } from '@portfolio/luna-shopper-admin/data-access';
import type {
  ResourceGateway,
  ResourceQuery,
  ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import type { ItemScopePrices } from '../catalog-seed';
import { toCategoryNodes } from './category-nodes';
import { holdsOwnPrice } from './product-context';
import {
  formatDay,
  formatPrice,
  formatSeen,
  formatSize,
  formatUnitPrice,
} from './product-format';
import {
  PRICE_IDS_PER_READ,
  PRICE_STATE_FILTER,
  PRICE_STATES,
  PRICES_AT_FILTER,
  productListGateway,
  toPriceState,
  type ScopePrice,
} from './product-list-gateway';

/**
 * The parts of the product screens that are pure (admin plan 0043): the
 * gateway that lays the price at one scope over a page of products, and the
 * functions that put a price, a size and a date into words.
 */

interface Product extends ResourceRow {
  id: string;
  name: { en: string };
}

const product = (id: string): Product => ({ id, name: { en: `Name ${id}` } });

const price = (itemId: string, over: Partial<ScopePrice> = {}): ScopePrice =>
  ({
    id: `si_${itemId}`,
    itemId,
    priceScopeId: 'scope',
    price: 1,
    currency: 'EUR',
    unitPrice: 1,
    unitPriceLabel: '1 L',
    observedAt: '2026-10-01T00:00:00.000Z',
    sourceKind: 'OFFICIAL_API',
    stale: false,
    validUntil: null,
    itemPriceId: `ip_${itemId}`,
    available: true,
    itemName: { en: `Priced ${itemId}` },
    ...over,
  }) as ScopePrice;

/** Two gateways that record what they were asked, and answer what they hold. */
function build(
  products: readonly Product[],
  prices: readonly ScopePrice[],
  next: string | null = null
) {
  const productQueries: ResourceQuery[] = [];
  const priceQueries: ResourceQuery[] = [];

  const inner: ResourceGateway<Product> = {
    list: async (query) => {
      productQueries.push(query);
      return { items: products, nextCursor: next };
    },
    read: async (id) => product(id),
    create: async () => product('new'),
    update: async (id) => product(id),
    remove: async () => undefined,
  };
  const priced = {
    list: async (query: ResourceQuery) => {
      priceQueries.push(query);
      const ids = query.filters?.['itemIds'];
      return {
        items: Array.isArray(ids)
          ? prices.filter((row) => ids.includes(row.itemId))
          : prices,
        nextCursor: next,
      };
    },
  };

  return {
    gateway: productListGateway(inner, priced),
    productQueries,
    priceQueries,
  };
}

describe('productListGateway', () => {
  /**
   * A product the list found by its ID (admin plan 0051) is drawn in the row
   * of any other product, so it carries the price at the chosen scope.
   */
  it('reads one product with its price at the scope the list shows', async () => {
    const { gateway, priceQueries } = build([], [price('a', { price: 2.5 })]);

    const row = await gateway.read('a', {
      query: 'a',
      [PRICES_AT_FILTER]: 'scope',
    });

    expect(row.scopePrice?.price).toBe(2.5);
    expect(priceQueries).toHaveLength(1);
    expect(priceQueries[0].filters).toEqual({
      [PRICES_AT_FILTER]: 'scope',
      itemIds: ['a'],
    });
  });

  /**
   * The product was found. A price read that fails after it must not be
   * read as "No product has this ID.", which is what a 404 or a 400 thrown
   * from the read becomes.
   */
  it.each([404, 400, 503])(
    'answers the product without a price when the price read fails with %i',
    async (status) => {
      const { gateway } = build([], []);
      const failing = productListGateway(
        { ...gateway, read: async (id: string) => product(id) },
        {
          list: () =>
            Promise.reject(
              new GatewayError({ code: 'failed', status, correlationId: 'c' })
            ),
        }
      );

      const row = await failing.read('a', { [PRICES_AT_FILTER]: 'scope' });

      expect(row.id).toBe('a');
      // Absent, and not `null`: nobody learned whether the scope holds one.
      expect('scopePrice' in row).toBe(false);
    }
  );

  it('still throws when the product itself cannot be read', async () => {
    const { gateway } = build([], [price('a')]);
    const failing = productListGateway(
      {
        ...gateway,
        read: () =>
          Promise.reject(
            new GatewayError({
              code: 'not_found',
              status: 404,
              correlationId: 'c',
            })
          ),
      },
      { list: async () => ({ items: [], nextCursor: null }) }
    );

    await expect(
      failing.read('a', { [PRICES_AT_FILTER]: 'scope' })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('reads one product alone when the list shows no scope', async () => {
    const { gateway, priceQueries } = build([], [price('a')]);

    const row = await gateway.read('a');

    expect(row.scopePrice).toBeUndefined();
    expect(priceQueries).toEqual([]);
  });

  it('is the product gateway when no scope is asked for', async () => {
    const { gateway, productQueries, priceQueries } = build(
      [product('a'), product('b')],
      []
    );

    const page = await gateway.list({
      order: 'name',
      filters: { query: 'milk' },
    });

    expect(page.items.map((row) => row.id)).toEqual(['a', 'b']);
    expect(page.items[0].scopePrice).toBeUndefined();
    expect(productQueries).toEqual([
      { order: 'name', filters: { query: 'milk' } },
    ]);
    // No price is read for a list that shows none.
    expect(priceQueries).toEqual([]);
  });

  /** One request per page, never one per row. */
  it('reads the prices of a whole page at the scope in one request', async () => {
    const { gateway, productQueries, priceQueries } = build(
      [product('a'), product('b'), product('c')],
      [price('a'), price('c', { price: 2.5 })]
    );

    const page = await gateway.list({
      cursor: 'next',
      filters: { query: 'milk', [PRICES_AT_FILTER]: 'scope' },
    });

    expect(priceQueries).toEqual([
      {
        limit: PRICE_IDS_PER_READ,
        filters: { [PRICES_AT_FILTER]: 'scope', itemIds: ['a', 'b', 'c'] },
      },
    ]);
    expect(page.items.map((row) => row.scopePrice?.price ?? null)).toEqual([
      1,
      // The scope holds no row for it: `null`, which is not "no scope asked".
      null,
      2.5,
    ]);
    expect(page.items[1].scopePrice).toBeNull();
    // The scope never reaches the product route, which does not declare it.
    expect(productQueries).toEqual([
      { cursor: 'next', filters: { query: 'milk' } },
    ]);
  });

  it('asks for no price on an empty page', async () => {
    const { gateway, priceQueries } = build([], [price('a')]);

    await gateway.list({ filters: { [PRICES_AT_FILTER]: 'scope' } });

    expect(priceQueries).toEqual([]);
  });

  it('splits a page larger than one read may name', async () => {
    const many = Array.from({ length: PRICE_IDS_PER_READ + 5 }, (_, index) =>
      product(`p${index}`)
    );
    const { gateway, priceQueries } = build(many, []);

    await gateway.list({ filters: { [PRICES_AT_FILTER]: 'scope' } });

    expect(
      priceQueries.map(
        (query) => (query.filters?.['itemIds'] as readonly string[]).length
      )
    ).toEqual([PRICE_IDS_PER_READ, 5]);
  });

  /**
   * With a state the page is read from the prices, which is the read that can
   * filter by state. A row then names its product and carries nothing else.
   */
  it('reads the page from the prices when a state is asked for', async () => {
    const { gateway, productQueries, priceQueries } = build(
      [product('a')],
      [price('x', { stale: true }), price('y', { stale: true })],
      'more'
    );

    const page = await gateway.list({
      cursor: 'c1',
      limit: 50,
      filters: {
        query: 'ignored',
        [PRICES_AT_FILTER]: 'scope',
        [PRICE_STATE_FILTER]: 'stale',
      },
    });

    expect(productQueries).toEqual([]);
    expect(priceQueries).toEqual([
      {
        cursor: 'c1',
        limit: 50,
        filters: { [PRICES_AT_FILTER]: 'scope', stale: 'true' },
      },
    ]);
    expect(page.nextCursor).toBe('more');
    expect(page.items).toEqual([
      {
        id: 'x',
        name: { en: 'Priced x' },
        scopePrice: price('x', { stale: true }),
        partial: true,
      },
      {
        id: 'y',
        name: { en: 'Priced y' },
        scopePrice: price('y', { stale: true }),
        partial: true,
      },
    ]);
  });

  it('names a priced product that is gone by nothing, and still lists it', async () => {
    const { gateway } = build([], [price('gone', { itemName: null })]);

    const page = await gateway.list({
      filters: { [PRICES_AT_FILTER]: 'scope', [PRICE_STATE_FILTER]: 'stale' },
    });

    expect(page.items[0]).toMatchObject({ id: 'gone', name: {} });
  });

  /** A state means nothing without a scope, and reaches no route. */
  it('ignores a state when no scope is asked for', async () => {
    const { gateway, productQueries, priceQueries } = build([product('a')], []);

    await gateway.list({ filters: { [PRICE_STATE_FILTER]: 'stale' } });

    expect(productQueries).toEqual([{ filters: {} }]);
    expect(priceQueries).toEqual([]);
  });

  it('reads a state it does not know as no state', async () => {
    const { gateway, productQueries } = build([product('a')], []);

    await gateway.list({
      filters: { [PRICES_AT_FILTER]: 'scope', [PRICE_STATE_FILTER]: 'cheap' },
    });

    expect(productQueries).toHaveLength(1);
  });

  it('passes every other act straight to the products', async () => {
    const { gateway } = build([], []);

    expect((await gateway.read('a')).id).toBe('a');
    expect((await gateway.update('b', {})).id).toBe('b');
    await expect(gateway.remove('c')).resolves.toBeUndefined();
  });
});

describe('the states a price can be listed by', () => {
  /**
   * "Not sold here" and "No price" are not among them: the gateway cannot
   * answer either today, and a state it cannot answer is not drawn.
   */
  it('is "out of date" and nothing else', () => {
    expect([...PRICE_STATES]).toEqual(['stale']);
    expect(toPriceState('stale')).toBe('stale');
    expect(toPriceState('unavailable')).toBeNull();
    expect(toPriceState('none')).toBeNull();
    expect(toPriceState(undefined)).toBeNull();
  });
});

describe('a scope that holds a price of its own', () => {
  const scope = (
    priceScopeId: string,
    rowScopes: readonly string[]
  ): ItemScopePrices =>
    ({
      priceScopeId,
      rows: rowScopes.map((id, index) => ({
        id: `row${index}`,
        priceScopeId: id,
      })),
    }) as unknown as ItemScopePrices;

  it('is one with a row written at it', () => {
    expect(holdsOwnPrice(scope('shop', ['shop']))).toBe(true);
    expect(holdsOwnPrice(scope('shop', ['national', 'shop']))).toBe(true);
  });

  /** A shop that only inherits a wider scope's price is not a place it was written. */
  it('is not one whose every row was written at a wider scope', () => {
    expect(holdsOwnPrice(scope('shop', ['national']))).toBe(false);
  });

  /** Only stock was said there, and that was said at the scope itself. */
  it('is one with no row at all', () => {
    expect(holdsOwnPrice(scope('shop', []))).toBe(true);
  });
});

describe('the category tree, from the flat rows', () => {
  const row = (
    id: string,
    parentId: string | null,
    position: number,
    itemCount = 0
  ) => ({
    id,
    parentId,
    slug: id,
    name: { en: `Name ${id}`, es: `Nombre ${id}` },
    position,
    itemCount,
  });

  it('puts each category under its parent, each level by position', () => {
    const nodes = toCategoryNodes(
      [
        row('b', null, 2),
        row('a2', 'a', 2, 7),
        row('a', null, 1, 12),
        row('a1', 'a', 1, 5),
      ],
      ['en', 'es']
    );

    expect(nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(nodes[0].children.map((node) => node.id)).toEqual(['a1', 'a2']);
    expect(nodes[0].count).toBe(12);
    expect(nodes[0].children[1].count).toBe(7);
    expect(nodes[1].children).toEqual([]);
  });

  it('names each in the language the catalog is read in', () => {
    const rows = [row('a', null, 1)];

    expect(toCategoryNodes(rows, ['en', 'es'])[0].name).toBe('Name a');
    expect(toCategoryNodes(rows, ['es', 'en'])[0].name).toBe('Nombre a');
  });

  it('falls back to the handle for a category with no name', () => {
    expect(
      toCategoryNodes([{ ...row('a', null, 1), name: {} }], ['en', 'es'])[0]
        .name
    ).toBe('a');
  });

  /** A row is never lost to a parent a page did not carry. */
  it('draws a category whose parent is missing at the top level', () => {
    const nodes = toCategoryNodes([row('child', 'missing', 1)], ['en']);

    expect(nodes.map((node) => node.id)).toEqual(['child']);
  });
});

describe('how the product screens write a price, a size and a date', () => {
  it('writes money through Intl, in the interface language', () => {
    expect(formatPrice(0.98, 'EUR', 'en')).toBe('€0.98');
    expect(formatPrice(0.98, 'EUR', 'es')).toMatch(/^0,98\s€$/);
    expect(formatPrice(1234.5, 'EUR', 'en')).toBe('€1,234.50');
  });

  it('writes nothing for no price, and a bare number for no currency', () => {
    expect(formatPrice(null, 'EUR', 'en')).toBe('');
    expect(formatPrice(undefined, 'EUR', 'en')).toBe('');
    expect(formatPrice(0.5, null, 'en')).toBe('0.50');
    expect(formatPrice(0, 'EUR', 'en')).toBe('€0.00');
  });

  it('keeps the number when the currency is one Intl does not know', () => {
    expect(formatPrice(2, 'not a code', 'en')).toBe('2.00 not a code');
  });

  it('writes a unit price with what it is per, to four decimals at most', () => {
    expect(formatUnitPrice(0.98, '1 L', 'EUR', 'en')).toBe('€0.98 / 1 L');
    expect(formatUnitPrice(0.1325, 'ud', 'EUR', 'en')).toBe('€0.1325 / ud');
    expect(formatUnitPrice(2, null, 'EUR', 'en')).toBe('€2.00');
    expect(formatUnitPrice(null, '1 L', 'EUR', 'en')).toBe('');
  });

  it('writes a size with the short word of its unit', () => {
    expect(formatSize({ unitSize: 1, defaultUnit: 'LITER' }, 'en')).toBe('1 L');
    expect(formatSize({ unitSize: 450, defaultUnit: 'GRAM' }, 'en')).toBe(
      '450 g'
    );
    expect(
      formatSize({ unitSize: 1500, defaultUnit: 'MILLILITER' }, 'en')
    ).toBe('1,500 ml');
    // A count needs no word.
    expect(formatSize({ unitSize: 12, defaultUnit: 'UNIT' }, 'en')).toBe('12');
    expect(formatSize({ unitSize: null, defaultUnit: 'LITER' }, 'en')).toBe('');
  });

  /** The size of a pack is the size of the whole pack. */
  it('writes a pack as its count and the size of one', () => {
    expect(
      formatSize({ unitSize: 6, defaultUnit: 'LITER', packCount: 6 }, 'en')
    ).toBe('6 x 1 L');
    expect(
      formatSize({ unitSize: 500, defaultUnit: 'GRAM', packCount: 4 }, 'en')
    ).toBe('4 x 125 g');
    expect(
      formatSize({ unitSize: 1.98, defaultUnit: 'LITER', packCount: 6 }, 'en')
    ).toBe('6 x 0.33 L');
    // A pack of one is not a pack, and neither is a product with no count.
    expect(
      formatSize({ unitSize: 1, defaultUnit: 'LITER', packCount: 1 }, 'en')
    ).toBe('1 L');
    expect(
      formatSize({ unitSize: 6, defaultUnit: 'LITER', packCount: null }, 'en')
    ).toBe('6 L');
  });

  it('says how long ago in days, then in weeks', () => {
    const now = Date.parse('2026-10-04T12:00:00.000Z');

    expect(formatSeen('2026-10-04T08:00:00.000Z', now, 'en')).toBe('today');
    expect(formatSeen('2026-10-02T12:00:00.000Z', now, 'en')).toBe(
      '2 days ago'
    );
    expect(formatSeen('2026-08-30T12:00:00.000Z', now, 'en')).toBe(
      '5 weeks ago'
    );
  });

  it('says nothing for no date, an unreadable one and one ahead of now', () => {
    const now = Date.parse('2026-10-04T12:00:00.000Z');

    expect(formatSeen(null, now, 'en')).toBe('');
    expect(formatSeen('not a date', now, 'en')).toBe('');
    expect(formatSeen('2026-10-05T12:00:00.000Z', now, 'en')).toBe('');
  });

  it('writes a day, and the text itself when it is not a date', () => {
    expect(formatDay('2026-10-09T10:00:00.000Z', 'en')).toBe('Oct 9, 2026');
    expect(formatDay('', 'en')).toBe('');
    expect(formatDay('soon', 'en')).toBe('soon');
  });
});
