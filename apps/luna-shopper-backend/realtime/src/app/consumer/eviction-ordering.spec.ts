import {
  RealtimeEvent,
  zoneRoom,
  type DomainEvent,
} from '@portfolio/luna-shopper/contracts';
import { JSONCodec } from 'nats';
import {
  RELAY_CHANNEL,
  RELAY_DIRECTIVE_CHANNEL,
  EventRelayService,
} from '../relay/event-relay.service';
import { JetStreamConsumer } from './jetstream.consumer';

/**
 * The ordering plan 0031 section 5 calls load bearing: **the event goes out
 * before the sweep does**.
 *
 * A member kicked from a zone learns about it through the zone room. Evicting
 * them first would take away the room carrying the news and leave their client
 * sitting on a group it no longer belongs to with no idea why. This test watches
 * the Redis channel both cross, because that is the one place the two are
 * genuinely ordered against each other.
 */

const ZONE = 'z1';

interface Published {
  channel: string;
  raw: string;
}

async function handle(envelope: DomainEvent): Promise<Published[]> {
  const published: Published[] = [];
  const redis = {
    duplicate: () => ({
      on: jest.fn(),
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(1),
    }),
    client: {
      publish: jest.fn(async (channel: string, raw: string) => {
        published.push({ channel, raw });
        return 1;
      }),
      // `'OK'` is the dedupe claim: this pod is the first to see the event id.
      set: jest.fn().mockResolvedValue('OK'),
    },
  } as never;

  const relay = new EventRelayService(redis, {
    warn: jest.fn(),
    error: jest.fn(),
  } as never);
  await relay.onModuleInit();

  const consumer = new JetStreamConsumer(
    {} as never,
    relay,
    redis,
    { invalidateZone: jest.fn(), invalidateList: jest.fn() } as never,
    { warn: jest.fn(), error: jest.fn(), log: jest.fn() } as never
  );

  const codec = JSONCodec();
  await (
    consumer as unknown as { handle: (m: unknown) => Promise<void> }
  ).handle({
    subject: envelope.event,
    data: codec.encode({ pattern: envelope.event, data: envelope }),
    headers: undefined,
  });

  return published;
}

const KICK: DomainEvent = {
  event: RealtimeEvent.MemberKicked,
  eventId: 'e1',
  zoneId: ZONE,
  payload: { id: 'm1', zoneId: ZONE, userId: 'u1' },
};

describe('a kick', () => {
  it('fans out to the zone room before it asks anyone to sweep', async () => {
    const published = await handle(KICK);

    const event = published.findIndex((p) => p.channel === RELAY_CHANNEL);
    const directive = published.findIndex(
      (p) => p.channel === RELAY_DIRECTIVE_CHANNEL
    );

    expect(event).toBeGreaterThanOrEqual(0);
    expect(directive).toBeGreaterThan(event);
  });

  it('sends the news to the room it is about to take away', async () => {
    const [event] = await handle(KICK);
    expect(JSON.parse(event.raw).rooms).toEqual([zoneRoom(ZONE)]);
  });

  it('names the kicked user in the directive', async () => {
    const published = await handle(KICK);
    const directive = published.find(
      (p) => p.channel === RELAY_DIRECTIVE_CHANNEL
    );

    expect(JSON.parse(directive?.raw ?? '{}')).toEqual({
      direction: 'evict',
      userIds: ['u1'],
    });
  });

  it('puts the directive on its own channel, so SSE never pushes it', async () => {
    // The SSE controller maps everything on the event channel straight to a
    // `MessageEvent`; a directive arriving there would be sent to browsers as
    // though it were news.
    const published = await handle(KICK);
    const onEventChannel = published.filter((p) => p.channel === RELAY_CHANNEL);

    for (const message of onEventChannel) {
      expect(JSON.parse(message.raw).direction).toBeUndefined();
    }
  });
});

describe('an event that changes nobody', () => {
  it('publishes no directive at all', async () => {
    const published = await handle({
      event: RealtimeEvent.LineAdded,
      eventId: 'e2',
      zoneId: ZONE,
      listId: 'l1',
      payload: {},
    });

    expect(
      published.some((p) => p.channel === RELAY_DIRECTIVE_CHANNEL)
    ).toBe(false);
  });
});
