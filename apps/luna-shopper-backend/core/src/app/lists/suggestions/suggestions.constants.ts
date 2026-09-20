/**
 * The thresholds behind the lines a list suggests (plan 0123, section 5).
 *
 * Named constants in one file, and not environment variables: they are a product
 * rule, and a cluster that answered a different rule from the one the specs prove
 * would be a bug nobody could reproduce.
 *
 * Every one of them is elapsed time or a count. None names a calendar day, so no
 * time zone is involved anywhere in the rule.
 */

/** A day as elapsed time, never a calendar day. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long two purchases may be apart and still be one purchase is **not** here.
 * It is `PURCHASE_SESSION_GAP_MS` in contracts, six hours, and `mergePurchases`
 * folds on `continuesPurchaseSession` (plan 0134, section 7).
 *
 * It used to be a twelve hour `PURCHASE_MERGE_MS` here, beside a six hour gap in
 * the trips read, so one shopping trip read as one trip on the list and two
 * purchases in the estimate. A session is one thing, so it is one number, and
 * that number is not a suggestions threshold.
 */

/** Fewer merged purchases than this have no period. Two define one interval. */
export const SUGGESTION_MIN_PURCHASES = 3;

/** How early before the period ends a line is already due, as a share of it. */
export const SUGGESTION_WINDOW_SHARE = 0.25;

/** How many of the list's ended basket trips the staple rule looks at. */
export const STAPLE_TRIPS = 6;

/** Below this many ended basket trips, no line of the list is a staple. */
export const STAPLE_MIN_TRIPS = 4;
