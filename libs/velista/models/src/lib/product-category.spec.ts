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
    node('ice-cream', 'frozen', 3),
    node('frozen', null, 8),
    node('milk', 'dairy-and-eggs', 0),
    node('dairy-and-eggs', null, 4),
    node('eggs', 'dairy-and-eggs', 4),
    node('frozen-vegetables', 'frozen', 0),
  ];

  it('puts the roots, and each root’s children, in position order', () => {
    const tree = buildCategoryTree(rows);

    expect(
      tree.roots.map((branch) => [
        branch.root.slug,
        branch.children.map((child) => child.slug),
      ])
    ).toEqual([
      ['dairy-and-eggs', ['milk', 'eggs']],
      ['frozen', ['frozen-vegetables', 'ice-cream']],
    ]);
  });

  it('ranks every row in walk order: a root, its children, the next root', () => {
    const tree = buildCategoryTree(rows);

    expect(
      [...tree.ranks.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id)
    ).toEqual([
      'cat-dairy-and-eggs',
      'cat-milk',
      'cat-eggs',
      'cat-frozen',
      'cat-frozen-vegetables',
      'cat-ice-cream',
    ]);
  });

  it('looks a row up by id and by slug', () => {
    const tree = buildCategoryTree(rows);

    expect(tree.byId.get('cat-milk')?.slug).toBe('milk');
    expect(tree.bySlug.get('ice-cream')?.id).toBe('cat-ice-cream');
    expect(tree.bySlug.get('nothing')).toBeUndefined();
  });

  it('breaks a position tie on the slug, so every read walks the same way', () => {
    const tree = buildCategoryTree([
      node('pets', null, 0),
      node('cats', 'pets', 0),
      node('baby', null, 0),
      node('dogs', 'pets', 0),
    ]);

    expect(tree.roots.map((branch) => branch.root.slug)).toEqual([
      'baby',
      'pets',
    ]);
    expect(tree.roots[1].children.map((child) => child.slug)).toEqual([
      'cats',
      'dogs',
    ]);
  });

  it('leaves out a row that breaks the two levels, rather than guessing its place', () => {
    const tree = buildCategoryTree([
      node('frozen', null, 0),
      node('ice-cream', 'frozen', 0),
      // A grandchild, and an orphan whose parent was never sent.
      node('vanilla', 'ice-cream', 0),
      node('lost', 'nowhere', 0),
    ]);

    expect(tree.byId.has('cat-vanilla')).toBe(false);
    expect(tree.byId.has('cat-lost')).toBe(false);
    expect(tree.ranks.size).toBe(2);
  });

  it('keeps the first of two rows with one id', () => {
    const tree = buildCategoryTree([
      node('frozen', null, 0),
      node('frozen', null, 1),
    ]);

    expect(tree.roots).toHaveLength(1);
  });

  it('answers an empty tree for nothing', () => {
    expect(buildCategoryTree([])).toEqual(EMPTY_CATEGORY_TREE);
  });
});

describe('categoryName', () => {
  it('names a category in the reader’s language', () => {
    const milk = node('milk', 'dairy-and-eggs', 0, 'Milk', 'Leche');

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
