/**
 * Domain events core publishes for the realtime fan out (plan 0006, section 9;
 * plan 0007, section 5), wired to sockets in plan 0009. One enum names every
 * event so the realtime service can subscribe by name and a consumer stays
 * idempotent by event id (plan 0004, section 9). Values are the NATS subjects.
 */
export enum RealtimeEvent {
  // Zones (plan 0006)
  ZoneUpdated = 'zone.updated',
  ZoneDeleted = 'zone.deleted',
  ZoneMarkedForDeletion = 'zone.markedForDeletion',
  ZoneOwnershipChanged = 'zone.ownershipChanged',

  // Membership (plan 0006)
  MemberJoined = 'member.joined',
  MemberApproved = 'member.approved',
  MemberRejected = 'member.rejected',
  MemberKicked = 'member.kicked',
  MemberBanned = 'member.banned',
  MemberRoleChanged = 'member.roleChanged',

  // Lists / lines / comments (plan 0007)
  ListCreated = 'list.created',
  ListUpdated = 'list.updated',
  ListDeleted = 'list.deleted',
  ListAccessChanged = 'list.accessChanged',
  LineAdded = 'line.added',
  LineUpdated = 'line.updated',
  LineReordered = 'line.reordered',
  LineDeleted = 'line.deleted',
  CommentAdded = 'comment.added',

  // Account merge (plan 0008). `MergeApproved` also implies a `MemberKicked` for
  // the source membership, emitted alongside it.
  MergeRequested = 'merge.requested',
  MergeApproved = 'merge.approved',
  MergeRejected = 'merge.rejected',
}

/**
 * The envelope every domain event shares: which zone it belongs to (the realtime
 * fan out is scoped per zone) and an id for idempotent consumers. The `payload`
 * is event specific.
 */
export interface DomainEvent<T = unknown> {
  event: RealtimeEvent;
  /** Unique id for dedupe on the consumer (at-least-once delivery). */
  eventId: string;
  zoneId: string;
  payload: T;
}
