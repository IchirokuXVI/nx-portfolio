import { v5 as uuidv5 } from 'uuid';

/**
 * Every id in the reference catalog is derived from a slug, not written down
 * (plan 0067, section 6).
 *
 * The demo world states its ids as constants, which is right for a graph of a
 * dozen rows that specs assert against by name. This set is 139 groups, 135
 * items, two chains and their scopes and locations, and hand written uuids at
 * that size are 400 lines of noise nobody can check and one transposed digit
 * away from a silent mis-link.
 *
 * Deriving them buys the property the seed actually needs, which is that running
 * it twice writes the same rows: `groupId('milk')` is the same uuid in every
 * database, this week and next, so the seed can upsert by primary key and stay
 * idempotent without a lookup table. A v5 uuid is a hash, so the derivation is
 * pure and reproducible anywhere, and the namespace below is what keeps these
 * ids from colliding with anything else that hashes the word "milk".
 *
 * The namespace is fixed forever. Changing it renames every row in the reference
 * catalog, which to a database is 274 deletions and 274 insertions, and any
 * shopping line pointing at one of the old ids would be left pointing at
 * nothing.
 */
const REFERENCE_NAMESPACE = '6f9d2c41-3b7a-4e58-9c2d-8a1f5b0e7d34';

const derive = (kind: string, slug: string): string =>
  uuidv5(`${kind}:${slug}`, REFERENCE_NAMESPACE);

export const groupId = (slug: string): string => derive('group', slug);
export const itemId = (store: string, slug: string): string =>
  derive('item', `${store}/${slug}`);
export const supermarketId = (slug: string): string =>
  derive('supermarket', slug);
export const priceScopeId = (slug: string): string => derive('scope', slug);
export const locationId = (slug: string): string => derive('location', slug);
export const supermarketItemId = (store: string, slug: string): string =>
  derive('supermarket-item', `${store}/${slug}`);
