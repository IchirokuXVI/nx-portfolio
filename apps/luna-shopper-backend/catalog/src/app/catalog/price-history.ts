import { PRICE_HISTORY_LIMITS } from '@portfolio/luna-shopper/contracts';
import {
  resolveEffectivePrice,
  toNumber,
  type PolicyRow,
  type PriceRow,
} from './effective-price';

/**
 * The part of an `item_prices` row the replay reads: what the price rule
 * reads, the instant the row began at, and what a point shows.
 */
export interface HistoryPriceRow extends PriceRow {
  /** The first time the source stated this number. */
  observedAt: Date;
  currency: string | null;
  unitPriceLabel: string | null;
}

export interface PriceHistoryInput {
  /**
   * Every row of the product at the scope being read and at each scope it
   * falls through to, with `observedAt` no later than {@link to}. Old rows
   * included: the replay needs the row that was current on each day, and
   * that is not the row that is current now.
   */
  rows: readonly HistoryPriceRow[];
  /** The scope being read. The most specific of the set. */
  priceScopeId: string;
  /** Each scope id in {@link rows} against its priority, as the price rule takes it. */
  scopePriorities?: ReadonlyMap<string, number>;
  policies: readonly PolicyRow[];
  from: Date;
  to: Date;
  /** How many points to keep. Defaults to the limit of the contract. */
  maxPoints?: number;
}

/** What was shown from `at` until the next point. */
export interface PriceHistoryPoint {
  at: Date;
  /** Null when nothing was shown. */
  price: number | null;
  currency: string | null;
  unitPrice: number | null;
  unitPriceLabel: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The price a shopper saw at one scope over a range of time (plan 0196,
 * section 2), as a pure function of the stored rows, the policies and the
 * range.
 *
 * **The rule is replayed and not approximated.** A history read from one
 * source would be wrong on each day that another source won: a leaflet inside
 * its window, a hand correction inside its protection, a narrower scope that
 * started later. So this asks {@link resolveEffectivePrice} the same question
 * the materialized row answers, one time for each instant at which the answer
 * can change:
 *
 * 1. The instants are, for each row: `observedAt`, `validFrom`, `validUntil`,
 *    `protectedUntil`, and `lastObservedAt` plus the max age of its kind.
 *    Those inside the range are kept, with `from` itself.
 * 2. At an instant `t`, the current row of a scope and kind is the one with
 *    the newest `observedAt` that is not after `t`.
 * 3. Each current row is handed over with `lastObservedAt` no later than `t`,
 *    because at `t` nobody had seen it later than that.
 * 4. The row that the rule answers is the point, fresh or stale. No row is a
 *    point with a null price.
 *
 * The first point is at `from`. A later point exists only where the price,
 * the currency, the unit price or the label changed.
 *
 * ## What the replay cannot know
 *
 * - **The policies and the priorities are those of today**, not of the day.
 *   A kind that was disabled last month is replayed as it is set now.
 * - **A row counts as seen all through, from `observedAt` to
 *   `lastObservedAt`.** The table keeps the first and the last sighting of a
 *   number and nothing between them. A source that went quiet for longer than
 *   its max age and then repeated the same price leaves no trace of the gap.
 * - **The stock of a shop is not replayed.** `available` lives on the
 *   materialized row and has no history, so a product that a shop stopped
 *   stocking for a while still shows its price for that while.
 *
 * Each one makes the history a little smoother than what a shopper saw. None
 * of them invents a price: every number of every point is a number that a
 * source stated for this product at a scope of this stack.
 */
export function priceHistory(input: PriceHistoryInput): PriceHistoryPoint[] {
  const from = input.from.getTime();
  const to = input.to.getTime();
  const policies = new Map(input.policies.map((p) => [p.sourceKind, p]));

  // The rows of each scope and kind, oldest first, so the current row at an
  // instant is the last one that began at or before it. The id breaks a tie
  // of `observedAt`, as the `DISTINCT ON` of the current rows does.
  const byKey = new Map<string, HistoryPriceRow[]>();
  for (const row of input.rows) {
    const key = `${row.priceScopeId}\n${row.sourceKind}`;
    const held = byKey.get(key);
    if (held) {
      held.push(row);
    } else {
      byKey.set(key, [row]);
    }
  }
  for (const rows of byKey.values()) {
    rows.sort(
      (a, b) =>
        a.observedAt.getTime() - b.observedAt.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
  }

  const instants = new Set<number>([from]);
  const consider = (time: number | null | undefined) => {
    if (time !== null && time !== undefined && time > from && time <= to) {
      instants.add(time);
    }
  };
  for (const row of input.rows) {
    consider(row.observedAt.getTime());
    consider(row.validFrom?.getTime());
    consider(row.validUntil?.getTime());
    consider(row.protectedUntil?.getTime());
    const maxAgeDays = policies.get(row.sourceKind)?.maxAgeDays;
    if (maxAgeDays !== null && maxAgeDays !== undefined) {
      consider(row.lastObservedAt.getTime() + maxAgeDays * DAY_MS);
    }
  }

  const points: PriceHistoryPoint[] = [];
  for (const t of [...instants].sort((a, b) => a - b)) {
    const current: HistoryPriceRow[] = [];
    for (const rows of byKey.values()) {
      const row = currentAt(rows, t);
      if (row) {
        // A copy, so the stored row keeps its real last sighting for the
        // instants after this one.
        current.push(
          row.lastObservedAt.getTime() > t
            ? { ...row, lastObservedAt: new Date(t) }
            : row
        );
      }
    }
    const shown = resolveEffectivePrice({
      rows: current,
      priceScopeId: input.priceScopeId,
      scopePriorities: input.scopePriorities,
      policies: input.policies,
      now: new Date(t),
    }).row as HistoryPriceRow | null;
    const point: PriceHistoryPoint = {
      at: new Date(t),
      price: toNumber(shown?.price),
      currency: shown?.currency ?? null,
      unitPrice: toNumber(shown?.unitPrice),
      unitPriceLabel: shown?.unitPriceLabel ?? null,
    };
    const last = points[points.length - 1];
    if (!last || !showsTheSame(last, point)) {
      points.push(point);
    }
  }

  // The oldest go. The first point kept is not moved back to `from`: it
  // stays at the instant it really starts at.
  const maxPoints = input.maxPoints ?? PRICE_HISTORY_LIMITS.maxPoints;
  return points.length > maxPoints ? points.slice(-maxPoints) : points;
}

/** The last row that began at or before `t`, in a list sorted oldest first. */
function currentAt(
  rows: readonly HistoryPriceRow[],
  t: number
): HistoryPriceRow | null {
  let found: HistoryPriceRow | null = null;
  for (const row of rows) {
    if (row.observedAt.getTime() > t) {
      break;
    }
    found = row;
  }
  return found;
}

/** Whether two points show a shopper the same thing. */
function showsTheSame(a: PriceHistoryPoint, b: PriceHistoryPoint): boolean {
  return (
    a.price === b.price &&
    a.currency === b.currency &&
    a.unitPrice === b.unitPrice &&
    a.unitPriceLabel === b.unitPriceLabel
  );
}
