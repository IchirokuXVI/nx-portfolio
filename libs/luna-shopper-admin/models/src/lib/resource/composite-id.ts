/**
 * The address of a row that is keyed on more than one column (plan 0005,
 * sections 2 and 4).
 *
 * Two catalog resources are: a price is unique on `(itemId, priceScopeId)` and a
 * location item on `(itemId, supermarketLocationId)`. Both carry an `id` of
 * their own, and for both it is nearly useless: the gateway has **no route that
 * reads one by it**. A price is read by listing prices with those two
 * parameters, and it is written by putting the pair in the body of an upsert.
 *
 * So the pair is what a URL carries, and this is how it is written down. The
 * row's own `id` is still what a delete quotes, because that is the one thing it
 * is good for.
 */

/**
 * What separates one part from the next.
 *
 * A tilde, because the parts are uuids and a uuid already contains hyphens, and
 * because `~` is unreserved in a URL path segment (RFC 3986) so nothing has to
 * be escaped on the way there or guessed at on the way back.
 */
export const COMPOSITE_ID_SEPARATOR = '~';

/** The parts of a composite address, in the order the key names them. */
export function compositeId(values: readonly string[]): string {
  return values.join(COMPOSITE_ID_SEPARATOR);
}

/**
 * One row's composite address, read off the row.
 *
 * Empty when any part of the key is missing, which is the same answer
 * {@link idOf} gives for a row with no id: a row that cannot be addressed does
 * not become a link.
 */
export function compositeIdOf(
  row: Record<string, unknown>,
  key: readonly string[]
): string {
  const values: string[] = [];

  for (const field of key) {
    const value = row[field];
    if (typeof value !== 'string' || value === '') {
      return '';
    }
    values.push(value);
  }

  return compositeId(values);
}

/**
 * A composite address, back as the fields it was made of.
 *
 * `null` when it has the wrong number of parts, rather than a record with
 * `undefined` in it. A URL somebody edited by hand is a not found, and the
 * caller can only say so if this refuses to guess.
 */
export function compositeParts(
  id: string,
  key: readonly string[]
): Readonly<Record<string, string>> | null {
  const parts = id.split(COMPOSITE_ID_SEPARATOR);
  if (parts.length !== key.length || parts.some((part) => part === '')) {
    return null;
  }

  return Object.fromEntries(key.map((field, index) => [field, parts[index]]));
}
