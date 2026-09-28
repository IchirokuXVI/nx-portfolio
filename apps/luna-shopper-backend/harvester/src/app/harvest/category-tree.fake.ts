import type {
  CategoryTreeView,
  CategoryView,
} from '@portfolio/luna-shopper/contracts';

/**
 * A small category tree, as catalog's `category.tree` answers it, for the
 * harvester's tests (plan 0166, section 7).
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
      root('dairy-and-eggs', 0),
      root('drinks', 1),
      root('other', 2),
      root('cold-cuts-and-cheese', 3),
      leaf('milk', 'dairy-and-eggs', 0),
      leaf('cheese', 'cold-cuts-and-cheese', 0),
      leaf('soft-drinks', 'drinks', 0),
      leaf('juices', 'drinks', 1),
      leaf('uncategorised', 'other', 0),
    ],
  };
}
