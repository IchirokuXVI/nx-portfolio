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
  | { kind: 'list'; listId: string };

/**
 * Read a room name back into the access question that gates it, or `undefined`
 * for a name this service did not build.
 *
 * Socket.io puts every socket in a room named after its own id, so `undefined`
 * is an ordinary answer here rather than a fault, and the sweep passes over it.
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
  if (parts[0] === RealtimeRoom.List && parts.length === 2) {
    return { kind: 'list', listId: parts[1] };
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

/** Body of a {@link RealtimeClientMessage.StopEditLine} intent. */
export interface StopEditLineSignal {
  listId: string;
  lineId: string;
}
