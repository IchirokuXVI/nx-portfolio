import {
  SettlementOutcome,
  TripKind,
  TripRowOutcome,
  type TripRowView,
  type TripView,
} from '@portfolio/luna-shopper/contracts';
import type { TripLineRow, TripRow } from './trips.sql';

/** One raw trip head, with its date serialized and its kind typed. */
export function toTripView(row: TripRow): TripView {
  return {
    id: row.id,
    kind: row.kind === TripKind.BASKET ? TripKind.BASKET : TripKind.SESSION,
    name: row.name,
    live: row.live,
    startedAt: new Date(row.startedAt).toISOString(),
    lineCount: Number(row.lineCount),
    boughtLineCount: Number(row.boughtLineCount),
  };
}

/**
 * What a trip did to one zone line (plan 0122, section 4).
 *
 * ## A basket row
 *
 * `left` is `max(0, asked - bought)`: buying more than was asked leaves nothing,
 * not a negative amount. The outcome is read in this order:
 *
 * | Outcome         | When                                                     |
 * | --------------- | -------------------------------------------------------- |
 * | `NOT_AVAILABLE` | the latest standing settlement says so, and something is |
 * |                 | left or nothing was bought                               |
 * | `BOUGHT`        | something was bought and nothing is left                 |
 * | `PARTLY`        | something was bought and something is left               |
 * | `NOT_BOUGHT`    | nothing was bought                                       |
 *
 * So "they had none" after a partial purchase reads `NOT_AVAILABLE`, which is
 * the newer and the more useful of the two facts, and a line bought all the way
 * through reads `BOUGHT` whatever was said before the last unit went in.
 *
 * ## A session row
 *
 * It asked for nothing, so `asked` and `left` are null and the outcome is the
 * latest settlement's own: `BOUGHT` or `NOT_AVAILABLE`.
 *
 * `TRIPS_CTE` counts `boughtLineCount` by the same two rules. Change one and
 * change the other.
 */
export function toTripRowView(kind: TripKind, row: TripLineRow): TripRowView {
  const bought = Number(row.bought);
  const notAvailable = row.lastOutcome === SettlementOutcome.NOT_AVAILABLE;

  if (kind === TripKind.SESSION) {
    return {
      lineId: row.lineId,
      asked: null,
      bought,
      left: null,
      outcome: notAvailable
        ? TripRowOutcome.NOT_AVAILABLE
        : TripRowOutcome.BOUGHT,
      settledByUserId: row.settledByUserId ?? null,
    };
  }

  const asked = Number(row.asked ?? 0);
  const left = Math.max(0, asked - bought);
  return {
    lineId: row.lineId,
    asked,
    bought,
    left,
    outcome: basketOutcome(bought, left, notAvailable),
    settledByUserId: null,
  };
}

function basketOutcome(
  bought: number,
  left: number,
  notAvailable: boolean
): TripRowOutcome {
  if (notAvailable && (left > 0 || bought === 0)) {
    return TripRowOutcome.NOT_AVAILABLE;
  }
  if (bought > 0) {
    return left === 0 ? TripRowOutcome.BOUGHT : TripRowOutcome.PARTLY;
  }
  return TripRowOutcome.NOT_BOUGHT;
}
