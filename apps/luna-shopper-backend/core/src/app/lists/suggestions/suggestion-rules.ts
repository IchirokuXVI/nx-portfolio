import { continuesPurchaseSession } from '@portfolio/luna-shopper/contracts';
import {
  DAY_MS,
  STAPLE_MIN_TRIPS,
  STAPLE_TRIPS,
  SUGGESTION_MIN_PURCHASES,
  SUGGESTION_WINDOW_SHARE,
} from './suggestions.constants';

/**
 * The two rules that decide whether a line at zero is due again (plan 0123,
 * sections 3 and 4).
 *
 * Pure functions over plain arrays and a `now` the caller passes. Neither reads a
 * clock, so a spec owns every instant it asserts about, and neither names a
 * calendar day, so no server clock or time zone can change an answer.
 */

/** One standing `BOUGHT` settlement of a line: when, how many units, and where. */
export interface Purchase {
  at: Date;
  quantity: number;
  /**
   * The basket it was bought through, or null off the list page.
   *
   * Carried for the quantity rule of plan 0142, section 8.2, and read by
   * nothing else here. Neither rule below looks at it: what a purchase came off
   * changes neither the period nor whether a line is a staple.
   */
  basketId: string | null;
}

/**
 * Several settlements folded into one purchase.
 *
 * `at` is the earliest of them, the one the rest were folded into. `quantity` is
 * their sum, which is what the trip bought. `basketId` is the **newest** folded
 * row's, because the question it answers is "where did this purchase end up",
 * and a shopper who started on the list page and finished through a basket
 * finished through the basket.
 */
export interface MergedPurchase {
  at: Date;
  quantity: number;
  basketId: string | null;
}

/** What the period rule says about one line (section 3). */
export interface LinePeriod {
  /** The median gap between merged purchases, in whole days, at least 1. */
  periodDays: number;
  /** How many days before the period ends the line is already due. */
  windowDays: number;
  /** Whole days since the last merged purchase. */
  elapsedDays: number;
  /** `elapsedDays - (periodDays - windowDays)`: at least 0 when due. */
  overdueDays: number;
  due: boolean;
}

/**
 * Step 1 of section 3: a trip is one purchase however many rows it wrote.
 *
 * Sorted by time, then every purchase that `continuesPurchaseSession` says is
 * still the same session as the one before it is folded into that one. "The one
 * before it" is the previous settlement and not the first of the group, so a slow
 * partial settle that writes a row every few hours stays one purchase.
 *
 * The session is the trips read's own session (plan 0134, section 7), so a line's
 * estimate counts the trips the list shows and not a different number of them.
 * Two shops nine hours apart on one day used to fold and now do not, which
 * shortens that line's median a little, and the floor of
 * {@link SUGGESTION_MIN_PURCHASES} still refuses a period below three purchases.
 */
export function mergePurchases(
  purchases: readonly Purchase[]
): MergedPurchase[] {
  const sorted = [...purchases].sort((a, b) => a.at.getTime() - b.at.getTime());
  const merged: MergedPurchase[] = [];
  let previous: Date | null = null;

  for (const purchase of sorted) {
    const last = merged[merged.length - 1];
    if (last && previous && continuesPurchaseSession(previous, purchase.at)) {
      last.quantity += purchase.quantity;
      last.basketId = purchase.basketId;
    } else {
      merged.push({
        at: new Date(purchase.at.getTime()),
        quantity: purchase.quantity,
        basketId: purchase.basketId,
      });
    }
    previous = purchase.at;
  }
  return merged;
}

/** Whole days of elapsed time between two instants, rounded. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * The share of a period that counts as already due, in whole days.
 *
 * `Math.round`, so a half rounds up: 10 gives 3, 7 gives 2, 2 gives 1 and 1
 * gives 0.
 */
export function windowOf(periodDays: number): number {
  return Math.round(periodDays * SUGGESTION_WINDOW_SHARE);
}

/**
 * The period rule (section 3), or null when the history is too thin to have one.
 *
 * The period is the **median** gap between neighbouring merged purchases and not
 * the mean, because one stock up trip moves a mean for ever.
 */
export function periodOf(
  purchaseTimes: readonly Date[],
  now: Date
): LinePeriod | null {
  const merged = mergePurchases(
    // The period is a question about times alone, so the other two fields are
    // whatever `mergePurchases` needs to accept.
    purchaseTimes.map((at) => ({ at, quantity: 0, basketId: null }))
  );
  if (merged.length < SUGGESTION_MIN_PURCHASES) {
    return null;
  }

  const gaps: number[] = [];
  for (let i = 1; i < merged.length; i += 1) {
    gaps.push((merged[i].at.getTime() - merged[i - 1].at.getTime()) / DAY_MS);
  }
  gaps.sort((a, b) => a - b);
  const middle = Math.floor(gaps.length / 2);
  const median =
    gaps.length % 2 === 0
      ? (gaps[middle - 1] + gaps[middle]) / 2
      : gaps[middle];

  const periodDays = Math.max(1, Math.round(median));
  const windowDays = windowOf(periodDays);
  const elapsedDays = daysBetween(merged[merged.length - 1].at, now);
  const overdueDays = elapsedDays - (periodDays - windowDays);

  return {
    periodDays,
    windowDays,
    elapsedDays,
    overdueDays,
    due: overdueDays >= 0,
  };
}

/**
 * The staple rule (section 4).
 *
 * `presence` is one boolean per ended trip of the list, newest first, true
 * where the trip wanted the line. Only the first {@link STAPLE_TRIPS} count.
 *
 * **It never knew what a trip was**, which is why plan 0142 widened a trip to
 * include a session without touching a line of this function: it takes a list
 * of booleans and the statement behind them decides what each one means.
 *
 * A staple is present in at least half of them **and** never absent from two in a
 * row: every trip, or every other trip, and nothing looser. Below
 * {@link STAPLE_MIN_TRIPS} trips there is too little to say, so nothing is.
 */
export function isStaple(presence: readonly boolean[]): boolean {
  const trips = presence.slice(0, STAPLE_TRIPS);
  if (trips.length < STAPLE_MIN_TRIPS) {
    return false;
  }

  const present = trips.filter(Boolean).length;
  if (present * 2 < trips.length) {
    return false;
  }
  return trips.every((here, i) => here || i === 0 || trips[i - 1]);
}
