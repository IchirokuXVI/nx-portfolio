import { Injectable } from '@angular/core';
import type {
  CatalogItem,
  CatalogSuggestion,
  ProductGroup,
  UnitOfMeasure,
} from '@portfolio/velista/models';
import type { CatalogServiceI } from './catalog-service';

/**
 * A handful of products, in memory. Asked for by name, never a default.
 *
 * Enough to exercise the three rules of velista plan 0043 section 6 with no backend,
 * and no more than that: a group that outranks its own members, items with brands, and
 * a query that matches nothing so the composer's "add it as written" row is reachable.
 *
 * **Two milks differ only in size**, on purpose. The catalog holds one record per
 * size, so that is what "leche" really answers with, and a fixture where every product
 * had a distinct name made the rows look distinguishable when against a real catalog
 * they were not. The eggs beside them are the other half of the size rule: a count of
 * twelve is worth drawing and a count of one is not.
 *
 * The products are Spanish supermarket staples because that is what the catalog
 * actually holds, and using them keeps the row widths honest: "Leche semidesnatada
 * Hacendado, 6 x 1 L" is a real product name and it is the case a row has to survive.
 */
const MILK: readonly CatalogItem[] = [
  item('item-milk-hacendado', 'Leche entera Hacendado', 'Whole milk', 'Hacendado', 1, 'LITER', 'group-milk'),
  item('item-milk-hacendado-half', 'Leche entera Hacendado', 'Whole milk', 'Hacendado', 0.5, 'LITER', 'group-milk'),
  item('item-milk-pascual', 'Leche entera Pascual', 'Whole milk', 'Pascual', 1, 'LITER', 'group-milk'),
  item('item-milk-semi', 'Leche semidesnatada Hacendado, 6 x 1 L', 'Semi-skimmed milk, 6 x 1 L', 'Hacendado', 6, 'LITER', 'group-milk'),
  item('item-milk-oat', 'Bebida de avena Oatly', 'Oat drink', 'Oatly', 1, 'LITER', 'group-milk'),
];

const BREAD: readonly CatalogItem[] = [
  item('item-bread-sourdough', 'Pan de masa madre', 'Sourdough loaf', null, 0.5, 'KILOGRAM', 'group-bread'),
  // No size at all, which is an ordinary state for a harvested product and the one
  // case the row has to draw nothing for rather than guessing a packet.
  item('item-bread-sliced', 'Pan de molde integral Bimbo', 'Wholemeal sliced bread', 'Bimbo', null, 'UNIT', 'group-bread'),
];

const OIL: readonly CatalogItem[] = [
  item('item-oil-hacendado', 'Aceite de oliva virgen extra', 'Extra virgin olive oil', 'Hacendado', 1, 'LITER', 'group-oil'),
];

const EGGS: readonly CatalogItem[] = [
  // A count, so the size is the number of eggs and is worth a row's width. Its
  // partner below is the case the size is suppressed for: one of a thing is what
  // every product is, so "1 unit" would appear on half the catalog and tell nobody
  // anything.
  item('item-eggs-dozen', 'Huevos frescos Hacendado', 'Free range eggs', 'Hacendado', 12, 'UNIT', 'group-eggs'),
  item('item-eggs-single', 'Huevo de codorniz', 'Quail egg', null, 1, 'UNIT', 'group-eggs'),
];

const GROUPS: readonly ProductGroup[] = [
  group('group-milk', 'Leche', 'Milk'),
  group('group-bread', 'Pan', 'Bread'),
  group('group-oil', 'Aceite de oliva', 'Olive oil'),
  group('group-eggs', 'Huevos', 'Eggs'),
];

const ITEMS: readonly CatalogItem[] = [...MILK, ...BREAD, ...OIL, ...EGGS];

const MEMBERS: Readonly<Record<string, readonly string[]>> = {
  'group-milk': MILK.map((row) => row.id),
  'group-bread': BREAD.map((row) => row.id),
  'group-oil': OIL.map((row) => row.id),
  'group-eggs': EGGS.map((row) => row.id),
};

@Injectable()
export class CatalogMemory implements CatalogServiceI {
  /**
   * Matches on either language, and **groups first**.
   *
   * The ordering is the one rule this fake has to reproduce faithfully, because it is
   * the rule the screen is built on: somebody typing "milk" is offered the group, not
   * one brand of it (velista plan 0043, section 6). A fixture that returned items
   * first would make the composer look correct while testing the opposite of what the
   * server does.
   *
   * `profileId` is accepted and ignored. The real search narrows to the chains a
   * profile visits; there is one catalog here and no prices, so honouring it would
   * mean inventing a scope rather than modelling one.
   */
  async suggest(query: string): Promise<readonly CatalogSuggestion[]> {
    const needle = query.trim().toLocaleLowerCase();
    if (needle.length === 0) {
      return [];
    }

    const groups: CatalogSuggestion[] = GROUPS.filter((row) =>
      matches(row.name.es, row.name.en, needle)
    ).map((row) => ({
      kind: 'group',
      group: row,
      itemIds: MEMBERS[row.id] ?? [],
      offer: null,
    }));

    const items: CatalogSuggestion[] = ITEMS.filter((row) =>
      matches(row.name.es, row.name.en, needle)
    ).map((row) => ({ kind: 'item', item: row }));

    return [...groups, ...items];
  }

  /**
   * The fixture's answer to a set of ids, with the unknown ones **omitted**.
   *
   * Omitted rather than filled in, because that is what the real catalog does and it is
   * the case the screens have to survive: a line outlives a product, and a fake that
   * invented a name for every id asked of it would make the one branch that matters
   * unreachable in development.
   *
   * Never null. A fake has no transport to fail, and returning a failure here would be
   * inventing one; the failure branch is exercised by a stub in the specs that want it.
   */
  async itemsByIds(
    itemIds: readonly string[]
  ): Promise<readonly CatalogItem[] | null> {
    const wanted = new Set(itemIds);
    return ITEMS.filter((row) => wanted.has(row.id));
  }

  /**
   * The fixture's groups, unknown ids **omitted**, for the reason above.
   *
   * A line outlives the group it was bound to, so an id matching nothing here is the
   * ordinary "the group is gone" case, which the heading draws as `From a group`.
   * Never null: a fake has no transport to fail.
   */
  async productGroupsByIds(
    groupIds: readonly string[]
  ): Promise<readonly ProductGroup[] | null> {
    const wanted = new Set(groupIds);
    return GROUPS.filter((row) => wanted.has(row.id));
  }
}

/** The products of one group, for a composer choosing it whole. */
export function membersOfGroup(groupId: string): readonly string[] {
  return MEMBERS[groupId] ?? [];
}

/** One product's name, for the chips and history rows that draw ids otherwise. */
export function catalogItemById(itemId: string): CatalogItem | null {
  return ITEMS.find((row) => row.id === itemId) ?? null;
}

function matches(es: string, en: string, needle: string): boolean {
  return (
    es.toLocaleLowerCase().includes(needle) ||
    en.toLocaleLowerCase().includes(needle)
  );
}

function item(
  id: string,
  es: string,
  en: string,
  brand: string | null,
  size: number | null,
  unit: UnitOfMeasure,
  productGroupId: string
): CatalogItem {
  // No offer, on every row. There is one catalog here and no scopes to price it
  // against, so a number would be invented rather than modelled, and unpriced is
  // the state both clusters are permanently in anyway (velista `0063`, section 3).
  return { id, name: { es, en }, brand, size, unit, productGroupId, offer: null };
}

function group(id: string, es: string, en: string): ProductGroup {
  return { id, name: { es, en } };
}
