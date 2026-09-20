/**
 * "Is somebody still shopping this", stated once (plan 0133, section 6).
 *
 * Seven queries used to ask it, each spelling out a status array it was handed
 * as a parameter, and every one of them was about to be wrong about the
 * permanent basket of plan 0136: a basket that never ends is open forever, so
 * the sweep would finish it after sixty hours and the settle would then refuse
 * it. The question they all mean is "a trip somebody composed, still being
 * shopped", and that is two columns rather than one.
 *
 * Both fragments assume the alias `gl` for `"generated_lists"`, which every
 * query that asks them already uses. They are string fragments rather than
 * parameters for the same reason the rest of this codebase's raw SQL is written
 * by hand: an enum value is not user input, and a fragment cannot be passed the
 * wrong array by a caller that forgot.
 */

/**
 * A basket that claims lines and counts as a trip in progress: made on purpose,
 * and open. The permanent basket is never one of these.
 */
export const OPEN_GENERATED_BASKET = `gl."kind" = 'GENERATED' AND gl."status" = 'OPEN'`;

/** A basket that is a trip at all, open or over. */
export const GENERATED_BASKET = `gl."kind" = 'GENERATED'`;
