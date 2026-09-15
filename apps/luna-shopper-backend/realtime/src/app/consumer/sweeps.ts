import {
  generatedListPresenceRoom,
  generatedListRoom,
  listPresenceRoom,
  listRoom,
  RealtimeEvent,
  zoneRoom,
  type DomainEvent,
  type MembershipView,
  type MergeRequestView,
} from '@portfolio/luna-shopper/contracts';
import type { RelayDirective } from '../relay/event-relay.service';

/**
 * Which sockets each event asks the pods to re-check (plan 0031, section 6).
 *
 * Kept apart from the consumer because it is a table, and a table is worth
 * reading and testing on its own. It answers a list rather than one directive:
 * an event can ask for more than one sweep, and most ask for none at all.
 *
 * `member.rejected` is the one deliberate omission, and it is safe rather than an
 * oversight: a rejected membership was `PENDING`, the zone check requires an
 * approved one, so that user was never admitted to the room in the first place.
 *
 * Every zone scoped case guards `zoneId` for the same reason the list case guards
 * `listId`: since plan 0030 both are optional on the envelope, because an event
 * can be addressed to a person instead of a resource. None of the events below is
 * one of those, and the consumer has already dropped an envelope addressed to
 * nobody before it reaches here, so the guard should never fire. It answers no
 * sweep rather than a room named `zone:undefined`, which is a room no socket is
 * in and therefore a sweep that reports success having checked nothing.
 */
export function sweepsFor(envelope: DomainEvent): RelayDirective[] {
  const { zoneId, listId, generatedListId, payload } = envelope;

  switch (envelope.event) {
    // The member named in the payload lost the zone, and with it every list in
    // it. A demotion is here too: it loses the `:staff` room and nothing else,
    // which the sweep works out for itself by re-asking each room.
    case RealtimeEvent.MemberKicked:
    case RealtimeEvent.MemberBanned:
    case RealtimeEvent.MemberRoleChanged:
      return [{ direction: 'evict', userIds: [(payload as MembershipView).userId] }];

    // An approval implies a kick for the source membership (plan 0008), so it
    // moves access for two people at once and the payload names both.
    case RealtimeEvent.MergeApproved: {
      const merge = payload as MergeRequestView;
      return [
        { direction: 'evict', userIds: [merge.sourceUserId, merge.targetUserId] },
      ];
    }

    // These name no membership: an ownership change carries a `ZoneView`, and a
    // deletion denies everybody. Sweeping the whole room is cheap and cannot be
    // wrong, and after plan 0029 the two `member.roleChanged` events an ownership
    // transfer emits already swept the two people precisely, which leaves this
    // as belt and braces costing one pass over an online household.
    case RealtimeEvent.ZoneOwnershipChanged:
    case RealtimeEvent.ZoneDeleted:
    case RealtimeEvent.ZoneMarkedForDeletion:
      return zoneId ? [{ direction: 'evict', rooms: [zoneRoom(zoneId)] }] : [];

    // The payload is `{ listId }` and names nobody, which is the fact that makes
    // the whole design a sweep rather than a difference. Everyone in both of the
    // list's rooms is re-checked and whoever now answers no is removed.
    case RealtimeEvent.ListAccessChanged:
      return listId
        ? [
            {
              direction: 'evict',
              rooms: [listRoom(listId), listPresenceRoom(listId)],
            },
          ]
        : [];

    // The mirror image (plan 0032, section 4.2). Invalidating the readable set
    // does not join anybody to anything: the sockets already subscribed to the
    // zone are not in the new list's presence room, and nothing would put them
    // there until they re-subscribed, which on a long lived mobile connection can
    // be hours. So the zone's sockets are swept the other way.
    case RealtimeEvent.ListCreated:
      return zoneId
        ? [{ direction: 'admit', rooms: [zoneRoom(zoneId)], zoneId }]
        : [];

    // A shared basket lost somebody, or went (plan 0114, section 10): a removal,
    // a link revoked with its people, somebody leaving, or the deletion itself.
    // Neither payload names a socket, and a basket socket carries a participant
    // rather than a user, so both basket rooms are swept: every socket there
    // re-asks whether its participant is still live, and the ones that are not
    // leave at once rather than when their token lapses. Both events name the
    // basket on the envelope, the deletion since plan 0114, and that is what this
    // reads.
    case RealtimeEvent.GeneratedListParticipantLeft:
    case RealtimeEvent.GeneratedListDeleted:
      return generatedListId
        ? [
            {
              direction: 'evict',
              rooms: [
                generatedListRoom(generatedListId),
                generatedListPresenceRoom(generatedListId),
              ],
            },
          ]
        : [];

    default:
      return [];
  }
}
