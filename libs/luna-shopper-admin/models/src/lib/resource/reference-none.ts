/**
 * The value a reference filter holds when it asks for the rows that point at
 * nothing (plan 0012, section 2).
 *
 * A filter that is absent means "any", so it cannot spell "none" by leaving
 * itself out. It spells it with this literal instead, on the **same** query
 * parameter a uuid would go on: `productGroupId=none` is the products that
 * belong to no group, and `ownerUserId=none` is the zones nobody owns. The
 * gateway reads the same literal, so it is one word end to end rather than a
 * second boolean parameter per reference.
 *
 * It is safe as a sentinel because no uuid can ever equal it, and it is a
 * plain word rather than an empty string because an empty string is already
 * what an unset filter holds.
 */
export const REFERENCE_NONE = 'none';

/** Whether a reference filter's value is the "points at nothing" answer. */
export function isReferenceNone(value: string): boolean {
  return value === REFERENCE_NONE;
}
