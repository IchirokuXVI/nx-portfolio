import { Injectable } from '@angular/core';
import type {
  CatalogItem,
  CatalogSuggestion,
  ProductGroup,
} from '@portfolio/velista/models';
import type { CatalogServiceI } from './catalog-service';

/**
 * A handful of products, in memory. Asked for by name, never a default.
 *
 * Enough to exercise the three rules of velista plan 0043 section 6 with no backend,
 * and no more than that: a group that outranks its own members, items with brands, and
 * a query that matches nothing so the composer's "add it as written" row is reachable.
 *
 * The products are Spanish supermarket staples because that is what the catalog
 * actually holds, and using them keeps the row widths honest: "Leche semidesnatada
 * Hacendado, 6 x 1 L" is a real product name and it is the case a row has to survive.
 */
const MILK: readonly CatalogItem[] = [
  item('item-milk-hacendado', 'Leche entera Hacendado, 1 L', 'Whole milk, 1 L', 'Hacendado', 'group-milk'),
  item('item-milk-pascual', 'Leche entera Pascual, 1 L', 'Whole milk, 1 L', 'Pascual', 'group-milk'),
  item('item-milk-semi', 'Leche semidesnatada Hacendado, 6 x 1 L', 'Semi-skimmed milk, 6 x 1 L', 'Hacendado', 'group-milk'),
  item('item-milk-oat', 'Bebida de avena Oatly, 1 L', 'Oat drink, 1 L', 'Oatly', 'group-milk'),
];

const BREAD: readonly CatalogItem[] = [
  item('item-bread-sourdough', 'Pan de masa madre, 500 g', 'Sourdough loaf, 500 g', null, 'group-bread'),
  item('item-bread-sliced', 'Pan de molde integral Bimbo', 'Wholemeal sliced bread', 'Bimbo', 'group-bread'),
];

const OIL: readonly CatalogItem[] = [
  item('item-oil-hacendado', 'Aceite de oliva virgen extra, 1 L', 'Extra virgin olive oil, 1 L', 'Hacendado', 'group-oil'),
];

const GROUPS: readonly ProductGroup[] = [
  group('group-milk', 'Leche', 'Milk', MILK.length),
  group('group-bread', 'Pan', 'Bread', BREAD.length),
  group('group-oil', 'Aceite de oliva', 'Olive oil', OIL.length),
];

const ITEMS: readonly CatalogItem[] = [...MILK, ...BREAD, ...OIL];

const MEMBERS: Readonly<Record<string, readonly string[]>> = {
  'group-milk': MILK.map((row) => row.id),
  'group-bread': BREAD.map((row) => row.id),
  'group-oil': OIL.map((row) => row.id),
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
    }));

    const items: CatalogSuggestion[] = ITEMS.filter((row) =>
      matches(row.name.es, row.name.en, needle)
    ).map((row) => ({ kind: 'item', item: row }));

    return [...groups, ...items];
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
  productGroupId: string
): CatalogItem {
  return { id, name: { es, en }, brand, productGroupId };
}

function group(
  id: string,
  es: string,
  en: string,
  itemCount: number
): ProductGroup {
  return { id, name: { es, en }, itemCount };
}
