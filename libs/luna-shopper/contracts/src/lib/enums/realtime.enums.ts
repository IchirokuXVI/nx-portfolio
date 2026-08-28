/**
 * Realtime transport enums shared by the client and the realtime service (plan
 * 0009). Room prefixes and the client to server message names live here so the
 * two sides never disagree on a string literal (plan 0009, sections 3 and 6).
 * String values are the wire format and must stay stable.
 */

/** Room name prefixes. A socket joins `zone:{zoneId}` and `list:{listId}` rooms. */
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
  ViewList = 'presence.view',
  UnviewList = 'presence.unview',
  EditLine = 'presence.edit',
  StopEditLine = 'presence.stopEdit',
}
