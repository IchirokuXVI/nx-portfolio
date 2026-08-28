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
  ListRole,
  MembershipStatus,
  MergeRequestStatus,
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
  SeedSupermarket,
  SeedSupermarketItem,
  SeedSupermarketLocation,
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
    ...overrides,
  };
}

export function makeListAccess(
  overrides: Partial<SeedListAccess> = {}
): SeedListAccess {
  return {
    id: uuid(),
    listId: uuid(),
    membershipId: uuid(),
    role: ListRole.READER,
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
    ...overrides,
  };
}

export function makeSupermarketLocation(
  overrides: Partial<SeedSupermarketLocation> = {}
): SeedSupermarketLocation {
  return {
    id: uuid(),
    supermarketId: uuid(),
    label: null,
    address: null,
    city: null,
    country: null,
    latitude: null,
    longitude: null,
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
    supermarketLocationId: uuid(),
    price: null,
    currency: null,
    positionInStore: null,
    available: true,
    ...overrides,
  };
}
