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

/** Builds the `list:{listId}` room name. */
export function listRoom(listId: string): string {
  return `${RealtimeRoom.List}:${listId}`;
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
