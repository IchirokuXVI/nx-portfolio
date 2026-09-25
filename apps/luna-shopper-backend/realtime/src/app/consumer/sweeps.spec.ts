import {
  basketPresenceRoom,
  basketRoom,
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
    rooms: [basketRoom(BASKET), basketPresenceRoom(BASKET)],
  },
];

describe('sweepsFor, on a shared basket', () => {
  it('evicts both basket rooms when a participant is removed, revoked or leaves', () => {
    const event: DomainEvent = {
      event: RealtimeEvent.BasketParticipantLeft,
      eventId: 'e1',
      basketIds: [BASKET],
      payload: { id: 'p1', kind: 'REGISTERED' },
    };

    expect(sweepsFor(event)).toEqual(BOTH_BASKET_ROOMS);
  });

  it('evicts both basket rooms when the basket is deleted', () => {
    // The owner's own sessions hear it too, and the basket room is what the
    // envelope names for the sweep, not the user.
    const event: DomainEvent = {
      event: RealtimeEvent.BasketDeleted,
      eventId: 'e2',
      userIds: ['u-owner'],
      basketIds: [BASKET],
      payload: { id: BASKET },
    };

    expect(sweepsFor(event)).toEqual(BOTH_BASKET_ROOMS);
  });

  it('evicts nothing for either event when the envelope names no basket', () => {
    for (const event of [
      RealtimeEvent.BasketParticipantLeft,
      RealtimeEvent.BasketDeleted,
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
        event: RealtimeEvent.BasketParticipantJoined,
        eventId: 'e4',
        basketIds: [BASKET],
        payload: { id: 'p1' },
      })
    ).toEqual([]);
  });

  it("evicts nothing for the invitee's own two events, which reach a user room", () => {
    for (const event of [
      RealtimeEvent.BasketShared,
      RealtimeEvent.BasketUnshared,
    ]) {
      expect(
        sweepsFor({
          event,
          eventId: 'e5',
          userIds: ['u-invitee'],
          payload: { basketId: BASKET },
        })
      ).toEqual([]);
    }
  });
});

/**
 * The same table, read off the field core writes now (plan 0139, section 1).
 *
 * Both of these events still name exactly one basket. What changed is the
 * envelope: the audience is a list, and the consumer has to read either name for
 * one release, because a replayed envelope carries the old one.
 */
describe('sweepsFor, reading the basket audience either way', () => {
  it('sweeps both rooms of a basket named on basketIds', () => {
    for (const event of [
      RealtimeEvent.BasketParticipantLeft,
      RealtimeEvent.BasketDeleted,
    ]) {
      expect(
        sweepsFor({
          event,
          eventId: 'e6',
          basketIds: [BASKET],
          payload: { id: BASKET },
        })
      ).toEqual(BOTH_BASKET_ROOMS);
    }
  });

  it('sweeps both rooms of every basket named, if an event ever names two', () => {
    expect(
      sweepsFor({
        event: RealtimeEvent.BasketDeleted,
        eventId: 'e7',
        basketIds: [BASKET, 'gl-2'],
        payload: { id: BASKET },
      })
    ).toEqual([
      ...BOTH_BASKET_ROOMS,
      {
        direction: 'evict',
        rooms: [basketRoom('gl-2'), basketPresenceRoom('gl-2')],
      },
    ]);
  });

  it('sweeps nothing for an empty basketIds', () => {
    expect(
      sweepsFor({
        event: RealtimeEvent.BasketDeleted,
        eventId: 'e8',
        basketIds: [],
        payload: { id: BASKET },
      })
    ).toEqual([]);
  });

  it('asks for no sweep at all on a lines changed event', () => {
    // Section 5: a socket is in a basket room because its participant is live on
    // the basket, and that does not change when the rows move or when the owner
    // loses a list. The room stays and the next read is smaller.
    expect(
      sweepsFor({
        event: RealtimeEvent.BasketLinesChanged,
        eventId: 'e9',
        basketIds: [BASKET],
        payload: { lineIds: [] },
      })
    ).toEqual([]);
  });
});
