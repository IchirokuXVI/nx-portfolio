import type {
  CategoryNode,
  LocalizedName,
  ProductCategory,
} from '@portfolio/velista/models';
import { isRecord, mapArray, numOr, str, strOr } from './primitives';

/**
 * The catalog's categories, read off the wire (velista `0118`, backend `0166`
 * section 3). Rule D4: every function takes `unknown`.
 *
 * A category is data now, and there is no constant to fold an unreadable one onto. So
 * the rule is the plan's: keep the rows that carry an id, a parent, a slug and a name
 * somebody can read, and drop the rest. A product left with none has no category,
 * which both groupings already draw.
 */

/**
 * A name with at least one language in it, or null.
 *
 * The wire promises one of the two. A row with neither could only draw a blank
 * heading or radio, and a blank is worse than the row not being there.
 */
function readableName(raw: unknown): LocalizedName | null {
  if (!isRecord(raw)) {
    return null;
  }
  const name = { en: strOr(raw['en'], ''), es: strOr(raw['es'], '') };
  return name.en !== '' || name.es !== '' ? name : null;
}

/** From `ItemCategoryView`: one of a product's categories, always a leaf. */
export function toProductCategory(raw: unknown): ProductCategory | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['id']);
  const parentId = str(raw['parentId']);
  const slug = str(raw['slug']);
  const name = readableName(raw['name']);
  if (
    id === null ||
    id === '' ||
    parentId === null ||
    slug === null ||
    name === null
  ) {
    return null;
  }

  return { id, parentId, slug, name };
}

/**
 * `ItemView.categories`: a product's categories in the catalog's order.
 *
 * Unreadable elements are dropped and a repeated id is kept once, so a grouping
 * never draws one row twice under one heading. Anything that is not a list is no
 * categories at all, which is also what an older backend sending the retired scalar
 * `category` reads as.
 */
export function toProductCategories(raw: unknown): readonly ProductCategory[] {
  const seen = new Set<string>();
  return mapArray(raw, toProductCategory).filter((category) => {
    if (seen.has(category.id)) {
      return false;
    }
    seen.add(category.id);
    return true;
  });
}

/** From `CategoryView`: one row of the whole tree, a root or a child. */
export function toCategoryNode(raw: unknown): CategoryNode | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['id']);
  const slug = str(raw['slug']);
  const name = readableName(raw['name']);
  const parent = raw['parentId'];
  // Null is a root. Anything else that is not a string is a row this build cannot
  // place, and placing it as a root would invent one.
  if (
    id === null ||
    id === '' ||
    slug === null ||
    name === null ||
    (parent !== null && typeof parent !== 'string')
  ) {
    return null;
  }

  return {
    id,
    parentId: parent,
    slug,
    name,
    position: numOr(raw['position'], 0),
    itemCount: Math.max(0, numOr(raw['itemCount'], 0)),
  };
}

/**
 * `GET /v1/catalog/categories`: `{ categories: CategoryView[] }`.
 *
 * Null for a body that is not that shape, which the store treats as a read that did
 * not answer. An answer with no rows is an empty tree, which is a fact.
 */
export function toCategoryNodes(raw: unknown): readonly CategoryNode[] | null {
  if (!isRecord(raw) || !Array.isArray(raw['categories'])) {
    return null;
  }
  return mapArray(raw['categories'], toCategoryNode);
}
