import {
  GatewayError,
  type MemoryTables,
  type ResourceMemoryRules,
  type ResourceSource,
} from '@portfolio/luna-shopper-admin/data-access';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import type { ItemSectionPin, LocationSectionList } from './section-seed';

/**
 * The rules of shop sections, kept by the in memory tables (backend plan 0167,
 * sections 1 to 3; admin plan 0037, target 6).
 *
 * Catalog enforces them on the server. The twin enforces them too, because
 * the screens are built around what they answer: a slug the chain already
 * holds, a category that does not exist, a section of another chain in a
 * shop's list, and the three branches of "where is this product in this shop".
 */

type Section = Wire.CatalogSupermarketSectionView;
type Category = Wire.CatalogCategoryView;
type Location = Wire.CatalogSupermarketLocationView;
type Item = Wire.CatalogItemView;

/** The tables a section rule looks across, as source factories. */
export interface SectionTables {
  readonly sections: () => ResourceSource<Section>;
  readonly categories: () => ResourceSource<Category>;
  readonly locations: () => ResourceSource<Location>;
  readonly lists: () => ResourceSource<LocationSectionList>;
  readonly pins: () => ResourceSource<ItemSectionPin>;
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
      const supermarketId = String(input['supermarketId'] ?? '');
      const slug = String(input['slug'] ?? '');
      const chain = tables
        .table(sources.sections())
        .filter((section) => section.supermarketId === supermarketId);

      if (chain.some((section) => section.slug === slug)) {
        throw sectionRefusal('section_slug_taken', 409);
      }
      const categoryIds = checkedCategories(
        input['categoryIds'],
        tables.table(sources.categories())
      );
      return {
        ...input,
        categoryIds,
        position:
          typeof input['position'] === 'number'
            ? input['position']
            : chain.length,
        // A new section is on no shop's own list yet, so it is present at the
        // shops that inherit the chain's.
        locationCount: shopsOf(supermarketId, tables, sources).filter(
          (shop) => ownList(shop.id, tables, sources) === null
        ).length,
      };
    },

    update(_current, input, tables) {
      if (!('categoryIds' in input)) {
        return input;
      }
      return {
        ...input,
        categoryIds: checkedCategories(
          input['categoryIds'],
          tables.table(sources.categories())
        ),
      };
    },

    remove(current, tables) {
      // A section that no longer exists cannot be a place: it leaves every
      // shop's list and every pin (backend plan 0167, section 2).
      const lists = tables.table(sources.lists()) as LocationSectionList[];
      replaceAll(
        lists,
        lists
          .map((list) => ({
            ...list,
            sectionIds: list.sectionIds.filter((id) => id !== current.id),
          }))
          .filter((list) => list.sectionIds.length > 0)
      );
      const pins = tables.table(sources.pins()) as ItemSectionPin[];
      replaceAll(
        pins,
        pins
          .map((pin) => ({
            ...pin,
            sectionIds: pin.sectionIds.filter((id) => id !== current.id),
          }))
          .filter((pin) => pin.sectionIds.length > 0)
      );
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

function replaceAll<T>(target: T[], rows: readonly T[]): void {
  target.splice(0, target.length, ...rows);
}

/** The shops of one chain. */
export function shopsOf(
  supermarketId: string,
  tables: MemoryTables,
  sources: SectionTables
): readonly Location[] {
  return tables
    .table(sources.locations())
    .filter((shop) => shop.supermarketId === supermarketId);
}

/** A shop's own list, or `null` when it inherits its chain's. */
export function ownList(
  locationId: string,
  tables: MemoryTables,
  sources: SectionTables
): readonly string[] | null {
  const list = tables
    .table(sources.lists())
    .find((row) => row.id === locationId);
  return list === undefined || list.sectionIds.length === 0
    ? null
    : list.sectionIds;
}

/** A chain's sections, in the chain's order. */
export function chainSections(
  supermarketId: string,
  tables: MemoryTables,
  sources: SectionTables
): readonly Section[] {
  return [...tables.table(sources.sections())]
    .filter((section) => section.supermarketId === supermarketId)
    .sort((a, b) => a.position - b.position);
}

/**
 * Step 1: the sections present at a shop, in its order, and where the list
 * came from.
 */
export function presentSections(
  location: Location,
  tables: MemoryTables,
  sources: SectionTables
): { readonly source: 'LOCATION' | 'CHAIN'; readonly sections: Section[] } {
  const chain = chainSections(location.supermarketId, tables, sources);
  const own = ownList(location.id, tables, sources);
  if (own === null) {
    return { source: 'CHAIN', sections: [...chain] };
  }
  return {
    source: 'LOCATION',
    sections: own
      .map((id) => chain.find((section) => section.id === id))
      .filter((section): section is Section => section !== undefined),
  };
}

/**
 * Steps 2 to 4 for one product, over the present sections: its pins that are
 * present, else the present sections covering one of its leaves or a leaf's
 * root, else nothing.
 */
export function sectionsForItem(
  item: Item | undefined,
  supermarketId: string,
  present: readonly Section[],
  tables: MemoryTables,
  sources: SectionTables
): { sectionIds: string[]; step: 'PINNED' | 'COVERED' | 'NONE' } {
  if (item === undefined) {
    return { sectionIds: [], step: 'NONE' };
  }
  const pin = tables
    .table(sources.pins())
    .find(
      (row) => row.supermarketId === supermarketId && row.itemId === item.id
    );
  if (pin !== undefined) {
    const pinned = present
      .filter((section) => pin.sectionIds.includes(section.id))
      .map((section) => section.id);
    if (pinned.length > 0) {
      return { sectionIds: pinned, step: 'PINNED' };
    }
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
