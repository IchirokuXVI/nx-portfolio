import {
  GatewayError,
  type MemoryTables,
  type ResourceMemoryRules,
  type ResourceSource,
} from '@portfolio/luna-shopper-admin/data-access';
import type { Wire } from '@portfolio/luna-shopper-admin/models';

/**
 * The rules of the sections of a shop, kept by the in memory tables (backend
 * plan 0200, section 3; admin plan 0063).
 *
 * Catalog enforces them on the server. The twin enforces them too, because
 * the screens are built around what they answer: a slug the shop already
 * holds, a category that does not exist, a section of another shop in an
 * order, and the two answers of "where is this product in this shop".
 */

type Section = Wire.CatalogShopSectionView;
type Category = Wire.CatalogCategoryView;
type Location = Wire.CatalogSupermarketLocationView;
type Item = Wire.CatalogItemView;

/** The tables a section rule looks across, as source factories. */
export interface SectionTables {
  readonly sections: () => ResourceSource<Section>;
  readonly categories: () => ResourceSource<Category>;
  readonly locations: () => ResourceSource<Location>;
}

/** A refusal, shaped as the gateway's own answer would be. */
export function sectionRefusal(code: string, status: number): GatewayError {
  return new GatewayError({ code, status, correlationId: '' });
}

/** The sections table's rules. */
export function sectionMemoryRules(
  sources: SectionTables
): ResourceMemoryRules<Section> {
  return {
    create(input, tables) {
      const locationId = String(input['supermarketLocationId'] ?? '');
      const slug = String(input['slug'] ?? '');
      if (
        !tables
          .table(sources.locations())
          .some((shop) => shop.id === locationId)
      ) {
        throw sectionRefusal('not_found', 404);
      }
      const shop = shopSections(locationId, tables, sources);
      if (shop.some((section) => section.slug === slug)) {
        throw sectionRefusal('section_slug_taken', 409);
      }
      const categoryIds = checkedCategories(
        input['categoryIds'],
        tables.table(sources.categories())
      );
      return {
        ...input,
        categoryIds,
        // A new section goes after the last one of its shop.
        position: shop.length,
      };
    },

    update(current, input, tables) {
      const changes: Record<string, unknown> = { ...input };
      if ('categoryIds' in input) {
        changes['categoryIds'] = checkedCategories(
          input['categoryIds'],
          tables.table(sources.categories())
        );
      }
      // A position is a move: the sections between move by one, and a place
      // past the last one is the last one.
      if (typeof input['position'] === 'number') {
        const ids = shopSections(
          current.supermarketLocationId,
          tables,
          sources
        ).map((section) => section.id);
        const without = ids.filter((id) => id !== current.id);
        const to = Math.max(0, Math.min(input['position'], without.length));
        without.splice(to, 0, current.id);
        writeShopOrder(current.supermarketLocationId, without, tables, sources);
        changes['position'] = to;
      }
      return changes;
    },

    remove(current, tables) {
      // A delete closes the gap in its shop's order. The row itself is
      // removed by the table once this answers.
      const rest = shopSections(current.supermarketLocationId, tables, sources)
        .map((section) => section.id)
        .filter((id) => id !== current.id);
      writeShopOrder(current.supermarketLocationId, rest, tables, sources);
    },
  };
}

/** Every id must name a category, at either level. */
function checkedCategories(
  value: unknown,
  tree: readonly Category[]
): string[] {
  const ids = Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string')
    : [];
  for (const id of ids) {
    if (!tree.some((category) => category.id === id)) {
      throw sectionRefusal('category_not_found', 404);
    }
  }
  return ids;
}

/** The sections of one shop, in its order. */
export function shopSections(
  locationId: string,
  tables: MemoryTables,
  sources: SectionTables
): readonly Section[] {
  return [...tables.table(sources.sections())]
    .filter((section) => section.supermarketLocationId === locationId)
    .sort((a, b) => a.position - b.position);
}

/**
 * Give the sections of a shop the places of `ids`, in that order, as
 * `PUT locations/:id/sections` does: the named sections first, every other
 * section of the shop after them in the order it had. An id of another shop
 * is `section_of_another_shop`, and an unknown one `section_not_found`.
 */
export function writeShopOrder(
  locationId: string,
  ids: readonly string[],
  tables: MemoryTables,
  sources: SectionTables
): void {
  const all = tables.table(sources.sections()) as Section[];
  const shop = shopSections(locationId, tables, sources);
  for (const id of ids) {
    if (shop.some((section) => section.id === id)) {
      continue;
    }
    throw all.some((section) => section.id === id)
      ? sectionRefusal('section_of_another_shop', 409)
      : sectionRefusal('section_not_found', 404);
  }
  const order = [
    ...new Set([
      ...ids,
      ...shop.map((section) => section.id).filter((id) => !ids.includes(id)),
    ]),
  ];
  // In place, so that a table that is iterating its rows finds each one
  // where it was.
  for (const [index, row] of all.entries()) {
    const place = order.indexOf(row.id);
    if (row.supermarketLocationId === locationId && place !== -1) {
      all[index] = { ...row, position: place };
    }
  }
}

/**
 * Where one product is among a shop's sections: the sections covering one of
 * its categories or the root above one, else none. No pin exists (backend
 * plan 0200).
 */
export function sectionsForItem(
  item: Item | undefined,
  present: readonly Section[]
): { sectionIds: string[]; step: 'COVERED' | 'NONE' } {
  if (item === undefined) {
    return { sectionIds: [], step: 'NONE' };
  }
  const covering = new Set(
    (item.categories ?? []).flatMap((category) => [
      category.id,
      category.parentId,
    ])
  );
  const covered = present
    .filter((section) => section.categoryIds.some((id) => covering.has(id)))
    .map((section) => section.id);
  return covered.length > 0
    ? { sectionIds: covered, step: 'COVERED' }
    : { sectionIds: [], step: 'NONE' };
}
