import { ACCOUNT_DELETION_STREAM } from '@portfolio/luna-shopper/contracts';
import { JSONCodec, nanos, StorageType } from 'nats';
import {
  AccountDeletionPublisher,
  messageId,
} from './account-deletion.publisher';

/**
 * The outbox publisher of `user.deleted` (plan 0232, section 5), against
 * doubles of the broker and the table. That the stream really keeps what was
 * acked is proven against a slot's NATS in
 * `account-deletion.integration.spec.ts`.
 */

const codec = JSONCodec<{ userId: string }>();

function build(
  options: {
    rows?: string[];
    streamExists?: boolean;
    publish?: jest.Mock;
  } = {}
) {
  const rows = (options.rows ?? []).map((userId, i) => ({
    userId,
    deletedAt: new Date(2026, 0, 1, 0, 0, i),
  }));
  const outbox = {
    rows,
    find: jest.fn(async ({ take }: { take: number }) => rows.slice(0, take)),
    delete: jest.fn(async ({ userId }: { userId: string }) => {
      const index = rows.findIndex((row) => row.userId === userId);
      if (index >= 0) {
        rows.splice(index, 1);
      }
    }),
  };
  const jsm = {
    streams: {
      info: jest.fn(async () => {
        if (!options.streamExists) {
          throw new Error('stream not found');
        }
        return {};
      }),
      add: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
    },
  };
  const publish = options.publish ?? jest.fn(async () => ({ seq: 1 }));
  /** A double of one connection; `closed` says the client gave it up. */
  const open = () => ({
    closed: false,
    isClosed() {
      return this.closed;
    },
    jetstreamManager: jest.fn(async () => jsm),
    jetstream: jest.fn(() => ({ publish })),
    drain: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  });
  const connections: Array<ReturnType<typeof open>> = [];
  const connect = jest.fn(async () => {
    const next = open();
    connections.push(next);
    return next as never;
  });
  const publisher = new AccountDeletionPublisher(
    { getRepository: () => outbox } as never,
    { connect, intervalMs: 30_000 }
  );
  return {
    publisher,
    outbox,
    jsm,
    publish,
    connect,
    connections,
  };
}

describe('AccountDeletionPublisher', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('creates the stream at boot: one subject, file storage, thirty days', async () => {
    const { publisher, jsm } = build();

    await publisher.onModuleInit();

    expect(jsm.streams.add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: ACCOUNT_DELETION_STREAM.name,
        subjects: [ACCOUNT_DELETION_STREAM.subject],
        storage: StorageType.File,
        max_age: nanos(30 * 24 * 60 * 60 * 1000),
      })
    );
    await publisher.onApplicationShutdown();
  });

  it('brings an existing stream to the same subjects and age', async () => {
    const { publisher, jsm } = build({ streamExists: true });

    await publisher.onModuleInit();

    expect(jsm.streams.add).not.toHaveBeenCalled();
    expect(jsm.streams.update).toHaveBeenCalledWith(
      ACCOUNT_DELETION_STREAM.name,
      expect.objectContaining({ subjects: [ACCOUNT_DELETION_STREAM.subject] })
    );
    await publisher.onApplicationShutdown();
  });

  it('publishes each row with a dedupe id, then deletes it', async () => {
    const { publisher, outbox, publish } = build({ rows: ['u1', 'u2'] });
    await publisher.onModuleInit();

    await publisher.publishPending();

    expect(publish).toHaveBeenCalledTimes(2);
    const [subject, body, opts] = publish.mock.calls[0];
    expect(subject).toBe(ACCOUNT_DELETION_STREAM.subject);
    expect(codec.decode(body)).toEqual({ userId: 'u1' });
    expect(opts).toEqual(
      expect.objectContaining({
        msgID: messageId('u1'),
        expect: { streamName: ACCOUNT_DELETION_STREAM.name },
      })
    );
    expect(outbox.rows).toEqual([]);
    await publisher.onApplicationShutdown();
  });

  it('keeps a row whose publish was not acked, and the rows after it', async () => {
    const publish = jest
      .fn()
      .mockResolvedValueOnce({ seq: 1 })
      .mockRejectedValueOnce(new Error('no responders'));
    const { publisher, outbox } = build({
      rows: ['u1', 'u2', 'u3'],
      publish,
    });
    await publisher.onModuleInit();

    await expect(publisher.publishPending()).rejects.toThrow('no responders');

    expect(outbox.rows.map((row) => row.userId)).toEqual(['u2', 'u3']);
    await publisher.onApplicationShutdown();
  });

  it('never runs two passes at once, and reads again for a trigger that came during one', async () => {
    let release: () => void = () => undefined;
    const publish = jest.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ seq: 1 });
        })
    );
    const { publisher, outbox } = build({ rows: ['u1'], publish });
    await publisher.onModuleInit();
    // onModuleInit started a pass of its own; let it reach the publish.
    await jest.advanceTimersByTimeAsync(0);

    const joined = publisher.publishPending();
    outbox.rows.push({ userId: 'u2', deletedAt: new Date() });
    expect(publish).toHaveBeenCalledTimes(1);

    release();
    await jest.advanceTimersByTimeAsync(0);
    release();
    await joined;

    expect(publish).toHaveBeenCalledTimes(2);
    expect(outbox.rows).toEqual([]);
    await publisher.onApplicationShutdown();
  });

  it('retries what is left on the timer, and stops the timer at shutdown', async () => {
    const publish = jest
      .fn()
      .mockRejectedValueOnce(new Error('broker down'))
      .mockResolvedValue({ seq: 1 });
    const { publisher, outbox, connections } = build({
      rows: ['u1'],
      publish,
    });
    await publisher.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(outbox.rows).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(30_000);
    expect(outbox.rows).toEqual([]);

    await publisher.onApplicationShutdown();
    expect(connections[0].drain).toHaveBeenCalled();
    outbox.rows.push({ userId: 'u2', deletedAt: new Date() });
    await jest.advanceTimersByTimeAsync(60_000);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('opens a new connection when the client closed the old one for good', async () => {
    const { publisher, outbox, jsm, connect, connections } = build();
    await publisher.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(connect).toHaveBeenCalledTimes(1);

    // The broker was away longer than the client would retry.
    connections[0].closed = true;
    outbox.rows.push({ userId: 'u1', deletedAt: new Date() });
    await publisher.publishPending();

    expect(connect).toHaveBeenCalledTimes(2);
    expect(jsm.streams.add).toHaveBeenCalledTimes(2);
    expect(connections[1].jetstream).toHaveBeenCalled();
    expect(outbox.rows).toEqual([]);

    await publisher.onApplicationShutdown();
    expect(connections[1].drain).toHaveBeenCalled();
  });

  it('keeps trying when the new connection cannot ensure the stream', async () => {
    const { publisher, outbox, jsm, connect, connections } = build();
    await publisher.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    connections[0].closed = true;
    outbox.rows.push({ userId: 'u1', deletedAt: new Date() });
    jsm.streams.add.mockRejectedValueOnce(new Error('no jetstream'));

    await expect(publisher.publishPending()).rejects.toThrow('no jetstream');
    expect(connections[1].close).toHaveBeenCalled();
    expect(outbox.rows).toHaveLength(1);

    await publisher.publishPending();
    expect(connect).toHaveBeenCalledTimes(3);
    expect(outbox.rows).toEqual([]);
    await publisher.onApplicationShutdown();
  });

  it('hashes the user id into the dedupe id', () => {
    expect(messageId('u1')).toMatch(/^user\.deleted:[0-9a-f]{64}$/);
    expect(messageId('u1')).not.toContain('u1');
    expect(messageId('u1')).toBe(messageId('u1'));
  });
});
