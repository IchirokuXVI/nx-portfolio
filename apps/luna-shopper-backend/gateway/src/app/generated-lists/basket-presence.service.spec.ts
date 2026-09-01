import {
  generatedListPresenceKey,
  PRESENCE_TTL_MS,
  type RedisService,
} from '@portfolio/luna-shopper/platform';
import { BasketPresenceService } from './basket-presence.service';

/**
 * How many people are in each basket, for a page of history rows (plan 0053,
 * section 2).
 *
 * Three properties are worth pinning, and all three are about what the count
 * says when something is not simply true:
 *
 * - a **stale** entry is not a shopper, because a pod that was killed never ran
 *   a disconnect handler and its sockets are still written in the room;
 * - a **Redis outage** is nobody rather than an error, because the caller is
 *   asking for their shopping history and a caption must never cost the page;
 * - a basket nobody has ever been in has **an entry of zero**, not a missing
 *   one, so the controller indexes the map without checking.
 */

const BASKET_A = 'gl-a';
const BASKET_B = 'gl-b';

/** A live entry: one socket, seen just now. */
function entry(seenAt: number, participantId: string): string {
  return JSON.stringify({
    participantId,
    kind: 'GUEST',
    displayName: null,
    guestNumber: 1,
    userId: null,
    seenAt,
  });
}

/**
 * One Redis holding presence hashes, with only the two commands this service
 * issues. `pipeline().exec()` answers a `[error, result]` pair per queued
 * command, in order, which is the shape the service reads.
 */
class FakeRedis {
  failing = false;
  /** Keys that answer with an error rather than a hash, per command. */
  broken = new Set<string>();

  constructor(private readonly rooms: Record<string, Record<string, string>>) {}

  readonly client = {
    pipeline: () => {
      const queued: string[] = [];
      return {
        hgetall: (key: string) => {
          queued.push(key);
          return undefined;
        },
        exec: async () =>
          queued.map((key) =>
            this.broken.has(key)
              ? [new Error('WRONGTYPE'), null]
              : [null, this.rooms[key] ?? {}]
          ),
      };
    },
  };

  async tryCommand<T>(
    operation: (client: FakeRedis['client']) => Promise<T>
  ): Promise<T | undefined> {
    if (this.failing) {
      return undefined;
    }
    return operation(this.client);
  }
}

function build(rooms: Record<string, Record<string, string>> = {}) {
  const redis = new FakeRedis(rooms);
  const service = new BasketPresenceService(redis as unknown as RedisService);
  return { service, redis };
}

describe('how many people are in a basket (plan 0053, section 2)', () => {
  it('counts one entry per socket in the room', async () => {
    const now = Date.now();
    const { service } = build({
      [generatedListPresenceKey(BASKET_A)]: {
        's-1': entry(now, 'p-1'),
        's-2': entry(now, 'p-2'),
      },
    });

    const counts = await service.countsFor([BASKET_A]);

    expect(counts.get(BASKET_A)).toBe(2);
  });

  it('answers zero for a basket nobody is in, rather than leaving it out', async () => {
    const { service } = build();

    const counts = await service.countsFor([BASKET_A, BASKET_B]);

    // Present as keys, so the caller never has to tell "no room" from "not asked".
    expect([...counts.entries()]).toEqual([
      [BASKET_A, 0],
      [BASKET_B, 0],
    ]);
  });

  it('does not count an entry that has stopped heartbeating', async () => {
    const now = Date.now();
    const { service } = build({
      [generatedListPresenceKey(BASKET_A)]: {
        's-live': entry(now, 'p-1'),
        // The socket of a pod that was killed without running a disconnect
        // handler. The key's own TTL cannot say anything about one member, so
        // the reader applies the window itself.
        's-dead': entry(now - PRESENCE_TTL_MS - 1, 'p-2'),
      },
    });

    const counts = await service.countsFor([BASKET_A]);

    expect(counts.get(BASKET_A)).toBe(1);
  });

  it('treats an unreadable entry as gone rather than as a shopper', async () => {
    const { service } = build({
      [generatedListPresenceKey(BASKET_A)]: {
        's-1': entry(Date.now(), 'p-1'),
        's-bad': 'not json',
      },
    });

    expect((await service.countsFor([BASKET_A])).get(BASKET_A)).toBe(1);
  });

  it('answers nobody, not an error, when Redis is unreachable', async () => {
    const { service, redis } = build({
      [generatedListPresenceKey(BASKET_A)]: { 's-1': entry(Date.now(), 'p-1') },
    });
    redis.failing = true;

    const counts = await service.countsFor([BASKET_A, BASKET_B]);

    // The caller asked for their shopping history. A blip costs the caption.
    expect([...counts.values()]).toEqual([0, 0]);
  });

  it('loses one basket rather than the page when one command fails', async () => {
    const now = Date.now();
    const { service, redis } = build({
      [generatedListPresenceKey(BASKET_A)]: { 's-1': entry(now, 'p-1') },
      [generatedListPresenceKey(BASKET_B)]: { 's-2': entry(now, 'p-2') },
    });
    redis.broken.add(generatedListPresenceKey(BASKET_A));

    const counts = await service.countsFor([BASKET_A, BASKET_B]);

    expect(counts.get(BASKET_A)).toBe(0);
    expect(counts.get(BASKET_B)).toBe(1);
  });

  it('asks Redis nothing at all for an empty page', async () => {
    const { service, redis } = build();
    const pipeline = jest.spyOn(redis.client, 'pipeline');

    expect(await service.countsFor([])).toEqual(new Map());
    expect(pipeline).not.toHaveBeenCalled();
  });
});
