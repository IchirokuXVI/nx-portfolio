import type {
  BasketLine,
  BasketLineOrigin,
  BasketPriceScope,
  BasketProduct,
} from './basket-view';
import {
  basketPricedScope,
  basketViewActiveCount,
  basketViewChips,
  basketViewLines,
  composeBasketView,
  DEFAULT_BASKET_VIEW_STATE,
  resetBasketViewProperty,
  type BasketViewContext,
  type BasketViewState,
} from './compose-basket-view';
import type { ProductOffer } from './domain';
import type { ProductCategory } from './enums';

function line(
  id: string,
  content: string,
  extra: Partial<BasketLine> = {}
): BasketLine {
  return {
    id,
    content,
    quantity: 1,
    settled: 0,
    waitingSettled: 0,
    pickId: null,
    optionIds: [],
    position: 0,
    createdBy: null,
    createdByName: null,
    lastOutcome: null,
    ...extra,
  } as BasketLine;
}

function origin(
  listId: string,
  over: Partial<BasketLineOrigin> = {}
): BasketLineOrigin {
  return {
    id: `o-${listId}`,
    zoneId: 'z1',
    listId,
    lineId: `zone-line-${listId}`,
    quantity: 1,
    ...over,
  };
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
  listNames: new Map(),
  scopes: new Map(),
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

/**
 * A basket priced at two chains, which is the smallest world the marks need.
 *
 * Milk is listed at both and cheaper at Dia; bread is listed at Mercadona alone;
 * eggs are listed at Dia alone, so a view of Mercadona sinks them.
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
        },
      ],
      [
        'p-bread',
        {
          ...product('p-bread', 'Bread', null),
          offers: [offer('s-merca', 1.2)],
        },
      ],
      [
        'p-eggs',
        {
          ...product('p-eggs', 'Eggs', null),
          offers: [offer('s-dia', 2.4)],
        },
      ],
    ]),
    scopes: new Map([
      ['s-merca', scope('s-merca', 'Mercadona')],
      ['s-dia', scope('s-dia', 'Dia')],
    ]),
  };
}

function state(over: Partial<BasketViewState> = {}): BasketViewState {
  return { ...DEFAULT_BASKET_VIEW_STATE, ...over };
}

describe('composeBasketView', () => {
  it('draws one unheaded section holding every line, by default', () => {
    const lines = [line('a', 'Milk'), line('b', 'Bread')];

    const sections = composeBasketView(lines, state(), CONTEXT);

    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBeNull();
    expect(sections[0].hint).toBeNull();
    expect(sections[0].rows.map((row) => row.line.id)).toEqual(['a', 'b']);
  });

  it('leaves the server order alone, which is the order the shopper walks', () => {
    const lines = [line('a', 'Zucchini'), line('b', 'Apples')];

    const sections = composeBasketView(lines, state(), CONTEXT);

    expect(sections[0].rows.map((row) => row.line.content)).toEqual([
      'Zucchini',
      'Apples',
    ]);
  });

  /**
   * The ordering the plan's section 3 fixes, and the one thing a later plan could
   * break by reaching for a tidier implementation: grouping must not get to impose
   * an order of its own.
   */
  it('filters, then orders, then groups, so a line keeps its place inside its group', () => {
    const lines = [
      line('a', 'Zucchini', { origins: [origin('l1')] }),
      line('b', 'Apples', { origins: [] }),
      line('c', 'Bread', { origins: [origin('l1')] }),
      line('d', 'Cherries', { origins: [] }),
    ];

    const sections = composeBasketView(
      lines,
      state({ order: 'alpha', lists: new Set(['l1']) }),
      CONTEXT
    );

    // Alphabetical across the whole basket first, and only then cut in two, so each
    // section is alphabetical without the grouping having sorted anything.
    expect(sections[0].rows.map((row) => row.line.content)).toEqual([
      'Bread',
      'Zucchini',
    ]);
    expect(sections[1].rows.map((row) => row.line.content)).toEqual([
      'Apples',
      'Cherries',
    ]);
  });

  it('sorts alpha with a base sensitivity collator, so "Ávila" sorts with "Avila"', () => {
    const lines = [
      line('a', 'Azúcar'),
      line('b', 'Ávila'),
      line('c', 'Avila'),
      line('d', 'Arroz'),
    ];

    const sections = composeBasketView(lines, state({ order: 'alpha' }), {
      ...CONTEXT,
      locale: 'es',
    });

    expect(sections[0].rows.map((row) => row.line.content)).toEqual([
      'Arroz',
      'Ávila',
      'Avila',
      'Azúcar',
    ]);
  });

  it('narrows to the search, which looks at the pick as well as the line', () => {
    const lines = [
      line('a', 'Leche'),
      line('b', 'bread', { pickId: 'p1' }),
      line('c', 'Cheese'),
    ];
    const context: BasketViewContext = {
      ...CONTEXT,
      query: 'hacendado',
      products: new Map([['p1', product('p1', 'Pan de molde', 'Hacendado')]]),
    };

    const sections = composeBasketView(lines, state(), context);

    expect(sections[0].rows.map((row) => row.line.id)).toEqual(['b']);
  });

  describe('the list filter', () => {
    const lines = [
      line('kept', 'Milk', { origins: [origin('l1')] }),
      line('both', 'Bread', { origins: [origin('l1'), origin('l2')] }),
      line('dropped', 'Cheese', { origins: [origin('l2')] }),
      line('none', 'Batteries', { origins: [] }),
      line('guest', 'Candles'),
    ];

    it('keeps a line that reaches any kept list', () => {
      const sections = composeBasketView(
        lines,
        state({ lists: new Set(['l1']) }),
        CONTEXT
      );

      expect(sections[0].rows.map((row) => row.line.id)).toEqual([
        'kept',
        'both',
        'guest',
      ]);
    });

    /**
     * The distinction the plan's section 6 turns on, and the one a tidier
     * implementation collapses: `origins: []` is a line nobody has accepted, and
     * an absent `origins` is a reader who may not see them at all.
     */
    it('sinks the line on no list and leaves a redacted one where it was', () => {
      const sections = composeBasketView(
        lines,
        state({ lists: new Set(['l1']) }),
        CONTEXT
      );

      expect(sections).toHaveLength(2);
      expect(sections[0].rows.map((row) => row.line.id)).toContain('guest');
      expect(sections[1].heading).toEqual({
        kind: 'key',
        key: 'basket.group.noList',
      });
      expect(sections[1].hint).toBe('basket.group.noListHint');
      expect(sections[1].rows.map((row) => row.line.id)).toEqual(['none']);
    });

    it('never hides a line on no list yet, whichever list is kept', () => {
      for (const kept of ['l1', 'l2']) {
        const drawn = basketViewLines(
          composeBasketView(lines, state({ lists: new Set([kept]) }), CONTEXT)
        );

        expect(drawn.map((item) => item.id)).toContain('none');
      }
    });

    it('draws no sink when every line is on a list', () => {
      const sections = composeBasketView(
        [lines[0], lines[1]],
        state({ lists: new Set(['l1']) }),
        CONTEXT
      );

      expect(sections).toHaveLength(1);
    });

    /**
     * The sink belongs to the filter. With no filter the basket is the order the
     * shopper walks and nothing else, so an aisle's own line stays where it was put.
     */
    it('draws no sink at all while no list filter is on', () => {
      const sections = composeBasketView(lines, state(), CONTEXT);

      expect(sections).toHaveLength(1);
      expect(sections[0].rows.map((row) => row.line.id)).toEqual([
        'kept',
        'both',
        'dropped',
        'none',
        'guest',
      ]);
    });
  });

  /**
   * The ungrouped view is about lines and not about origins, and its one section
   * is the whole screen, so a count on it would only repeat the sentence in the
   * tools row above it.
   */
  it('draws no origin and no count on an ungrouped view', () => {
    const sections = composeBasketView([line('a', 'Milk')], state(), CONTEXT);

    expect(sections[0].rows[0].origin).toBeNull();
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
    lines: readonly BasketLine[],
    over: Partial<BasketViewState> = {}
  ) {
    return composeBasketView(lines, state({ grouping: 'category', ...over }), {
      ...CONTEXT,
      products: CATALOG,
    });
  }

  it('puts every line under its product’s category', () => {
    const sections = grouped([
      line('a', 'Milk', { pickId: 'p-milk' }),
      line('b', 'Bread', { pickId: 'p-bread' }),
      line('c', 'Cheese', { pickId: 'p-cheese' }),
    ]);

    expect(
      sections.map((part) => [
        part.heading,
        part.rows.map((row) => row.line.id),
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
      line('a', 'Batteries', { pickId: 'p-odd' }),
      line('b', 'Bread', { pickId: 'p-bread' }),
      line('c', 'Milk', { pickId: 'p-milk' }),
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
      [line('a', 'Yoghurt', { pickId: 'p-both' })],
      state({ grouping: 'category' }),
      { ...CONTEXT, products: twoAisles }
    );

    expect(sections.map((part) => part.key)).toEqual([
      'category:DAIRY',
      'category:SNACKS',
    ]);
    expect(basketViewLines(sections)).toHaveLength(1);
  });

  /**
   * Two ways to have no category and they are one section: a line nobody picked a
   * product for, and a line whose pick the products map cannot resolve because the
   * basket has outlived the catalog it was built from.
   */
  it('puts every line with no resolved pick last, under a heading that says why', () => {
    const sections = grouped([
      line('free', 'Something for dinner'),
      line('milk', 'Milk', { pickId: 'p-milk' }),
      line('gone', 'Old thing', { pickId: 'p-deleted' }),
    ]);

    const last = sections[sections.length - 1];
    expect(last.key).toBe('no-category');
    expect(last.heading).toEqual({
      kind: 'key',
      key: 'basket.group.noCategory',
    });
    expect(last.hint).toBe('basket.group.noCategoryHint');
    expect(last.rows.map((row) => row.line.id)).toEqual(['free', 'gone']);
  });

  it('counts each section over its own lines, with a close that bought nothing apart', () => {
    const sections = grouped([
      line('a', 'Milk', {
        pickId: 'p-milk',
        quantity: 1,
        settled: 1,
        lastOutcome: 'BOUGHT',
      }),
      line('b', 'Cheese', {
        pickId: 'p-cheese',
        quantity: 1,
        settled: 1,
        lastOutcome: 'NOT_AVAILABLE',
      }),
      line('c', 'Cream', { pickId: 'p-milk' }),
      line('d', 'Bread', { pickId: 'p-bread' }),
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
        line('z', 'Zucchini', { pickId: 'p-milk' }),
        line('a', 'Apples', { pickId: 'p-milk' }),
        line('m', 'Milk', { pickId: 'p-milk' }),
      ],
      { order: 'alpha' }
    );

    expect(sections[0].rows.map((row) => row.line.content)).toEqual([
      'Apples',
      'Milk',
      'Zucchini',
    ]);
  });

  it('narrows to the search before it groups', () => {
    const sections = composeBasketView(
      [
        line('a', 'Milk', { pickId: 'p-milk' }),
        line('b', 'Bread', { pickId: 'p-bread' }),
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
 * The claim that matters most here is that a line is drawn **once per origin** with
 * that origin on the row: everything the row does differently under this grouping
 * reads the origin, so a row handed none would quietly draw the basket's summed
 * numbers under one household's heading.
 */
describe('composeBasketView, grouped by list', () => {
  const NAMES = new Map([
    ['l1', 'Weekly shop'],
    ['l2', 'Flat 3B'],
  ]);

  function grouped(
    lines: readonly BasketLine[],
    over: Partial<BasketViewState> = {}
  ) {
    return composeBasketView(lines, state({ grouping: 'list', ...over }), {
      ...CONTEXT,
      listNames: NAMES,
    });
  }

  it('heads a section with the list’s own name, which is data and not a key', () => {
    const sections = grouped([line('a', 'Milk', { origins: [origin('l1')] })]);

    expect(sections[0].heading).toEqual({ kind: 'text', text: 'Weekly shop' });
    expect(sections[0].key).toBe('list:l1');
  });

  it('draws a line once per origin, each row carrying its own', () => {
    const sections = grouped([
      line('both', 'Eggs', {
        origins: [origin('l1', { quantity: 6 }), origin('l2', { quantity: 6 })],
      }),
    ]);

    expect(sections.map((part) => part.key)).toEqual(['list:l1', 'list:l2']);
    expect(sections[0].rows[0].origin?.listId).toBe('l1');
    expect(sections[1].rows[0].origin?.listId).toBe('l2');
    // One thing to buy, drawn in two places. The sheet's button says one.
    expect(basketViewLines(sections)).toHaveLength(1);
  });

  it('gives a section the place of its first line, like every other grouping', () => {
    const sections = grouped([
      line('a', 'Milk', { origins: [origin('l2')] }),
      line('b', 'Bread', { origins: [origin('l1')] }),
    ]);

    expect(sections.map((part) => part.key)).toEqual(['list:l2', 'list:l1']);
  });

  it('sinks the line on no list yet, under 0075’s own words', () => {
    const sections = grouped([
      line('a', 'Milk', { origins: [origin('l1')] }),
      line('b', 'Batteries', { origins: [] }),
    ]);

    const last = sections[sections.length - 1];
    expect(last.key).toBe('no-list');
    expect(last.heading).toEqual({ kind: 'key', key: 'basket.group.noList' });
    expect(last.hint).toBe('basket.group.noListHint');
    expect(last.rows.map((row) => row.line.id)).toEqual(['b']);
    expect(last.rows[0].origin).toBeNull();
  });

  /**
   * Redaction is not a fact about the line. A guest is never told that something is
   * on no list, because they are never told about lists at all, so a line with no
   * `origins` key stays unheaded rather than joining the sink.
   */
  it('leaves a redacted line unheaded rather than sinking it', () => {
    const sections = grouped([
      line('guest', 'Candles'),
      line('a', 'Milk', { origins: [origin('l1')] }),
    ]);

    expect(sections[0].heading).toBeNull();
    expect(sections[0].rows.map((row) => row.line.id)).toEqual(['guest']);
    expect(sections[1].key).toBe('list:l1');
  });

  it('does not head a section for a list it has no name for', () => {
    const sections = grouped([
      line('a', 'Milk', { origins: [origin('l1'), origin('unknown')] }),
    ]);

    expect(sections.map((part) => part.key)).toEqual(['list:l1']);
  });

  it('gives each list its own count', () => {
    const sections = grouped([
      line('a', 'Milk', {
        quantity: 1,
        settled: 1,
        lastOutcome: 'BOUGHT',
        origins: [origin('l1')],
      }),
      line('b', 'Bread', { origins: [origin('l1')] }),
      line('c', 'Cheese', { origins: [origin('l2')] }),
    ]);

    expect(sections[0].progress).toEqual({ done: 1, unavailable: 0, total: 2 });
    expect(sections[1].progress).toEqual({ done: 0, unavailable: 0, total: 1 });
  });

  /**
   * A row's key has to survive a line reaching one household through two zone lines,
   * which `@for` tracks on. The line's id is the same for both.
   */
  it('gives two rows of one line under one heading distinct keys', () => {
    const sections = grouped([
      line('a', 'Milk', {
        origins: [
          origin('l1', { id: 'o-first', lineId: 'zl-1' }),
          origin('l1', { id: 'o-second', lineId: 'zl-2' }),
        ],
      }),
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0].rows.map((row) => row.key)).toEqual([
      'o-first',
      'o-second',
    ]);
  });

  it('keeps the list filter, which runs before the grouping', () => {
    const sections = grouped(
      [
        line('a', 'Milk', { origins: [origin('l1')] }),
        line('b', 'Cheese', { origins: [origin('l2')] }),
      ],
      { lists: new Set(['l1']) }
    );

    expect(sections.map((part) => part.key)).toEqual(['list:l1']);
  });
});

describe('basketViewLines', () => {
  it('counts a line once however many sections draw it', () => {
    const one = line('a', 'Milk');
    const sections = [
      {
        key: 'x',
        heading: null,
        hint: null,
        progress: null,
        rows: [{ key: 'a', line: one, origin: null }],
      },
      {
        key: 'y',
        heading: null,
        hint: null,
        progress: null,
        rows: [{ key: 'a', line: one, origin: null }],
      },
    ];

    expect(basketViewLines(sections)).toEqual([one]);
  });
});

describe('basketViewChips', () => {
  const names = { listNames: new Map([['l1', 'Groceries']]), listCount: 3 };

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
  const MILK = line('a', 'Milk', { pickId: 'p-milk' });
  const BREAD = line('b', 'Bread', { pickId: 'p-bread' });
  const EGGS = line('c', 'Eggs', { pickId: 'p-eggs' });

  it('marks a line another shop sells cheaper, and names the chain', () => {
    const sections = composeBasketView(
      [MILK, BREAD],
      state({ shop: 's-merca' }),
      priced()
    );

    expect(sections[0].rows[0].mark).toEqual({
      kind: 'cheaper',
      price: 0.79,
      currency: 'EUR',
      chain: 'Dia',
    });
    // Listed here and cheapest here: there is nothing to say.
    expect(sections[0].rows[1].mark).toBeNull();
  });

  it('marks a line this shop does not list, with the cheapest price elsewhere', () => {
    const sections = composeBasketView(
      [MILK, EGGS],
      state({ shop: 's-merca' }),
      priced()
    );

    const sunk = sections[1].rows[0];
    expect(sunk.line.id).toBe('c');
    expect(sunk.mark).toEqual({
      kind: 'unlisted',
      chain: 'Mercadona',
      elsewhere: { price: 2.4, currency: 'EUR', chain: 'Dia' },
    });
  });

  it('sinks the unlisted lines under their own heading, ungrouped', () => {
    const sections = composeBasketView(
      [EGGS, MILK, BREAD],
      state({ shop: 's-merca' }),
      priced()
    );

    expect(sections).toHaveLength(2);
    expect(sections[0].rows.map((row) => row.line.id)).toEqual(['a', 'b']);
    expect(sections[1].heading).toEqual({
      kind: 'key',
      key: 'basket.group.notListed',
      args: { chain: 'Mercadona' },
    });
    expect(sections[1].hint).toBe('basket.group.notListedHint');
    expect(sections[1].rows.map((row) => row.line.id)).toEqual(['c']);
  });

  /**
   * Grouped, the sink is the **end of each group** rather than a section of its own,
   * which is what keeps a category's own unlisted lines inside that category.
   */
  it('sinks to the end of a group, keeping the relative order of what sank', () => {
    const second = line('d', 'More eggs', { pickId: 'p-eggs' });

    const sections = composeBasketView(
      [EGGS, MILK, second, BREAD],
      state({ shop: 's-merca', grouping: 'category' }),
      priced()
    );

    // One category, because every product here is `OTHER`: the two sunk lines are
    // last inside it, in the order they arrived in.
    expect(sections).toHaveLength(1);
    expect(sections[0].rows.map((row) => row.line.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('leaves a line with no pick unmarked, and never sinks it', () => {
    const typed = line('d', 'Something for the cat');

    // Milk is here so that the shop prices *something*, which is what turns the
    // marks on at all (section 5.1): without it nothing on this basket is marked.
    const sections = composeBasketView(
      [typed, MILK, EGGS],
      state({ shop: 's-merca' }),
      priced()
    );

    expect(sections[0].rows.map((row) => row.line.id)).toEqual(['d', 'a']);
    expect(sections[0].rows[0].mark).toBeNull();
    expect(sections[1].rows.map((row) => row.line.id)).toEqual(['c']);
  });

  /**
   * Section 5.1, and the case staging and production are actually in: a shop nobody
   * has priced is not a shop that stocks nothing.
   */
  it('marks nothing and sinks nothing at a shop that lists no line of the basket', () => {
    const context = priced();

    const sections = composeBasketView(
      [EGGS, BREAD],
      state({ shop: 's-empty' }),
      {
        ...context,
        scopes: new Map([
          ...context.scopes,
          ['s-empty', scope('s-empty', 'Carrefour')],
        ]),
      }
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].rows.map((row) => row.mark)).toEqual([null, null]);
  });

  it('marks nothing for a shop this basket was not priced at', () => {
    const sections = composeBasketView(
      [MILK, EGGS],
      state({ shop: 's-gone' }),
      priced()
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].rows.map((row) => row.mark)).toEqual([null, null]);
  });

  /**
   * A scope the read could not name is skipped rather than drawn with its id: "1.99
   * € at 7f3c…" is not a sentence. The line is still unlisted and still sinks.
   */
  it('names no chain it cannot name, and says the line is unlisted anyway', () => {
    const context = priced();

    const sections = composeBasketView(
      [MILK, EGGS],
      state({ shop: 's-merca' }),
      {
        ...context,
        scopes: new Map([['s-merca', scope('s-merca', 'Mercadona')]]),
      }
    );

    expect(sections[0].rows[0].mark).toBeNull();
    expect(sections[1].rows[0].mark).toEqual({
      kind: 'unlisted',
      chain: 'Mercadona',
      elsewhere: null,
    });
  });
});

describe('basketPricedScope', () => {
  it('answers the chosen scope when it prices something on the basket', () => {
    expect(
      basketPricedScope(
        [line('a', 'Milk', { pickId: 'p-milk' })],
        state({ shop: 's-merca' }),
        priced()
      )
    ).toBe('s-merca');
  });

  it('answers null for a shop with no offer on any line', () => {
    expect(
      basketPricedScope(
        [line('c', 'Eggs', { pickId: 'p-eggs' })],
        state({ shop: 's-merca' }),
        priced()
      )
    ).toBeNull();
  });

  it('answers null when no shop is chosen', () => {
    expect(basketPricedScope([], state(), priced())).toBeNull();
  });
});
