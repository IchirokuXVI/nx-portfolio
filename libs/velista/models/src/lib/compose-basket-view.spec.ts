import type {
  BasketListRef,
  BasketPriceScope,
  BasketProduct,
  BasketProductAtShop,
  BasketRow,
  BasketRowEntry,
  BasketShop,
} from './basket-view';
import {
  basketPricedAtShop,
  basketReadAtShop,
  basketRowsProgress,
  basketViewActiveCount,
  basketViewChips,
  basketViewRows,
  composeBasketView,
  DEFAULT_BASKET_VIEW_STATE,
  resetBasketViewProperty,
  type BasketViewContext,
  type BasketViewState,
} from './compose-basket-view';
import type { ProductOffer } from './domain';
import type { ProductCategory } from './enums';

/**
 * One row, with one entry unless the test says otherwise.
 *
 * A row with no entry at all is only `REMOVED`, so the default carries one: a
 * pipeline that walked an empty `entries` would pass tests the real model cannot
 * produce. Its list is unserved by default, which is a guest's view and the case
 * the filter and the grouping both have to keep.
 */
function row(
  rowKey: string,
  content: string,
  extra: Partial<BasketRow> = {}
): BasketRow {
  const left = extra.left ?? 1;
  const bought = extra.bought ?? 0;
  return {
    rowKey,
    content,
    left,
    bought,
    asked: bought + left,
    state: 'WANTED',
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    optionIds: [],
    touchedBy: null,
    touchedAt: null,
    entries: [entry(null, { lineId: `zl-${rowKey}` })],
    ...extra,
  };
}

/** One entry of a row, on a served list or on none. */
function entry(
  listId: string | null,
  over: Partial<BasketRowEntry> = {}
): BasketRowEntry {
  return {
    lineId: `zl-${listId ?? 'none'}`,
    listId,
    left: 1,
    bought: 0,
    asked: 1,
    state: 'WANTED',
    awaitingApproval: false,
    demandEditable: true,
    ...over,
  };
}

/** One served list ref, which is what lets a reader name a list. */
function ref(listId: string, name: string): BasketListRef {
  return { listId, name, zoneId: 'z1', zoneName: 'Home' };
}

function product(
  id: string,
  name: string,
  brand: string | null,
  categories: readonly ProductCategory[] = ['OTHER']
): BasketProduct {
  return {
    id,
    name: { en: name, es: name },
    brand,
    categories,
  } as BasketProduct;
}

const CONTEXT: BasketViewContext = {
  query: '',
  products: new Map(),
  locale: 'en',
  lists: new Map(),
  scopes: new Map(),
  shop: null,
};

/** One offer at one scope, which is all the price marks read off it. */
function offer(priceScopeId: string, price: number | null): ProductOffer {
  return {
    price,
    currency: 'EUR',
    unitPrice: null,
    unitPriceLabel: null,
    observedAt: null,
    sourceKind: 'OFFICIAL_WEB',
    stale: false,
    priceScopeId,
  };
}

/** One scope, named. Locations are nothing to this pipeline: it draws chains. */
function scope(priceScopeId: string, chain: string): BasketPriceScope {
  return {
    priceScopeId,
    supermarketName: { en: chain, es: chain },
    locations: [],
  };
}

/** One shop, named, which is what a read at a shop names (velista `0102`). */
function shop(id: string, chain: string): BasketShop {
  return {
    id,
    supermarketId: null,
    chain: { en: chain, es: chain },
    label: null,
    address: null,
    city: null,
    postalCode: null,
    inProfile: null,
  };
}

/** What the shop the read was made at says about one product. */
function at(
  priceScopeId: string | null,
  price: number | null,
  available: boolean | null = null
): BasketProductAtShop {
  return {
    priceScopeId,
    price,
    currency: price === null ? null : 'EUR',
    available,
  };
}

/** The Mercadona the fixtures are read at. */
const MERCA = 'loc-merca';

/**
 * A basket priced at two chains and read at a Mercadona, which is the smallest
 * world the marks need.
 *
 * Milk is listed at both and cheaper at Dia; bread is listed at Mercadona alone;
 * eggs are listed at Dia alone, so a view of Mercadona sinks them. **The price at
 * the shop is `atShop`**, which the server decided, and never a scope picked out of
 * `offers` here.
 */
function priced(): BasketViewContext {
  return {
    ...CONTEXT,
    products: new Map([
      [
        'p-milk',
        {
          ...product('p-milk', 'Milk', null),
          offers: [offer('s-dia', 0.79), offer('s-merca', 0.95)],
          atShop: at('s-merca', 0.95),
        },
      ],
      [
        'p-bread',
        {
          ...product('p-bread', 'Bread', null),
          offers: [offer('s-merca', 1.2)],
          atShop: at('s-merca', 1.2),
        },
      ],
      [
        'p-eggs',
        {
          ...product('p-eggs', 'Eggs', null),
          offers: [offer('s-dia', 2.4)],
          atShop: at(null, null),
        },
      ],
    ]),
    scopes: new Map([
      ['s-merca', scope('s-merca', 'Mercadona')],
      ['s-dia', scope('s-dia', 'Dia')],
    ]),
    shop: shop(MERCA, 'Mercadona'),
  };
}

function state(over: Partial<BasketViewState> = {}): BasketViewState {
  return { ...DEFAULT_BASKET_VIEW_STATE, ...over };
}

describe('composeBasketView', () => {
  it('draws one unheaded section holding every line, by default', () => {
    const rows = [row('a', 'Milk'), row('b', 'Bread')];

    const sections = composeBasketView(rows, state(), CONTEXT);

    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBeNull();
    expect(sections[0].hint).toBeNull();
    expect(sections[0].rows.map((row) => row.row.rowKey)).toEqual(['a', 'b']);
  });

  it('leaves the server order alone, which is the order the shopper walks', () => {
    const rows = [row('a', 'Zucchini'), row('b', 'Apples')];

    const sections = composeBasketView(rows, state(), CONTEXT);

    expect(sections[0].rows.map((row) => row.row.content)).toEqual([
      'Zucchini',
      'Apples',
    ]);
  });

  /**
   * The ordering the plan's section 3 fixes, and the one thing a later plan could
   * break by reaching for a tidier implementation: grouping must not get to impose
   * an order of its own.
   */
  it('filters, then orders, then groups, so a row keeps its place inside its group', () => {
    const rows = [
      row('a', 'Zucchini', { entries: [entry('l1')] }),
      row('b', 'Apples', { entries: [entry('l2')] }),
      row('c', 'Bread', { entries: [entry('l1')] }),
      row('d', 'Cherries', { entries: [entry('l2')] }),
    ];

    const sections = composeBasketView(
      rows,
      state({ order: 'alpha', grouping: 'list', lists: null }),
      { ...CONTEXT, lists: new Map([['l1', ref('l1', 'Weekly shop')]]) }
    );

    // Alphabetical across the whole basket first, and only then cut up, so each
    // section is alphabetical without the grouping having sorted anything. The
    // second section is the one heading for every entry this reader cannot place.
    expect(sections[0].rows.map((row) => row.row.content)).toEqual([
      'Bread',
      'Zucchini',
    ]);
    expect(sections[1].rows.map((row) => row.row.content)).toEqual([
      'Apples',
      'Cherries',
    ]);
  });

  it('sorts alpha with a base sensitivity collator, so "Ávila" sorts with "Avila"', () => {
    const rows = [
      row('a', 'Azúcar'),
      row('b', 'Ávila'),
      row('c', 'Avila'),
      row('d', 'Arroz'),
    ];

    const sections = composeBasketView(rows, state({ order: 'alpha' }), {
      ...CONTEXT,
      locale: 'es',
    });

    expect(sections[0].rows.map((row) => row.row.content)).toEqual([
      'Arroz',
      'Ávila',
      'Avila',
      'Azúcar',
    ]);
  });

  it('narrows to the search, which looks at the pick as well as the line', () => {
    const rows = [
      row('a', 'Leche'),
      row('b', 'bread', { optionIds: ['p1'] }),
      row('c', 'Cheese'),
    ];
    const context: BasketViewContext = {
      ...CONTEXT,
      query: 'hacendado',
      products: new Map([['p1', product('p1', 'Pan de molde', 'Hacendado')]]),
    };

    const sections = composeBasketView(rows, state(), context);

    expect(sections[0].rows.map((row) => row.row.rowKey)).toEqual(['b']);
  });

  /**
   * The list filter (velista `0090`, section 8.2).
   *
   * Two claims carry it, and the second is the one a tidier implementation drops:
   * a row with a served entry on a kept list stays, and **a row this reader cannot
   * place stays too**, because a reader cannot filter out what they cannot name.
   *
   * There is no sink here any more. Backend `0136` removed the thing it held: a
   * line is on a list or it does not exist, so "lines on no list yet" describes
   * nothing.
   */
  describe('the list filter', () => {
    const rows = [
      row('kept', 'Milk', { entries: [entry('l1')] }),
      row('both', 'Bread', { entries: [entry('l1'), entry('l2')] }),
      row('dropped', 'Cheese', { entries: [entry('l2')] }),
      row('guest', 'Candles', { entries: [entry(null)] }),
    ];

    it('keeps a row with any served entry on a kept list', () => {
      const sections = composeBasketView(
        rows,
        state({ lists: new Set(['l1']) }),
        CONTEXT
      );

      expect(sections[0].rows.map((row) => row.row.rowKey)).toEqual([
        'kept',
        'both',
        'guest',
      ]);
    });

    /**
     * A reader cannot filter out what they cannot name, so an unserved entry keeps
     * its row whichever list is kept. Dropping it would hide, from a guest, rows
     * that may well be on the very list they chose.
     */
    it('keeps a row with an unserved entry, whichever list is kept', () => {
      for (const kept of ['l1', 'l2']) {
        const drawn = basketViewRows(
          composeBasketView(rows, state({ lists: new Set([kept]) }), CONTEXT)
        );

        expect(drawn.map((item) => item.rowKey)).toContain('guest');
      }
    });

    it('drops a row whose every served entry is on a list that was filtered out', () => {
      const sections = composeBasketView(
        rows,
        state({ lists: new Set(['l1']) }),
        CONTEXT
      );

      expect(sections[0].rows.map((row) => row.row.rowKey)).not.toContain(
        'dropped'
      );
    });

    /**
     * One section and no sink, whatever the filter says: the only sink left is the
     * chosen shop's, and no shop is chosen here.
     */
    it('draws one section whether or not the filter is on', () => {
      expect(
        composeBasketView(rows, state({ lists: new Set(['l1']) }), CONTEXT)
      ).toHaveLength(1);
      expect(composeBasketView(rows, state(), CONTEXT)).toHaveLength(1);
    });

    /** Information about the basket, so no filter and no search hides it. */
    it('keeps a REMOVED row past every filter', () => {
      const gone = row('gone', 'Olives', {
        state: 'REMOVED',
        entries: [],
      });

      const sections = composeBasketView(
        [...rows, gone],
        state({ lists: new Set(['l1']) }),
        { ...CONTEXT, query: 'nothing matches this' }
      );

      expect(sections[0].rows.map((row) => row.row.rowKey)).toEqual(['gone']);
    });
  });

  /**
   * The ungrouped view is about rows and not about entries, and its one section
   * is the whole screen, so a count on it would only repeat the sentence in the
   * tools row above it.
   */
  it('draws no entry and no count on an ungrouped view', () => {
    const sections = composeBasketView([row('a', 'Milk')], state(), CONTEXT);

    expect(sections[0].rows[0].entry).toBeNull();
    expect(sections[0].progress).toBeNull();
  });
});

/**
 * The aisle view (velista `0077`, section 3).
 *
 * Three claims carry it, and each one is a thing a tidier implementation quietly
 * breaks: a section's place comes from its first line and from nothing else, a
 * product in two aisles puts its line in both without being counted twice, and the
 * lines with no product go last under a heading that says why.
 */
describe('composeBasketView, grouped by category', () => {
  const CATALOG = new Map([
    ['p-milk', product('p-milk', 'Milk', null, ['DAIRY'])],
    ['p-bread', product('p-bread', 'Bread', null, ['BAKERY'])],
    ['p-cheese', product('p-cheese', 'Cheese', null, ['DAIRY'])],
    ['p-odd', product('p-odd', 'Batteries', null, ['OTHER'])],
  ]);

  function grouped(
    rows: readonly BasketRow[],
    over: Partial<BasketViewState> = {}
  ) {
    return composeBasketView(rows, state({ grouping: 'category', ...over }), {
      ...CONTEXT,
      products: CATALOG,
    });
  }

  it('puts every line under its product’s category', () => {
    const sections = grouped([
      row('a', 'Milk', { optionIds: ['p-milk'] }),
      row('b', 'Bread', { optionIds: ['p-bread'] }),
      row('c', 'Cheese', { optionIds: ['p-cheese'] }),
    ]);

    expect(
      sections.map((part) => [
        part.heading,
        part.rows.map((row) => row.row.rowKey),
      ])
    ).toEqual([
      [{ kind: 'key', key: 'basket.category.DAIRY' }, ['a', 'c']],
      [{ kind: 'key', key: 'basket.category.BAKERY' }, ['b']],
    ]);
  });

  /**
   * The rule the plan's section 3 fixes. Under "The way you shop" it is what makes
   * the aisles order the categories, which is the entire point of that order; a
   * pipeline that sorted the sections by name, or by the enum, would throw it away.
   */
  it('gives a section the place of its first line, OTHER included', () => {
    const sections = grouped([
      row('a', 'Batteries', { optionIds: ['p-odd'] }),
      row('b', 'Bread', { optionIds: ['p-bread'] }),
      row('c', 'Milk', { optionIds: ['p-milk'] }),
    ]);

    expect(sections.map((part) => part.key)).toEqual([
      'category:OTHER',
      'category:BAKERY',
      'category:DAIRY',
    ]);
  });

  it('draws a line in every category it has, and counts it once', () => {
    const twoAisles = new Map([
      ['p-both', product('p-both', 'Yoghurt', null, ['DAIRY', 'SNACKS'])],
    ]);

    const sections = composeBasketView(
      [row('a', 'Yoghurt', { optionIds: ['p-both'] })],
      state({ grouping: 'category' }),
      { ...CONTEXT, products: twoAisles }
    );

    expect(sections.map((part) => part.key)).toEqual([
      'category:DAIRY',
      'category:SNACKS',
    ]);
    expect(basketViewRows(sections)).toHaveLength(1);
  });

  /**
   * Two ways to have no category and they are one section: a line nobody picked a
   * product for, and a line whose pick the products map cannot resolve because the
   * basket has outlived the catalog it was built from.
   */
  it('puts every line with no resolved pick last, under a heading that says why', () => {
    const sections = grouped([
      row('free', 'Something for dinner'),
      row('milk', 'Milk', { optionIds: ['p-milk'] }),
      row('gone', 'Old thing', { optionIds: ['p-deleted'] }),
    ]);

    const last = sections[sections.length - 1];
    expect(last.key).toBe('no-category');
    expect(last.heading).toEqual({
      kind: 'key',
      key: 'basket.group.noCategory',
    });
    expect(last.hint).toBe('basket.group.noCategoryHint');
    expect(last.rows.map((row) => row.row.rowKey)).toEqual(['free', 'gone']);
  });

  it('counts each section over its own lines, with a close that bought nothing apart', () => {
    const sections = grouped([
      row('a', 'Milk', {
        optionIds: ['p-milk'],
        left: 0,
        bought: 1,
        state: 'DONE',
      }),
      row('b', 'Cheese', {
        optionIds: ['p-cheese'],
        left: 1,
        bought: 0,
        state: 'NOT_AVAILABLE',
      }),
      row('c', 'Cream', { optionIds: ['p-milk'] }),
      row('d', 'Bread', { optionIds: ['p-bread'] }),
    ]);

    expect(sections[0].progress).toEqual({ done: 1, unavailable: 1, total: 3 });
    expect(sections[1].progress).toEqual({ done: 0, unavailable: 0, total: 1 });
  });

  /**
   * Filter, then order, then group. The grouping gets no ordering of its own, so a
   * line keeps whatever place the order gave it inside its category.
   */
  it('keeps the order the shop sink gave a line inside its category', () => {
    const sections = grouped(
      [
        row('z', 'Zucchini', { optionIds: ['p-milk'] }),
        row('a', 'Apples', { optionIds: ['p-milk'] }),
        row('m', 'Milk', { optionIds: ['p-milk'] }),
      ],
      { order: 'alpha' }
    );

    expect(sections[0].rows.map((row) => row.row.content)).toEqual([
      'Apples',
      'Milk',
      'Zucchini',
    ]);
  });

  it('narrows to the search before it groups', () => {
    const sections = composeBasketView(
      [
        row('a', 'Milk', { optionIds: ['p-milk'] }),
        row('b', 'Bread', { optionIds: ['p-bread'] }),
      ],
      state({ grouping: 'category' }),
      { ...CONTEXT, products: CATALOG, query: 'bread' }
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe('category:BAKERY');
  });
});

/**
 * The household view (velista `0077`, section 4).
 *
 * The claim that matters most here is that a row is drawn **once per entry** with
 * that entry on it: everything the row does differently under this grouping reads
 * the entry, so a drawn row handed none would quietly show the basket's summed
 * numbers under one household's heading.
 */
describe('composeBasketView, grouped by list', () => {
  const REFS = new Map([
    ['l1', ref('l1', 'Weekly shop')],
    ['l2', ref('l2', 'Flat 3B')],
  ]);

  function grouped(
    rows: readonly BasketRow[],
    over: Partial<BasketViewState> = {}
  ) {
    return composeBasketView(rows, state({ grouping: 'list', ...over }), {
      ...CONTEXT,
      lists: REFS,
    });
  }

  it('heads a section with the list’s own name, which is data and not a key', () => {
    const sections = grouped([row('a', 'Milk', { entries: [entry('l1')] })]);

    expect(sections[0].heading).toEqual({ kind: 'text', text: 'Weekly shop' });
    expect(sections[0].key).toBe('list:l1');
  });

  it('draws a row once per entry, each drawn row carrying its own', () => {
    const sections = grouped([
      row('both', 'Eggs', {
        entries: [
          entry('l1', { left: 6, asked: 6 }),
          entry('l2', { left: 6, asked: 6 }),
        ],
      }),
    ]);

    expect(sections.map((part) => part.key)).toEqual(['list:l1', 'list:l2']);
    expect(sections[0].rows[0].entry?.listId).toBe('l1');
    expect(sections[1].rows[0].entry?.listId).toBe('l2');
    // One thing to buy, drawn in two places. The sheet's button says one.
    expect(basketViewRows(sections)).toHaveLength(1);
  });

  it('gives a section the place of its first line, like every other grouping', () => {
    const sections = grouped([
      row('a', 'Milk', { entries: [entry('l2')] }),
      row('b', 'Bread', { entries: [entry('l1')] }),
    ]);

    expect(sections.map((part) => part.key)).toEqual(['list:l2', 'list:l1']);
  });

  /**
   * Every entry this reader cannot place goes under **one** heading, last, and it
   * names none of them (velista `0090`, section 8.2).
   *
   * It replaced the sink for "lines on no list yet". No such line exists: a line is
   * on a list or it does not exist, so what a reader cannot head is a list they
   * were not **served**, and the only honest sentence for those is one that names
   * nothing.
   */
  it('puts every unserved entry under one last heading', () => {
    const sections = grouped([
      row('a', 'Milk', { entries: [entry('l1')] }),
      row('b', 'Batteries', { entries: [entry(null)] }),
      row('c', 'Candles', { entries: [entry('unknown')] }),
    ]);

    const last = sections[sections.length - 1];
    expect(last.key).toBe('other-lists');
    expect(last.heading).toEqual({
      kind: 'key',
      key: 'basket.group.otherLists',
    });
    expect(last.rows.map((row) => row.row.rowKey)).toEqual(['b', 'c']);
    // Drawn for its entry like every other row here: the numbers under this
    // heading are that household's, even where it cannot be named.
    expect(last.rows[0].entry).not.toBeNull();
  });

  /**
   * A list the basket served no ref for is one this reader may not name, and an
   * entry with a null `listId` is one the server withheld. They are the same
   * nothing to the reader, and the mapper already collapses the first onto the
   * second, so there is one heading rather than two that read alike.
   */
  it('heads no section for a list it was served no ref for', () => {
    const sections = grouped([
      row('a', 'Milk', { entries: [entry('l1'), entry('unknown')] }),
    ]);

    expect(sections.map((part) => part.key)).toEqual([
      'list:l1',
      'other-lists',
    ]);
  });

  it('gives each list its own count', () => {
    const sections = grouped([
      row('a', 'Milk', {
        left: 0,
        bought: 1,
        state: 'DONE',
        entries: [entry('l1', { left: 0, bought: 1, state: 'DONE' })],
      }),
      row('b', 'Bread', { entries: [entry('l1')] }),
      row('c', 'Cheese', { entries: [entry('l2')] }),
    ]);

    expect(sections[0].progress).toEqual({ done: 1, unavailable: 0, total: 2 });
    expect(sections[1].progress).toEqual({ done: 0, unavailable: 0, total: 1 });
  });

  /**
   * A drawn row's key has to survive one household asking for the same thing on two
   * lines, which `@for` tracks on. The row's own key is the same for both, so the
   * key is the pair.
   */
  it('gives two rows of one row under one heading distinct keys', () => {
    const sections = grouped([
      row('a', 'Milk', {
        entries: [
          entry('l1', { lineId: 'zl-1' }),
          entry('l1', { lineId: 'zl-2' }),
        ],
      }),
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0].rows.map((row) => row.key)).toEqual([
      'a:zl-1',
      'a:zl-2',
    ]);
  });

  it('keeps the list filter, which runs before the grouping', () => {
    const sections = grouped(
      [
        row('a', 'Milk', { entries: [entry('l1')] }),
        row('b', 'Cheese', { entries: [entry('l2')] }),
      ],
      { lists: new Set(['l1']) }
    );

    expect(sections.map((part) => part.key)).toEqual(['list:l1']);
  });
});

/**
 * The one counting function left (velista `0090`, section 8.3).
 *
 * It counts **states the server wrote** and compares no number with another, which
 * is the whole difference from `basketLinesProgress`: that one asked whether a
 * line's settled amount had reached what it asked for, and could not tell a shop
 * that had none from a purchase.
 */
describe('basketRowsProgress', () => {
  it('counts states, and never a REMOVED row', () => {
    expect(
      basketRowsProgress([
        { state: 'DONE' },
        { state: 'NOT_AVAILABLE' },
        { state: 'PARTLY' },
        { state: 'WANTED' },
        { state: 'SKIPPED' },
        { state: 'REMOVED' },
      ])
    ).toEqual({ done: 1, unavailable: 1, total: 5 });
  });

  /**
   * The assertion the heading and the sentence above it both rest on: over an
   * unfiltered, ungrouped basket the section's count **is** the server's own. A
   * build where the two could disagree is one where a section says "1 of 3" under
   * a sentence saying "2 of 4".
   */
  it('equals the server’s own progress over an unfiltered, ungrouped basket', () => {
    const rows = [
      row('a', 'Milk', { state: 'DONE', left: 0, bought: 1 }),
      row('b', 'Bread', { state: 'NOT_AVAILABLE' }),
      row('c', 'Eggs', { state: 'PARTLY', left: 1, bought: 1 }),
      row('d', 'Olives', { state: 'REMOVED', entries: [] }),
    ];
    // What a server with this basket would send, by backend `0130` section 4.
    const served = { done: 1, unavailable: 1, total: 3 };

    const sections = composeBasketView(rows, state({ grouping: 'category' }), {
      ...CONTEXT,
    });

    expect(basketRowsProgress(basketViewRows(sections))).toEqual(served);
  });

  /** A `SKIPPED` row is pending, which is what keeps it out of both counts. */
  it('counts a SKIPPED row in the total and in neither half', () => {
    const counted = basketRowsProgress([{ state: 'SKIPPED' }]);

    expect(counted).toEqual({ done: 0, unavailable: 0, total: 1 });
  });
});

describe('basketViewRows', () => {
  it('counts a row once however many sections draw it', () => {
    const one = row('a', 'Milk');
    const sections = [
      {
        key: 'x',
        heading: null,
        hint: null,
        progress: null,
        rows: [{ key: 'a', row: one, entry: null, priceMark: null }],
      },
      {
        key: 'y',
        heading: null,
        hint: null,
        progress: null,
        rows: [{ key: 'a', row: one, entry: null, priceMark: null }],
      },
    ];

    expect(basketViewRows(sections)).toEqual([one]);
  });
});

describe('basketViewChips', () => {
  const names = {
    lists: new Map([['l1', ref('l1', 'Groceries')]]),
    listCount: 3,
  };

  it('draws nothing at all for the default view', () => {
    expect(basketViewChips(DEFAULT_BASKET_VIEW_STATE, names)).toEqual([]);
  });

  it('chips the order and the grouping, neither of which hides a line', () => {
    const chips = basketViewChips(
      state({ order: 'alpha', grouping: 'category' }),
      names
    );

    expect(chips).toEqual([
      { property: 'order', key: 'basket.view.order.alpha', args: null },
      { property: 'grouping', key: 'basket.view.chip.byCategory', args: null },
    ]);
  });

  it('names one kept list and counts several', () => {
    expect(basketViewChips(state({ lists: new Set(['l1']) }), names)).toEqual([
      {
        property: 'lists',
        key: 'basket.view.lists.only',
        args: { name: 'Groceries' },
      },
    ]);

    expect(
      basketViewChips(state({ lists: new Set(['l1', 'l2']) }), names)
    ).toEqual([
      {
        property: 'lists',
        key: 'basket.view.lists.some',
        args: { kept: 2, total: 3 },
      },
    ]);
  });

  /** An id with no name is counted rather than printed, as the row's caption does. */
  it('counts one kept list whose name the basket never sent', () => {
    expect(basketViewChips(state({ lists: new Set(['l9']) }), names)).toEqual([
      {
        property: 'lists',
        key: 'basket.view.lists.some',
        args: { kept: 1, total: 3 },
      },
    ]);
  });

  it('chips the shop by its chain alone', () => {
    const chips = basketViewChips(state({ shop: 's1' }), {
      ...names,
      chainName: 'Mercadona',
    });

    expect(chips).toEqual([
      {
        property: 'shop',
        key: 'basket.view.chip.shop',
        args: { name: 'Mercadona' },
      },
    ]);
  });

  /** Velista `0102`: a lock and no x on a basket started at a shop. */
  it('locks the shop chip of a basket started at a shop', () => {
    const chips = basketViewChips(state({ shop: 'loc-1' }), {
      ...names,
      chainName: 'Mercadona',
      shopLocked: true,
    });

    expect(chips).toEqual([
      {
        property: 'shop',
        key: 'basket.view.chip.shop',
        args: { name: 'Mercadona' },
        locked: true,
      },
    ]);
  });
});

describe('basketViewActiveCount', () => {
  it('counts the properties that are not at their default', () => {
    expect(basketViewActiveCount(DEFAULT_BASKET_VIEW_STATE)).toBe(0);
    expect(
      basketViewActiveCount(
        state({
          order: 'alpha',
          grouping: 'list',
          shop: 's1',
          lists: new Set(['l1']),
        })
      )
    ).toBe(4);
  });
});

describe('resetBasketViewProperty', () => {
  it('puts one property back and leaves the others alone', () => {
    const on = state({ order: 'alpha', lists: new Set(['l1']) });

    const next = resetBasketViewProperty(on, 'order');

    expect(next.order).toBe('shop');
    expect(next.lists).toBe(on.lists);
  });
});

/**
 * Prices from one shop (velista `0078`, section 5).
 *
 * Two questions rather than one, and these keep them apart: **what a row says**,
 * which is the mark, and **where the line sits**, which is the sink. The pipeline
 * answers both from one decision, so a test that asserted only the first would pass
 * on a build that marked a line and left it where it was.
 */
describe('composeBasketView: prices from one shop', () => {
  const MILK = row('a', 'Milk', { optionIds: ['p-milk'] });
  const BREAD = row('b', 'Bread', { optionIds: ['p-bread'] });
  const EGGS = row('c', 'Eggs', { optionIds: ['p-eggs'] });

  it('marks a line another shop sells cheaper, and names the chain', () => {
    const sections = composeBasketView(
      [MILK, BREAD],
      state({ shop: MERCA }),
      priced()
    );

    expect(sections[0].rows[0].priceMark).toEqual({
      kind: 'cheaper',
      price: 0.79,
      currency: 'EUR',
      chain: 'Dia',
    });
    // Listed here and cheapest here: there is nothing to say.
    expect(sections[0].rows[1].priceMark).toBeNull();
  });

  it('marks a line this shop does not list, with the cheapest price elsewhere', () => {
    const sections = composeBasketView(
      [MILK, EGGS],
      state({ shop: MERCA }),
      priced()
    );

    const sunk = sections[1].rows[0];
    expect(sunk.row.rowKey).toBe('c');
    expect(sunk.priceMark).toEqual({
      kind: 'unlisted',
      chain: 'Mercadona',
      elsewhere: { price: 2.4, currency: 'EUR', chain: 'Dia' },
    });
  });

  it('sinks the unlisted lines under their own heading, ungrouped', () => {
    const sections = composeBasketView(
      [EGGS, MILK, BREAD],
      state({ shop: MERCA }),
      priced()
    );

    expect(sections).toHaveLength(2);
    expect(sections[0].rows.map((row) => row.row.rowKey)).toEqual(['a', 'b']);
    expect(sections[1].heading).toEqual({
      kind: 'key',
      key: 'basket.group.notListed',
      args: { chain: 'Mercadona' },
    });
    expect(sections[1].hint).toBe('basket.group.notListedHint');
    expect(sections[1].rows.map((row) => row.row.rowKey)).toEqual(['c']);
  });

  /**
   * Grouped, the sink is the **end of each group** rather than a section of its own,
   * which is what keeps a category's own unlisted lines inside that category.
   */
  it('sinks to the end of a group, keeping the relative order of what sank', () => {
    const second = row('d', 'More eggs', { optionIds: ['p-eggs'] });

    const sections = composeBasketView(
      [EGGS, MILK, second, BREAD],
      state({ shop: MERCA, grouping: 'category' }),
      priced()
    );

    // One category, because every product here is `OTHER`: the two sunk lines are
    // last inside it, in the order they arrived in.
    expect(sections).toHaveLength(1);
    expect(sections[0].rows.map((row) => row.row.rowKey)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('leaves a line with no pick unmarked, and never sinks it', () => {
    const typed = row('d', 'Something for the cat');

    // Milk is here so that the shop prices *something*, which is what turns the
    // marks on at all (section 5.1): without it nothing on this basket is marked.
    const sections = composeBasketView(
      [typed, MILK, EGGS],
      state({ shop: MERCA }),
      priced()
    );

    expect(sections[0].rows.map((row) => row.row.rowKey)).toEqual(['d', 'a']);
    expect(sections[0].rows[0].priceMark).toBeNull();
    expect(sections[1].rows.map((row) => row.row.rowKey)).toEqual(['c']);
  });

  /**
   * Section 5.1, and the case staging and production are actually in: a shop nobody
   * has priced is not a shop that stocks nothing.
   */
  it('marks nothing and sinks nothing at a shop that prices no line of the basket', () => {
    const context = priced();
    const unpriced = new Map(
      [...context.products].map(([id, item]) => [
        id,
        { ...item, atShop: at(null, null) },
      ])
    );

    const sections = composeBasketView(
      [EGGS, BREAD],
      state({ shop: 'loc-carrefour' }),
      {
        ...context,
        products: unpriced,
        shop: shop('loc-carrefour', 'Carrefour'),
      }
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].rows.map((row) => row.priceMark)).toEqual([null, null]);
  });

  /**
   * The products still describe the last shop while the read at the next one is
   * out, and quoting them under the new shop's name would be a lie.
   */
  it('marks nothing while the read at the chosen shop is still out', () => {
    const sections = composeBasketView(
      [MILK, EGGS],
      state({ shop: 'loc-next' }),
      priced()
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].rows.map((row) => row.priceMark)).toEqual([null, null]);
    expect(sections[0].rows.map((row) => row.shelf)).toEqual([null, null]);
  });

  /**
   * **The server decides the price at a shop.** Milk's Mercadona scope says 0.95,
   * and the shop's own stack says 0.75: the row is priced from `atShop`, so nothing
   * elsewhere is cheaper.
   */
  it('prices from atShop and compares cheaper elsewhere against it', () => {
    const context = priced();
    const products = new Map(context.products);
    const milk = products.get('p-milk') as BasketProduct;
    products.set('p-milk', { ...milk, atShop: at('s-merca-store', 0.75) });

    const sections = composeBasketView([MILK, BREAD], state({ shop: MERCA }), {
      ...context,
      products,
    });

    expect(sections[0].rows[0].priceMark).toBeNull();
    expect(
      basketPricedAtShop([MILK], state({ shop: MERCA }), {
        ...context,
        products,
      })
    ).toBe(true);
  });

  it('sinks a line whose product has no price at the shop, whatever its offers say', () => {
    const context = priced();
    const products = new Map(context.products);
    const bread = products.get('p-bread') as BasketProduct;
    // Mercadona's scope lists bread, and this Mercadona has no price for it.
    products.set('p-bread', { ...bread, atShop: at(null, null) });

    const sections = composeBasketView([BREAD, MILK], state({ shop: MERCA }), {
      ...context,
      products,
    });

    expect(sections[0].rows.map((row) => row.row.rowKey)).toEqual(['a']);
    expect(sections[1].rows.map((row) => row.row.rowKey)).toEqual(['b']);
    expect(sections[1].rows[0].priceMark?.kind).toBe('unlisted');
  });

  /**
   * A scope the read could not name is skipped rather than drawn with its id: "1.99
   * € at 7f3c…" is not a sentence. The line is still unlisted and still sinks.
   */
  it('names no chain it cannot name, and says the line is unlisted anyway', () => {
    const context = priced();

    const sections = composeBasketView([MILK, EGGS], state({ shop: MERCA }), {
      ...context,
      scopes: new Map([['s-merca', scope('s-merca', 'Mercadona')]]),
    });

    expect(sections[0].rows[0].priceMark).toBeNull();
    expect(sections[1].rows[0].priceMark).toEqual({
      kind: 'unlisted',
      chain: 'Mercadona',
      elsewhere: null,
    });
  });
});

describe('basketPricedAtShop', () => {
  it('answers true when the shop prices something on the basket', () => {
    expect(
      basketPricedAtShop(
        [row('a', 'Milk', { optionIds: ['p-milk'] })],
        state({ shop: MERCA }),
        priced()
      )
    ).toBe(true);
  });

  it('answers false for a shop with no price for any line', () => {
    expect(
      basketPricedAtShop(
        [row('c', 'Eggs', { optionIds: ['p-eggs'] })],
        state({ shop: MERCA }),
        priced()
      )
    ).toBe(false);
  });

  it('answers false when no shop is chosen', () => {
    expect(basketPricedAtShop([], state(), priced())).toBe(false);
  });
});

describe('basketReadAtShop', () => {
  it('answers true only when the read was made at the chosen shop', () => {
    expect(basketReadAtShop(state({ shop: MERCA }), priced())).toBe(true);
    expect(basketReadAtShop(state({ shop: 'loc-next' }), priced())).toBe(false);
    expect(basketReadAtShop(state(), priced())).toBe(false);
  });
});

/**
 * Velista `0102`: what the chosen shop is known not to have. A mark, and never a
 * move, and unknown is never marked.
 */
describe('composeBasketView: what the shop does not have', () => {
  /** A product this shop prices, with what it says about the shelf. */
  function stocked(
    id: string,
    available: boolean | null,
    price: number | null = 1
  ): BasketProduct {
    return {
      ...product(id, id, null),
      offers: price === null ? [] : [offer('s-merca', price)],
      atShop: at(price === null ? null : 's-merca', price, available),
    };
  }

  function world(...products: BasketProduct[]): BasketViewContext {
    return {
      ...CONTEXT,
      products: new Map(products.map((item) => [item.id, item])),
      scopes: new Map([['s-merca', scope('s-merca', 'Mercadona')]]),
      shop: shop(MERCA, 'Mercadona'),
    };
  }

  function shelves(rows: BasketRow[], context: BasketViewContext) {
    return composeBasketView(rows, state({ shop: MERCA }), context).flatMap(
      (section) => section.rows.map((drawn) => drawn.shelf)
    );
  }

  it('marks a row unavailable only when every option is known missing', () => {
    const context = world(
      stocked('p-a', false),
      stocked('p-b', false),
      stocked('p-c', null)
    );

    expect(
      shelves([row('r1', 'Yogurt', { optionIds: ['p-a', 'p-b'] })], context)
    ).toEqual([{ kind: 'unavailable' }]);
    // One option nobody has said anything about is not a missing row.
    expect(
      shelves([row('r2', 'Yogurt', { optionIds: ['p-c', 'p-a'] })], context)
    ).toEqual([null]);
  });

  it('never marks a row whose shop said nothing, or said it is there', () => {
    const context = world(stocked('p-a', null), stocked('p-b', true));

    expect(
      shelves(
        [
          row('r1', 'Oat drink', { optionIds: ['p-a'] }),
          row('r2', 'Rice', { optionIds: ['p-b'] }),
        ],
        context
      )
    ).toEqual([null, null]);
  });

  it('offers another option in place of a default known missing, preferring one known there', () => {
    const context = world(
      stocked('p-danone', false),
      stocked('p-unknown', null),
      stocked('p-hacendado', true)
    );

    expect(
      shelves(
        [
          row('r1', 'Greek yogurt', {
            optionIds: ['p-danone', 'p-unknown', 'p-hacendado'],
          }),
        ],
        context
      )
    ).toEqual([
      { kind: 'instead', optionId: 'p-hacendado', replacedId: 'p-danone' },
    ]);
  });

  it('offers an option nobody has said anything about when none is known there', () => {
    const context = world(stocked('p-danone', false), stocked('p-other', null));

    expect(
      shelves(
        [row('r1', 'Yogurt', { optionIds: ['p-danone', 'p-other'] })],
        context
      )
    ).toEqual([
      { kind: 'instead', optionId: 'p-other', replacedId: 'p-danone' },
    ]);
  });

  it('keeps a marked row in its place', () => {
    const context = world(stocked('p-a', true), stocked('p-b', false));
    const sections = composeBasketView(
      [
        row('r1', 'Oat drink', { optionIds: ['p-b'] }),
        row('r2', 'Milk', { optionIds: ['p-a'] }),
      ],
      state({ shop: MERCA }),
      context
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].rows.map((drawn) => drawn.row.rowKey)).toEqual([
      'r1',
      'r2',
    ]);
    expect(sections[0].rows[0].shelf).toEqual({ kind: 'unavailable' });
  });

  /** The user's answer on the mock: the price rule came first, so it sinks. */
  it('sinks a row that is both unlisted and unavailable, and says both', () => {
    const context = world(stocked('p-a', true), stocked('p-b', false, null));
    const sections = composeBasketView(
      [
        row('r1', 'Washing up liquid', { optionIds: ['p-b'] }),
        row('r2', 'Milk', { optionIds: ['p-a'] }),
      ],
      state({ shop: MERCA }),
      context
    );

    expect(sections[1].rows[0].row.rowKey).toBe('r1');
    expect(sections[1].rows[0].priceMark?.kind).toBe('unlisted');
    expect(sections[1].rows[0].shelf).toEqual({ kind: 'unavailable' });
  });

  /** Availability without a single price is the one source of it today. */
  it('marks the shelf at a shop that prices nothing', () => {
    const context = world(
      stocked('p-a', false, null),
      stocked('p-b', true, null)
    );

    expect(
      shelves(
        [
          row('r1', 'Rice', { optionIds: ['p-a'] }),
          row('r2', 'Milk', { optionIds: ['p-b'] }),
        ],
        context
      )
    ).toEqual([{ kind: 'unavailable' }, null]);
  });
});
