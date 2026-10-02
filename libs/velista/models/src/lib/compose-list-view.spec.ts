import {
  composeListView,
  DEFAULT_LIST_VIEW_STATE,
  lineCategories,
  listCategoryCounts,
  listViewActiveCount,
  listViewHoldsReorder,
  NO_CATEGORY,
  type ListCategoryPick,
  type ListViewContext,
  type ListViewLine,
  type ListViewState,
} from './compose-list-view';
import type { CatalogItem } from './domain';
import type { ProductCategory } from './product-category';

/**
 * Category ids and their names in the reader's language. Ids are the catalog's own
 * (uuids on the wire); readable ones here so a failure names the aisle.
 */
const NAMES: Record<string, string> = {
  'apples-and-pears': 'Manzanas y peras',
  'potatoes-and-carrots': 'Patatas y zanahorias',
  milk: 'Leche',
  pork: 'Cerdo',
  pates: 'Patés',
  cereals: 'Cereales',
  'film-aluminum-and-preservation': 'Film, aluminio y conservación',
};

function category(id: string, parentId = 'root'): ProductCategory {
  return { id, parentId, slug: id, name: { en: id, es: NAMES[id] ?? '' } };
}

function line(id: string, content: string): ListViewLine {
  return { id, content };
}

/** A context over a table of each line's categories and product names. */
function context(
  table: Record<
    string,
    { categories?: ListCategoryPick[]; products?: string[] }
  > = {},
  query = ''
): ListViewContext {
  return {
    query,
    locale: 'es',
    categoriesOf: (id) => table[id]?.categories ?? [NO_CATEGORY],
    productNamesOf: (id) => table[id]?.products ?? [],
    categoryName: (id) => NAMES[id] ?? '',
  };
}

function state(overrides: Partial<ListViewState> = {}): ListViewState {
  return { ...DEFAULT_LIST_VIEW_STATE, ...overrides };
}

const ids = (lines: readonly ListViewLine[]) => lines.map((row) => row.id);

describe('lineCategories', () => {
  function product(id: string, ...categories: string[]): CatalogItem {
    return {
      id,
      name: { es: id, en: id },
      brand: null,
      size: null,
      unit: 'UNIT',
      productGroupId: null,
      categories: categories.map((one) => category(one)),
      offer: null,
      unitBasis: null,
      chainPrices: [],
      imageUrl: null,
      packCount: null,
    };
  }

  const catalog = [
    product('milk-1l', 'milk'),
    product('apple', 'apples-and-pears'),
    // One product in two aisles, which backend `0166` allows.
    product('pork-in-a-can', 'pates', 'pork'),
    // A product whose categories none could be read.
    product('unreadable'),
  ];
  const itemOf = (id: string) => catalog.find((row) => row.id === id) ?? null;
  const tree: Record<string, number> = {
    'apples-and-pears': 0,
    pork: 1,
    milk: 2,
    pates: 3,
  };
  const rank = (id: string) => tree[id] ?? null;

  it('is the set of its products’ categories, in first appearance order while nothing is ranked', () => {
    expect(
      lineCategories(['milk-1l', 'apple', 'milk-1l', 'pork-in-a-can'], itemOf)
    ).toEqual(['milk', 'apples-and-pears', 'pates', 'pork']);
  });

  it('is in tree order once the tree ranks them', () => {
    expect(
      lineCategories(['milk-1l', 'apple', 'pork-in-a-can'], itemOf, rank)
    ).toEqual(['apples-and-pears', 'pork', 'milk', 'pates']);
  });

  it('puts a category the tree does not hold after the ranked ones', () => {
    expect(
      lineCategories(['apple', 'milk-1l'], itemOf, (id) =>
        id === 'milk' ? 0 : null
      )
    ).toEqual(['milk', 'apples-and-pears']);
  });

  it('holds every category of a product with several', () => {
    expect(lineCategories(['pork-in-a-can'], itemOf)).toEqual([
      'pates',
      'pork',
    ]);
  });

  it('is No category for a line with no products', () => {
    expect(lineCategories([], itemOf)).toEqual([NO_CATEGORY]);
  });

  it('is No category while none of its products has loaded', () => {
    expect(lineCategories(['not-loaded'], itemOf)).toEqual([NO_CATEGORY]);
  });

  it('is No category for a product with no readable category', () => {
    expect(lineCategories(['unreadable'], itemOf)).toEqual([NO_CATEGORY]);
  });
});

describe('composeListView', () => {
  const lines = [
    line('l1', 'Zanahorias'),
    line('l2', 'Ávila chorizo'),
    line('l3', 'avena'),
    line('l4', 'Bolsas de basura'),
  ];

  it('keeps list order by default and draws no heading', () => {
    const view = composeListView(lines, state(), context());

    expect(ids(view.lines)).toEqual(['l1', 'l2', 'l3', 'l4']);
    expect(view.category).toBeNull();
  });

  it('collates A to Z in the locale, so an accent sorts with its letter', () => {
    const view = composeListView(lines, state({ order: 'alpha' }), context());

    expect(ids(view.lines)).toEqual(['l3', 'l2', 'l4', 'l1']);
  });

  describe('one category', () => {
    const table = {
      l1: { categories: ['potatoes-and-carrots'] as ListCategoryPick[] },
      l2: { categories: ['pork', 'cereals', 'milk'] as ListCategoryPick[] },
      l3: { categories: ['cereals'] as ListCategoryPick[] },
    };

    it('keeps only the lines holding the picked category, under its heading', () => {
      const view = composeListView(
        lines,
        state({ view: 'category', category: 'cereals' }),
        context(table)
      );

      expect(ids(view.lines)).toEqual(['l2', 'l3']);
      expect(view.category).toBe('cereals');
    });

    it('keeps the lines with no products under No category', () => {
      const view = composeListView(
        lines,
        state({ view: 'category', category: NO_CATEGORY }),
        context(table)
      );

      expect(ids(view.lines)).toEqual(['l4']);
    });

    it('changes nothing until a category is picked', () => {
      const view = composeListView(
        lines,
        state({ view: 'category', category: null }),
        context(table)
      );

      expect(ids(view.lines)).toEqual(['l1', 'l2', 'l3', 'l4']);
      expect(view.category).toBeNull();
    });

    it('orders inside the view', () => {
      const view = composeListView(
        lines,
        state({ order: 'alpha', view: 'category', category: 'cereals' }),
        context(table)
      );

      expect(ids(view.lines)).toEqual(['l3', 'l2']);
    });

    it('never draws a line twice, whichever of its categories is picked', () => {
      for (const category of ['pork', 'cereals', 'milk']) {
        const view = composeListView(
          [...lines, lines[1]],
          state({ view: 'category', category }),
          context(table)
        );
        expect(ids(view.lines).filter((id) => id === 'l2')).toHaveLength(1);
      }
    });
  });

  describe('the search', () => {
    const table = {
      l1: { categories: ['potatoes-and-carrots'] as ListCategoryPick[] },
      l3: {
        productGroupId: null,
        categories: ['cereals'] as ListCategoryPick[],
        products: ['Copos de avena Hacendado'],
      },
      l4: {
        productGroupId: null,
        categories: ['film-aluminum-and-preservation'] as ListCategoryPick[],
        products: ['Bolsas autocierre'],
      },
    };

    it('matches the line’s own name, folded', () => {
      const view = composeListView(lines, state(), context(table, 'AVILA'));
      expect(ids(view.lines)).toEqual(['l2']);
    });

    it('matches the name of a product on the line', () => {
      const view = composeListView(lines, state(), context(table, 'hacendado'));
      expect(ids(view.lines)).toEqual(['l3']);
    });

    it('matches a category name in the reader’s language, folded', () => {
      const view = composeListView(lines, state(), context(table, 'ALUMINIO'));
      expect(ids(view.lines)).toEqual(['l4']);
    });

    it('finds nothing by a category id', () => {
      const view = composeListView(lines, state(), context(table, 'aluminum'));
      expect(ids(view.lines)).toEqual([]);
    });

    it('applies on top of the category and the order', () => {
      const view = composeListView(
        lines,
        state({ order: 'alpha', view: 'category', category: 'cereals' }),
        context(table, 'avena')
      );
      expect(ids(view.lines)).toEqual(['l3']);
    });
  });
});

describe('listCategoryCounts', () => {
  const lines = [line('a', 'a'), line('b', 'b'), line('c', 'c')];
  const categories: Record<string, ListCategoryPick[]> = {
    a: [NO_CATEGORY],
    b: ['cereals', 'milk'],
    c: ['milk'],
  };

  it('names only the categories present, in tree order, with No category last', () => {
    const tree: Record<string, number> = { milk: 4, cereals: 9 };

    expect(
      listCategoryCounts(
        lines,
        (id) => categories[id],
        (id) => tree[id] ?? null
      )
    ).toEqual([
      { category: 'milk', lines: 2 },
      { category: 'cereals', lines: 1 },
      { category: NO_CATEGORY, lines: 1 },
    ]);
  });

  it('keeps first appearance order while the tree has not arrived', () => {
    expect(listCategoryCounts(lines, (id) => categories[id])).toEqual([
      { category: 'cereals', lines: 1 },
      { category: 'milk', lines: 2 },
      { category: NO_CATEGORY, lines: 1 },
    ]);
  });
});

describe('the badge and the reorder hold', () => {
  it('counts A to Z and a picked category, and not a category still unpicked', () => {
    expect(listViewActiveCount(state())).toBe(0);
    expect(listViewActiveCount(state({ order: 'alpha' }))).toBe(1);
    expect(listViewActiveCount(state({ view: 'category' }))).toBe(0);
    expect(
      listViewActiveCount(
        state({ order: 'alpha', view: 'category', category: 'milk' })
      )
    ).toBe(2);
  });

  it('holds reorder under A to Z, a picked category, or a search', () => {
    expect(listViewHoldsReorder(state(), '')).toBe(false);
    expect(listViewHoldsReorder(state(), '   ')).toBe(false);
    expect(listViewHoldsReorder(state({ order: 'alpha' }), '')).toBe(true);
    expect(
      listViewHoldsReorder(state({ view: 'category', category: 'milk' }), '')
    ).toBe(true);
    expect(listViewHoldsReorder(state(), 'milk')).toBe(true);
  });
});
