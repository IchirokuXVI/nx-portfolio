import {
  BasketRowMark,
  BasketRowState,
  SettlementOutcome,
  type BasketRowView,
} from '@portfolio/luna-shopper/contracts';
import type { BasketSettlementRow } from '../basket-read.sql';
import type { RemovedGroup } from './basket-marks.reader';

/**
 * A row for something that was taken off the basket (plan 0138, section 7).
 *
 * The redesign asks that a removed line stays visible, disabled, for a while,
 * rather than vanishing under a thumb that was about to tap it. This is that row.
 *
 * ## It is not a thing to buy, and says so in four ways
 *
 * `left` is zero, it holds **no entries**, its state and its mark are both
 * `REMOVED`, and `progressOf` counts neither it nor its absence. Every write
 * addressed to it is refused by the resolver of plan 0136 as it stands, because
 * its anchor is outside the coverage: the row is a fact about the past, and the
 * client draws it disabled.
 *
 * ## What it keeps is the purchases
 *
 * `bought` is what this basket bought of the lines that went, which survives the
 * deletion on `line_settlements` (plan 0132). Somebody who bought two of a thing
 * and then had it taken off their list is still owed the record of buying it, and
 * a row showing zero would read as "nothing happened here".
 *
 * A free function rather than a method, for the reason the rest of `basket-rows`
 * is: it is a rule, and a spec can state it against two arrays.
 */
export function removedRows(
  removed: readonly RemovedGroup[],
  settlements: readonly BasketSettlementRow[]
): BasketRowView[] {
  if (removed.length === 0) {
    return [];
  }
  const byLine = new Map<string, BasketSettlementRow[]>();
  for (const row of settlements) {
    const held = byLine.get(row.lineId);
    if (held) {
      held.push(row);
    } else {
      byLine.set(row.lineId, [row]);
    }
  }

  return removed.map((group) => {
    const rows = group.lineIds.flatMap((lineId) => byLine.get(lineId) ?? []);
    const bought = rows
      .filter((row) => row.outcome === SettlementOutcome.BOUGHT)
      .reduce((sum, row) => sum + row.quantity, 0);
    // The newest act on the row, which is the same answer an ordinary row gives
    // to the same question (plan 0137, section 4): a removed row that was bought
    // still says who bought it and when.
    const newest = rows.reduce<BasketSettlementRow | null>((held, row) => {
      if (!held) {
        return row;
      }
      const a = at(row);
      const b = at(held);
      return a > b || (a === b && row.id > held.id) ? row : held;
    }, null);

    return {
      rowKey: group.rowKey,
      content: group.content,
      left: 0,
      bought,
      asked: bought,
      state: BasketRowState.REMOVED,
      note: null,
      noteAt: null,
      mark: BasketRowMark.REMOVED,
      awaitingApproval: false,
      optionIds: [],
      touchedBy: newest?.settledByParticipantId ?? null,
      touchedAt: newest ? new Date(newest.settledAt).toISOString() : null,
      entries: [],
      // Filled by the read when it has a chain (plan 0165), from the lines
      // that went, and null otherwise.
      usual: null,
    };
  });
}

/** `pg` hands a `timestamptz` back as a `Date`; a driver that hands a string would throw. */
function at(row: BasketSettlementRow): number {
  return row.settledAt instanceof Date
    ? row.settledAt.getTime()
    : new Date(row.settledAt).getTime();
}
