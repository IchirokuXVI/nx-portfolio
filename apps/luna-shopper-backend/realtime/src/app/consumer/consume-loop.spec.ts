import {
  RealtimeEvent,
  type DomainEvent,
} from '@portfolio/luna-shopper/contracts';
import { JSONCodec } from 'nats';
import { JetStreamConsumer } from './jetstream.consumer';

/**
 * The consume loop's survival (found in a live environment, 2026-08-28).
 *
 * The loop used to be one pass: build the iterator, `for await` over it, log if it
 * threw. Both ways out of that were terminal, and the process stayed perfectly
 * healthy either way. Sockets kept connecting, presence kept broadcasting, rooms kept
 * being joined, no probe failed, and not one domain event was fanned out again.
 *
 * It was found with the durable consumer sitting 26 messages behind the stream and
 * `num_waiting` at zero: nobody was pulling. The user's symptom was "events reach the
 * socket but nothing in the UI changes", which is exactly what a client sees when the
 * only events still flowing are the ones the realtime service generates in process.
 *
 * These two tests are the loop's contract, and neither is optional.
 */

const codec = JSONCodec();

function envelope(eventId: string): DomainEvent {
  return {
    event: RealtimeEvent.ZoneUpdated,
    eventId,
    zoneId: 'z1',
    payload: { id: 'z1', name: 'Flat 3B' },
  };
}

function message(eventId: string) {
  return {
    subject: RealtimeEvent.ZoneUpdated,
    data: codec.encode({
      pattern: RealtimeEvent.ZoneUpdated,
      data: envelope(eventId),
    }),
    headers: undefined,
    ack: jest.fn(),
    nak: jest.fn(),
  };
}

/**
 * A consumer whose subscription hands back one batch of messages and then ends,
 * which is what a dropped connection or a missed heartbeat looks like from here.
 */
function build(
  batches: ReturnType<typeof message>[][],
  relayPublish: jest.Mock
) {
  const consume = jest.fn(async () => {
    const batch = batches.shift() ?? [];
    return {
      // eslint-disable-next-line @typescript-eslint/require-await
      async *[Symbol.asyncIterator]() {
        for (const entry of batch) {
          yield entry;
        }
      },
      close: jest.fn(),
    };
  });

  const consumer = new JetStreamConsumer(
    {} as never,
    { publish: relayPublish } as never,
    { client: { set: jest.fn().mockResolvedValue('OK') } } as never,
    { invalidateZone: jest.fn(), invalidateList: jest.fn() } as never,
    { warn: jest.fn(), error: jest.fn(), log: jest.fn() } as never
  );

  (consumer as unknown as { connection: unknown }).connection = {
    jetstream: () => ({ consumers: { get: async () => ({ consume }) } }),
  };

  return { consumer, consume };
}

const loopOf = (consumer: JetStreamConsumer) =>
  (consumer as unknown as { consumeLoop: () => Promise<void> }).consumeLoop();

const drain = (consumer: JetStreamConsumer) => {
  (consumer as unknown as { draining: boolean }).draining = true;
};

describe('the JetStream consume loop', () => {
  it('keeps consuming after one message fails, and retries that one later', async () => {
    // An unexpected throw out of the fan out. The handler already swallows the
    // failures it knows about, so anything reaching the loop is a bug in handling
    // one event, and taking the whole fan out down for the process is never the
    // right answer to it.
    const publish = jest
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('boom');
      })
      .mockImplementation(() => undefined);

    const bad = message('e1');
    const good = message('e2');
    const { consumer } = build([[bad, good]], publish);

    const loop = loopOf(consumer);
    // One pass is all this needs; ending the batch ends the subscription.
    await new Promise((resolve) => setTimeout(resolve, 50));
    drain(consumer);
    await loop;

    expect(publish).toHaveBeenCalledTimes(2);
    // The failed one is not acked, so the broker brings it back; the delay is what
    // keeps a deterministically failing message from becoming a hot loop.
    expect(bad.nak).toHaveBeenCalled();
    expect(bad.ack).not.toHaveBeenCalled();
    // And the message behind it was still delivered, which is the whole point.
    expect(good.ack).toHaveBeenCalled();
  });

  it('rebuilds the subscription when it ends', async () => {
    const publish = jest.fn();
    const { consumer, consume } = build(
      [[message('e1')], [message('e2')]],
      publish
    );

    const loop = loopOf(consumer);
    // The first batch ends on its own. Nothing is wrong, nothing throws, and the
    // old code returned here and never pulled again.
    await new Promise((resolve) => setTimeout(resolve, 1_400));
    drain(consumer);
    await loop;

    expect(consume.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(publish).toHaveBeenCalledTimes(2);
  }, 10_000);
});
