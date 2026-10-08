import type { ListPermission } from './enums';

/**
 * One line of a list that holds a product, as the catalog knows it (velista `0134`,
 * sections 4.1 and 7).
 *
 * A list can hold one product on several lines: once under the product's own name
 * and again under a name somebody typed ("Coffee for the machine"). Each line has
 * its own quantity, so each is drawn with its own stepper.
 */
export interface HeldLine {
  readonly lineId: string;
  readonly listId: string;
  /** What the line says. */
  readonly name: string;
  readonly quantity: number;
  /** Whether the line waits for approval. */
  readonly pending: boolean;
  /** The products the catalog knows this line holds. */
  readonly itemIds: readonly string[];
}

/** One list the person can read, with what they may do on it. */
export interface ItemList {
  readonly listId: string;
  readonly zoneId: string;
  readonly name: string;
  /** The group's name. The UI word for a zone is "group". */
  readonly zoneName: string;
  readonly autoApproveLines: boolean;
  readonly permissions: readonly ListPermission[];
}

/**
 * Every list the person can read and the lines of them that hold one product
 * (`GET /v1/items/:id/list-lines`, backend `0196`, section 3).
 */
export interface ItemLists {
  readonly lists: readonly ItemList[];
  readonly lines: readonly HeldLine[];
  /** The server cut the answer at its cap of lists. */
  readonly hasMore: boolean;
}

/**
 * Whether the person may change a line's quantity, which is the server's rule for
 * `POST /v1/lines/:id/quantity`: somebody who manages the list always may, an
 * approved line needs `DECIDE`, and a line that still waits needs `WRITE`.
 */
export function canStepLine(
  permissions: readonly ListPermission[],
  pending: boolean
): boolean {
  if (permissions.includes('MANAGE')) {
    return true;
  }
  return permissions.includes(pending ? 'WRITE' : 'DECIDE');
}

/**
 * Whether the person may delete a line, which is the server's rule for
 * `DELETE /v1/lines/:id` (backend `0196`, section 4).
 *
 * Somebody who manages the list always may. A person who can write deletes a line
 * that still waits, and on a list that approves lines by itself they delete an
 * approved one too: there nobody agreed to the line, so nothing is undone behind
 * anybody's back.
 */
export function canDeleteLine(
  permissions: readonly ListPermission[],
  autoApproveLines: boolean,
  pending: boolean
): boolean {
  if (permissions.includes('MANAGE')) {
    return true;
  }
  return permissions.includes('WRITE') && (pending || autoApproveLines);
}

/** The list id out of what `StorageKeys.lastList` holds (`zoneId/listId`), or null. */
export function lastListId(lastList: string | null): string | null {
  return lastList?.split('/')[1] ?? null;
}

/** One held line as a row draws it. */
export interface HoldingRow {
  readonly lineId: string;
  readonly name: string;
  readonly quantity: number;
  /** Whether the person may move its quantity. */
  readonly editable: boolean;
  readonly pending: boolean;
}

/**
 * The lines of one list that hold one product, in the order they were handed
 * over, as rows with a stepper each.
 *
 * A line whose write has not answered yet has no id the server knows, so it is not
 * editable until it does.
 */
export function holdingRows(
  lines: readonly HeldLine[],
  listId: string,
  itemId: string,
  permissions: readonly ListPermission[]
): readonly HoldingRow[] {
  return lines
    .filter((line) => line.listId === listId && line.itemIds.includes(itemId))
    .map((line) => ({
      lineId: line.lineId,
      name: line.name,
      quantity: line.quantity,
      editable:
        !isUnsavedLine(line.lineId) && canStepLine(permissions, line.pending),
      pending: line.pending,
    }));
}

const UNSAVED = 'unsaved:';

/** The id of a line drawn before its add answered. */
export function unsavedLineId(listId: string, itemId: string): string {
  return `${UNSAVED}${listId}/${itemId}`;
}

export function isUnsavedLine(lineId: string): boolean {
  return lineId.startsWith(UNSAVED);
}

/**
 * Whether a line says exactly a product's name, the way a person reads it: the
 * case and the spaces around it do not make another name.
 */
export function sameLineName(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

/**
 * The line an add of this product lands on, among the lines of one list: the one
 * that says exactly the product's name and is still wanted.
 *
 * **A line at zero is not it.** Zero is what a list calls stocked, and the server
 * does not raise a stocked line on an add: it makes a new line beside it. Seen in
 * the walk of stage 2, where a list ended with two lines called "Milk". So with
 * only a stocked line of that name the answer is null, and the add makes a line.
 */
export function addedToLine<T extends { name: string; quantity: number }>(
  lines: readonly T[],
  productName: string
): T | null {
  return (
    lines.find(
      (line) => line.quantity > 0 && sameLineName(line.name, productName)
    ) ?? null
  );
}

/** One list in the product page's table of lists (section 7). */
export interface ProductListRow {
  readonly listId: string;
  readonly name: string;
  /** The list the plus of the catalog adds to today. */
  readonly lastUsed: boolean;
  /** Whether the person can put a line on this list. Without it there is no stepper. */
  readonly canAdd: boolean;
  /**
   * The line that holds this product under exactly the product's name and is
   * still wanted ({@link addedToLine}), or null. The list's own stepper starts at
   * its quantity, and at zero without one.
   */
  readonly main: HoldingRow | null;
  /**
   * Every other line that holds the product, each on its own row: one under
   * another name, and one under the product's name that is stocked.
   */
  readonly others: readonly HoldingRow[];
}

/** The lists of one group. */
export interface ProductListGroup {
  readonly zoneId: string;
  readonly zoneName: string;
  readonly lists: readonly ProductListRow[];
}

/**
 * The table of lists of a product page: every list the person can read, under the
 * name of its group.
 *
 * The group of the last used list comes first, and that list comes first in it.
 * Everything else keeps the order it was read in.
 *
 * `lastList` is what `StorageKeys.lastList` holds, `zoneId/listId`, or null.
 */
export function productListGroups(
  lists: readonly ItemList[],
  lines: readonly HeldLine[],
  itemId: string,
  productName: string,
  lastList: string | null
): readonly ProductListGroup[] {
  const lastId = lastListId(lastList);
  const groups = new Map<
    string,
    { zoneName: string; rows: ProductListRow[] }
  >();

  for (const list of lists) {
    const rows = holdingRows(lines, list.listId, itemId, list.permissions);
    const main = addedToLine(rows, productName);
    const row: ProductListRow = {
      listId: list.listId,
      name: list.name,
      lastUsed: list.listId === lastId,
      canAdd: list.permissions.includes('WRITE'),
      main,
      others: rows.filter((held) => held !== main),
    };
    const group = groups.get(list.zoneId);
    if (group === undefined) {
      groups.set(list.zoneId, { zoneName: list.zoneName, rows: [row] });
    } else {
      group.rows.push(row);
    }
  }

  const first = (flag: boolean): number => (flag ? 0 : 1);
  return [...groups]
    .map(([zoneId, group]) => ({
      zoneId,
      zoneName: group.zoneName,
      lists: [...group.rows].sort(
        (left, right) => first(left.lastUsed) - first(right.lastUsed)
      ),
    }))
    .sort(
      (left, right) =>
        first(left.lists.some((list) => list.lastUsed)) -
        first(right.lists.some((list) => list.lastUsed))
    );
}
