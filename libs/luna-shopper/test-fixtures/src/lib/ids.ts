/**
 * Fixed uuid constants for the canonical demo world (plan 0013, section 1).
 *
 * These are compile time constants, so a Playwright test knows exactly which
 * zone and list to open, and a unit test asserts against the same ids. The
 * seeder and the unit fixtures then produce the SAME world across the auth, core
 * and catalog databases, which stays referentially consistent because all three
 * halves reference the identical ids (Luna Shopper joins the databases by
 * application level id, never by a cross database foreign key).
 *
 * The values are arbitrary but fixed; the `0000-0000-0000` style middle groups
 * make a seeded row obvious in a database browser.
 */

// --- Auth: users --------------------------------------------------------------
/** Alice: the zone owner, a registered email + password user. */
export const ALICE_ID = 'a11ce000-0000-4000-a000-000000000001';
/** Bob: an approved member, a registered Google user. */
export const BOB_ID = 'b0b00000-0000-4000-a000-000000000002';
/** Carol: a pending member, a registered email + password user. */
export const CAROL_ID = 'ca401000-0000-4000-a000-000000000003';
/** Temp: a temporary (throwaway) user, used for the upgrade and merge paths. */
export const TEMP_USER_ID = '7e290000-0000-4000-a000-000000000004';

// --- Auth: credentials + identities ------------------------------------------
export const ALICE_CREDENTIAL_ID = 'a11ce000-0000-4000-b000-000000000001';
export const CAROL_CREDENTIAL_ID = 'ca401000-0000-4000-b000-000000000003';
export const BOB_OAUTH_ID = 'b0b00000-0000-4000-c000-000000000002';

/** The plaintext password the seeder hashes with argon2 for the email users. */
export const DEMO_PASSWORD = 'Password123!';
/** Bob's Google `providerUserId` (the stable external subject id). */
export const BOB_GOOGLE_SUBJECT = 'google-oauth2|000000000000000000002';

// --- Core: zone + memberships ------------------------------------------------
export const ZONE_WEEKLY_ID = '20de0000-0000-4000-a000-000000000001';
export const ZONE_WEEKLY_JOIN_CODE = 'WEEKLY01';

export const MEMBERSHIP_ALICE_ID = 'de3b0000-0000-4000-a000-000000000001';
export const MEMBERSHIP_BOB_ID = 'de3b0000-0000-4000-a000-000000000002';
export const MEMBERSHIP_CAROL_ID = 'de3b0000-0000-4000-a000-000000000003';
export const MEMBERSHIP_TEMP_ID = 'de3b0000-0000-4000-a000-000000000004';

/**
 * The second zone (plan 0042, section 4): a group whose member was approved
 * **after** its lists were made, which is the shape the whole plan is about and
 * the one shape the demo world did not contain.
 *
 * Bob owns it, so it is also where the other half of plan 0042 is visible: the
 * owner created both lists and has **no** stored access row on either, because a
 * row for a staff membership says nothing their derived grant does not.
 */
export const ZONE_FLAT_ID = '20de0000-0000-4000-a000-000000000002';
export const ZONE_FLAT_JOIN_CODE = 'FLATSHR1';

export const MEMBERSHIP_BOB_FLAT_ID = 'de3b0000-0000-4000-b000-000000000001';
/** Carol, approved into the flat after both of its lists already existed. */
export const MEMBERSHIP_CAROL_FLAT_ID = 'de3b0000-0000-4000-b000-000000000002';

// --- Core: lists + access ----------------------------------------------------
export const LIST_GROCERIES_ID = '115e0000-0000-4000-a000-000000000001';
export const LIST_HARDWARE_ID = '115e0000-0000-4000-a000-000000000002';
/** Shared with the flat, so approving Carol granted her the three. */
export const LIST_FLAT_SUPPLIES_ID = '115e0000-0000-4000-b000-000000000001';
/** Not shared, so approving Carol granted her nothing and she cannot see it. */
export const LIST_FLAT_GIFTS_ID = '115e0000-0000-4000-b000-000000000002';

export const ACCESS_BOB_GROCERIES_ID = 'acce0000-0000-4000-a000-000000000003';
export const ACCESS_BOB_HARDWARE_ID = 'acce0000-0000-4000-a000-000000000004';
/** The guest's row: DECIDE without WRITE, one of plan 0036's two new states. */
export const ACCESS_TEMP_GROCERIES_ID = 'acce0000-0000-4000-a000-000000000005';
/** What the approval grant wrote for Carol: read, add, and tick off. */
export const ACCESS_CAROL_FLAT_SUPPLIES_ID =
  'acce0000-0000-4000-b000-000000000001';

// --- Core: lines + comments --------------------------------------------------
export const LINE_MILK_ID = '11e00000-0000-4000-a000-000000000001';
export const LINE_APPLES_ID = '11e00000-0000-4000-a000-000000000002';
export const LINE_BREAD_ID = '11e00000-0000-4000-a000-000000000003';
export const LINE_EGGS_ID = '11e00000-0000-4000-a000-000000000004';
export const LINE_NAILS_ID = '11e00000-0000-4000-a000-000000000005';

export const COMMENT_MILK_ALICE_ID = 'c0117e00-0000-4000-a000-000000000001';
export const COMMENT_MILK_BOB_ID = 'c0117e00-0000-4000-a000-000000000002';

// --- Core: merge request -----------------------------------------------------
/** A pending merge of the temp user into Bob, to populate the merge path. */
export const MERGE_TEMP_INTO_BOB_ID = 'e36e0000-0000-4000-a000-000000000001';

// --- Catalog: supermarkets + locations ---------------------------------------
export const SUPERMARKET_MERCADONA_ID = '5efa0000-0000-4000-a000-000000000001';
export const LOCATION_MERCADONA_VALENCIA_ID =
  '10ca0000-0000-4000-a000-000000000001';

/**
 * The scope the demo store prices against (plan 0038, section 5.1). A STORE
 * scope, because that is the shape catalog had before scopes existed and what a
 * hand entered supermarket still gets, so the demo world exercises the ordinary
 * path rather than the Mercadona one.
 */
export const PRICE_SCOPE_MERCADONA_VALENCIA_ID =
  '5c0e0000-0000-4000-a000-000000000001';

// --- Catalog: items + per scope prices ---------------------------------------
export const ITEM_MILK_ID = '17e00000-0000-4000-b000-000000000001';
export const ITEM_BREAD_ID = '17e00000-0000-4000-b000-000000000002';

export const SUPERMARKET_ITEM_MILK_ID = '51e00000-0000-4000-a000-000000000001';
export const SUPERMARKET_ITEM_BREAD_ID = '51e00000-0000-4000-a000-000000000002';

// --- Catalog: the per store half (plan 0038, section 5.2) --------------------
export const LOCATION_ITEM_MILK_ID = '10c1e000-0000-4000-a000-000000000001';
export const LOCATION_ITEM_BREAD_ID = '10c1e000-0000-4000-a000-000000000002';

// --- Catalog: product groups (plan 0048, section 1) --------------------------
export const PRODUCT_GROUP_MILK_ID = '9a0d0000-0000-4000-b000-000000000001';
export const PRODUCT_GROUP_BREAD_ID = '9a0d0000-0000-4000-b000-000000000002';

// --- Core: a line's product set (plan 0048, section 1.1) ---------------------
export const LINE_ITEM_MILK_ID = '11e10000-0000-4000-a000-000000000001';
export const LINE_ITEM_BREAD_ID = '11e10000-0000-4000-a000-000000000002';

/**
 * The `itemSetHash` of a set holding only the milk item, written out.
 *
 * A literal rather than a call, deliberately. The digest is computed in two
 * places that have to agree, core's `item-set-hash.ts` and the core migration's
 * SQL, and a fixture that computed it a third way would be a third
 * implementation rather than a check on the other two. Written out, it is a value
 * both of them are measured against, and `demo-world.spec.ts` is where that
 * measurement is asserted.
 */
export const LINE_MILK_SET_HASH =
  'ec78935ab47cba6f035dce46a44ff56a9b54ce3e12adb727abca3abf2ae2f7cc';
export const LINE_BREAD_SET_HASH =
  '519747c897ef7713b41959553e35ff04fc248ef44e91f25e5c4d79feb384b752';
