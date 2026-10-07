import { canDeleteLine, lastListId } from './catalog-holdings';
import type { ListPermission } from './enums';

/**
 * One line that this visit to the catalog put a product on (velista `0134`,
 * section 4.4).
 *
 * It holds what is needed to undo the add and no more: the line, and what that
 * line was before the visit touched it. One entry for each line, because a list
 * can hold a product on several lines and each has its own quantity.
 */
export interface VisitAddition {
  readonly listId: string;
  readonly itemId: string;
  /** The line the visit raised: a new one, or one that was there before. */
  readonly lineId: string;
  /** What the line says, which is the product's name when the visit made it. */
  readonly name: string;
  /** The product's detail as the row drew it, for the sheet. */
  readonly detail: string | null;
  /** How many the line holds now. */
  readonly quantity: number;
  /** How many it held before this visit. Zero when the visit made the line. */
  readonly before: number;
  /** Whether the visit made the line, rather than raising one that was there. */
  readonly created: boolean;
  /** Whether the line waits for approval (section 4.4). */
  readonly pending: boolean;
}

/** Everything one visit added, in the order it was added. */
export type CatalogVisit = readonly VisitAddition[];

/** What a write answered about a line. */
export interface VisitLineState {
  readonly lineId: string;
  readonly name: string;
  readonly quantity: number;
  readonly pending: boolean;
}

/** The product a write was for, as the record keeps it. */
export interface VisitProduct {
  readonly listId: string;
  readonly itemId: string;
  readonly detail: string | null;
}

/** The entry for a line, or null when the visit did not raise it. */
export function visitAddition(
  visit: CatalogVisit,
  lineId: string
): VisitAddition | null {
  return visit.find((entry) => entry.lineId === lineId) ?? null;
}

/**
 * The visit after an add was answered.
 *
 * The first add onto a line writes the entry, and what the line held before is
 * worked out from the answer: a merge raised a line by `added`, so the line held
 * that much less. Every later answer for the same line moves the quantity and
 * leaves `before` and `created` alone, because those are about the moment before
 * the visit.
 */
export function visitAfterAdd(
  visit: CatalogVisit,
  product: VisitProduct,
  line: VisitLineState,
  merged: boolean,
  added = 1
): CatalogVisit {
  if (visitAddition(visit, line.lineId) !== null) {
    return withLine(visit, line);
  }
  return [
    ...visit,
    {
      ...product,
      lineId: line.lineId,
      name: line.name,
      quantity: line.quantity,
      before: merged ? Math.max(0, line.quantity - added) : 0,
      created: !merged,
      pending: line.pending,
    },
  ];
}

/**
 * The visit after a stepper moved a line from `was` to what `line` says.
 *
 * - A line the visit already raised moves, and leaves the record when it is back
 *   at what it held before, or under it: the visit then added nothing to it.
 * - A line the visit had not touched joins the record when it went up. It was
 *   there before, so taking it back lowers it and never deletes it.
 * - A line that only went down is not something the visit added.
 */
export function visitAfterStep(
  visit: CatalogVisit,
  product: VisitProduct,
  line: VisitLineState,
  was: number
): CatalogVisit {
  const held = visitAddition(visit, line.lineId);
  if (held !== null) {
    return line.quantity > held.before
      ? withLine(visit, line)
      : visitWithout(visit, line.lineId);
  }
  if (line.quantity <= was) {
    return visit;
  }
  return [
    ...visit,
    {
      ...product,
      lineId: line.lineId,
      name: line.name,
      quantity: line.quantity,
      before: was,
      created: false,
      pending: line.pending,
    },
  ];
}

/** The visit without one line. */
export function visitWithout(
  visit: CatalogVisit,
  lineId: string
): CatalogVisit {
  return visit.filter((entry) => entry.lineId !== lineId);
}

/**
 * The lowest quantity the sheet's stepper shows: one more than the line held
 * before the visit. A minus pressed there takes the product back.
 */
export function visitFloor(entry: VisitAddition): number {
  return entry.before + 1;
}

/** What the record needs to know about the list of an entry. */
export interface VisitList {
  readonly permissions: readonly ListPermission[];
  readonly autoApproveLines: boolean;
}

/**
 * How to take one line back (section 4.4): **undo what the visit did, and no
 * more.**
 *
 * - A line the visit made is deleted.
 * - A line that was there before goes back to the quantity it had. That is a
 *   signed change and not an absolute write, so what somebody else added to the
 *   line in the meantime stays.
 *
 * Whether the person may delete is the server's rule ({@link canDeleteLine}).
 * Without it the line the visit made is lowered to nothing, which a list draws as
 * stocked.
 */
export type VisitTakeBack =
  | { readonly kind: 'delete'; readonly lineId: string }
  | { readonly kind: 'lower'; readonly lineId: string; readonly by: number };

export function visitTakeBack(
  entry: VisitAddition,
  list: VisitList
): VisitTakeBack {
  if (
    entry.created &&
    canDeleteLine(list.permissions, list.autoApproveLines, entry.pending)
  ) {
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
export interface AddTargetList extends VisitList {
  readonly listId: string;
  readonly zoneId: string;
  readonly name: string;
  /** The group's name. The UI word for a zone is "group". */
  readonly zoneName: string;
  /** Lines the list still wants. */
  readonly wanted: number;
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
  const lastId = lastListId(lastList);
  return lists.find((list) => list.listId === lastId) ?? lists[0] ?? null;
}

/** Whether a URL is the catalog tab or a page under it, whatever the mount. */
export function isCatalogUrl(url: string): boolean {
  const path = url.split('#')[0]?.split('?')[0] ?? '';
  return path.split('/').includes('catalog');
}

function withLine(visit: CatalogVisit, line: VisitLineState): CatalogVisit {
  return visit.map((entry) =>
    entry.lineId === line.lineId
      ? {
          ...entry,
          name: line.name,
          quantity: line.quantity,
          pending: line.pending,
        }
      : entry
  );
}
