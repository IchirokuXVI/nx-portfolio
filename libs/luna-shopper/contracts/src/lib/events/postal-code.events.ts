/**
 * The codes a profile write put on somebody's profile (plan 0062, section 5).
 *
 * Core publishes it after the transaction commits and never waits for it. A code
 * arriving on any profile, `TYPED`, `DEVICE` or `NEARBY`, may be one catalog
 * holds no locations for, and looking is plan `0063`'s job: a discovery run takes
 * minutes and an admin import takes longer, so neither may hold up a profile
 * save, and a failure to announce must not fail the write that caused it.
 *
 * An **event** and not a request for exactly that reason. Nothing consumes it
 * until `0063` lands, and a published event nobody listens to is a no op rather
 * than an error, which is what makes shipping the announcement ahead of its
 * consumer safe.
 */
export const POSTAL_CODE_EVENTS = {
  /** One or more codes are now on a profile; find out whether we know them. */
  postalCodesAdded: 'postalCode.added',
} as const;

export type PostalCodeEvent =
  (typeof POSTAL_CODE_EVENTS)[keyof typeof POSTAL_CODE_EVENTS];

/**
 * The codes one write added, deduplicated, in one message rather than one each.
 *
 * One message because one write produces several: a code with `expandNearby` set
 * can add a parent and half a dozen neighbours at once, and plan `0063` section
 * 2 is the argument that six concurrent triggers is the wrong shape. It says
 * nothing about whose profile they landed on: a discovery run is about a place,
 * not about a person, and naming the user would put an account id in a queue that
 * outlives the request by a month.
 */
export interface PostalCodesAddedEvent {
  /** ISO 3166-1 alpha-2, lowercase. Every code in one message shares it. */
  country: string;
  postalCodes: string[];
}
