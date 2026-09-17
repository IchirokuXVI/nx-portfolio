import { foldForSearch } from './basket-search';
import {
  composeListView,
  pickedListCategory,
  type ListCategoryPick,
  type ListViewContext,
  type ListViewLine,
  type ListViewState,
} from './compose-list-view';
import { tripKey, type Trip, type TripRow } from './trips';

/**
 * The zone list drawn as groups (velista `0088`, sections 2 to 7).
 *
 * To buy first, then the live trips, then the past trips, each one a fold. Pure, like
 * `composeListView`, which it calls for every narrowing and ordering it does, so the
 * search, A to Z and the category mean the same thing inside a trip as in To buy.
 */

/** The facts about a line the groups are decided from. */
export interface GroupLineFacts {
  readonly quantity: number;
  readonly boughtCount: number;
  /** A live basket holds the line with units outstanding. */
  readonly claimed: boolean;
  readonly rejected: boolean;
}

export interface ListGroupsInput<T extends ListViewLine> {
  /** Every line's row, in list order with rejected lines last. */
  readonly lines: readonly T[];
  readonly factsOf: (lineId: string) => GroupLineFacts | null;
  /** Live trips, newest first. */
  readonly live: readonly Trip[];
  /** Ended trips paged in so far, newest first. */
  readonly past: readonly Trip[];
  /** One trip's rows, or undefined until they arrive. */
  readonly rowsOf: (key: string) => readonly TripRow[] | undefined;
  /** The keys of the trips somebody has open. */
  readonly openKeys: ReadonlySet<string>;
  readonly reordering: boolean;
  /**
   * The ids of the lines the list suggests, in the server's order (velista `0089`).
   * Absent or empty draws no due line.
   */
  readonly dueLineIds?: readonly string[];
}

/** One trip row joined to the line it is about. */
export interface JoinedTripRow<T extends ListViewLine> {
  readonly row: TripRow;
  readonly line: T;
}

export interface TripGroup<T extends ListViewLine> {
  readonly key: string;
  readonly trip: Trip;
  readonly open: boolean;
  /** Null until the rows arrive, which the group draws as skeleton rows. */
  readonly rows: readonly JoinedTripRow<T>[] | null;
}

export type ListGroupsView<T extends ListViewLine> =
  | {
      /** A search is active: every matching line once, with no group (section 6). */
      readonly kind: 'flat';
      readonly lines: readonly T[];
      readonly category: ListCategoryPick | null;
    }
  | {
      readonly kind: 'groups';
      readonly toBuy: readonly T[];
      /**
       * How many rows at the start of `toBuy` are wanted lines. The due lines are drawn
       * after them and before the lines at zero (velista `0089`, section 2).
       */
      readonly wantedCount: number;
      /** The due lines to draw, in the server's order. Empty in reorder mode. */
      readonly due: readonly T[];
      readonly category: ListCategoryPick | null;
      readonly trips: readonly TripGroup<T>[];
    };

/**
 * The page, as groups or as one flat search.
 *
 * ## What goes in To buy (section 3)
 *
 * Every wanted line no live trip draws, in list order, then the lines at zero that were
 * never bought, then the rejected lines of either kind. A claimed line leaves To buy
 * only once a live trip's rows that name it have arrived, so no line is ever on neither
 * side. A line at zero with purchases is in no live group: it lives in its trips.
 *
 * ## Reorder mode (section 7)
 *
 * To buy alone, without the lines at zero and without any trip.
 *
 * ## The due lines (velista `0089`, section 2)
 *
 * The lines the list suggests, in the server's order, kept only while the line is held,
 * is at zero, is not rejected and is not claimed. A line raised above zero leaves at
 * once, which is what makes an add feel instant. A category keeps only the due lines in
 * it. None in reorder mode, and none during a search, which is flat.
 */
export function composeListGroups<T extends ListViewLine>(
  input: ListGroupsInput<T>,
  state: ListViewState,
  context: ListViewContext
): ListGroupsView<T> {
  const category = pickedListCategory(state);

  if (foldForSearch(context.query) !== '') {
    const flat = composeListView(input.lines, state, context);
    return { kind: 'flat', lines: flat.lines, category: flat.category };
  }

  const unsearched: ListViewContext = { ...context, query: '' };
  const narrow = (lines: readonly T[]) =>
    composeListView(lines, state, unsearched).lines;

  const heldByLive = new Set<string>();
  for (const trip of input.live) {
    for (const row of input.rowsOf(tripKey(trip)) ?? []) {
      heldByLive.add(row.lineId);
    }
  }

  const wanted: T[] = [];
  const neverBought: T[] = [];
  const rejected: T[] = [];
  for (const line of input.lines) {
    const facts = input.factsOf(line.id);
    // A row the store cannot describe stays reachable in To buy.
    if (facts === null) {
      wanted.push(line);
      continue;
    }

    const isWanted =
      facts.quantity > 0 && !(facts.claimed && heldByLive.has(line.id));
    const isNeverBought = facts.quantity === 0 && facts.boughtCount === 0;
    if (!isWanted && !isNeverBought) {
      continue;
    }

    if (input.reordering) {
      if (isWanted) {
        wanted.push(line);
      }
    } else if (facts.rejected) {
      rejected.push(line);
    } else if (isWanted) {
      wanted.push(line);
    } else {
      neverBought.push(line);
    }
  }

  const narrowedWanted = narrow(wanted);
  const toBuy = input.reordering
    ? narrowedWanted
    : [...narrowedWanted, ...narrow(neverBought), ...narrow(rejected)];

  if (input.reordering) {
    return {
      kind: 'groups',
      toBuy,
      wantedCount: narrowedWanted.length,
      due: [],
      category,
      trips: [],
    };
  }

  const due = dueLinesOf(input, narrow);

  const byId = new Map(input.lines.map((line) => [line.id, line]));
  const trips: TripGroup<T>[] = [];

  for (const trip of [...input.live, ...input.past]) {
    const key = tripKey(trip);
    const held = input.rowsOf(key);

    if (held === undefined) {
      trips.push({ key, trip, open: input.openKeys.has(key), rows: null });
      continue;
    }

    // A row whose line is not held is not drawn (section 5).
    const rowByLine = new Map<string, TripRow>();
    const lines: T[] = [];
    for (const row of held) {
      const line = byId.get(row.lineId);
      if (line !== undefined && !rowByLine.has(row.lineId)) {
        rowByLine.set(row.lineId, row);
        lines.push(line);
      }
    }

    const rows = narrow(lines).map((line) => ({
      row: rowByLine.get(line.id) as TripRow,
      line,
    }));

    // A category leaves out a trip with no row in it (section 6).
    if (category !== null && rows.length === 0) {
      continue;
    }

    trips.push({ key, trip, open: input.openKeys.has(key), rows });
  }

  return {
    kind: 'groups',
    toBuy,
    wantedCount: narrowedWanted.length,
    due,
    category,
    trips,
  };
}

/** The due lines still worth offering, narrowed by the view, in the server's order. */
function dueLinesOf<T extends ListViewLine>(
  input: ListGroupsInput<T>,
  narrow: (lines: readonly T[]) => readonly T[]
): readonly T[] {
  const ids = input.dueLineIds ?? [];
  if (ids.length === 0) {
    return [];
  }

  const byId = new Map(input.lines.map((line) => [line.id, line]));
  const offered: T[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const line = byId.get(id);
    const facts = input.factsOf(id);
    if (
      line === undefined ||
      facts === null ||
      seen.has(id) ||
      facts.quantity > 0 ||
      facts.rejected ||
      facts.claimed
    ) {
      continue;
    }
    seen.add(id);
    offered.push(line);
  }

  // The view decides membership only. The order stays the server's, most due first.
  const kept = new Set(narrow(offered).map((line) => line.id));
  return offered.filter((line) => kept.has(line.id));
}

/**
 * The whole order to send after a line moved inside To buy (section 7).
 *
 * The lines To buy shows take, in their new order, the slots they held among all the
 * list's lines, and every other line keeps its slot. So nothing hidden from the person
 * moves. Null when the move changes nothing or the two lists disagree.
 *
 * `visibleIds` must be in the same relative order as `allIds`, which To buy in list
 * order is.
 */
export function reorderWithinSlots(
  allIds: readonly string[],
  visibleIds: readonly string[],
  lineId: string,
  to: number
): readonly string[] | null {
  const from = visibleIds.indexOf(lineId);
  if (from < 0 || to < 0 || to >= visibleIds.length || to === from) {
    return null;
  }

  const visible = new Set(visibleIds);
  if (allIds.filter((id) => visible.has(id)).length !== visibleIds.length) {
    return null;
  }

  const moved = [...visibleIds];
  moved.splice(from, 1);
  moved.splice(to, 0, lineId);

  let next = 0;
  return allIds.map((id) => (visible.has(id) ? moved[next++] : id));
}
