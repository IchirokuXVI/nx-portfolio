import {
  BASKET_TRIP_ROWS_FREEZE_SQL,
  BASKET_TRIP_ROWS_THAW_SQL,
} from '../generated-lists/basket-trip-rows.sql';
import { ORDER_HISTORY_SQL } from '../generated-lists/generated-list.sql';
import {
  ITEM_SETTLEMENTS_SQL,
  LINE_SETTLEMENT_SUMMARY_SQL,
} from '../lists/settlement.sql';
import {
  SUGGESTION_CANDIDATES_SQL,
  SUGGESTION_LAST_ASKED_SQL,
  SUGGESTION_PURCHASES_SQL,
  SUGGESTION_RECENT_TRIPS_SQL,
} from '../lists/suggestions/suggestions.sql';
import {
  BASKET_TRIP_LISTS_SQL,
  BASKET_TRIP_ROWS_SQL,
  ENDED_TRIPS_SQL,
  LIVE_TRIPS_SQL,
  LOOSE_TRIP_ROWS_SQL,
  OWNER_TRIP_LISTS_SQL,
} from '../lists/trips/trips.sql';

/**
 * Who never sees a skip (plan 0137, section 6, test 16).
 *
 * A skip is one shopper's intention for one trip. It is private to the basket,
 * it expires, and it is ended by other events, so every read below has to stay
 * ignorant of it: a trip row says asked, bought and left; a household's line did
 * not change; a skipped shelf is a shelf nobody stood at.
 *
 * The cheapest guard against a later plan reaching for the table because it was
 * there. It is a grep over the compiled constants rather than a rule anybody has
 * to remember, and it fails on the day somebody joins `basket_line_skips` into
 * one of them, with the constant named.
 *
 * **One exception, stated by name.** The suggestions' candidates read shares
 * `openBasketCoversLine` with the claim, which carries `noFreshSkip` since
 * section 5.4, so a skipped line is offered back to the household. That is the
 * intended consequence and the only match this file allows.
 */
const IGNORANT: Record<string, string> = {
  // The trips of a list: a skipped line reads `NOT_BOUGHT`, which is true.
  LIVE_TRIPS_SQL,
  ENDED_TRIPS_SQL,
  BASKET_TRIP_ROWS_SQL,
  LOOSE_TRIP_ROWS_SQL,
  BASKET_TRIP_LISTS_SQL,
  OWNER_TRIP_LISTS_SQL,
  // The finish and the reopen: finishing does nothing with a standing skip, and
  // the frozen row says asked and not bought.
  BASKET_TRIP_ROWS_FREEZE_SQL,
  BASKET_TRIP_ROWS_THAW_SQL,
  // The walk order: a skipped shelf is a shelf nobody stood at.
  ORDER_HISTORY_SQL,
  // The settlement history, served to every reader of the list. A skip is not a
  // purchase and not an attempt.
  ITEM_SETTLEMENTS_SQL,
  LINE_SETTLEMENT_SUMMARY_SQL,
  // The suggestions, except through the claim fragment below.
  SUGGESTION_PURCHASES_SQL,
  SUGGESTION_RECENT_TRIPS_SQL,
  SUGGESTION_LAST_ASKED_SQL,
};

describe('who never sees a skip (plan 0137, section 6)', () => {
  it.each(Object.entries(IGNORANT))(
    '%s does not mention basket_line_skips',
    (_name, sql) => {
      expect(sql).not.toContain('basket_line_skips');
    }
  );

  it('allows the one read that shares the claim fragment', () => {
    // Asserted rather than merely left out, so deleting the fragment from the
    // claim does not quietly take the rule with it.
    expect(SUGGESTION_CANDIDATES_SQL).toContain('basket_line_skips');
  });
});
