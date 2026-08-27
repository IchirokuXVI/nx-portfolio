import { RealtimeEvent, type DomainEvent } from '@portfolio/luna-shopper/contracts';
import { JSONCodec } from 'nats';
import { EventRelayService, type RelayMessage } from '../relay/event-relay.service';
import { DEDUPE_WINDOW_SECONDS } from '../realtime/constants';
import { JetStreamConsumer } from './jetstream.consumer';

/**
 * The shared dedupe window (plan 0028, section 2.5).
 *
 * The exit criterion this covers: "a JetStream redelivery landing on a different
 * pod than the original is dropped". The in memory map could not express that at
 * all, because the second pod's map was empty; a Redis key with a TTL is shared,
 * so whichever pod sees the redelivery finds the id already claimed.
 */

const ZONE_ID = 'z1';

function anEvent(eventId: string): DomainEvent {
  return {
    event: RealtimeEvent.MemberApproved,
    eventId,
    zoneId: ZONE_ID,
    payload: { id: 'm1', username: 'Ines' },
  };
}

/**
 * Two consumers over one shared key space, which is what two pods against one
 * Redis look like. `SET NX` is modelled exactly: the first caller gets 'OK', and
 * every later caller for the same id gets null until the key expires.
 */
async function twoPodsOverOneRedis() {
  const claimed = new Set<string>();
  const set = jest.fn(async (key: string) => {
    if (claimed.has(key)) {
      return null;
    }
    claimed.add(key);
    return 'OK';
  });

  const build = async () => {
    const relay = await loopbackRelay(set);
    const published: RelayMessage[] = [];
    relay.stream$.subscribe((message) => published.push(message));
    const consumer = new JetStreamConsumer(
      {} as never,
      relay,
      { client: { set } } as never,
      { invalidateZone: jest.fn(), invalidateList: jest.fn() } as never,
      { warn: jest.fn(), error: jest.fn(), log: jest.fn() } as never
    );
    return { published, consumer };
  };

  return { podA: await build(), podB: await build(), set };
}

/**
 * A relay whose publish loops back into this pod's own subscription, which is
 * what the real Redis channel does (plan 0028, section 2.3). Each pod gets its
 * own, because what this file exercises is the dedupe claim rather than the fan
 * out; `relay-fanout.spec.ts` is where one bus feeds several pods.
 */
async function loopbackRelay(
  set: jest.Mock
): Promise<EventRelayService> {
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
      set,
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

function deliverTo(
  pod: { consumer: JetStreamConsumer },
  envelope: DomainEvent
): Promise<void> {
  const codec = JSONCodec();
  return (
    pod.consumer as unknown as { handle: (m: unknown) => Promise<void> }
  ).handle({
    subject: envelope.event,
    data: codec.encode({ pattern: envelope.event, data: envelope }),
    headers: undefined,
  });
}

describe('the JetStream dedupe window', () => {
  it('drops a redelivery that lands on a different pod than the original', async () => {
    const { podA, podB } = await twoPodsOverOneRedis();
    const event = anEvent('e-1');

    await deliverTo(podA, event);
    await deliverTo(podB, event);

    expect(podA.published).toHaveLength(1);
    // The whole point: pod B's own memory is empty, and it still drops it.
    expect(podB.published).toHaveLength(0);
  });

  it('drops a redelivery to the same pod, as the in memory map did', async () => {
    const { podA } = await twoPodsOverOneRedis();

    await deliverTo(podA, anEvent('e-2'));
    await deliverTo(podA, anEvent('e-2'));

    expect(podA.published).toHaveLength(1);
  });

  it('lets a different event through', async () => {
    const { podA } = await twoPodsOverOneRedis();

    await deliverTo(podA, anEvent('e-3'));
    await deliverTo(podA, anEvent('e-4'));

    expect(podA.published).toHaveLength(2);
  });

  it('claims the id with SET NX and a TTL, never a bare SET', async () => {
    const { podA, set } = await twoPodsOverOneRedis();

    await deliverTo(podA, anEvent('e-5'));

    // NX is what makes the claim atomic across pods, and EX is what makes the
    // window a span of time rather than a leak.
    expect(set).toHaveBeenCalledWith(
      'dedupe:event:e-5',
      1,
      'EX',
      DEDUPE_WINDOW_SECONDS,
      'NX'
    );
  });

  /**
   * Section 5's failure policy applied to this key: between publishing an event
   * twice and dropping it, the duplicate is the recoverable one.
   */
  it('fans the event out anyway when Redis cannot answer', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('down'));
    const relay = await loopbackRelay(failing);
    const published: RelayMessage[] = [];
    relay.stream$.subscribe((message) => published.push(message));
    const consumer = new JetStreamConsumer(
      {} as never,
      relay,
      { client: { set: failing } } as never,
      { invalidateZone: jest.fn(), invalidateList: jest.fn() } as never,
      { warn: jest.fn(), error: jest.fn(), log: jest.fn() } as never
    );

    await deliverTo({ consumer }, anEvent('e-6'));

    expect(published).toHaveLength(1);
  });
});
