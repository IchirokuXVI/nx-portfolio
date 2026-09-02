/**
 * Shopping profile enums (plan 0049, section 1). The constant sets rule: a value
 * a column holds is an enum here, and its string values are the wire format.
 */

/**
 * Which zones and lists feed a generated basket (plan 0049, section 1).
 *
 * `ALL` is every list the person can reach, which is what somebody who has never
 * opened this setting means. `SELECTED` narrows it to the
 * `ProfileGenerationSource` rows the profile holds, and those rows are
 * meaningless under `ALL`: they are kept rather than deleted when the switch goes
 * back, so turning it off and on again does not lose the selection.
 *
 * Consumed by plan 0050, which is what actually runs a generation. Nothing reads
 * it yet, and it is declared now because it is a column on a table this plan
 * creates and adding a value to a Postgres enum later is a migration.
 */
export enum GenerationScope {
  ALL = 'ALL',
  SELECTED = 'SELECTED',
}

/**
 * Where a postal code on a profile came from (plan 0062, section 1).
 *
 * **Three values and not two.** `TYPED` and `DEVICE` behave identically
 * everywhere: both are the user's, both are removable, and both can seed an
 * expansion. They are separate anyway because the distinction cannot be
 * backfilled later and costs nothing now, and it earns its keep the first time
 * somebody wants to re resolve a stale device code, or to tell a user why a code
 * they do not remember typing is on their profile.
 *
 * `NEARBY` is the one the server concluded rather than the one the user said, and
 * it is never accepted as input: typing a code that happens to be derived is an
 * ordinary add, and the derived row is promoted (section 3.2).
 */
export enum ProfilePostalCodeSource {
  /** The user typed it. */
  TYPED = 'TYPED',
  /** Resolved from a location permission (`apps/velista/plans/0058`). */
  DEVICE = 'DEVICE',
  /** Derived from a `TYPED` or `DEVICE` code within the radius. */
  NEARBY = 'NEARBY',
}
