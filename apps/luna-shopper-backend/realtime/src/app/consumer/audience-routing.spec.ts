import {
  DOMAIN_EVENT_STREAM_SUBJECTS,
  domainEventSubject,
  listRoom,
  RealtimeEvent,
  userRoom,
  zoneRoom,
  type DomainEvent,
} from '@portfolio/luna-shopper/contracts';
import { JSONCodec } from 'nats';
import {
  EventRelayService,
  type RelayMessage,
} from '../relay/event-relay.service';
import { JetStreamConsumer } from './jetstream.consumer';

/**
 * Routing on the envelope's audience (plan 0030, section 3).
 *
 * Until this plan the consumer built its room list from a required `zoneId`, so
 * an event about a **person** had nowhere to go. Now the producer states the
 * audience and this routes on it, which puts one new failure mode within reach:
 * an envelope naming nobody. Fanning that out to an empty room list is a silent
 * no-op, so it is a logged fault instead, and the last test here is the one that
 * keeps it from also being a way to kill the consume loop.
 */

/** A relay whose publish loops back into this pod's own subscription. */
async function loopbackRelay(): Promise<EventRelayService> {
  let deliverToPod: ((channel: string, raw: string) => void) | undefined;
  const redis = {
    duplicate: () => ({
      on: (event: string, handler: (channel: string, raw: string) => void) => {
        if (event === 'message') {
          deliverToPod = handler;
        }
      },
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(1),
    }),
    client: {
      publish: jest.fn(async (channel: string, raw: string) => {
        deliverToPod?.(channel, raw);
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

async function deliver(envelope: DomainEvent) {
  const relay = await loopbackRelay();
  const published: RelayMessage[] = [];
  relay.stream$.subscribe((message) => published.push(message));

  const logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
  const coreAccess = { invalidateZone: jest.fn(), invalidateList: jest.fn() };
  const consumer = new JetStreamConsumer(
    {} as never,
    relay,
    { client: { set: jest.fn().mockResolvedValue('OK') } } as never,
    coreAccess as never,
    logger as never
  );

  const codec = JSONCodec();
  const subject = domainEventSubject(envelope.event);
  await (
    consumer as unknown as { handle: (m: unknown) => Promise<void> }
  ).handle({
    subject,
    data: codec.encode({ pattern: subject, data: envelope }),
    headers: undefined,
  });

  return { published, logger, coreAccess };
}

const membershipEnvelope = (
  overrides: Partial<DomainEvent> = {}
): DomainEvent => ({
  event: RealtimeEvent.MemberApproved,
  eventId: `e-${Math.random()}`,
  payload: { id: 'm1', userId: 'u1', username: 'Ines' },
  ...overrides,
});

describe('the audience an envelope names', () => {
  it('routes an event about a person to their own room and nowhere else', async () => {
    const { published } = await deliver(
      membershipEnvelope({
        event: RealtimeEvent.UserUsernameChanged,
        userIds: ['u1'],
        payload: { userId: 'u1', username: 'Vela Rápida' },
      })
    );

    expect(published).toHaveLength(1);
    expect(published[0].rooms).toEqual([userRoom('u1')]);
  });

  it('routes a membership event to the zone and to the member it is about', async () => {
    const { published } = await deliver(
      membershipEnvelope({ zoneId: 'z1', userIds: ['u1'] })
    );

    // Both, which is the whole of section 4.1: everybody else learns of the
    // approval from the zone room, and the person approved is the one
    // participant who is not in it.
    expect(published[0].rooms).toEqual([zoneRoom('z1'), userRoom('u1')]);
  });

  it('still routes a list event to its list room and its zone room', async () => {
    const { published } = await deliver(
      membershipEnvelope({
        event: RealtimeEvent.LineAdded,
        zoneId: 'z1',
        listId: 'l1',
      })
    );

    expect(published[0].rooms).toEqual([zoneRoom('z1'), listRoom('l1')]);
  });

  it('addresses every user named, not just the first', async () => {
    const { published } = await deliver(
      membershipEnvelope({ userIds: ['u1', 'u2'] })
    );

    expect(published[0].rooms).toEqual([userRoom('u1'), userRoom('u2')]);
  });

  it('drops an envelope addressed to nobody, and says so', async () => {
    const { published, logger } = await deliver(membershipEnvelope());

    expect(published).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: RealtimeEvent.MemberApproved }),
      expect.stringContaining('addressed to nobody')
    );
  });

  it('does not throw the unaddressed envelope into the consume loop', async () => {
    // `ef827b5` in this repo is a fix for a consume loop that never came back.
    // A bad event is dropped and acked; it must never be the reason the pod
    // stops pulling for everybody else.
    await expect(deliver(membershipEnvelope())).resolves.toBeDefined();
  });

  it('skips the zone access invalidation for an event with no zone', async () => {
    const { coreAccess } = await deliver(
      membershipEnvelope({ userIds: ['u1'] })
    );

    expect(coreAccess.invalidateZone).not.toHaveBeenCalled();
  });
});

describe('the subjects the stream captures', () => {
  it('captures the two events plan 0030 adds', () => {
    expect(DOMAIN_EVENT_STREAM_SUBJECTS).toContain(RealtimeEvent.ZoneCreated);
    expect(DOMAIN_EVENT_STREAM_SUBJECTS).toContain(
      'user.usernameChanged.broadcast'
    );
  });

  it('leaves auth’s identity subject out of the realtime stream', () => {
    // Section 4.3: the fan-out event shares its client facing name with the
    // identity event auth publishes, and the two must not share a subject, or
    // this stream would capture a service to service message it cannot route.
    expect(DOMAIN_EVENT_STREAM_SUBJECTS).not.toContain('user.usernameChanged');
    expect(domainEventSubject(RealtimeEvent.ZoneUpdated)).toBe('zone.updated');
  });
});
