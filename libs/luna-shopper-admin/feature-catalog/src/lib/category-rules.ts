import {
  GatewayError,
  type ProductCategory,
  type ResourceMemoryRules,
  type ResourceSource,
} from '@portfolio/luna-shopper-admin/data-access';
import type { ResourceRow, Wire } from '@portfolio/luna-shopper-admin/models';

/**
 * The four rules of the category tree, kept by the in memory tables (backend
 * plan 0166, sections 1 and 2; admin plan 0036).
 *
 * Catalog enforces these on the server, in the service and in the database.
 * The memory twin enforces them too, because the screens are built around the
 * refusals: a parent that is itself a child, a product on a root, a product
 * with no category, and a delete of a category that still holds something.
 * A twin that stored whatever it was handed would let every sentence that
 * explains one of those go untested.
 */

type Category = Wire.CatalogCategoryView;
type ItemRow = Wire.CatalogItemView;

/** A refusal, shaped as the gateway's own answer would be. */
function refusal(
  code: string,
  status: number,
  details?: Readonly<Record<string, unknown>>
): GatewayError {
  return new GatewayError({ code, status, correlationId: '', details });
}

/** The category tree's rules, for its own table. */
export function categoryMemoryRules(
  categories: () => ResourceSource<Category>,
  items: () => ResourceSource<ItemRow>
): ResourceMemoryRules<Category> {
  return {
    matches(row, param, value) {
      if (param !== 'kind') {
        return undefined;
      }
      return value === 'root' ? row.parentId === null : row.parentId !== null;
    },

    create(input, tables) {
      const parentId = readParent(input);
      if (parentId !== null) {
        parentFor(parentId, tables.table(categories()));
      }
      const all = tables.table(categories());
      if (all.some((category) => category.slug === input['slug'])) {
        throw refusal('conflict', 409);
      }
      return {
        ...input,
        parentId,
        position:
          typeof input['position'] === 'number'
            ? input['position']
            : all.filter((category) => category.parentId === parentId).length,
        itemCount: 0,
      };
    },

    update(current, input, tables) {
      if (!('parentId' in input)) {
        return input;
      }
      const parentId = readParent(input);
      const all = tables.table(categories());

      if (parentId !== null) {
        parentFor(parentId, all);
        // A root that already holds children cannot go under another: its
        // children would be a third level.
        if (all.some((category) => category.parentId === current.id)) {
          throw refusal('category_too_deep', 409, { categoryId: current.id });
        }
      } else if (
        current.parentId !== null &&
        holdsProducts(current.id, tables.table(items()))
      ) {
        // A child with products made a root would leave them on a root.
        throw refusal('category_not_a_leaf', 409, { categoryId: current.id });
      }
      return { ...input, parentId };
    },

    remove(current, tables) {
      const children = tables
        .table(categories())
        .some((category) => category.parentId === current.id);
      if (children || holdsProducts(current.id, tables.table(items()))) {
        throw refusal('category_in_use', 409);
      }
    },
  };
}

/** The products' rules, for the item table. */
export function itemMemoryRules(
  categories: () => ResourceSource<Category>
): ResourceMemoryRules<ItemRow> {
  return {
    matches(row, param, value) {
      if (param !== 'categoryId') {
        return undefined;
      }
      // A leaf, or a root meaning any of its children, as the route reads it.
      return (row.categories ?? []).some(
        (category) => category.id === value || category.parentId === value
      );
    },

    create(input, tables) {
      const { categoryIds, ...rest } = input;
      return {
        ...rest,
        categories: resolveItemCategories(
          categoryIds,
          tables.table(categories())
        ),
      };
    },

    update(_current, input, tables) {
      if (!('categoryIds' in input)) {
        return input;
      }
      const { categoryIds, ...rest } = input;
      return {
        ...rest,
        categories: resolveItemCategories(
          categoryIds,
          tables.table(categories())
        ),
      };
    },
  };
}

/**
 * A product's categories, from the ids a write named, in the order it named
 * them. Refused the way catalog refuses: none at all, an id that names
 * nothing, or a root.
 */
export function resolveItemCategories(
  ids: unknown,
  tree: readonly Category[]
): ProductCategory[] {
  const named = Array.isArray(ids)
    ? [...new Set(ids.filter((id): id is string => typeof id === 'string'))]
    : [];
  if (named.length === 0) {
    throw refusal('item_needs_a_category', 400);
  }

  const unknown = named.filter(
    (id) => !tree.some((category) => category.id === id)
  );
  if (unknown.length > 0) {
    throw refusal('category_not_found', 404, { unknown });
  }

  return named.map((id) => {
    const category = tree.find((row) => row.id === id) as Category;
    if (category.parentId === null) {
      throw refusal('category_not_a_leaf', 409, { categoryId: id });
    }
    return {
      id: category.id,
      parentId: category.parentId,
      slug: category.slug,
      name: category.name,
    };
  });
}

/** The parent a write named, or `null` for a root. */
function readParent(input: ResourceRow): string | null {
  const value = input['parentId'];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The parent, checked: it exists and is itself a root. */
function parentFor(id: string, tree: readonly Category[]): Category {
  const parent = tree.find((category) => category.id === id);
  if (parent === undefined) {
    throw refusal('category_not_found', 404, { unknown: [id] });
  }
  if (parent.parentId !== null) {
    throw refusal('category_too_deep', 409, { categoryId: parent.id });
  }
  return parent;
}

/** Whether any product sits on this category, or under it for a root. */
function holdsProducts(id: string, products: readonly ItemRow[]): boolean {
  return products.some((item) =>
    (item.categories ?? []).some(
      (category) => category.id === id || category.parentId === id
    )
  );
}
