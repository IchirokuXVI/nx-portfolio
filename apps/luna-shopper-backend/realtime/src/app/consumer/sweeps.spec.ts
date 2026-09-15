import {
  generatedListPresenceRoom,
  generatedListRoom,
  RealtimeEvent,
  type DomainEvent,
} from '@portfolio/luna-shopper/contracts';
import { sweepsFor } from './sweeps';

/**
 * The sweeps losing a shared basket asks for (plan 0114, section 10).
 *
 * The sweep itself, re-asking each socket's participant and leaving the rooms
 * that answer no, is `room-sync.service.ts` and already covered by plan 0051.
 * What this plan adds is only the table: which events ask for it, and which
 * rooms they name. So the table is what is tested, one row per event.
 */

const BASKET = 'gl-1';

const BOTH_BASKET_ROOMS = [
  {
    direction: 'evict',
    rooms: [generatedListRoom(BASKET), generatedListPresenceRoom(BASKET)],
  },
];

describe('sweepsFor, on a shared basket', () => {
  it('evicts both basket rooms when a participant is removed, revoked or leaves', () => {
    const event: DomainEvent = {
      event: RealtimeEvent.GeneratedListParticipantLeft,
      eventId: 'e1',
      generatedListId: BASKET,
      payload: { id: 'p1', kind: 'REGISTERED' },
    };

    expect(sweepsFor(event)).toEqual(BOTH_BASKET_ROOMS);
  });

  it('evicts both basket rooms when the basket is deleted', () => {
    // The owner's own sessions hear it too, and the basket room is what the
    // envelope names for the sweep, not the user.
    const event: DomainEvent = {
      event: RealtimeEvent.GeneratedListDeleted,
      eventId: 'e2',
      userIds: ['u-owner'],
      generatedListId: BASKET,
      payload: { id: BASKET },
    };

    expect(sweepsFor(event)).toEqual(BOTH_BASKET_ROOMS);
  });

  it('evicts nothing for either event when the envelope names no basket', () => {
    for (const event of [
      RealtimeEvent.GeneratedListParticipantLeft,
      RealtimeEvent.GeneratedListDeleted,
    ]) {
      expect(
        sweepsFor({
          event,
          eventId: 'e3',
          userIds: ['u-owner'],
          payload: { id: BASKET },
        })
      ).toEqual([]);
    }
  });

  it('evicts nothing when somebody joins', () => {
    expect(
      sweepsFor({
        event: RealtimeEvent.GeneratedListParticipantJoined,
        eventId: 'e4',
        generatedListId: BASKET,
        payload: { id: 'p1' },
      })
    ).toEqual([]);
  });

  it("evicts nothing for the invitee's own two events, which reach a user room", () => {
    for (const event of [
      RealtimeEvent.GeneratedListShared,
      RealtimeEvent.GeneratedListUnshared,
    ]) {
      expect(
        sweepsFor({
          event,
          eventId: 'e5',
          userIds: ['u-invitee'],
          payload: { generatedListId: BASKET },
        })
      ).toEqual([]);
    }
  });
});
