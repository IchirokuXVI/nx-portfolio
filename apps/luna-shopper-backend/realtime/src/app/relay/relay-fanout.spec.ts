import { RealtimeEvent, zoneRoom } from '@portfolio/luna-shopper/contracts';
import {
  EventRelayService,
  RELAY_CHANNEL,
  type RelayMessage,
} from './event-relay.service';

/**
 * One delivery per client per published event (plan 0028, section 2.3, and the
 * first exit criterion in section 7).
 *
 * This is the spec the plan asks for by name, because the two obvious wirings
 * fail in opposite directions and both failures are quiet:
 *
 * - one shared durable consumer with a purely local relay leaves SSE clients on
 *   the pod that did not consume the event deaf,
 * - a consumer per pod, or a `server.to()` emit instead of `server.local.to()`,
 *   delivers every event once per replica.
 *
 * What is modelled here is a Redis bus with several pods attached: a publish
 * from any pod reaches every pod's subscription exactly once, which is what the
 * real channel does.
 */

/** A stand in for one Redis instance several pods publish to and subscribe to. */
function createBus() {
  const subscribers: ((channel: string, raw: string) => void)[] = [];

  return {
    subscribers,
    /** A RedisService double for one pod attached to this bus. */
    podRedis() {
      return {
        duplicate: () => ({
          on: (
            event: string,
            handler: (channel: string, raw: string) => void
          ) => {
            if (event === 'message') {
              subscribers.push(handler);
            }
          },
          subscribe: jest.fn().mockResolvedValue(1),
          unsubscribe: jest.fn().mockResolvedValue(1),
        }),
        client: {
          publish: jest.fn(async (channel: string, raw: string) => {
            // Every subscriber, including the publisher's own. That is the
            // property the relay depends on: a publisher does not feed itself.
            for (const deliver of [...subscribers]) {
              deliver(channel, raw);
            }
            return subscribers.length;
          }),
        },
      } as never;
    },
  };
}

async function attachPod(bus: ReturnType<typeof createBus>) {
  const relay = new EventRelayService(bus.podRedis(), {
    warn: jest.fn(),
    error: jest.fn(),
  } as never);
  await relay.onModuleInit();

  const received: RelayMessage[] = [];
  relay.stream$.subscribe((message) => received.push(message));
  return { relay, received };
}

const MESSAGE: RelayMessage = {
  rooms: [zoneRoom('z1')],
  event: RealtimeEvent.MemberApproved,
  payload: { id: 'm1', username: 'Ines' },
  correlationId: 'c-1',
};

describe('the relay channel across pods', () => {
  it('delivers a publish to every pod exactly once', async () => {
    const bus = createBus();
    const podA = await attachPod(bus);
    const podB = await attachPod(bus);

    podA.relay.publish(MESSAGE);

    // The consuming pod gets it through the channel like everyone else, which is
    // what keeps "exactly once" from depending on who published.
    expect(podA.received).toHaveLength(1);
    expect(podB.received).toHaveLength(1);
  });

  /**
   * The SSE half of the trap. Pod B never consumed this event from JetStream,
   * and its SSE clients still have to see it.
   */
  it('reaches a pod that did not publish', async () => {
    const bus = createBus();
    const podA = await attachPod(bus);
    const podB = await attachPod(bus);

    podA.relay.publish(MESSAGE);

    expect(podB.received[0]).toEqual(MESSAGE);
  });

  it('publishes to the shared channel rather than delivering locally', async () => {
    const bus = createBus();
    const redis = bus.podRedis() as unknown as {
      client: { publish: jest.Mock };
    };
    const relay = new EventRelayService(redis as never, {
      warn: jest.fn(),
      error: jest.fn(),
    } as never);
    await relay.onModuleInit();

    relay.publish(MESSAGE);

    expect(redis.client.publish).toHaveBeenCalledWith(
      RELAY_CHANNEL,
      JSON.stringify(MESSAGE)
    );
  });

  it('carries the correlation id across the hop', async () => {
    const bus = createBus();
    const podA = await attachPod(bus);
    const podB = await attachPod(bus);

    podA.relay.publish(MESSAGE);

    // A push has to stay traceable back to the request that caused it (plan
    // 0009, section 4), and the hop is JSON, so this is the assertion that the
    // envelope survived the round trip.
    expect(podB.received[0].correlationId).toBe('c-1');
  });

  it('scales to three pods without duplicating', async () => {
    const bus = createBus();
    const pods = [
      await attachPod(bus),
      await attachPod(bus),
      await attachPod(bus),
    ];

    pods[1].relay.publish(MESSAGE);

    for (const pod of pods) {
      expect(pod.received).toHaveLength(1);
    }
  });
});

describe('the relay when Redis is down', () => {
  /**
   * Section 5: the service is degraded but must keep serving. Locally consumed
   * events still reach local clients; cross pod fan out is what stops.
   */
  it('delivers to local clients when the publish fails', async () => {
    const redis = {
      duplicate: () => ({
        on: jest.fn(),
        subscribe: jest.fn().mockResolvedValue(1),
        unsubscribe: jest.fn().mockResolvedValue(1),
      }),
      client: {
        publish: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      },
    } as never;

    const warn = jest.fn();
    const relay = new EventRelayService(redis, {
      warn,
      error: jest.fn(),
    } as never);
    await relay.onModuleInit();

    const received: RelayMessage[] = [];
    relay.stream$.subscribe((message) => received.push(message));

    relay.publish(MESSAGE);
    // The fallback runs in the promise rejection handler, so let it settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(received).toEqual([MESSAGE]);
    expect(warn).toHaveBeenCalled();
  });

  it('keeps serving rather than throwing at the caller', async () => {
    const redis = {
      duplicate: () => ({
        on: jest.fn(),
        subscribe: jest.fn().mockRejectedValue(new Error('down')),
        unsubscribe: jest.fn().mockResolvedValue(1),
      }),
      client: { publish: jest.fn().mockResolvedValue(1) },
    } as never;

    const relay = new EventRelayService(redis, {
      warn: jest.fn(),
      error: jest.fn(),
    } as never);

    // A failed SUBSCRIBE at boot is the start of an outage, not a reason to
    // refuse to start: ioredis re issues it on reconnect.
    await expect(relay.onModuleInit()).resolves.toBeUndefined();
  });
});
