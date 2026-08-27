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

/**
 * A relay wired to a Redis double that loops a publish straight back into this
 * pod's own subscription, which is what the real one does (plan 0028, section
 * 2.3): the publisher receives its own message through the channel rather than
 * being fed locally.
 */
async function loopbackRelay(): Promise<EventRelayService> {
  let deliver: ((channel: string, raw: string) => void) | undefined;
  const redis = {
    duplicate: () => ({
      on: (event: string, handler: (channel: string, raw: string) => void) => {
        if (event === 'message') {
          deliver = handler;
        }
      },
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(1),
    }),
    client: {
      publish: jest.fn(async (channel: string, raw: string) => {
        deliver?.(channel, raw);
        return 1;
      }),
    },
  } as never;

  const relay = new EventRelayService(redis, {
    warn: jest.fn(),
    error: jest.fn(),
  } as never);
  await relay.onModuleInit();
  return relay;
}

async function deliver(envelope: DomainEvent): Promise<RelayMessage[]> {
  const relay = await loopbackRelay();
  const published: RelayMessage[] = [];
  relay.stream$.subscribe((message) => published.push(message));

  // The dedupe claim is a Redis round trip since plan 0028, section 2.5. `'OK'`
  // is the reply that means "you are the first to see this event id"; `null`
  // would mean a redelivery, which is asserted separately.
  const redis = {
    client: { set: jest.fn().mockResolvedValue('OK') },
  } as never;

  const consumer = new JetStreamConsumer(
    {} as never,
    relay,
    redis,
    // The access cache invalidation runs before every fan out (plan 0028,
    // section 2.6); it is asserted in access-cache.spec.ts, not here.
    { invalidateZone: jest.fn(), invalidateList: jest.fn() } as never,
    { warn: jest.fn(), error: jest.fn(), log: jest.fn() } as never
  );

  const codec = JSONCodec();
  const message = {
    subject: envelope.event,
    data: codec.encode({ pattern: envelope.event, data: envelope }),
    headers: undefined,
  };
  await (
    consumer as unknown as { handle: (m: unknown) => Promise<void> }
  ).handle(message);
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

  it('fills the governance fields in the staff room', async () => {
    const staff = (await deliver(countsEvent())).find((m) =>
      m.rooms.includes(zoneStaffRoom(ZONE_ID))
    );

    expect(staff).toBeDefined();
    const counts = (staff?.payload as ZoneCountsUpdatedPayload).counts;
    expect(counts.pendingRequestCount).toBe(2);
    expect(counts.firstPendingRequesterName).toBe('Ines');
  });

  it('nulls the governance fields in the plain zone room', async () => {
    const plain = (await deliver(countsEvent())).find((m) =>
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

  it('never puts the filled payload in the plain zone room', async () => {
    for (const message of await deliver(countsEvent())) {
      if (message.rooms.includes(zoneRoom(ZONE_ID))) {
        expect(JSON.stringify(message.payload)).not.toContain('Ines');
      }
    }
  });

  it('reaches both rooms and nothing else', async () => {
    const rooms = (await deliver(countsEvent())).flatMap((m) => m.rooms);
    expect(new Set(rooms)).toEqual(
      new Set([zoneRoom(ZONE_ID), zoneStaffRoom(ZONE_ID)])
    );
  });

  it('leaves every other zone event on the plain room alone', async () => {
    const published = await deliver({
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
