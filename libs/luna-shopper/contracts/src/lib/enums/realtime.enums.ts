/**
 * Realtime transport enums shared by the client and the realtime service (plan
 * 0009). Room prefixes and the client to server message names live here so the
 * two sides never disagree on a string literal (plan 0009, sections 3 and 6).
 * String values are the wire format and must stay stable.
 */

/** Room name prefixes. A socket joins `zone:{zoneId}` and `list:{listId}` rooms. */
export enum RealtimeRoom {
  Zone = 'zone',
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
