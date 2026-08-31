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
