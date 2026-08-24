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
} as const;

export const MEMBERSHIP_PATTERNS = {
  approve: 'membership.approve',
  reject: 'membership.reject',
  kick: 'membership.kick',
  ban: 'membership.ban',
} as const;

/** A zone as returned to clients. */
export interface ZoneView {
  id: string;
  name: string;
  joinCode: string;
  status: ZoneStatus;
  ownerUserId: string | null;
  config: Record<string, unknown>;
}

/** A membership as returned to clients. */
export interface MembershipView {
  id: string;
  zoneId: string;
  userId: string;
  username: string;
  role: ZoneRole;
  status: MembershipStatus;
}

/** A zone annotated with the caller's own membership (plan 0006, section 7). */
export interface MyZoneView extends ZoneView {
  myRole: ZoneRole;
  myStatus: MembershipStatus;
}

export interface CreateZoneRequest {
  userId: string;
  name: string;
  username: string;
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

export interface ListMyZonesRequest extends PageQuery {
  userId: string;
}

export type ZonePage = Paginated<MyZoneView>;

/** Fields a caller may order their zone listing by (plan 0006, section 7). */
export const MY_ZONE_ORDERS = ['name', 'joined', 'recent'] as const;
export type MyZoneOrder = (typeof MY_ZONE_ORDERS)[number];
