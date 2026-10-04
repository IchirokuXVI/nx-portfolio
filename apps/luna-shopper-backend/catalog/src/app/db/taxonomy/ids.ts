import { v5 as uuidv5 } from 'uuid';

/**
 * A category's id is derived from its slug, not written down (plan 0166,
 * section 5).
 *
 * `categoryId('fruits')` is the same uuid in every database, this week and
 * next, so every writer of the tree can upsert by primary key without a lookup
 * table. A v5 uuid is a hash, so the derivation is pure and reproducible
 * anywhere, and the namespace below is what keeps these ids from colliding
 * with anything else that hashes the word "fruits".
 *
 * The namespace is fixed forever, and so is the `category:` prefix. Two
 * migrations inserted the tree under the ids this derives, and every category
 * row in both clusters carries one. Changing either renames every row, which
 * to a database is a deletion and an insertion for each, and every product
 * pointing at one of the old ids would be left pointing at nothing.
 * `taxonomy.spec.ts` pins a handful of ids so that a change fails there first.
 *
 * The name of the constant is history: this file was part of the reference
 * seed, which plan 0180 removed. The value is what matters.
 */
const REFERENCE_NAMESPACE = '6f9d2c41-3b7a-4e58-9c2d-8a1f5b0e7d34';

const derive = (kind: string, slug: string): string =>
  uuidv5(`${kind}:${slug}`, REFERENCE_NAMESPACE);

/**
 * A category's id (plan 0166, section 5). One namespace for roots and leaves,
 * because a slug is unique across the whole tree and not only among siblings.
 * The migration that created the table inserted its roots and landing leaves
 * under these same ids, so a taxonomy upsert that follows it writes over them.
 */
export const categoryId = (slug: string): string => derive('category', slug);
