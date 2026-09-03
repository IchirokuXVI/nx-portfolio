/**
 * How far a device may be from the nearest centroid and still be placed in that
 * postal code (`apps/velista/plans/0058`, section 3; plan 0060, section 6).
 *
 * **Ten kilometres, as configuration, for the same reason the neighbour radius is
 * configuration**: the distance from a person to the centroid of the code they
 * are standing in is a few hundred metres in central Madrid and can be several
 * kilometres in rural Córdoba, and one number cannot be right for both.
 *
 * It is deliberately generous, and larger than
 * {@link DEFAULT_NEARBY_RADIUS_METRES}, because the two numbers are guarding
 * different things. The neighbour radius decides what gets written to a profile
 * with nobody looking; this one decides what a person is **shown and asked to
 * confirm**, and the confirmation is the real guard against a wrong code. What
 * remains for this cap is refusing an answer that is absurd rather than merely
 * approximate: a point at sea, a point in a country we ship no centroids for, a
 * device reporting a position from the other side of Europe. Those should read as
 * "we don't know", and null is how the screen is told to offer typing instead.
 *
 * Tightening it makes the app say "we don't know" to more rural users, who then
 * type four characters. Widening it makes it offer a code from further away,
 * which a human then declines. Neither failure writes anything, which is why this
 * number can be tuned from the environment rather than argued about in a review.
 */
export const DEFAULT_LOCATION_MAX_DISTANCE_METRES = 10_000;
