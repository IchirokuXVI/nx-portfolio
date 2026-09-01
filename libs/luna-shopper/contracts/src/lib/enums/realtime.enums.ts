/**
 * Realtime transport enums shared by the client and the realtime service (plan
 * 0009). Room prefixes and the client to server message names live here so the
 * two sides never disagree on a string literal (plan 0009, sections 3 and 6).
 * String values are the wire format and must stay stable.
 */

/**
 * Room name prefixes. A socket joins `zone:{zoneId}` and `list:{listId}` rooms,
 * and is put in `user:{userId}` for it (plan 0030, section 2).
 */
export enum RealtimeRoom {
  Zone = 'zone',
  /**
   * The governance side room of a zone (plan 0017, section 9): everything the
   * plain zone room may not see, which today is who is waiting to join. Unlike
   * the other two members this is not a bare prefix, because the zone id sits
   * between its two segments (`zone:{zoneId}:staff`), so build the room name
   * with `zoneStaffRoom` rather than by concatenating this value.
   */
  ZoneStaff = 'zone:staff',
  List = 'list',
  /**
   * The one room whose subject is a person rather than a resource (plan 0030).
   * A socket is joined to it at connection from the id its token carries, so
   * unlike the three above it is never asked for and never authorized: the token
   * is the claim, and it was verified a line earlier.
   */
  User = 'user',
  /**
   * A shared basket (plan 0051, section 7): the one room whose members are
   * **participants** rather than users.
   *
   * It is a room of its own rather than a filter over the owner's room because a
   * guest has no user id to address, and it follows plan 0032's rule that the
   * room is the access control rather than a filter applied to a broadcast: a
   * socket is admitted to it by presenting a live participant credential, and
   * everything published there is a thing every participant may see.
   */
  GeneratedList = 'generated',
}

/**
 * Messages a client sends up the socket (plan 0009, sections 3 and 7). Room
 * subscription is explicit and authorized per room; presence intents are how a
 * client signals it is viewing a list or editing one of its lines.
 */
export enum RealtimeClientMessage {
  SubscribeZone = 'zone.subscribe',
  UnsubscribeZone = 'zone.unsubscribe',
  SubscribeList = 'list.subscribe',
  UnsubscribeList = 'list.unsubscribe',
  // Presence intents over the socket (plan 0009, section 7).
  /**
   * "I am looking at this group right now" (plan 0033).
   *
   * Separate from {@link SubscribeZone}, which is a data subscription a client
   * holds for every group it belongs to so its counts stay live. Zone presence
   * used to ride on that subscription, which made every member of six groups
   * present in all six at once, permanently. An intent is the only shape that
   * can follow navigation, because navigation is the thing that changes it.
   */
  EnterZone = 'presence.enterZone',
  LeaveZone = 'presence.leaveZone',
  ViewList = 'presence.view',
  UnviewList = 'presence.unview',
  EditLine = 'presence.edit',
  StopEditLine = 'presence.stopEdit',
}
