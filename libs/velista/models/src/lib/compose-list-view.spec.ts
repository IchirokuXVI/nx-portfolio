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
import type { ProductCategory } from './enums';

const LABELS: Record<ProductCategory, string> = {
  PRODUCE: 'Produce',
  DAIRY: 'Dairy',
  BAKERY: 'Bakery',
  MEAT: 'Meat',
  SEAFOOD: 'Seafood',
  FROZEN: 'Frozen',
  BEVERAGES: 'Drinks',
  SNACKS: 'Snacks',
  PANTRY: 'Pantry',
  HOUSEHOLD: 'Household',
  PERSONAL_CARE: 'Personal care',
  OTHER: 'Other',
};

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
    categoryLabel: (category) => LABELS[category],
  };
}

function state(overrides: Partial<ListViewState> = {}): ListViewState {
  return { ...DEFAULT_LIST_VIEW_STATE, ...overrides };
}

const ids = (lines: readonly ListViewLine[]) => lines.map((row) => row.id);

describe('lineCategories', () => {
  function product(id: string, category: ProductCategory): CatalogItem {
    return {
      id,
      name: { es: id, en: id },
      brand: null,
      size: null,
      unit: 'UNIT',
      productGroupId: null,
      category,
      offer: null,
    };
  }

  const catalog = [product('milk', 'DAIRY'), product('apple', 'PRODUCE')];
  const itemOf = (id: string) => catalog.find((row) => row.id === id) ?? null;

  it('is the set of its products’ categories, in catalog order', () => {
    expect(lineCategories(['milk', 'apple', 'milk'], itemOf)).toEqual([
      'PRODUCE',
      'DAIRY',
    ]);
  });

  it('is No category for a line with no products', () => {
    expect(lineCategories([], itemOf)).toEqual([NO_CATEGORY]);
  });

  it('is No category while none of its products has loaded', () => {
    expect(lineCategories(['not-loaded'], itemOf)).toEqual([NO_CATEGORY]);
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
      l1: { categories: ['PRODUCE'] as ListCategoryPick[] },
      l2: { categories: ['MEAT', 'PANTRY', 'DAIRY'] as ListCategoryPick[] },
      l3: { categories: ['PANTRY'] as ListCategoryPick[] },
    };

    it('keeps only the lines holding the picked category, under its heading', () => {
      const view = composeListView(
        lines,
        state({ view: 'category', category: 'PANTRY' }),
        context(table)
      );

      expect(ids(view.lines)).toEqual(['l2', 'l3']);
      expect(view.category).toBe('PANTRY');
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
        state({ order: 'alpha', view: 'category', category: 'PANTRY' }),
        context(table)
      );

      expect(ids(view.lines)).toEqual(['l3', 'l2']);
    });

    it('never draws a line twice, whichever of its categories is picked', () => {
      for (const category of ['MEAT', 'PANTRY', 'DAIRY'] as const) {
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
      l1: { categories: ['PRODUCE'] as ListCategoryPick[] },
      l3: {
        categories: ['PANTRY'] as ListCategoryPick[],
        products: ['Copos de avena Hacendado'],
      },
      l4: {
        categories: ['HOUSEHOLD'] as ListCategoryPick[],
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

    it('matches a category label in the reader’s language', () => {
      const view = composeListView(lines, state(), context(table, 'household'));
      expect(ids(view.lines)).toEqual(['l4']);
    });

    it('applies on top of the category and the order', () => {
      const view = composeListView(
        lines,
        state({ order: 'alpha', view: 'category', category: 'PANTRY' }),
        context(table, 'avena')
      );
      expect(ids(view.lines)).toEqual(['l3']);
    });
  });
});

describe('listCategoryCounts', () => {
  it('names only the categories present, in catalog order, with No category last', () => {
    const lines = [line('a', 'a'), line('b', 'b'), line('c', 'c')];
    const categories: Record<string, ListCategoryPick[]> = {
      a: ['PANTRY', 'DAIRY'],
      b: ['DAIRY'],
      c: [NO_CATEGORY],
    };

    expect(listCategoryCounts(lines, (id) => categories[id])).toEqual([
      { category: 'DAIRY', lines: 2 },
      { category: 'PANTRY', lines: 1 },
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
        state({ order: 'alpha', view: 'category', category: 'DAIRY' })
      )
    ).toBe(2);
  });

  it('holds reorder under A to Z, a picked category, or a search', () => {
    expect(listViewHoldsReorder(state(), '')).toBe(false);
    expect(listViewHoldsReorder(state(), '   ')).toBe(false);
    expect(listViewHoldsReorder(state({ order: 'alpha' }), '')).toBe(true);
    expect(
      listViewHoldsReorder(state({ view: 'category', category: 'DAIRY' }), '')
    ).toBe(true);
    expect(listViewHoldsReorder(state(), 'milk')).toBe(true);
  });
});
