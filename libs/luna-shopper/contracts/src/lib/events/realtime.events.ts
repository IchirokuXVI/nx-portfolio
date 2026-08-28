/**
 * Domain events core publishes for the realtime fan out (plan 0006, section 9;
 * plan 0007, section 5), wired to sockets in plan 0009. One enum names every
 * event so the realtime service can subscribe by name and a consumer stays
 * idempotent by event id (plan 0004, section 9). Values are the NATS subjects.
 */
export enum RealtimeEvent {
  // Zones (plan 0006)
  /**
   * A zone was created (plan 0030, section 4.2). Addressed to the creator alone
   * and to no zone room: nobody is in the new zone's room, so routing it there
   * would send it nowhere. The payload is the {@link ZoneView} the endpoint
   * returns, which is enough for another of the creator's tabs to identify the
   * zone and ask for the rest.
   */
  ZoneCreated = 'zone.created',
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

  // Zone summary (plan 0017, section 9). Carries the counts a client cannot
  // derive from the events above, chiefly the next pending requester's name.
  ZoneCountsUpdated = 'zone.countsUpdated',

  // Lists / lines / comments (plan 0007)
  ListCreated = 'list.created',
  ListUpdated = 'list.updated',
  ListDeleted = 'list.deleted',
  ListAccessChanged = 'list.accessChanged',
  /**
   * One person's own permissions on one list changed (plan 0036, section 8),
   * addressed to that person's sessions.
   *
   * The companion of {@link ListAccessChanged} and not a replacement for it. That
   * one goes to the list room and says only that the table changed, which is
   * adequate for everybody who **kept** access and useless for the two people the
   * change is actually about: it names nobody, and somebody who has just been
   * granted access was never in the room to receive it.
   */
  ListMyAccessChanged = 'list.myAccessChanged',
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

  /**
   * A user's global username changed (plan 0030, section 4.3), addressed to that
   * user's own sessions and to nothing else.
   *
   * It shares its string with the identity event auth publishes
   * ({@link IDENTITY_EVENTS.userUsernameChanged}) and is not the same message:
   * that one is service to service, carries its own envelope and is consumed by
   * core, which re publishes it here as a domain event for the fan out. The
   * string is shared because this value is what a client listens on, and the two
   * are kept off each other's streams by {@link domainEventSubject}.
   */
  UserUsernameChanged = 'user.usernameChanged',
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
  RealtimeEvent.ZoneCreated,
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
  RealtimeEvent.ZoneCountsUpdated,
  RealtimeEvent.ListCreated,
  RealtimeEvent.ListUpdated,
  RealtimeEvent.ListDeleted,
  RealtimeEvent.ListAccessChanged,
  RealtimeEvent.ListMyAccessChanged,
  RealtimeEvent.LineAdded,
  RealtimeEvent.LineUpdated,
  RealtimeEvent.LineReordered,
  RealtimeEvent.LineDeleted,
  RealtimeEvent.CommentAdded,
  RealtimeEvent.MergeRequested,
  RealtimeEvent.MergeApproved,
  RealtimeEvent.MergeRejected,
  RealtimeEvent.UserUsernameChanged,
] as const;

/**
 * The NATS subject a domain event is published on and captured under, which is
 * the event's own name for all but one of them.
 *
 * The exception is {@link RealtimeEvent.UserUsernameChanged}, and plan 0030
 * section 4.3 asks for the choice to be made here and written down. It is
 * `user.usernameChanged.broadcast`, because auth already publishes an identity
 * event on the bare `user.usernameChanged`: capturing that subject into the
 * realtime stream would pull auth's service to service message into the fan out
 * consumer, which would decode it as a {@link DomainEvent}, find no audience on
 * it and log a fault on every rename. The client facing name is untouched, since
 * the socket emits {@link DomainEvent.event} and not the subject.
 */
export function domainEventSubject(event: RealtimeEvent): string {
  return event === RealtimeEvent.UserUsernameChanged
    ? `${event}.broadcast`
    : event;
}

/** {@link DOMAIN_EVENT_SUBJECTS} as the stream captures them. */
export const DOMAIN_EVENT_STREAM_SUBJECTS: readonly string[] =
  DOMAIN_EVENT_SUBJECTS.map(domainEventSubject);

/**
 * The envelope every domain event shares: an id for idempotent consumers, and
 * the **audience** the producer states so the consumer can route without knowing
 * a single payload shape (plan 0009, section 6; plan 0030, section 3).
 *
 * Every field of that audience is optional and at least one must be set. An
 * envelope naming none of them reaches nobody, and the consumer drops it as a
 * fault rather than fanning it out to an empty room list: it is the one mistake
 * an optional `zoneId` makes possible, and a silent no-op is how it would be
 * found six months later by somebody wondering why one event never arrives.
 */
export interface DomainEvent<T = unknown> {
  event: RealtimeEvent;
  /** Unique id for dedupe on the consumer (at-least-once delivery). */
  eventId: string;
  /** The `zone:{zoneId}` room, when the event belongs to a zone. */
  zoneId?: string;
  /** Present on list-scoped events (list/line/comment) for `list:` room routing. */
  listId?: string;
  /**
   * Users whose own sessions must hear this whatever rooms they hold (plan 0030,
   * section 3.1). Stated by the producer, which built the payload and knows
   * whose membership it is; a consumer that reached into a payload for a
   * `userId` would be right for six membership events and wrong the first time a
   * payload named a user for some other reason.
   */
  userIds?: readonly string[];
  payload: T;
}
