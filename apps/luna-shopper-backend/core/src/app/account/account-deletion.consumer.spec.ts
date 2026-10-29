import type { JsMsg } from 'nats';
import {
  AccountDeletionConsumer,
  decodeUserId,
} from './account-deletion.consumer';

/**
 * One message of the deletion stream (plan 0232, section 5): acked after the
 * deletion commits, naked with a delay when it throws, and acked and dropped
 * when it cannot be read. The stream itself is proven on a slot.
 */
const USER = '0f0e0d0c-0b0a-4908-8706-050403020100';

function message(body: string) {
  return {
    data: new TextEncoder().encode(body),
    subject: 'user.deleted',
    seq: 7,
    info: { redeliveryCount: 0 },
    ack: jest.fn(),
    nak: jest.fn(),
    working: jest.fn(),
  };
}

function consumer(handleUserDeleted: jest.Mock) {
  return new AccountDeletionConsumer(
    {} as never,
    { handleUserDeleted } as never
  );
}

describe('decodeUserId', () => {
  it('reads the raw JSON body auth publishes', () => {
    expect(decodeUserId(new TextEncoder().encode(`{"userId":"${USER}"}`))).toBe(
      USER
    );
  });

  it('refuses what is not a user id', () => {
    for (const body of [
      'not json',
      'null',
      '{}',
      '{"userId":42}',
      '{"userId":"u1"}',
      // Nest's envelope is not what this stream carries.
      `{"pattern":"user.deleted","data":{"userId":"${USER}"}}`,
    ]) {
      expect(decodeUserId(new TextEncoder().encode(body))).toBeNull();
    }
  });
});

describe('AccountDeletionConsumer.handle', () => {
  it('acks after the deletion returns', async () => {
    const handled = jest.fn(async () => true);
    const msg = message(`{"userId":"${USER}"}`);

    await consumer(handled).handle(msg as unknown as JsMsg);

    expect(handled).toHaveBeenCalledWith(USER);
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.nak).not.toHaveBeenCalled();
  });

  it('acks a redelivery the deletion already applied', async () => {
    const msg = message(`{"userId":"${USER}"}`);

    await consumer(jest.fn(async () => false)).handle(msg as unknown as JsMsg);

    expect(msg.ack).toHaveBeenCalledTimes(1);
  });

  it('naks with a delay when the deletion throws, and never acks', async () => {
    const msg = message(`{"userId":"${USER}"}`);

    await consumer(
      jest.fn(async () => {
        throw new Error('rolled back');
      })
    ).handle(msg as unknown as JsMsg);

    expect(msg.ack).not.toHaveBeenCalled();
    expect(msg.nak).toHaveBeenCalledWith(expect.any(Number));
    expect(msg.nak.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it('acks and drops a message it cannot read', async () => {
    const handled = jest.fn();
    const msg = message('garbage');

    await consumer(handled).handle(msg as unknown as JsMsg);

    expect(handled).not.toHaveBeenCalled();
    expect(msg.ack).toHaveBeenCalledTimes(1);
  });
});
