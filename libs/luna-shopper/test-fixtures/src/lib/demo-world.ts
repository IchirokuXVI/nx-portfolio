/**
 * The canonical "demo world" (plan 0013, section 1).
 *
 * One hand authored, internally consistent graph built from the factories with
 * fixed uuid constants, partitioned by owning database (auth / core / catalog).
 * It is just enough to drive the primary flows end to end:
 *
 *   Users   Alice (owner, registered email), Bob (approved member, Google),
 *           Carol (pending member, registered email), Temp (temporary user).
 *   Zones   "Weekly shop", owned by Alice, with Bob approved and Carol pending;
 *           Temp is an approved member so the merge path (Temp -> Bob) is valid.
 *           "Flat share", owned by Bob, where Carol was approved AFTER both of
 *           its lists already existed (plan 0042, section 4). That ordering is
 *           the shape the whole of plan 0042 is about and the one shape this
 *           world did not contain: it is what a member seeing an empty group
 *           looked like, and it is what the approval grant now fixes.
 *   Lists   "Groceries" and "Hardware" under the weekly zone, both shared with
 *           it; "Flat supplies" (shared) and "Gift ideas" (private) under the
 *           flat, so one member can read exactly one of the two.
 *   Access  Bob holds read and write on Groceries and read alone on Hardware;
 *           the guest holds read and decide on Groceries; Carol holds the shared
 *           set on Flat supplies and no row at all on Gift ideas. Write without
 *           decide and decide without write are there deliberately (plan 0036,
 *           section 9): they are the two states a single role could not express.
 *           Neither owner has a row anywhere, because creation no longer writes
 *           one for a staff membership (plan 0042, section 1.2).
 *   Lines   Several across both line state machines (approvalStatus x status),
 *           with non sequential float positions (the reordering case), a couple
 *           linked to real catalog items, and two comments on the milk line.
 *   Catalog Mercadona (one location) with Milk and Bread priced per store; the
 *           milk and bread lines reference those item ids across the databases.
 */

import {
  AuthProvider,
  ItemCategory,
  LineApprovalStatus,
  LineStatus,
  ListPermission,
  MembershipStatus,
  MergeRequestStatus,
  PriceScopeKind,
  UnitOfMeasure,
  UserKind,
  ZoneRole,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  makeComment,
  makeCredential,
  makeItem,
  makeLine,
  makeList,
  makeListAccess,
  makeMembership,
  makeMergeRequest,
  makeOAuthIdentity,
  makePriceScope,
  makeSupermarket,
  makeSupermarketItem,
  makeSupermarketLocation,
  makeSupermarketLocationItem,
  makeUser,
  makeZone,
} from './factories';
import {
  ACCESS_BOB_GROCERIES_ID,
  ACCESS_BOB_HARDWARE_ID,
  ACCESS_CAROL_FLAT_SUPPLIES_ID,
  ACCESS_TEMP_GROCERIES_ID,
  ALICE_CREDENTIAL_ID,
  ALICE_ID,
  BOB_GOOGLE_SUBJECT,
  BOB_ID,
  BOB_OAUTH_ID,
  CAROL_CREDENTIAL_ID,
  CAROL_ID,
  COMMENT_MILK_ALICE_ID,
  COMMENT_MILK_BOB_ID,
  ITEM_BREAD_ID,
  ITEM_MILK_ID,
  LINE_APPLES_ID,
  LINE_BREAD_ID,
  LINE_EGGS_ID,
  LINE_MILK_ID,
  LINE_NAILS_ID,
  LIST_FLAT_GIFTS_ID,
  LIST_FLAT_SUPPLIES_ID,
  LIST_GROCERIES_ID,
  LIST_HARDWARE_ID,
  LOCATION_ITEM_BREAD_ID,
  LOCATION_ITEM_MILK_ID,
  LOCATION_MERCADONA_VALENCIA_ID,
  MEMBERSHIP_ALICE_ID,
  MEMBERSHIP_BOB_FLAT_ID,
  MEMBERSHIP_BOB_ID,
  MEMBERSHIP_CAROL_FLAT_ID,
  MEMBERSHIP_CAROL_ID,
  MEMBERSHIP_TEMP_ID,
  MERGE_TEMP_INTO_BOB_ID,
  PRICE_SCOPE_MERCADONA_VALENCIA_ID,
  SUPERMARKET_ITEM_BREAD_ID,
  SUPERMARKET_ITEM_MILK_ID,
  SUPERMARKET_MERCADONA_ID,
  TEMP_USER_ID,
  ZONE_FLAT_ID,
  ZONE_FLAT_JOIN_CODE,
  ZONE_WEEKLY_ID,
  ZONE_WEEKLY_JOIN_CODE,
} from './ids';
import type { AuthSeed, CatalogSeed, CoreSeed, DemoWorld } from './types';

// --- Auth half ---------------------------------------------------------------

const auth: AuthSeed = {
  users: [
    makeUser({
      id: ALICE_ID,
      email: 'alice@example.com',
      emailVerifiedAt: new Date('2026-01-01T09:00:00.000Z'),
      displayName: 'Alice',
      username: 'Swift Sail',
    }),
    makeUser({
      id: BOB_ID,
      email: 'bob@example.com',
      emailVerifiedAt: new Date('2026-01-01T09:05:00.000Z'),
      displayName: 'Bob',
      username: 'Steady Helm',
    }),
    makeUser({
      id: CAROL_ID,
      email: 'carol@example.com',
      emailVerifiedAt: null,
      displayName: 'Carol',
      username: 'Bright Beacon',
    }),
    makeUser({
      id: TEMP_USER_ID,
      kind: UserKind.TEMPORARY,
      email: null,
      emailVerifiedAt: null,
      displayName: null,
      // A guest has a generated name from the moment they exist (plan 0018).
      username: 'Quiet Lantern',
    }),
  ],
  // Alice and Carol log in with email + password; Bob logs in with Google.
  credentials: [
    makeCredential({ id: ALICE_CREDENTIAL_ID, userId: ALICE_ID }),
    makeCredential({ id: CAROL_CREDENTIAL_ID, userId: CAROL_ID }),
  ],
  oauthIdentities: [
    makeOAuthIdentity({
      id: BOB_OAUTH_ID,
      userId: BOB_ID,
      provider: AuthProvider.GOOGLE,
      providerUserId: BOB_GOOGLE_SUBJECT,
    }),
  ],
};

// --- Core half ---------------------------------------------------------------

const core: CoreSeed = {
  zones: [
    makeZone({
      id: ZONE_WEEKLY_ID,
      name: 'Weekly shop',
      joinCode: ZONE_WEEKLY_JOIN_CODE,
      status: ZoneStatus.ACTIVE,
      ownerUserId: ALICE_ID,
    }),
    // The late joiner's group (plan 0042, section 4). Bob owns it, made both of
    // its lists before Carol was anywhere near it, and Carol was approved
    // afterwards; that ordering is the whole point of the fixture and the shape
    // nothing in the world had.
    makeZone({
      id: ZONE_FLAT_ID,
      name: 'Flat share',
      joinCode: ZONE_FLAT_JOIN_CODE,
      status: ZoneStatus.ACTIVE,
      ownerUserId: BOB_ID,
    }),
  ],
  memberships: [
    makeMembership({
      id: MEMBERSHIP_ALICE_ID,
      zoneId: ZONE_WEEKLY_ID,
      userId: ALICE_ID,
      username: 'alice',
      role: ZoneRole.OWNER,
      status: MembershipStatus.APPROVED,
    }),
    makeMembership({
      id: MEMBERSHIP_BOB_ID,
      zoneId: ZONE_WEEKLY_ID,
      userId: BOB_ID,
      username: 'bob',
      role: ZoneRole.MEMBER,
      status: MembershipStatus.APPROVED,
      approvedByUserId: ALICE_ID,
    }),
    makeMembership({
      id: MEMBERSHIP_CAROL_ID,
      zoneId: ZONE_WEEKLY_ID,
      userId: CAROL_ID,
      username: 'carol',
      role: ZoneRole.MEMBER,
      status: MembershipStatus.PENDING,
    }),
    makeMembership({
      id: MEMBERSHIP_TEMP_ID,
      zoneId: ZONE_WEEKLY_ID,
      userId: TEMP_USER_ID,
      username: 'guest',
      role: ZoneRole.MEMBER,
      status: MembershipStatus.APPROVED,
      approvedByUserId: ALICE_ID,
    }),
    makeMembership({
      id: MEMBERSHIP_BOB_FLAT_ID,
      zoneId: ZONE_FLAT_ID,
      userId: BOB_ID,
      username: 'bob',
      role: ZoneRole.OWNER,
      status: MembershipStatus.APPROVED,
    }),
    // Approved after both lists already existed, which is why her only access row
    // is on the shared one: the approval grant wrote it (plan 0042, section 2.3).
    makeMembership({
      id: MEMBERSHIP_CAROL_FLAT_ID,
      zoneId: ZONE_FLAT_ID,
      userId: CAROL_ID,
      username: 'carol',
      role: ZoneRole.MEMBER,
      status: MembershipStatus.APPROVED,
      approvedByUserId: BOB_ID,
    }),
  ],
  lists: [
    // Both shared with the weekly group, which is what the rows below record and
    // what the plan 0042 backfill recovers from them: a list with an access row
    // for somebody other than its creator was shared, because only the shared
    // grant writes one.
    makeList({
      id: LIST_GROCERIES_ID,
      zoneId: ZONE_WEEKLY_ID,
      name: 'Groceries',
      createdByUserId: ALICE_ID,
      sharedWithZone: true,
    }),
    makeList({
      id: LIST_HARDWARE_ID,
      zoneId: ZONE_WEEKLY_ID,
      name: 'Hardware',
      createdByUserId: ALICE_ID,
      sharedWithZone: true,
    }),
    // One shared and one private in the same group, so "a member approved into a
    // zone with a shared list and a private one can read exactly one" is a fact
    // about the fixture rather than a scenario every test has to build.
    makeList({
      id: LIST_FLAT_SUPPLIES_ID,
      zoneId: ZONE_FLAT_ID,
      name: 'Flat supplies',
      createdByUserId: BOB_ID,
      sharedWithZone: true,
    }),
    makeList({
      id: LIST_FLAT_GIFTS_ID,
      zoneId: ZONE_FLAT_ID,
      name: 'Gift ideas',
      createdByUserId: BOB_ID,
      sharedWithZone: false,
    }),
  ],
  // Permission sets deliberately different from each other (plan 0036, section
  // 9). Bob adds to Groceries but does not decide what goes in the trolley, and
  // reads Hardware and nothing more; the guest decides on Groceries but cannot
  // put anything on it. Those middle two are the states nothing exercised before
  // the permission set existed, and they are the two it exists to express.
  //
  // **Neither owner has a row anywhere** (plan 0042, section 1.2). Alice created
  // both weekly lists and Bob both flat ones, and creation no longer writes a
  // creator's row when the creator is group staff, because staff hold all four by
  // derivation and the row would only be one `setAccess` then refuses. Their
  // access is identical without it, and a fixture holding one would seed a world
  // the service can no longer produce.
  listAccess: [
    makeListAccess({
      id: ACCESS_BOB_GROCERIES_ID,
      listId: LIST_GROCERIES_ID,
      membershipId: MEMBERSHIP_BOB_ID,
      permissions: [ListPermission.READ, ListPermission.WRITE],
    }),
    makeListAccess({
      id: ACCESS_BOB_HARDWARE_ID,
      listId: LIST_HARDWARE_ID,
      membershipId: MEMBERSHIP_BOB_ID,
      permissions: [ListPermission.READ],
    }),
    makeListAccess({
      id: ACCESS_TEMP_GROCERIES_ID,
      listId: LIST_GROCERIES_ID,
      membershipId: MEMBERSHIP_TEMP_ID,
      permissions: [ListPermission.READ, ListPermission.DECIDE],
    }),
    // Carol's one row in the flat, and the only row in that zone. It is exactly
    // what approving her wrote: the shared set on the shared list, and nothing at
    // all on the private one (plan 0042, section 2.2).
    makeListAccess({
      id: ACCESS_CAROL_FLAT_SUPPLIES_ID,
      listId: LIST_FLAT_SUPPLIES_ID,
      membershipId: MEMBERSHIP_CAROL_FLAT_ID,
      permissions: [
        ListPermission.READ,
        ListPermission.WRITE,
        ListPermission.DECIDE,
      ],
    }),
  ],
  lines: [
    // Groceries. Non sequential positions on purpose (the reordering case):
    // apples was dragged in between milk and bread.
    makeLine({
      id: LINE_MILK_ID,
      listId: LIST_GROCERIES_ID,
      content: 'Milk',
      quantity: 2,
      itemId: ITEM_MILK_ID,
      position: 1000,
      approvalStatus: LineApprovalStatus.APPROVED,
      status: LineStatus.READY,
      createdByUserId: BOB_ID,
      approvedByUserId: ALICE_ID,
      version: 2,
    }),
    makeLine({
      id: LINE_APPLES_ID,
      listId: LIST_GROCERIES_ID,
      content: 'Apples',
      quantity: 6,
      position: 1500,
      approvalStatus: LineApprovalStatus.REJECTED,
      status: LineStatus.PENDING,
      createdByUserId: BOB_ID,
      approvedByUserId: ALICE_ID,
    }),
    makeLine({
      id: LINE_BREAD_ID,
      listId: LIST_GROCERIES_ID,
      content: 'Bread',
      quantity: 1,
      itemId: ITEM_BREAD_ID,
      position: 2000,
      approvalStatus: LineApprovalStatus.PENDING,
      status: LineStatus.PENDING,
      createdByUserId: BOB_ID,
    }),
    makeLine({
      id: LINE_EGGS_ID,
      listId: LIST_GROCERIES_ID,
      content: 'Eggs',
      quantity: 12,
      position: 3000,
      approvalStatus: LineApprovalStatus.APPROVED,
      status: LineStatus.NOT_AVAILABLE,
      createdByUserId: ALICE_ID,
      approvedByUserId: ALICE_ID,
      version: 3,
    }),
    // Hardware.
    makeLine({
      id: LINE_NAILS_ID,
      listId: LIST_HARDWARE_ID,
      content: 'Nails',
      quantity: 100,
      position: 1000,
      approvalStatus: LineApprovalStatus.APPROVED,
      status: LineStatus.READY,
      createdByUserId: ALICE_ID,
      approvedByUserId: ALICE_ID,
    }),
  ],
  // Two comments on the milk line; createdAt is explicit so newest to oldest is
  // deterministic (Bob's reply is newer than Alice's note).
  comments: [
    makeComment({
      id: COMMENT_MILK_ALICE_ID,
      lineId: LINE_MILK_ID,
      authorUserId: ALICE_ID,
      body: 'Get the semi-skimmed one, please.',
      createdAt: new Date('2026-01-02T10:00:00.000Z'),
    }),
    makeComment({
      id: COMMENT_MILK_BOB_ID,
      lineId: LINE_MILK_ID,
      authorUserId: BOB_ID,
      body: 'On it.',
      createdAt: new Date('2026-01-02T10:05:00.000Z'),
    }),
  ],
  mergeRequests: [
    makeMergeRequest({
      id: MERGE_TEMP_INTO_BOB_ID,
      zoneId: ZONE_WEEKLY_ID,
      sourceUserId: TEMP_USER_ID,
      targetUserId: BOB_ID,
      requestedByUserId: BOB_ID,
      status: MergeRequestStatus.PENDING,
    }),
  ],
};

// --- Catalog half ------------------------------------------------------------

const catalog: CatalogSeed = {
  supermarkets: [
    makeSupermarket({
      id: SUPERMARKET_MERCADONA_ID,
      name: { en: 'Mercadona', es: 'Mercadona' },
      websiteUrl: 'https://www.mercadona.es',
      // The chain's Wikidata QID (plan 0038, section 5.4). Matching on the brand
      // NAME would split `Dia` from `Maxi Dia`; this is what a discovery run
      // recognises the chain by.
      externalBrandKey: 'Q377705',
    }),
  ],
  priceScopes: [
    makePriceScope({
      id: PRICE_SCOPE_MERCADONA_VALENCIA_ID,
      supermarketId: SUPERMARKET_MERCADONA_ID,
      kind: PriceScopeKind.STORE,
      externalKey: LOCATION_MERCADONA_VALENCIA_ID,
      label: { en: 'Valencia — Colón', es: 'Valencia — Colón' },
    }),
  ],
  locations: [
    makeSupermarketLocation({
      id: LOCATION_MERCADONA_VALENCIA_ID,
      supermarketId: SUPERMARKET_MERCADONA_ID,
      priceScopeId: PRICE_SCOPE_MERCADONA_VALENCIA_ID,
      label: { en: 'Valencia — Colón', es: 'Valencia — Colón' },
      address: 'Carrer de Colón, 1',
      city: 'Valencia',
      country: 'ES',
      postalCode: '46004',
    }),
  ],
  items: [
    makeItem({
      id: ITEM_MILK_ID,
      name: { en: 'Milk', es: 'Leche' },
      category: ItemCategory.DAIRY,
      defaultUnit: UnitOfMeasure.LITER,
    }),
    makeItem({
      id: ITEM_BREAD_ID,
      name: { en: 'Bread', es: 'Pan' },
      category: ItemCategory.BAKERY,
      defaultUnit: UnitOfMeasure.UNIT,
    }),
  ],
  supermarketItems: [
    makeSupermarketItem({
      id: SUPERMARKET_ITEM_MILK_ID,
      itemId: ITEM_MILK_ID,
      priceScopeId: PRICE_SCOPE_MERCADONA_VALENCIA_ID,
      price: 1.15,
      currency: 'EUR',
      unitPrice: 1.15,
      unitPriceLabel: 'L',
    }),
    makeSupermarketItem({
      id: SUPERMARKET_ITEM_BREAD_ID,
      itemId: ITEM_BREAD_ID,
      priceScopeId: PRICE_SCOPE_MERCADONA_VALENCIA_ID,
      price: 0.95,
      currency: 'EUR',
      unitPrice: 0.95,
      unitPriceLabel: 'ud',
    }),
  ],
  // The aisle is per store even when the price is not, which is why it lives
  // here now (plan 0038, section 5.2).
  locationItems: [
    makeSupermarketLocationItem({
      id: LOCATION_ITEM_MILK_ID,
      itemId: ITEM_MILK_ID,
      supermarketLocationId: LOCATION_MERCADONA_VALENCIA_ID,
      positionInStore: 'Aisle 3',
    }),
    makeSupermarketLocationItem({
      id: LOCATION_ITEM_BREAD_ID,
      itemId: ITEM_BREAD_ID,
      supermarketLocationId: LOCATION_MERCADONA_VALENCIA_ID,
      positionInStore: 'Aisle 1',
    }),
  ],
};

/** The whole canonical scenario, partitioned by owning database. */
export const demoWorld: DemoWorld = { auth, core, catalog };
