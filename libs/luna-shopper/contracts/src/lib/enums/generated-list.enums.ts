/**
 * Generated shopping list enums (plan 0050, sections 1 and 9). The constant sets
 * rule: a value a column holds is an enum here, and its string values are the
 * wire format.
 */

/**
 * Where a generated list has got to (plan 0050, section 1).
 *
 * `DRAFT` is a basket that has been composed and not yet taken to a shop,
 * `ACTIVE` is the one being worked through, `COMPLETED` is a trip that is over,
 * and `ARCHIVED` hides a list from the default listing without deleting it
 * (section 7).
 *
 * `ACTIVE` is the only value carrying a rule beyond display: the overlap check in
 * section 3 refuses to put one zone line in two live baskets at once, which is
 * how a household ends up with two of everything.
 */
export enum GeneratedListStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  ARCHIVED = 'ARCHIVED',
}

/**
 * How a line got into a generated list (plan 0050, section 1).
 *
 * `DERIVED` came from zone lines and carries a provenance row per contributing
 * line. `ADDED` was typed into the basket, and **exists nowhere else** until the
 * user names a target list for it (section 5), which is the distinction the write
 * back rule turns on.
 *
 * The value survives that promotion: a line typed here and then pushed into a
 * shared list keeps `ADDED`, because what is worth recording is where it came
 * from rather than where it ended up.
 */
export enum GeneratedLineOrigin {
  DERIVED = 'DERIVED',
  ADDED = 'ADDED',
}
