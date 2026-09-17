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
 * Two purchases closer than this are one purchase: twelve hours.
 *
 * One trip writes several settlements for one line seconds apart (one per
 * origin, one per sibling basket line, one per partial settle), and read as they
 * are they put gaps of zero into the median.
 */
export const PURCHASE_MERGE_MS = 12 * 60 * 60 * 1000;

/** Fewer merged purchases than this have no period. Two define one interval. */
export const SUGGESTION_MIN_PURCHASES = 3;

/** How early before the period ends a line is already due, as a share of it. */
export const SUGGESTION_WINDOW_SHARE = 0.25;

/** How many of the list's ended basket trips the staple rule looks at. */
export const STAPLE_TRIPS = 6;

/** Below this many ended basket trips, no line of the list is a staple. */
export const STAPLE_MIN_TRIPS = 4;
