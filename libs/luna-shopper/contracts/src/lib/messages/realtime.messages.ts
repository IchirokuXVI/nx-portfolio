import { RealtimeRoom } from '../enums/realtime.enums';

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
} as const;

export interface CheckZoneAccessRequest {
  userId: string;
  zoneId: string;
}

export interface CheckListAccessRequest {
  userId: string;
  listId: string;
}

/** Whether the caller may join the requested room. */
export interface AccessCheckResult {
  allowed: boolean;
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
