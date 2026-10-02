import type {
  CategoryTreeView,
  CategoryView,
} from '@portfolio/luna-shopper/contracts';

/**
 * A small category tree, as catalog's `category.tree` answers it, for the
 * harvester's tests (plan 0166, section 7). It is a slice of the tree of plan
 * 0173, appendix A: real roots, each with real leaves of its own.
 *
 * The ids are readable on purpose (`cat-milk` for `milk`), so an assertion on
 * what reached catalog says which leaf it meant. It holds the leaves the specs
 * name and `uncategorised`, and nothing else: a slug outside it is exactly the
 * unknown slug a test wants to see refused.
 */
export function fakeCategoryTree(): CategoryTreeView {
  const root = (slug: string, position: number): CategoryView => ({
    id: `cat-${slug}`,
    parentId: null,
    slug,
    name: { en: slug },
    position,
    itemCount: 0,
  });
  const leaf = (
    slug: string,
    parent: string,
    position: number
  ): CategoryView => ({
    id: `cat-${slug}`,
    parentId: `cat-${parent}`,
    slug,
    name: { en: slug },
    position,
    itemCount: 0,
  });
  return {
    categories: [
      root('eggs-milk-and-butter', 6),
      root('water-and-soft-drinks', 19),
      root('juices-and-smoothies', 20),
      root('other', 28),
      leaf('eggs', 'eggs-milk-and-butter', 0),
      leaf('milk', 'eggs-milk-and-butter', 1),
      leaf('cola', 'water-and-soft-drinks', 1),
      leaf('orange', 'juices-and-smoothies', 1),
      leaf('uncategorised', 'other', 0),
    ],
  };
}
