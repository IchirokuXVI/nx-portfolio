import type {
  BasketLine,
  BasketLineOrigin,
  BasketProduct,
} from './basket-view';
import {
  basketViewActiveCount,
  basketViewChips,
  basketViewLines,
  composeBasketView,
  DEFAULT_BASKET_VIEW_STATE,
  resetBasketViewProperty,
  type BasketViewContext,
  type BasketViewState,
} from './compose-basket-view';

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

function origin(listId: string): BasketLineOrigin {
  return { id: `o-${listId}`, zoneId: 'z1', listId, lineId: 'l1', quantity: 1 };
}

function product(
  id: string,
  name: string,
  brand: string | null
): BasketProduct {
  return { id, name: { en: name, es: name }, brand } as BasketProduct;
}

const CONTEXT: BasketViewContext = {
  query: '',
  products: new Map(),
  locale: 'en',
};

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
      expect(sections[1].heading).toBe('basket.group.noList');
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

  it('draws no origin on any row, which is 0077’s', () => {
    const sections = composeBasketView([line('a', 'Milk')], state(), CONTEXT);

    expect(sections[0].rows[0].origin).toBeNull();
    expect(sections[0].progress).toBeNull();
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
        rows: [{ line: one, origin: null }],
      },
      {
        key: 'y',
        heading: null,
        hint: null,
        progress: null,
        rows: [{ line: one, origin: null }],
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
