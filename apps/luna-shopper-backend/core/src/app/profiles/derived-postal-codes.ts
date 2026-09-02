import {
  ProfilePostalCodeSource,
  type PostalCodeDistanceView,
} from '@portfolio/luna-shopper/contracts';

/**
 * The derived set is a **pure function of the profile's own state** (plan 0062,
 * section 3), and this file is that function.
 *
 * The tempting implementation stores a parent pointer on each derived row and
 * edits incrementally: add a parent, insert its neighbours; remove a parent,
 * delete them. It has three bugs, and they are the kind that surface months later
 * on one user's profile.
 *
 * - **A shared child.** Two user codes three kilometres apart both derive the
 *   same neighbour. Removing one parent deletes a row the other still justifies.
 * - **An orphan.** Remove a parent without cleaning up and the user keeps rows
 *   they cannot explain and, by section 2, cannot re add once removed.
 * - **A changed radius.** The radius is configuration, and an incremental scheme
 *   has no moment at which it revisits rows written under the old value.
 *
 * All three vanish when the set is recomputed in full on every change, which is
 * why nothing here takes a "what changed" argument and nothing reasons about
 * parents at all: it is handed the profile's rows and the neighbours of each
 * expanding one, and it answers what the derived rows should be.
 */

/** Everything the recompute needs to know about one row. */
export interface PostalCodeRowState {
  postalCode: string;
  country: string;
  source: ProfilePostalCodeSource;
  expandNearby: boolean;
  suppressed: boolean;
}

/** One code, in the country it was read against. */
export interface PostalCodeRef {
  country: string;
  postalCode: string;
}

/** `(country, postalCode)` as one comparable string. */
export function codeKey(ref: PostalCodeRef): string {
  return `${ref.country}:${ref.postalCode}`;
}

/**
 * The rows whose neighbours have to be asked for: the user's own codes that
 * asked to be widened.
 *
 * A `NEARBY` row never expands, whatever its `expandNearby` says. Letting one
 * would make the derived set a transitive closure that walks the country two
 * kilometres at a time, and the user asked about the place they live rather than
 * about everywhere reachable from it.
 */
export function expandingParents(
  rows: readonly PostalCodeRowState[]
): PostalCodeRef[] {
  return rows
    .filter(
      (row) => row.source !== ProfilePostalCodeSource.NEARBY && row.expandNearby
    )
    .map((row) => ({ country: row.country, postalCode: row.postalCode }));
}

/**
 * `derived(profile)`: the union of every expanding parent's neighbours, minus
 * every code the user holds themselves.
 *
 * Deduplicated across parents, so a neighbour two parents share is one row and
 * removing one of them leaves it. Ordered by the parent it first came from and
 * then by distance, which is nothing more than a stable order for the position
 * column: a derived row's position is not a statement about anything.
 *
 * `limit` caps how many neighbours one parent contributes, nearest first. It is
 * a bound on top of the radius rather than instead of it (section 4): two
 * kilometres around a dense centroid can pull in a dozen codes and around a rural
 * one none at all, and leaving the size of the set to the geography of wherever
 * somebody lives is not a decision anybody made.
 */
export function derivedPostalCodes(
  rows: readonly PostalCodeRowState[],
  neighbours: ReadonlyMap<string, readonly PostalCodeDistanceView[]>,
  limit: number
): PostalCodeRef[] {
  const own = new Set(
    rows
      .filter((row) => row.source !== ProfilePostalCodeSource.NEARBY)
      .map((row) => codeKey(row))
  );

  const derived: PostalCodeRef[] = [];
  const seen = new Set<string>();
  for (const parent of expandingParents(rows)) {
    const found = neighbours.get(codeKey(parent)) ?? [];
    for (const near of found.slice(0, limit)) {
      const ref = { country: parent.country, postalCode: near.postalCode };
      const key = codeKey(ref);
      if (own.has(key) || seen.has(key)) {
        continue;
      }
      seen.add(key);
      derived.push(ref);
    }
  }
  return derived;
}
