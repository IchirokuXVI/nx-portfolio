import type { ListPermission } from './enums';

/**
 * One product that this visit to the catalog put on a list (velista `0134`,
 * section 4.4).
 *
 * It holds what is needed to undo the add and no more: the line the add answered,
 * and what that line was before the visit touched it.
 */
export interface VisitAddition {
  readonly listId: string;
  readonly itemId: string;
  /** The line the add answered: a new one, or the one it merged into. */
  readonly lineId: string;
  /** The product's name and detail as the row drew them, for the sheet. */
  readonly name: string;
  readonly detail: string | null;
  /** How many the line holds now. */
  readonly quantity: number;
  /** How many it held before this visit. Zero when the visit made the line. */
  readonly before: number;
  /** Whether the add made the line, rather than raising one that was there. */
  readonly created: boolean;
  /** Whether the line waits for approval (section 4.4). */
  readonly pending: boolean;
}

/** Everything one visit added, in the order it was added. */
export type CatalogVisit = readonly VisitAddition[];

/** What an add or a quantity change answered about a line. */
export interface VisitLineState {
  readonly lineId: string;
  readonly quantity: number;
  readonly pending: boolean;
}

/** The entry for a product on a list, or null when the visit did not add it. */
export function visitAddition(
  visit: CatalogVisit,
  listId: string,
  itemId: string
): VisitAddition | null {
  return (
    visit.find((entry) => entry.listId === listId && entry.itemId === itemId) ??
    null
  );
}

/**
 * The visit after an add was answered.
 *
 * The first add of a product to a list writes the entry, and what the line held
 * before is worked out from the answer: a merge raised a line by `added`, so the
 * line held that much less. Every later answer for the same product moves the
 * quantity and leaves `before` and `created` alone, because those are about the
 * moment before the visit.
 */
export function visitAfterAdd(
  visit: CatalogVisit,
  product: {
    readonly listId: string;
    readonly itemId: string;
    readonly name: string;
    readonly detail: string | null;
  },
  line: VisitLineState,
  merged: boolean,
  added = 1
): CatalogVisit {
  const held = visitAddition(visit, product.listId, product.itemId);
  if (held !== null) {
    return visitAfterQuantity(visit, product.listId, product.itemId, line);
  }
  return [
    ...visit,
    {
      ...product,
      lineId: line.lineId,
      quantity: line.quantity,
      before: merged ? Math.max(0, line.quantity - added) : 0,
      created: !merged,
      pending: line.pending,
    },
  ];
}

/** The visit after a line's quantity moved. */
export function visitAfterQuantity(
  visit: CatalogVisit,
  listId: string,
  itemId: string,
  line: VisitLineState
): CatalogVisit {
  return visit.map((entry) =>
    entry.listId === listId && entry.itemId === itemId
      ? {
          ...entry,
          lineId: line.lineId,
          quantity: line.quantity,
          pending: line.pending,
        }
      : entry
  );
}

/** The visit without one product on one list. */
export function visitWithout(
  visit: CatalogVisit,
  listId: string,
  itemId: string
): CatalogVisit {
  return visit.filter(
    (entry) => !(entry.listId === listId && entry.itemId === itemId)
  );
}

/**
 * The lowest quantity the stepper shows: one more than the line held before the
 * visit. A minus pressed there takes the product back.
 */
export function visitFloor(entry: VisitAddition): number {
  return entry.before + 1;
}

/**
 * How to take one product back (section 4.4): **undo what the visit did, and no
 * more.**
 *
 * - A line the visit made is deleted.
 * - A line that was there before goes back to the quantity it had. That is a
 *   signed change and not an absolute write, so what somebody else added to the
 *   line in the meantime stays.
 *
 * `canDelete` is the server's rule, read from the person's permissions: an
 * approved line is deleted only by somebody who manages the list. Without it the
 * line the visit made is lowered to nothing, which a list draws as stocked.
 */
export type VisitTakeBack =
  | { readonly kind: 'delete'; readonly lineId: string }
  | { readonly kind: 'lower'; readonly lineId: string; readonly by: number };

export function visitTakeBack(
  entry: VisitAddition,
  permissions: readonly ListPermission[]
): VisitTakeBack {
  const canDelete =
    permissions.includes('MANAGE') ||
    (entry.pending && permissions.includes('WRITE'));
  if (entry.created && canDelete) {
    return { kind: 'delete', lineId: entry.lineId };
  }
  return {
    kind: 'lower',
    lineId: entry.lineId,
    by: entry.quantity - entry.before,
  };
}

/** One list's part of the sheet of what the visit added. */
export interface VisitSection {
  readonly listId: string;
  readonly entries: readonly VisitAddition[];
}

/**
 * The visit under one heading for each list, the chosen list first and the rest
 * in the order the visit first added to them.
 */
export function visitSections(
  visit: CatalogVisit,
  chosenListId: string | null
): readonly VisitSection[] {
  const sections = new Map<string, VisitAddition[]>();
  for (const entry of visit) {
    const held = sections.get(entry.listId);
    if (held === undefined) {
      sections.set(entry.listId, [entry]);
    } else {
      held.push(entry);
    }
  }
  return [...sections]
    .map(([listId, entries]) => ({ listId, entries }))
    .sort(
      (left, right) =>
        Number(right.listId === chosenListId) -
        Number(left.listId === chosenListId)
    );
}

/** One list a product can be added to, as the sheet of lists draws it. */
export interface AddTargetList {
  readonly listId: string;
  readonly zoneId: string;
  readonly name: string;
  /** The group's name. The UI word for a zone is "group". */
  readonly zoneName: string;
  /** Lines the list still wants. */
  readonly wanted: number;
  readonly permissions: readonly ListPermission[];
}

/**
 * The list the plus adds to when the catalog opens (section 4.2): the last used
 * list if the person can still write to it, else the first list they can write to.
 *
 * `lastList` is what `StorageKeys.lastList` holds, `zoneId/listId`, or null.
 */
export function firstAddTarget(
  lists: readonly AddTargetList[],
  lastList: string | null
): AddTargetList | null {
  const lastId = lastList?.split('/')[1] ?? null;
  return lists.find((list) => list.listId === lastId) ?? lists[0] ?? null;
}

/** Whether a URL is the catalog tab or a page under it, whatever the mount. */
export function isCatalogUrl(url: string): boolean {
  const path = url.split('#')[0]?.split('?')[0] ?? '';
  return path.split('/').includes('catalog');
}
