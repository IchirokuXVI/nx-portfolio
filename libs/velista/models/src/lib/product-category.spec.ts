import {
  buildCategoryTree,
  categoryName,
  EMPTY_CATEGORY_TREE,
  inCategoryOrder,
  type CategoryNode,
} from './product-category';

function node(
  slug: string,
  parent: string | null,
  position: number,
  en = slug,
  es = slug
): CategoryNode {
  return {
    id: `cat-${slug}`,
    parentId: parent === null ? null : `cat-${parent}`,
    slug,
    name: { en, es },
    position,
    itemCount: 0,
  };
}

/**
 * The tree read once (velista `0118`, section 4): roots with their children in
 * `position` order, and one rank per row in walk order.
 */
describe('buildCategoryTree', () => {
  // Deliberately out of order, as nothing promises the wire is sorted.
  const rows = [
    node('ice-creams-and-ice', 'frozen-foods-and-ice-cream', 5),
    node('frozen-foods-and-ice-cream', null, 9),
    node('milk', 'eggs-milk-and-butter', 1),
    node('eggs-milk-and-butter', null, 6),
    node('eggs', 'eggs-milk-and-butter', 0),
    node('vegetables-and-potatoes', 'frozen-foods-and-ice-cream', 3),
  ];

  it('puts the roots, and each root’s children, in position order', () => {
    const tree = buildCategoryTree(rows);

    expect(
      tree.roots.map((branch) => [
        branch.root.slug,
        branch.children.map((child) => child.slug),
      ])
    ).toEqual([
      ['eggs-milk-and-butter', ['eggs', 'milk']],
      [
        'frozen-foods-and-ice-cream',
        ['vegetables-and-potatoes', 'ice-creams-and-ice'],
      ],
    ]);
  });

  it('ranks every row in walk order: a root, its children, the next root', () => {
    const tree = buildCategoryTree(rows);

    expect(
      [...tree.ranks.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id)
    ).toEqual([
      'cat-eggs-milk-and-butter',
      'cat-eggs',
      'cat-milk',
      'cat-frozen-foods-and-ice-cream',
      'cat-vegetables-and-potatoes',
      'cat-ice-creams-and-ice',
    ]);
  });

  it('looks a row up by id and by slug', () => {
    const tree = buildCategoryTree(rows);

    expect(tree.byId.get('cat-milk')?.slug).toBe('milk');
    expect(tree.bySlug.get('ice-creams-and-ice')?.id).toBe(
      'cat-ice-creams-and-ice'
    );
    expect(tree.bySlug.get('nothing')).toBeUndefined();
  });

  it('breaks a position tie on the slug, so every read walks the same way', () => {
    const tree = buildCategoryTree([
      node('pets', null, 0),
      node('dry-cat-food', 'pets', 0),
      node('children', null, 0),
      node('dry-dog-food', 'pets', 0),
    ]);

    expect(tree.roots.map((branch) => branch.root.slug)).toEqual([
      'children',
      'pets',
    ]);
    expect(tree.roots[1].children.map((child) => child.slug)).toEqual([
      'dry-cat-food',
      'dry-dog-food',
    ]);
  });

  it('leaves out a row that breaks the two levels, rather than guessing its place', () => {
    const tree = buildCategoryTree([
      node('frozen-foods-and-ice-cream', null, 0),
      node('ice-creams-and-ice', 'frozen-foods-and-ice-cream', 0),
      // A grandchild, and an orphan whose parent was never sent.
      node('vanilla', 'ice-creams-and-ice', 0),
      node('lost', 'nowhere', 0),
    ]);

    expect(tree.byId.has('cat-vanilla')).toBe(false);
    expect(tree.byId.has('cat-lost')).toBe(false);
    expect(tree.ranks.size).toBe(2);
  });

  it('keeps the first of two rows with one id', () => {
    const tree = buildCategoryTree([
      node('frozen-foods-and-ice-cream', null, 0),
      node('frozen-foods-and-ice-cream', null, 1),
    ]);

    expect(tree.roots).toHaveLength(1);
  });

  it('answers an empty tree for nothing', () => {
    expect(buildCategoryTree([])).toEqual(EMPTY_CATEGORY_TREE);
  });
});

describe('categoryName', () => {
  it('names a category in the reader’s language', () => {
    const milk = node('milk', 'eggs-milk-and-butter', 0, 'Milk', 'Leche');

    expect(categoryName(milk, 'es')).toBe('Leche');
    expect(categoryName(milk, 'en')).toBe('Milk');
  });

  it('falls back to the other language rather than drawing a blank', () => {
    expect(categoryName(node('x', null, 0, '', 'Sin categoría'), 'en')).toBe(
      'Sin categoría'
    );
    expect(categoryName(node('x', null, 0, 'Pets', ''), 'es')).toBe('Pets');
  });
});

describe('inCategoryOrder', () => {
  const ranks: Record<string, number> = { a: 2, b: 0, c: 1 };
  const rank = (id: string) => ranks[id] ?? null;
  const self = (id: string) => id;

  it('sorts by rank', () => {
    expect(inCategoryOrder(['a', 'b', 'c'], self, rank)).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('keeps first appearance for the unranked, after the ranked', () => {
    expect(inCategoryOrder(['y', 'a', 'x', 'b'], self, rank)).toEqual([
      'b',
      'a',
      'y',
      'x',
    ]);
  });

  it('changes nothing while the tree has not arrived', () => {
    expect(inCategoryOrder(['y', 'a', 'x'], self, () => null)).toEqual([
      'y',
      'a',
      'x',
    ]);
  });
});
