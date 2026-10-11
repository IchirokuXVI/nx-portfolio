import {
  catalogName,
  inLocale,
  LINE_ITEM_SET_MAX,
  type CatalogItem,
  type Line,
  type LineProductCounterVm,
  type LineProductSource,
  type ProductGroup,
} from '@portfolio/velista/models';
import { productDetailText } from '@portfolio/velista/ui';

/**
 * From how many products the page says the count against the cap (velista `0135`,
 * section 3). Under it the number is noise on a page about two or three products.
 */
export const PRODUCTS_COUNTER_FROM = 90;

/** One product of the line, as a row of the products page. */
export interface LineProductRowVm {
  readonly itemId: string;
  /** Null while the catalog has not named it, which draws "Unnamed product". */
  readonly name: string | null;
  readonly detail: string | null;
  readonly imageUrl: string | null;
  readonly source: LineProductSource;
  /** `Keep`: only on a product the catalog put there (velista plan 0065, section 4). */
  readonly adoptable: boolean;
  readonly favorite: boolean;
}

/** One labelled run of rows (velista plan 0065, section 2). */
export interface LineProductGroupVm {
  readonly source: LineProductSource;
  /** Null for the one run of a line that follows no group, which has no heading. */
  readonly headingKey: string | null;
  readonly headingArgs: Readonly<Record<string, string>>;
  readonly rows: readonly LineProductRowVm[];
}

export interface LineProductsVm {
  readonly content: string;
  readonly groups: readonly LineProductGroupVm[];
  readonly empty: boolean;
  /** Null under {@link PRODUCTS_COUNTER_FROM} products. */
  readonly counter: LineProductCounterVm | null;
  readonly namesUnavailable: boolean;
  readonly canEdit: boolean;
}

export interface LineProductsInput {
  readonly line: Line | undefined;
  readonly itemNameOf: (itemId: string) => CatalogItem | null;
  readonly namesUnavailable: boolean;
  /** What the group this line follows is called, or null (velista plan 0065, 2.1). */
  readonly groupNameOf: (groupId: string) => ProductGroup | null;
  readonly locale: string;
  readonly canEdit: boolean;
  readonly translate: (key: string, args?: Record<string, unknown>) => string;
}

/**
 * What the products page of a line draws (velista `0135`, section 3).
 *
 * The clusters of plan `0065` are its headings: "From {group}" for what the
 * catalog put there, and "Added by you" for the rest. **A line that follows no
 * group has one run and no heading**, because there is nothing to tell apart.
 * An empty cluster is left out, never drawn empty.
 */
export function selectLineProducts(
  input: LineProductsInput
): LineProductsVm | null {
  const { line } = input;
  if (line === undefined) {
    return null;
  }

  const fromGroup = new Set(line.groupItemIds);
  const rows: LineProductRowVm[] = line.itemIds.map((itemId) => {
    const item = input.itemNameOf(itemId);
    const source: LineProductSource = fromGroup.has(itemId) ? 'group' : 'user';
    return {
      itemId,
      name: item === null ? null : catalogName(item.name, input.locale),
      detail:
        item === null
          ? null
          : productDetailText(item, input.locale, input.translate),
      imageUrl: item?.imageUrl ?? null,
      source,
      adoptable: source === 'group' && input.canEdit,
      favorite: line.favoriteItemId === itemId,
    };
  });

  return {
    content: line.content,
    groups: groupsOf(rows, line.productGroupId, input),
    empty: rows.length === 0,
    counter:
      rows.length < PRODUCTS_COUNTER_FROM
        ? null
        : {
            count: rows.length,
            cap: LINE_ITEM_SET_MAX,
            // Neither number is clamped: `104/100` is a state the catalog's own
            // sync produces (backend plan 0070, section 7.2).
            overCap: rows.length > LINE_ITEM_SET_MAX,
          },
    namesUnavailable: input.namesUnavailable && rows.length > 0,
    canEdit: input.canEdit,
  };
}

function groupsOf(
  rows: readonly LineProductRowVm[],
  productGroupId: string | null,
  input: Pick<LineProductsInput, 'groupNameOf' | 'locale'>
): readonly LineProductGroupVm[] {
  if (rows.length === 0) {
    return [];
  }
  if (productGroupId === null) {
    return [{ source: 'user', headingKey: null, headingArgs: {}, rows }];
  }

  const group = input.groupNameOf(productGroupId);
  const name = group === null ? '' : inLocale(group.name, input.locale);

  const groups: LineProductGroupVm[] = [
    {
      source: 'group',
      // Two keys, never one key with an empty argument: a group whose name did
      // not resolve is owed "From a group" and never "From ".
      headingKey:
        name === '' ? 'list.products.fromGroupUnnamed' : 'list.products.fromGroup',
      headingArgs: name === '' ? {} : { name },
      rows: rows.filter((row) => row.source === 'group'),
    },
    {
      source: 'user',
      headingKey: 'list.products.addedByYou',
      headingArgs: {},
      rows: rows.filter((row) => row.source === 'user'),
    },
  ];

  return groups.filter((cluster) => cluster.rows.length > 0);
}
