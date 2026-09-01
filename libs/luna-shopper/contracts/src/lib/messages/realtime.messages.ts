import { RealtimeRoom } from '../enums/realtime.enums';
import type { ParticipantPresenceEntry } from './generated-list-sharing.messages';

/**
 * Realtime message and payload contracts (plan 0009). Two kinds live here: the
 * NATS request/reply subjects the realtime service calls on core to authorize a
 * room subscription (section 5), and the shapes the realtime service pushes to
 * clients over both transports (sections 6 and 7). Both sides import these so a
 * socket client and an SSE client see identical payloads.
 */

/** Builds the `zone:{zoneId}` room name. */
export function zoneRoom(zoneId: string): string {
  return `${RealtimeRoom.Zone}:${zoneId}`;
}

/**
 * Builds the `zone:{zoneId}:staff` room name (plan 0017, section 9): the same
 * zone, restricted to the owners and admins who may see governance data. It is
 * derived from {@link zoneRoom} so the two can never drift apart.
 */
export function zoneStaffRoom(zoneId: string): string {
  return `${zoneRoom(zoneId)}:staff`;
}

/** Builds the `list:{listId}` room name. */
export function listRoom(listId: string): string {
  return `${RealtimeRoom.List}:${listId}`;
}

/**
 * Builds the `user:{userId}` room name: the one room addressed to a person
 * rather than to a resource (plan 0030, section 2).
 *
 * It lives here beside the three resource rooms because every server half needs
 * it (the socket gateway joins it at connection, the SSE controller adds it to
 * whichever stream is open, and the JetStream consumer routes to it) while the
 * client half needs to know nothing about it: nobody subscribes to this one.
 */
export function userRoom(userId: string): string {
  return `${RealtimeRoom.User}:${userId}`;
}

/**
 * Builds the `list:{listId}:presence` room name (plan 0032): everyone in the
 * zone who may read this list, whether or not they have it open.
 *
 * A room of its own rather than {@link listRoom}, and the distinction is the
 * whole design. `list:{listId}` carries every line and comment event, so joining
 * it eagerly would push every edit of every readable list to every device
 * permanently, and would destroy what that room means, which today is "I am
 * looking at this list". This one carries `presence.listUpdated` and nothing
 * else, so a group page can light a dot per row without opening a room per row.
 *
 * Derived from {@link listRoom} so the two cannot drift, and derivable from a
 * list id alone, which is what lets the presence broadcast reach it: the
 * broadcaster knows the list, never the zone.
 */
export function listPresenceRoom(listId: string): string {
  return `${listRoom(listId)}:presence`;
}

/**
 * Builds the `generated:{generatedListId}` room name (plan 0051, section 7):
 * everybody holding a live participant credential for one shared basket.
 *
 * The first room here whose members are **participants** rather than users, which
 * is what makes a guest reachable at all: a guest has no user id, so
 * {@link userRoom} could never address them and the owner's own room, which is
 * where plan 0050 put every basket event, reaches exactly one person.
 */
export function generatedListRoom(generatedListId: string): string {
  return `${RealtimeRoom.GeneratedList}:${generatedListId}`;
}

/**
 * Builds the `generated:{generatedListId}:presence` room name (plan 0051,
 * section 7).
 *
 * Split from {@link generatedListRoom} for the same reason
 * {@link listPresenceRoom} is split from {@link listRoom}: that room carries
 * every line edit and every settle, and a client that wants only to know who else
 * is in the shop should not have to take the traffic to find out.
 */
export function generatedListPresenceRoom(generatedListId: string): string {
  return `${generatedListRoom(generatedListId)}:presence`;
}

/**
 * What a room name refers to, once read back apart (plan 0031, section 4).
 *
 * The eviction sweep is handed the rooms a socket holds, as strings, and has to
 * turn each one back into the access question that admitted it. Reading them
 * apart here, next to the builders, is what stops the two drifting: a room shape
 * added above with no case below is a room nothing can re-check, and the sweep
 * would leave a socket in it forever without ever saying so.
 */
export type ParsedRoom =
  | { kind: 'zone'; zoneId: string }
  | { kind: 'zoneStaff'; zoneId: string }
  | { kind: 'list'; listId: string }
  | { kind: 'listPresence'; listId: string }
  | { kind: 'generatedList'; generatedListId: string }
  | { kind: 'generatedListPresence'; generatedListId: string };

/**
 * Read a room name back into the access question that gates it, or `undefined`
 * for a name this service did not build.
 *
 * Socket.io puts every socket in a room named after its own id, so `undefined`
 * is an ordinary answer here rather than a fault, and the sweep passes over it.
 *
 * {@link userRoom} is the one room deliberately left unparsed. Every other room
 * here is a claim on a resource that an access answer can revoke; that one is
 * the verified token itself (plan 0030, section 2), so there is no question to
 * re-ask and nothing the sweep could ever be right to evict a socket from.
 */
export function parseRoom(room: string): ParsedRoom | undefined {
  const parts = room.split(':');

  if (parts[0] === RealtimeRoom.Zone) {
    if (parts.length === 2) {
      return { kind: 'zone', zoneId: parts[1] };
    }
    if (parts.length === 3 && parts[2] === 'staff') {
      return { kind: 'zoneStaff', zoneId: parts[1] };
    }
  }
  if (parts[0] === RealtimeRoom.List) {
    if (parts.length === 2) {
      return { kind: 'list', listId: parts[1] };
    }
    if (parts.length === 3 && parts[2] === 'presence') {
      return { kind: 'listPresence', listId: parts[1] };
    }
  }
  // Plan 0051, section 7. Both cases are parsed rather than left out like
  // `userRoom`, because both are claims a revocation can take back: revoking a
  // participant has to evict their socket, and section 3.3 promises there is no
  // cache to wait out.
  if (parts[0] === RealtimeRoom.GeneratedList) {
    if (parts.length === 2) {
      return { kind: 'generatedList', generatedListId: parts[1] };
    }
    if (parts.length === 3 && parts[2] === 'presence') {
      return { kind: 'generatedListPresence', generatedListId: parts[1] };
    }
  }
  return undefined;
}

/**
 * Access checks the realtime service asks core before adding a socket to a room
 * (plan 0009, section 5). They mirror the socket rooms: a zone check gates the
 * `zone:` room, a list check gates the `list:` room. Core resolves membership and
 * list access from its own tables using the token `userId`, exactly as it does
 * for every other request.
 */
export const REALTIME_ACCESS_PATTERNS = {
  checkZone: 'realtime.checkZoneAccess',
  /**
   * Gates the `zone:{zoneId}:staff` room (plan 0017, section 9): core answers
   * yes only for an APPROVED OWNER or ADMIN, which is the same rule that decides
   * whether the governance fields are filled over REST.
   */
  checkZoneStaff: 'realtime.checkZoneStaffAccess',
  checkList: 'realtime.checkListAccess',
  /**
   * Gates the two `generated:{id}` rooms (plan 0051, section 7), and it is the
   * one access check here that names a **participant** rather than a user.
   *
   * Asked by participant id because that is what the socket's token carries: a
   * guest has no user id, so none of the three checks above could be asked about
   * them at all. Core answers from the participant row alone, reading `revokedAt`
   * on it, which is section 3.3's one indexed lookup.
   *
   * **Never cached**, unlike the other three. Section 3.3 promises revocation
   * bites immediately and that there is no cache to wait out, and a basket lives
   * about as long as a shopping trip, so there is no traffic here worth trading
   * that promise for.
   */
  checkParticipant: 'realtime.checkParticipantAccess',
} as const;

export interface CheckZoneAccessRequest {
  userId: string;
  zoneId: string;
}

export interface CheckListAccessRequest {
  userId: string;
  listId: string;
}

/**
 * Whether this participant is still live on this basket (plan 0051, section 7).
 *
 * The basket is named as well as the participant, so a participant id for one
 * basket can never admit a socket to another's room. The id alone would be enough
 * to find the row, which is exactly why the room is checked against it rather
 * than trusted from the token.
 */
export interface CheckParticipantAccessRequest {
  participantId: string;
  generatedListId: string;
}

/** Whether the caller may join the requested room. */
export interface AccessCheckResult {
  allowed: boolean;
  /**
   * On a zone check only: the lists in that zone this caller may read (plan
   * 0032, section 4.1).
   *
   * It rides on the zone answer because subscribing to a zone is already a round
   * trip to core, so this adds a field rather than a call. The realtime service
   * joins a presence room per id, which is how a group page lights a dot per row
   * without opening a room per row.
   */
  listIds?: readonly string[];
  /**
   * On a participant check only: who this participant is, for presence (plan
   * 0051, section 7).
   *
   * It rides on the liveness answer for the same reason `listIds` rides on the
   * zone one: admitting a participant socket is already a round trip to core, and
   * the alternative was putting the display name and guest number in the token,
   * where a guest who renamed themselves would be pinned to the old name for the
   * life of it. Read fresh on every admission, which is also every reconnection.
   */
  participant?: ParticipantPresenceEntry;
}

/** A user present in a zone or on a list. */
export interface PresenceUser {
  userId: string;
}

/** A user editing a specific line (or the list generally when `lineId` is null). */
export interface PresenceEditor extends PresenceUser {
  lineId: string | null;
}

/** Payload of {@link RealtimeEvent.PresenceZoneUpdated}: who is online in a zone. */
export interface ZonePresence {
  zoneId: string;
  online: PresenceUser[];
}

/**
 * Payload of {@link RealtimeEvent.PresenceListUpdated}: who is viewing a list and
 * who is editing it right now (plan 0009, section 7).
 */
export interface ListPresence {
  listId: string;
  viewers: PresenceUser[];
  editors: PresenceEditor[];
}

/** Body of an {@link RealtimeClientMessage.EditLine} intent. */
export interface EditLineSignal {
  listId: string;
  lineId: string;
}

/**
 * Payload of {@link RealtimeEvent.UserUsernameChanged}: the new global username
 * of the user this event is addressed to (plan 0030, section 4.3).
 *
 * The id travels with the name so a client can check that the event is about
 * itself rather than trusting the routing that put it in the room, and the two
 * fields are all there is: this is a rename, not a profile, and inventing the
 * rest of one would hand a client an email verification state and a created date
 * the rename never knew.
 */
export interface UserUsernameChangedPayload {
  userId: string;
  username: string;
}

/** Body of a {@link RealtimeClientMessage.StopEditLine} intent. */
export interface StopEditLineSignal {
  listId: string;
  lineId: string;
}
