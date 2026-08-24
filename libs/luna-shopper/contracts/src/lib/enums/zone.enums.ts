/**
 * Zone and membership enums (plan 0006, section 1). Cross service because the
 * gateway and realtime read them too; string values are the wire format and must
 * stay stable.
 */

/** A zone's lifecycle. A zone with no owner is marked for deletion (plan 0011). */
export enum ZoneStatus {
  ACTIVE = 'ACTIVE',
  MARKED_FOR_DELETION = 'MARKED_FOR_DELETION',
}

/**
 * A member's role in a zone. At most one OWNER (may be absent); any number of
 * ADMIN; everyone else is MEMBER (plan 0006, section 2).
 */
export enum ZoneRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
}

/**
 * A membership's status. A new join is PENDING until approved; KICKED may
 * re-request; BANNED is blocked from rejoining (plan 0006, section 4).
 */
export enum MembershipStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  KICKED = 'KICKED',
  BANNED = 'BANNED',
}
