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

/**
 * Mercadona's row id, which this module does **not** derive.
 *
 * `uq_supermarkets_external_brand_key` permits exactly one row carrying
 * `Q377705`, so there is one Mercadona in a catalog database and every writer
 * has to mean the same one. The demo world seeder states this id as a constant
 * and inserts it; the reference seed adopts whatever row already carries the
 * brand key and only creates one when nothing does. Deriving a second id here
 * would make the two disagree, and the disagreement surfaces as a unique
 * violation in whichever runs second rather than as two Mercadonas.
 *
 * It is written out rather than imported because the demo world lives in a test
 * fixtures library, and the seed that runs inside the production image should
 * not depend on one. `reference-catalog.spec.ts` asserts the two still match.
 */
export const MERCADONA_SUPERMARKET_ID = '5efa0000-0000-4000-a000-000000000001';

export const groupId = (slug: string): string => derive('group', slug);
export const itemId = (store: string, slug: string): string =>
  derive('item', `${store}/${slug}`);
export const supermarketId = (slug: string): string =>
  derive('supermarket', slug);
export const priceScopeId = (slug: string): string => derive('scope', slug);
export const locationId = (slug: string): string => derive('location', slug);
export const supermarketItemId = (store: string, slug: string): string =>
  derive('supermarket-item', `${store}/${slug}`);
