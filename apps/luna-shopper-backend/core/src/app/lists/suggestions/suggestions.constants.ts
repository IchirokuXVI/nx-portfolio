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

/**
 * How many of the list's ended trips the staple rule looks at.
 *
 * A trip is an ended basket **or** an ended session since plan 0142, section 8,
 * so the six are over the union and not over baskets alone. The number did not
 * change: what changed is what gets counted.
 */
export const STAPLE_TRIPS = 6;

/** Below this many ended trips, no line of the list is a staple. */
export const STAPLE_MIN_TRIPS = 4;

/**
 * How many distinct lines of the list a session must touch to count as a trip
 * (plan 0142, section 8.1).
 *
 * A basket trip states everything a household wanted, so a line missing from it
 * was not wanted and the absence means something. A session states only what
 * was bought. Somebody who went out for bread alone therefore reads as a trip
 * that wanted bread and nothing else, and two such errands in a row end every
 * staple the list has, because a staple may never be absent from two trips
 * running.
 *
 * Three is the smallest number that makes an errand look like an errand. It is
 * a floor on the evidence and not on the shopping: a real weekly shop touches
 * far more, and a household whose every trip is under three lines has no
 * pattern for this rule to find.
 */
export const STAPLE_SESSION_MIN_LINES = 3;
