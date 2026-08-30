/**
 * Factories / builders (plan 0013, section 1).
 *
 * Each `makeX(overrides?)` returns a well formed, entity shaped object with
 * sensible defaults that any field can override. The id defaults to a fresh
 * random uuid, so a unit test that builds one off objects never gets colliding
 * ids; the demo world overrides the id with a fixed constant. No database is
 * involved: these are plain objects.
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
  PriceSourceKind,
  UnitOfMeasure,
  UserKind,
  ZoneRole,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';
import { randomUUID } from 'node:crypto';
import { DEMO_PASSWORD } from './ids';
import type {
  SeedComment,
  SeedCredential,
  SeedItem,
  SeedLine,
  SeedList,
  SeedListAccess,
  SeedMembership,
  SeedMergeRequest,
  SeedOAuthIdentity,
  SeedPriceScope,
  SeedSupermarket,
  SeedSupermarketItem,
  SeedSupermarketLocation,
  SeedSupermarketLocationItem,
  SeedUser,
  SeedZone,
} from './types';

const uuid = (): string => randomUUID();

// --- Auth --------------------------------------------------------------------

export function makeUser(overrides: Partial<SeedUser> = {}): SeedUser {
  return {
    id: uuid(),
    kind: UserKind.REGISTERED,
    email: 'user@example.com',
    emailVerifiedAt: null,
    displayName: 'A User',
    username: 'Steady Sail',
    ...overrides,
  };
}

export function makeCredential(
  overrides: Partial<SeedCredential> = {}
): SeedCredential {
  return {
    id: uuid(),
    userId: uuid(),
    password: DEMO_PASSWORD,
    ...overrides,
  };
}

export function makeOAuthIdentity(
  overrides: Partial<SeedOAuthIdentity> = {}
): SeedOAuthIdentity {
  return {
    id: uuid(),
    userId: uuid(),
    provider: AuthProvider.GOOGLE,
    providerUserId: `google-${uuid()}`,
    ...overrides,
  };
}

// --- Core --------------------------------------------------------------------

export function makeZone(overrides: Partial<SeedZone> = {}): SeedZone {
  return {
    id: uuid(),
    name: 'A Zone',
    config: {},
    joinCode: 'JOIN0000',
    status: ZoneStatus.ACTIVE,
    ownerUserId: null,
    markedForDeletionAt: null,
    ...overrides,
  };
}

export function makeMembership(
  overrides: Partial<SeedMembership> = {}
): SeedMembership {
  return {
    id: uuid(),
    zoneId: uuid(),
    userId: uuid(),
    username: 'member',
    role: ZoneRole.MEMBER,
    status: MembershipStatus.APPROVED,
    approvedByUserId: null,
    ...overrides,
  };
}

export function makeList(overrides: Partial<SeedList> = {}): SeedList {
  return {
    id: uuid(),
    zoneId: uuid(),
    name: 'A List',
    createdByUserId: uuid(),
    autoApproveLines: false,
    // Private by default, which is the same direction the column defaults in and
    // the answer that grants nobody anything a test did not ask for.
    sharedWithZone: false,
    ...overrides,
  };
}

/**
 * A list access row. Defaults to `{READ}`, the weakest set that can be stored.
 *
 * Weakest rather than most useful, because a fixture that granted more than a
 * test asked for would let a check pass for a permission the test never meant to
 * hand out. It is not the empty set: an empty set is a deleted row (plan 0036,
 * section 2.2), so a test that wants no access omits the row rather than making
 * one with nothing in it.
 */
export function makeListAccess(
  overrides: Partial<SeedListAccess> = {}
): SeedListAccess {
  return {
    id: uuid(),
    listId: uuid(),
    membershipId: uuid(),
    permissions: [ListPermission.READ],
    ...overrides,
  };
}

export function makeLine(overrides: Partial<SeedLine> = {}): SeedLine {
  return {
    id: uuid(),
    listId: uuid(),
    content: 'An item',
    quantity: 1,
    itemId: null,
    position: 1000,
    approvalStatus: LineApprovalStatus.PENDING,
    status: LineStatus.PENDING,
    createdByUserId: uuid(),
    approvedByUserId: null,
    version: 1,
    ...overrides,
  };
}

export function makeComment(overrides: Partial<SeedComment> = {}): SeedComment {
  return {
    id: uuid(),
    lineId: uuid(),
    authorUserId: uuid(),
    body: 'A comment',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function makeMergeRequest(
  overrides: Partial<SeedMergeRequest> = {}
): SeedMergeRequest {
  return {
    id: uuid(),
    zoneId: uuid(),
    sourceUserId: uuid(),
    targetUserId: uuid(),
    requestedByUserId: uuid(),
    status: MergeRequestStatus.PENDING,
    resolvedByUserId: null,
    ...overrides,
  };
}

// --- Catalog -----------------------------------------------------------------

export function makeSupermarket(
  overrides: Partial<SeedSupermarket> = {}
): SeedSupermarket {
  return {
    id: uuid(),
    name: { en: 'A Supermarket', es: 'Un supermercado' },
    logoUrl: null,
    websiteUrl: null,
    externalBrandKey: null,
    ...overrides,
  };
}

/**
 * A price scope (plan 0038, section 5.1). Defaults to a `STORE` scope, which is
 * the shape catalog had before scopes existed and the one a hand entered
 * supermarket still gets.
 */
export function makePriceScope(
  overrides: Partial<SeedPriceScope> = {}
): SeedPriceScope {
  return {
    id: uuid(),
    supermarketId: uuid(),
    kind: PriceScopeKind.STORE,
    externalKey: null,
    label: null,
    ...overrides,
  };
}

export function makeSupermarketLocation(
  overrides: Partial<SeedSupermarketLocation> = {}
): SeedSupermarketLocation {
  return {
    id: uuid(),
    supermarketId: uuid(),
    priceScopeId: uuid(),
    label: null,
    address: null,
    city: null,
    country: null,
    postalCode: null,
    latitude: null,
    longitude: null,
    externalRef: null,
    externalProvider: null,
    ...overrides,
  };
}

export function makeItem(overrides: Partial<SeedItem> = {}): SeedItem {
  return {
    id: uuid(),
    name: { en: 'An Item', es: 'Un artículo' },
    brand: null,
    imageUrl: null,
    sku: null,
    ean: null,
    unitSize: null,
    category: ItemCategory.OTHER,
    defaultUnit: UnitOfMeasure.UNIT,
    ...overrides,
  };
}

export function makeSupermarketItem(
  overrides: Partial<SeedSupermarketItem> = {}
): SeedSupermarketItem {
  return {
    id: uuid(),
    itemId: uuid(),
    priceScopeId: uuid(),
    price: null,
    currency: null,
    unitPrice: null,
    unitPriceLabel: null,
    priceObservedAt: null,
    // A seeded price was put there by a person, so ADMIN is the honest default
    // and section 6.5 will protect it from an import exactly as intended.
    priceSourceKind: PriceSourceKind.ADMIN,
    available: true,
    ...overrides,
  };
}

export function makeSupermarketLocationItem(
  overrides: Partial<SeedSupermarketLocationItem> = {}
): SeedSupermarketLocationItem {
  return {
    id: uuid(),
    itemId: uuid(),
    supermarketLocationId: uuid(),
    positionInStore: null,
    // Null means "no store specific information, use the scope's".
    available: null,
    ...overrides,
  };
}
