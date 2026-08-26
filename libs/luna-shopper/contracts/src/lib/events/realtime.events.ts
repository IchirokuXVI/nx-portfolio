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
  /**
   * A member's per zone username changed (plan 0018, section 7), whether they
   * renamed themselves, an admin renamed them, or a global rename propagated.
   * The payload is the existing {@link MembershipView}, emitted once per
   * affected membership into that membership's own zone room.
   */
  MemberUsernameChanged = 'member.usernameChanged',

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

  // Presence (plan 0009, section 7). Unlike the events above these are NOT
  // published by a domain service; the realtime service computes them from live
  // connections and emits them straight to the room. They are named here so the
  // client and server agree on the string, but they are deliberately excluded
  // from {@link DOMAIN_EVENT_SUBJECTS} (nothing feeds them into JetStream).
  PresenceZoneUpdated = 'presence.zoneUpdated',
  PresenceListUpdated = 'presence.listUpdated',
}

/**
 * The subjects the realtime service captures in JetStream and fans out (plan
 * 0009, section 4). It is the explicit set of events the domain services publish,
 * so a durable stream configured with exactly these subjects never picks up the
 * request/reply command subjects that share a prefix (`zone.update` the command
 * versus `zone.updated` the event) nor the presence events, which have no
 * publisher. Keep in sync when a new domain event is added above.
 */
export const DOMAIN_EVENT_SUBJECTS: readonly RealtimeEvent[] = [
  RealtimeEvent.ZoneUpdated,
  RealtimeEvent.ZoneDeleted,
  RealtimeEvent.ZoneMarkedForDeletion,
  RealtimeEvent.ZoneOwnershipChanged,
  RealtimeEvent.MemberJoined,
  RealtimeEvent.MemberApproved,
  RealtimeEvent.MemberRejected,
  RealtimeEvent.MemberKicked,
  RealtimeEvent.MemberBanned,
  RealtimeEvent.MemberRoleChanged,
  RealtimeEvent.MemberUsernameChanged,
  RealtimeEvent.ListCreated,
  RealtimeEvent.ListUpdated,
  RealtimeEvent.ListDeleted,
  RealtimeEvent.ListAccessChanged,
  RealtimeEvent.LineAdded,
  RealtimeEvent.LineUpdated,
  RealtimeEvent.LineReordered,
  RealtimeEvent.LineDeleted,
  RealtimeEvent.CommentAdded,
  RealtimeEvent.MergeRequested,
  RealtimeEvent.MergeApproved,
  RealtimeEvent.MergeRejected,
] as const;

/**
 * The envelope every domain event shares: which zone it belongs to (the realtime
 * fan out is scoped per zone) and an id for idempotent consumers. List, line and
 * comment events also carry the `listId` so the realtime service can route them
 * to the `list:{listId}` room without having to know each payload's shape (plan
 * 0009, section 6). The `payload` is event specific.
 */
export interface DomainEvent<T = unknown> {
  event: RealtimeEvent;
  /** Unique id for dedupe on the consumer (at-least-once delivery). */
  eventId: string;
  zoneId: string;
  /** Present on list-scoped events (list/line/comment) for `list:` room routing. */
  listId?: string;
  payload: T;
}
