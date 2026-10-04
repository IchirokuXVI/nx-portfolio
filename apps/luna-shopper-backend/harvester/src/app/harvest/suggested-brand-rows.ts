/**
 * Which source rows carry a suggested brand, as a SQL predicate over
 * `source_catalog_entries` aliased `e` (plan 0115, section 7; admin plan 0044,
 * section 2).
 *
 * A suggestion is a brand key that a queued row carries and no registered
 * brand holds. Queued is `CANDIDATE` or `UNRESOLVED`: the products still
 * waiting for a person.
 *
 * Two reads use it. The suggestions list groups these rows by key, and the
 * dashboard counts the keys. One predicate for both, so that the number on the
 * Brands queue is the length of the list behind it.
 *
 * `registered` is the bind placeholder that holds the registered keys, such as
 * `$1`. It is a placeholder and never a value: the keys travel as a parameter.
 */
export function suggestedBrandRows(registered: string): string {
  return `e."status" IN ('CANDIDATE', 'UNRESOLVED')
             AND e."brandKey" IS NOT NULL
             AND NOT (e."brandKey" = ANY(${registered}::text[]))`;
}
