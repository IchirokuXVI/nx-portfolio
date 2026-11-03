import type { ClientProxy, NatsRecord } from '@nestjs/microservices';
import {
  ADMIN_ITEM_PATTERNS,
  SOURCE_ENTRY_PATTERNS,
  type AdminCredential,
} from '@portfolio/luna-shopper/contracts';
import { NEVER, Observable, of, throwError, TimeoutError } from 'rxjs';
import {
  ITEM_REFERENCES_TIMEOUT_MS,
  NatsItemReferences,
} from './item-references.client';

/**
 * Catalog's questions to the harvester and core over NATS (plan 0239).
 *
 * The merge and the delete trust these answers to refuse a write, so what is
 * proved here is what they rely on: the operator's own credential goes out,
 * a product the other service does not name comes back as zero, a silent
 * service fails the write after five seconds instead of hanging it, and a
 * refusal from the other service reaches the caller unchanged.
 */
describe('NatsItemReferences (plan 0239)', () => {
  const CREDENTIAL: AdminCredential = {
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    adminToken: 'the operator token',
  };
  const ITEM_A = '11111111-1111-4111-8111-111111111111';
  const ITEM_B = '22222222-2222-4222-8222-222222222222';
  const CHAIN = '33333333-3333-4333-8333-333333333333';

  /** A client that answers each send with what `reply` gives it. */
  function client(reply: () => Observable<unknown>) {
    const sent: { subject: string; record: NatsRecord }[] = [];
    const proxy = {
      send: (subject: string, record: NatsRecord) => {
        sent.push({ subject, record });
        return reply();
      },
    } as unknown as ClientProxy;
    return { references: new NatsItemReferences(proxy), sent };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('asks the harvester with the operator credential, and fills a product it does not name with zero', async () => {
    const { references, sent } = client(() =>
      of({
        usage: [{ itemId: ITEM_A, rowCount: 2, activeSupermarketIds: [CHAIN] }],
      })
    );

    const usage = await references.queueUsage(CREDENTIAL, [ITEM_A, ITEM_B]);

    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe(SOURCE_ENTRY_PATTERNS.itemUsage);
    expect(sent[0].record.data).toEqual({
      userId: CREDENTIAL.userId,
      adminToken: CREDENTIAL.adminToken,
      itemIds: [ITEM_A, ITEM_B],
    });
    expect(usage).toEqual(
      new Map([
        [ITEM_A, { rowCount: 2, activeSupermarketIds: [CHAIN] }],
        [ITEM_B, { rowCount: 0, activeSupermarketIds: [] }],
      ])
    );
  });

  it('asks core with the operator credential, and fills a product it does not name with zero', async () => {
    const { references, sent } = client(() =>
      of({ usage: [{ itemId: ITEM_B, listLineCount: 3 }] })
    );

    const usage = await references.lineUsage(CREDENTIAL, [ITEM_A, ITEM_B]);

    expect(sent[0].subject).toBe(ADMIN_ITEM_PATTERNS.usage);
    expect(sent[0].record.data).toEqual({
      userId: CREDENTIAL.userId,
      adminToken: CREDENTIAL.adminToken,
      itemIds: [ITEM_A, ITEM_B],
    });
    expect(usage).toEqual(
      new Map([
        [ITEM_A, 0],
        [ITEM_B, 3],
      ])
    );
  });

  it.each([
    [
      'queueUsage',
      (r: NatsItemReferences) => r.queueUsage(CREDENTIAL, [ITEM_A]),
    ],
    ['lineUsage', (r: NatsItemReferences) => r.lineUsage(CREDENTIAL, [ITEM_A])],
  ])(
    '%s fails closed when nobody answers in five seconds',
    async (_name, ask) => {
      jest.useFakeTimers();
      const { references } = client(() => NEVER);

      const answer = ask(references).then(
        () => 'answered',
        (error: unknown) => error
      );
      await jest.advanceTimersByTimeAsync(ITEM_REFERENCES_TIMEOUT_MS - 1);
      let settled = false;
      void answer.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);

      expect(ITEM_REFERENCES_TIMEOUT_MS).toBe(5000);
      expect(await answer).toBeInstanceOf(TimeoutError);
    }
  );

  it('passes a refusal of the other service through unchanged', async () => {
    const problem = {
      status: 403,
      code: 'forbidden',
      message: 'Not an admin.',
    };
    const { references } = client(() => throwError(() => problem));

    await expect(references.queueUsage(CREDENTIAL, [ITEM_A])).rejects.toBe(
      problem
    );
    await expect(references.lineUsage(CREDENTIAL, [ITEM_A])).rejects.toBe(
      problem
    );
  });
});
