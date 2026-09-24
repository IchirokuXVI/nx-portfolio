import {
  BasketRowUsualState,
  type BasketRowUsualView,
  type BasketRowView,
} from '@portfolio/luna-shopper/contracts';
import type { UsualWindowRow } from './basket-usual.sql';

/**
 * Where a row is usually bought (plan 0165, section 1).
 *
 * Pure functions over the per line windows {@link USUAL_WINDOWS_SQL} counts, so
 * the states and the rounding are tested without a database. The query decides
 * what a window holds; this decides what a row says about it.
 */

/** One line's window: how many purchases, how many here, how many named a chain. */
export type LineWindow = Pick<UsualWindowRow, 'of' | 'bought' | 'named'>;

/**
 * The row's answer, from the windows of its lines.
 *
 * A line with an empty window, or none at all, does not enter anything: the
 * averages are over the lines that were bought, as section 3 of the plan reads
 * the user's "go with the average", and the user confirmed it.
 *
 * | Condition                                     | State           |
 * | --------------------------------------------- | --------------- |
 * | no line of the row has a purchase             | `NEVER_BOUGHT`  |
 * | no purchase in any window names a chain       | `NO_SHOP_KNOWN` |
 * | some purchase names a chain, none this one    | `ELSEWHERE`     |
 * | at least one purchase names this chain        | `HERE`          |
 *
 * `bought` and `of` are the averages rounded half up, and `bought` is at least
 * 1 whenever its average is above 0, so a row bought here once in eighteen
 * purchases across three lines still says so.
 */
export function usualOf(windows: readonly LineWindow[]): BasketRowUsualView {
  const bought = windows.filter((window) => window.of > 0);
  if (bought.length === 0) {
    return { state: BasketRowUsualState.NEVER_BOUGHT, bought: 0, of: 0 };
  }
  const lines = bought.length;
  const of = roundHalfUp(sum(bought, 'of'), lines);
  const named = sum(bought, 'named');
  const here = sum(bought, 'bought');
  if (named === 0) {
    return { state: BasketRowUsualState.NO_SHOP_KNOWN, bought: 0, of };
  }
  if (here === 0) {
    return { state: BasketRowUsualState.ELSEWHERE, bought: 0, of };
  }
  return {
    state: BasketRowUsualState.HERE,
    bought: Math.max(1, roundHalfUp(here, lines)),
    of,
  };
}

/**
 * `total / count`, rounded half up, in integers.
 *
 * Integer arithmetic rather than `Math.round(total / count)`, so that a half is
 * a half whatever the division does to it in floating point.
 */
export function roundHalfUp(total: number, count: number): number {
  return Math.floor((2 * total + count) / (2 * count));
}

/**
 * Every row with its `usual`, from the windows the query answered (plan 0165,
 * section 2).
 *
 * A row's lines are its entries. A removed row (plan 0138) holds no entries,
 * so its lines are passed in by row key: it is still a row the reader sees, and
 * it answers from the lines it was.
 */
export function withUsual(
  rows: readonly BasketRowView[],
  windows: readonly UsualWindowRow[],
  removedLineIds: ReadonlyMap<string, readonly string[]> = new Map()
): BasketRowView[] {
  const byLine = new Map(windows.map((window) => [window.lineId, window]));
  return rows.map((row) => {
    const lineIds = lineIdsOf(row, removedLineIds);
    return {
      ...row,
      usual: usualOf(
        lineIds.flatMap((lineId) => {
          const window = byLine.get(lineId);
          return window ? [window] : [];
        })
      ),
    };
  });
}

/** The line ids behind every row, deduplicated, for the one query. */
export function usualLineIdsOf(
  rows: readonly BasketRowView[],
  removedLineIds: ReadonlyMap<string, readonly string[]> = new Map()
): string[] {
  return [...new Set(rows.flatMap((row) => lineIdsOf(row, removedLineIds)))];
}

function lineIdsOf(
  row: BasketRowView,
  removedLineIds: ReadonlyMap<string, readonly string[]>
): readonly string[] {
  return row.entries.length > 0
    ? row.entries.map((entry) => entry.lineId)
    : (removedLineIds.get(row.rowKey) ?? []);
}

function sum(windows: readonly LineWindow[], key: keyof LineWindow): number {
  return windows.reduce((total, window) => total + window[key], 0);
}
