import {
  DOMAIN_EVENT_SUBJECTS,
  RealtimeEvent,
  zoneRoom,
  zoneStaffRoom,
  type DomainEvent,
  type ZoneCountsUpdatedPayload,
} from '@portfolio/luna-shopper/contracts';
import { JSONCodec } from 'nats';
import { JetStreamConsumer } from './jetstream.consumer';
import {
  EventRelayService,
  type RelayMessage,
} from '../relay/event-relay.service';

/**
 * The governance leak guard (plan 0017, section 9).
 *
 * The zone realtime room is every approved member, so publishing the counts as
 * core sends them would hand every member exactly what section 6 withholds over
 * REST. This is the test that catches that, so it is not optional.
 */

const ZONE_ID = 'z1';

const FILLED: ZoneCountsUpdatedPayload = {
  zoneId: ZONE_ID,
  counts: {
    memberCount: 3,
    pendingRequestCount: 2,
    firstPendingRequesterName: 'Ines',
  },
};

function deliver(envelope: DomainEvent): RelayMessage[] {
  const relay = new EventRelayService();
  const published: RelayMessage[] = [];
  relay.stream$.subscribe((message) => published.push(message));

  const consumer = new JetStreamConsumer(
    {} as never,
    relay,
    { warn: jest.fn(), error: jest.fn(), log: jest.fn() } as never
  );

  const codec = JSONCodec();
  const message = {
    subject: envelope.event,
    data: codec.encode({ pattern: envelope.event, data: envelope }),
    headers: undefined,
  };
  (consumer as unknown as { handle: (m: unknown) => void }).handle(message);
  return published;
}

function countsEvent(): DomainEvent {
  return {
    event: RealtimeEvent.ZoneCountsUpdated,
    eventId: `e-${Math.random()}`,
    zoneId: ZONE_ID,
    payload: FILLED,
  };
}

describe('zone.countsUpdated fan out', () => {
  it('is a domain event subject, so JetStream actually captures it', () => {
    expect(DOMAIN_EVENT_SUBJECTS).toContain(RealtimeEvent.ZoneCountsUpdated);
  });

  it('fills the governance fields in the staff room', () => {
    const staff = deliver(countsEvent()).find((m) =>
      m.rooms.includes(zoneStaffRoom(ZONE_ID))
    );

    expect(staff).toBeDefined();
    const counts = (staff?.payload as ZoneCountsUpdatedPayload).counts;
    expect(counts.pendingRequestCount).toBe(2);
    expect(counts.firstPendingRequesterName).toBe('Ines');
  });

  it('nulls the governance fields in the plain zone room', () => {
    const plain = deliver(countsEvent()).find((m) =>
      m.rooms.includes(zoneRoom(ZONE_ID))
    );

    expect(plain).toBeDefined();
    const counts = (plain?.payload as ZoneCountsUpdatedPayload).counts;
    // Null, not zero: "not your business" and "nobody is waiting" are different
    // answers and the client renders them differently.
    expect(counts.pendingRequestCount).toBeNull();
    expect(counts.firstPendingRequesterName).toBeNull();
    // Everything a member may see still arrives.
    expect(counts.memberCount).toBe(3);
  });

  it('never puts the filled payload in the plain zone room', () => {
    for (const message of deliver(countsEvent())) {
      if (message.rooms.includes(zoneRoom(ZONE_ID))) {
        expect(JSON.stringify(message.payload)).not.toContain('Ines');
      }
    }
  });

  it('reaches both rooms and nothing else', () => {
    const rooms = deliver(countsEvent()).flatMap((m) => m.rooms);
    expect(new Set(rooms)).toEqual(
      new Set([zoneRoom(ZONE_ID), zoneStaffRoom(ZONE_ID)])
    );
  });

  it('leaves every other zone event on the plain room alone', () => {
    const published = deliver({
      event: RealtimeEvent.MemberApproved,
      eventId: 'e-member',
      zoneId: ZONE_ID,
      payload: { id: 'm1', username: 'Ines' },
    });

    expect(published).toHaveLength(1);
    expect(published[0].rooms).toEqual([zoneRoom(ZONE_ID)]);
  });
});

describe('the staff room name', () => {
  it('is the zone room plus a :staff segment', () => {
    expect(zoneStaffRoom(ZONE_ID)).toBe(`${zoneRoom(ZONE_ID)}:staff`);
  });

  it('is not a prefix collision with any zone room', () => {
    // `zone:z1:staff` must never be mistaken for the room of a zone called
    // "z1:staff", which is why the id sits in the middle rather than the end.
    expect(zoneStaffRoom(ZONE_ID)).not.toBe(zoneRoom(ZONE_ID));
  });
});
