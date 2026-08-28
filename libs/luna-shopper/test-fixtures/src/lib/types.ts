/**
 * The entity shaped objects the fixtures produce (plan 0013, section 1).
 *
 * These are plain, framework free interfaces that mirror the columns of the
 * service entities WITHOUT importing them: the entity classes live inside each
 * app (auth / core / catalog) and are not importable across the app boundary, so
 * the fixtures library depends only on `@portfolio/luna-shopper/contracts` for
 * the shared enums and localized text. Each service's seeder maps these onto its
 * own `repo.create(...)` calls.
 *
 * Secrets are carried in their pre hash form: a credential holds a plaintext
 * `password`, which the auth seeder hashes with argon2 before insert, so the
 * stored hash is genuinely valid rather than a hand written constant that drifts.
 */

import type {
  AuthProvider,
  ItemCategory,
  LineApprovalStatus,
  LineStatus,
  ListRole,
  LocalizedText,
  MembershipStatus,
  MergeRequestStatus,
  UnitOfMeasure,
  UserKind,
  ZoneRole,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';

// --- Auth half ---------------------------------------------------------------

export interface SeedUser {
  id: string;
  kind: UserKind;
  email: string | null;
  emailVerifiedAt: Date | null;
  displayName: string | null;
  /** The global username (plan 0018): never null, and not unique. */
  username: string;
}

export interface SeedCredential {
  id: string;
  userId: string;
  /** Plaintext; the auth seeder hashes it with argon2id before insert. */
  password: string;
}

export interface SeedOAuthIdentity {
  id: string;
  userId: string;
  provider: AuthProvider;
  providerUserId: string;
}

export interface AuthSeed {
  users: SeedUser[];
  credentials: SeedCredential[];
  oauthIdentities: SeedOAuthIdentity[];
}

// --- Core half ---------------------------------------------------------------

export interface SeedZone {
  id: string;
  name: string;
  config: Record<string, unknown>;
  joinCode: string;
  status: ZoneStatus;
  ownerUserId: string | null;
  markedForDeletionAt: Date | null;
}

export interface SeedMembership {
  id: string;
  zoneId: string;
  userId: string;
  username: string;
  role: ZoneRole;
  status: MembershipStatus;
  approvedByUserId: string | null;
}

export interface SeedList {
  id: string;
  zoneId: string;
  name: string;
  createdByUserId: string;
}

export interface SeedListAccess {
  id: string;
  listId: string;
  membershipId: string;
  role: ListRole;
}

export interface SeedLine {
  id: string;
  listId: string;
  content: string;
  quantity: number;
  /** Opaque reference into the catalog `items` table, or null (item optional). */
  itemId: string | null;
  position: number;
  approvalStatus: LineApprovalStatus;
  status: LineStatus;
  createdByUserId: string;
  approvedByUserId: string | null;
  version: number;
}

export interface SeedComment {
  id: string;
  lineId: string;
  authorUserId: string;
  body: string;
  /** Set explicitly so the newest to oldest order is deterministic across reseeds. */
  createdAt: Date;
}

export interface SeedMergeRequest {
  id: string;
  zoneId: string;
  sourceUserId: string;
  targetUserId: string;
  requestedByUserId: string;
  status: MergeRequestStatus;
  resolvedByUserId: string | null;
}

export interface CoreSeed {
  zones: SeedZone[];
  memberships: SeedMembership[];
  lists: SeedList[];
  listAccess: SeedListAccess[];
  lines: SeedLine[];
  comments: SeedComment[];
  mergeRequests: SeedMergeRequest[];
}

// --- Catalog half ------------------------------------------------------------

export interface SeedSupermarket {
  id: string;
  name: LocalizedText;
  logoUrl: string | null;
  websiteUrl: string | null;
}

export interface SeedSupermarketLocation {
  id: string;
  supermarketId: string;
  label: LocalizedText | null;
  address: string | null;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface SeedItem {
  id: string;
  name: LocalizedText;
  brand: string | null;
  imageUrl: string | null;
  sku: string | null;
  category: ItemCategory;
  defaultUnit: UnitOfMeasure;
}

export interface SeedSupermarketItem {
  id: string;
  itemId: string;
  supermarketLocationId: string;
  price: number | null;
  currency: string | null;
  positionInStore: string | null;
  available: boolean;
}

export interface CatalogSeed {
  supermarkets: SeedSupermarket[];
  locations: SeedSupermarketLocation[];
  items: SeedItem[];
  supermarketItems: SeedSupermarketItem[];
}

/** The whole demo world, pre partitioned by owning database. */
export interface DemoWorld {
  auth: AuthSeed;
  core: CoreSeed;
  catalog: CatalogSeed;
}
