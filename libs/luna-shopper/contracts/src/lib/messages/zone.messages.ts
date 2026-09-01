import type {
  MembershipStatus,
  ZoneRole,
  ZoneStatus,
} from '../enums/zone.enums';
import type { PageQuery, Paginated } from '../pagination';

/**
 * Zone and membership message contracts (plan 0006). The gateway calls these on
 * core over NATS; core resolves the caller's membership locally and authorizes
 * every operation (section 6). Each request that acts on behalf of a user carries
 * the resolved `userId` (the gateway sets it from the verified token), never
 * trusting a body-supplied id.
 */
export const ZONE_PATTERNS = {
  create: 'zone.create',
  join: 'zone.join',
  update: 'zone.update',
  delete: 'zone.delete',
  regenerateJoinCode: 'zone.regenerateJoinCode',
  setRole: 'zone.setRole',
  transferOwnership: 'zone.transferOwnership',
  claimOwnership: 'zone.claimOwnership',
  listMine: 'zone.listMine',
  /** One zone with its summary, without paging to find it (plan 0017, section 3.6). */
  get: 'zone.get',
  /**
   * Resolve a join code to the group behind it (plan 0024, section 1), so a join
   * sheet can name the group before anybody commits to it. Read only: it creates
   * no membership and tells the zone's owner nothing.
   */
  getByCode: 'zone.getByCode',
  /** How many zones the caller owns, joined and is waiting on (plan 0017, section 3.5). */
  countsMine: 'zone.countsMine',
} as const;

export const MEMBERSHIP_PATTERNS = {
  approve: 'membership.approve',
  reject: 'membership.reject',
  kick: 'membership.kick',
  ban: 'membership.ban',
  /** Read a zone's members (plan 0017, section 5). */
  list: 'membership.list',
  /** Rename one membership: the member themselves, or the zone's owner/admins. */
  setUsername: 'membership.setUsername',
} as const;

/** A zone as returned to clients. */
export interface ZoneView {
  id: string;
  name: string;
  joinCode: string;
  status: ZoneStatus;
  ownerUserId: string | null;
  config: Record<string, unknown>;
  /** ISO 8601 UTC (plan 0017, section 7). */
  createdAt: string;
  /** ISO 8601 UTC (plan 0017, section 7). */
  updatedAt: string;
}

/**
 * What an unauthenticated caller learns from a join code (plan 0024, section 1.2).
 *
 * Deliberately two fields. This is an unauthenticated lookup keyed on a low
 * entropy secret, so it answers the question the join sheet asks and nothing
 * else: no id, no status, no owner, no created date and no echo of the code. The
 * id in particular is withheld because joining is by code, so no client needs
 * it, and withholding it means a scraped code cannot become a stable handle for
 * the zone.
 */
export interface ZoneByCodeView {
  name: string;
  /** APPROVED memberships, the same number {@link ZoneCounts} reports. */
  memberCount: number;
}

/** A membership as returned to clients. */
export interface MembershipView {
  id: string;
  zoneId: string;
  userId: string;
  username: string;
  role: ZoneRole;
  status: MembershipStatus;
  /** ISO 8601 UTC. When the member joined or last re-requested (plan 0017, section 7). */
  createdAt: string;
  /** ISO 8601 UTC (plan 0017, section 7). */
  updatedAt: string;
}

/** The summary numbers shown on a zone card (plan 0017, section 3). */
export interface ZoneCounts {
  /** APPROVED memberships. Pending members are not members yet. */
  memberCount: number;
  /**
   * Lists in the zone **that the caller may read** (section 3.2). Not the zone's
   * total list count.
   */
  listCount: number;
  /**
   * PENDING memberships. `null` for a caller who is not OWNER or ADMIN of the
   * zone: who is waiting to join is governance data (section 6).
   */
  pendingRequestCount: number | null;
  /**
   * The per zone username of the oldest PENDING membership, or `null` when there
   * are none, or when the caller may not see governance data. Oldest by
   * `createdAt`, tie broken by `id`, so it is stable across pages and refreshes.
   */
  firstPendingRequesterName: string | null;
}

/** A list as it appears in a zone's inline preview (plan 0017, section 3.3). */
export interface ZoneListPreview {
  id: string;
  name: string;
  lineCount: number;
  /**
   * Lines the household wants right now (plan 0047, section 2.3). Renamed from
   * `readyCount` with the count itself, so a card says how much is needed rather
   * than how much of some past trip is done.
   */
  wantedCount: number;
}

/** A zone annotated with the caller's own membership (plan 0006, section 7). */
export interface MyZoneView extends ZoneView {
  myRole: ZoneRole;
  myStatus: MembershipStatus;
  /** The summary numbers, always present (plan 0017, section 3.1). */
  counts: ZoneCounts;
  /**
   * At most three of the zone's lists, newest activity first, filtered exactly
   * as `counts.listCount` is (plan 0017, section 3.3). Empty means the caller
   * can read no list in this zone, never that the zone is empty.
   */
  lists: ZoneListPreview[];
  /**
   * The owner's per zone name, or null when the zone has no owner (plan 0024,
   * section 2). It is here rather than on {@link ZoneView} because the mutation
   * endpoints return that one and would pay for a subquery none of them reads.
   *
   * Null is a real case: an owner who deletes their account leaves the zone
   * unowned (plan 0011), and the waiting card renders its name free string then.
   */
  ownerUsername: string | null;
}

/**
 * The part of {@link ZoneCounts} that does not depend on who is asking, which is
 * what a room broadcast can carry (plan 0017, section 9). `listCount` is access
 * filtered per caller and the preview is an array, so neither belongs in an
 * event with no single asker; a client derives `listCount` from the list
 * created/deleted events it already receives.
 */
export type BroadcastZoneCounts = Omit<ZoneCounts, 'listCount'>;

/**
 * Payload of {@link RealtimeEvent.ZoneCountsUpdated} (plan 0017, section 9). The
 * governance fields are filled only in the `zone:{id}:staff` room; the plain zone
 * room receives the same event with both of them `null`.
 */
export interface ZoneCountsUpdatedPayload {
  zoneId: string;
  counts: BroadcastZoneCounts;
}

/**
 * `username` stays required on the NATS contract even though the REST body may
 * omit it (plan 0018, section 9): core must be told what to write and must never
 * reach into auth for it, so the gateway resolves the caller's global username
 * before sending.
 */
export interface CreateZoneRequest {
  userId: string;
  name: string;
  username: string;
}

/** Look up the zone behind a join code (plan 0024, section 1). No `userId`: the route is public. */
export interface GetZoneByCodeRequest {
  joinCode: string;
}

export interface JoinZoneRequest {
  userId: string;
  joinCode: string;
  username: string;
}

export interface UpdateZoneRequest {
  userId: string;
  zoneId: string;
  name?: string;
  config?: Record<string, unknown>;
}

export interface ZoneIdRequest {
  userId: string;
  zoneId: string;
}

export interface SetRoleRequest {
  userId: string;
  zoneId: string;
  membershipId: string;
  role: ZoneRole;
}

export interface MembershipActionRequest {
  userId: string;
  zoneId: string;
  membershipId: string;
}

/**
 * Rename one membership (plan 0018, section 5). One message covers both the
 * member renaming themselves in a single zone and an owner/admin renaming
 * someone; they are the same write with two authorization branches, resolved
 * from the caller's own membership.
 */
export interface SetMembershipUsernameRequest {
  /** The caller, from the verified token. */
  userId: string;
  zoneId: string;
  membershipId: string;
  username: string;
}

export interface ListMyZonesRequest extends PageQuery {
  userId: string;
}

export interface MyZoneCountsRequest {
  userId: string;
}

/** How many zones the caller is in, split the way the UI groups them. */
export interface MyZoneCounts {
  /** Zones where the caller holds an APPROVED membership with role OWNER. */
  owned: number;
  /** APPROVED memberships that are not OWNER. */
  joined: number;
  /** PENDING memberships: zones the caller has asked to join. */
  pending: number;
  /** `owned + joined`, the number `zone.listMine` would return with no cursor. */
  total: number;
}

export interface ListMembersRequest extends PageQuery {
  userId: string;
  zoneId: string;
  /**
   * Which statuses to return. Defaults to `[APPROVED]`. Any value other than
   * APPROVED requires the caller to be OWNER or ADMIN (plan 0017, section 6).
   */
  statuses?: MembershipStatus[];
}

export type ZonePage = Paginated<MyZoneView>;
export type MembershipPage = Paginated<MembershipView>;

/** Fields a caller may order their zone listing by (plan 0006, section 7). */
export const MY_ZONE_ORDERS = ['name', 'joined', 'recent'] as const;
export type MyZoneOrder = (typeof MY_ZONE_ORDERS)[number];

/** Fields a caller may order the member listing by (plan 0017, section 5). */
export const MEMBER_ORDERS = ['joined', 'name', 'role'] as const;
export type MemberOrder = (typeof MEMBER_ORDERS)[number];
