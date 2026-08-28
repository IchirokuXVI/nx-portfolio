import {
  REALTIME_ACCESS_PATTERNS,
  RealtimeEvent,
  type DomainEvent,
} from '@portfolio/luna-shopper/contracts';
import type { RedisService } from '@portfolio/luna-shopper/platform';
import { JSONCodec } from 'nats';
import { of } from 'rxjs';
import {
  ACCESS_CACHE_TTL_SECONDS,
  listAccessKey,
  zoneAccessKey,
  zoneListsAccessKey,
  zoneStaffAccessKey,
} from '../realtime/constants';
import { JetStreamConsumer } from '../consumer/jetstream.consumer';
import { CoreAccessClient } from './core-access.client';

/**
 * The access check cache and, inseparably, its invalidation (plan 0028, section
 * 2.6).
 *
 * The two are tested together on purpose. A cache in front of an authorization
 * decision is only acceptable because a revocation drops it immediately, and the
 * plan says to build the invalidation in the same change rather than as a follow
 * up. A test file that covered only the hit and miss would be describing a
 * feature the plan did not approve.
 */

/** Only what the client touches: a hash per resource, plus DEL and EXPIRE. */
class FakeRedis {
  readonly hashes = new Map<string, Map<string, string>>();
  readonly expiries = new Map<string, number>();
  failing = false;

  private hash(key: string) {
    let map = this.hashes.get(key);
    if (!map) {
      map = new Map();
      this.hashes.set(key, map);
    }
    return map;
  }

  readonly client = {
    hget: async (key: string, field: string) => {
      this.guard();
      return this.hashes.get(key)?.get(field) ?? null;
    },
    hset: async (key: string, field: string, value: string) => {
      this.guard();
      this.hash(key).set(field, value);
      return 1;
    },
    expire: async (key: string, seconds: number, mode?: string) => {
      this.guard();
      // NX means "only when the key has no expiry yet", which is what keeps the
      // window running from the first cached answer.
      if (mode === 'NX' && this.expiries.has(key)) {
        return 0;
      }
      this.expiries.set(key, seconds);
      return 1;
    },
    del: async (...keys: string[]) => {
      this.guard();
      let removed = 0;
      for (const key of keys) {
        if (this.hashes.delete(key)) {
          removed += 1;
        }
        this.expiries.delete(key);
      }
      return removed;
    },
  };

  private guard() {
    if (this.failing) {
      throw new Error('ECONNREFUSED');
    }
  }

  async tryCommand<T>(
    operation: (client: FakeRedis['client']) => Promise<T>
  ): Promise<T | undefined> {
    try {
      return await operation(this.client);
    } catch {
      return undefined;
    }
  }
}

function clientOn(redis: FakeRedis, allowed = true) {
  const send = jest.fn().mockReturnValue(of({ allowed }));
  const access = new CoreAccessClient(
    { send } as never,
    redis as unknown as RedisService
  );
  return { access, send };
}

describe('the access check cache', () => {
  it('asks core on a miss and answers from the cache after', async () => {
    const redis = new FakeRedis();
    const { access, send } = clientOn(redis);

    expect(await access.checkZone('u1', 'z1')).toBe(true);
    expect(await access.checkZone('u1', 'z1')).toBe(true);

    // The whole point: a reconnect storm re asks core once per user per zone,
    // not once per subscribe.
    expect(send).toHaveBeenCalledTimes(1);
  });

  /**
   * The more important half. A client that has lost access keeps retrying, so a
   * deny is both the cheaper thing to store and the more likely to be hammered.
   */
  it('caches a deny as well as an allow', async () => {
    const redis = new FakeRedis();
    const { access, send } = clientOn(redis, false);

    expect(await access.checkZone('u1', 'z1')).toBe(false);
    expect(await access.checkZone('u1', 'z1')).toBe(false);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('never answers one user from another user entry', async () => {
    const redis = new FakeRedis();
    const send = jest
      .fn()
      .mockReturnValueOnce(of({ allowed: true }))
      .mockReturnValueOnce(of({ allowed: false }));
    const access = new CoreAccessClient(
      { send } as never,
      redis as unknown as RedisService
    );

    expect(await access.checkZone('u1', 'z1')).toBe(true);
    expect(await access.checkZone('u2', 'z1')).toBe(false);
  });

  /**
   * Zone access and zone governance are different questions. A member promoted
   * to admin must not be answered from the entry that recorded they were not.
   */
  it('caches the staff answer under its own key', async () => {
    const redis = new FakeRedis();
    const { access, send } = clientOn(redis);

    await access.checkZone('u1', 'z1');
    await access.checkZoneStaff('u1', 'z1');

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toBe(REALTIME_ACCESS_PATTERNS.checkZone);
    expect(send.mock.calls[1][0]).toBe(REALTIME_ACCESS_PATTERNS.checkZoneStaff);
    expect(redis.hashes.has(zoneAccessKey('z1'))).toBe(true);
    expect(redis.hashes.has(zoneStaffAccessKey('z1'))).toBe(true);
  });

  it('sets the window once rather than extending it on every write', async () => {
    const redis = new FakeRedis();
    const { access } = clientOn(redis);

    await access.checkZone('u1', 'z1');
    await access.checkZone('u2', 'z1');

    // A refreshed expiry would let a busy zone hold a stale entry indefinitely,
    // which is the one thing a cache in front of authorization must not do.
    expect(redis.expiries.get(zoneAccessKey('z1'))).toBe(
      ACCESS_CACHE_TTL_SECONDS
    );
  });

  it('misses through to core when Redis is down', async () => {
    const redis = new FakeRedis();
    const { access, send } = clientOn(redis);
    redis.failing = true;

    expect(await access.checkZone('u1', 'z1')).toBe(true);
    expect(await access.checkZone('u1', 'z1')).toBe(true);

    // Fails open, straight through to the origin: the answer still comes from
    // core, so an outage costs latency, never a wrong authorization.
    expect(send).toHaveBeenCalledTimes(2);
  });
});

function consumerOver(redis: FakeRedis, access: CoreAccessClient) {
  return new JetStreamConsumer(
    {} as never,
    // The sweep directives are plan 0031's, asserted in its own specs; here they
    // only need somewhere to go.
    { publish: jest.fn(), publishDirective: jest.fn() } as never,
    { client: { set: jest.fn().mockResolvedValue('OK') } } as never,
    access,
    { warn: jest.fn(), error: jest.fn(), log: jest.fn() } as never
  );
}

function deliver(
  consumer: JetStreamConsumer,
  envelope: DomainEvent
): Promise<void> {
  const codec = JSONCodec();
  return (
    consumer as unknown as { handle: (m: unknown) => Promise<void> }
  ).handle({
    subject: envelope.event,
    data: codec.encode({ pattern: envelope.event, data: envelope }),
    headers: undefined,
  });
}

describe('access cache invalidation', () => {
  /** The exit criterion behind the cache: a kick is not survived by the cache. */
  it('drops a zone answer the moment a member is kicked', async () => {
    const redis = new FakeRedis();
    const { access, send } = clientOn(redis);
    const consumer = consumerOver(redis, access);

    await access.checkZone('u1', 'z1');
    expect(send).toHaveBeenCalledTimes(1);

    await deliver(consumer, {
      event: RealtimeEvent.MemberKicked,
      eventId: 'e-1',
      zoneId: 'z1',
      payload: { userId: 'u1' },
    });

    // Re asked, rather than answered from an entry that outlived the kick.
    await access.checkZone('u1', 'z1');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('drops the governance answer on a role change', async () => {
    const redis = new FakeRedis();
    const { access, send } = clientOn(redis);
    const consumer = consumerOver(redis, access);

    await access.checkZoneStaff('u1', 'z1');

    await deliver(consumer, {
      event: RealtimeEvent.MemberRoleChanged,
      eventId: 'e-2',
      zoneId: 'z1',
      payload: { userId: 'u1' },
    });

    await access.checkZoneStaff('u1', 'z1');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('drops a list answer when the list access changes', async () => {
    const redis = new FakeRedis();
    const { access, send } = clientOn(redis);
    const consumer = consumerOver(redis, access);

    await access.checkList('u1', 'l1');
    expect(redis.hashes.has(listAccessKey('l1'))).toBe(true);

    await deliver(consumer, {
      event: RealtimeEvent.ListAccessChanged,
      eventId: 'e-3',
      zoneId: 'z1',
      listId: 'l1',
      payload: {},
    });

    await access.checkList('u1', 'l1');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('leaves an unrelated zone cached', async () => {
    const redis = new FakeRedis();
    const { access, send } = clientOn(redis);
    const consumer = consumerOver(redis, access);

    await access.checkZone('u1', 'z1');
    await access.checkZone('u1', 'z2');

    await deliver(consumer, {
      event: RealtimeEvent.MemberKicked,
      eventId: 'e-4',
      zoneId: 'z1',
      payload: {},
    });

    await access.checkZone('u1', 'z2');
    // Two initial misses and nothing more: z2 was never touched.
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not invalidate on an ordinary content event', async () => {
    const redis = new FakeRedis();
    const { access, send } = clientOn(redis);
    const consumer = consumerOver(redis, access);

    await access.checkZone('u1', 'z1');

    await deliver(consumer, {
      event: RealtimeEvent.MemberUsernameChanged,
      eventId: 'e-5',
      zoneId: 'z1',
      payload: {},
    });

    await access.checkZone('u1', 'z1');
    // A rename moves no access, so the cache stands.
    expect(send).toHaveBeenCalledTimes(1);
  });
});

/**
 * The readable list set (plan 0032, section 4.1), which rides on the zone answer
 * and is cached beside it under the same zone name.
 */
describe('the readable list set', () => {
  function zoneClient(redis: FakeRedis, listIds = ['l1', 'l2']) {
    const send = jest.fn().mockReturnValue(of({ allowed: true, listIds }));
    const access = new CoreAccessClient(
      { send } as never,
      redis as unknown as RedisService
    );
    return { access, send };
  }

  it('comes back with the zone answer, from one call to core', async () => {
    const redis = new FakeRedis();
    const { access, send } = zoneClient(redis);

    expect(await access.checkZoneWithLists('u1', 'z1')).toEqual({
      allowed: true,
      listIds: ['l1', 'l2'],
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe(REALTIME_ACCESS_PATTERNS.checkZone);
  });

  it('is cached, so a second subscribe makes no further core call', async () => {
    const redis = new FakeRedis();
    const { access, send } = zoneClient(redis);

    await access.checkZoneWithLists('u1', 'z1');
    await access.checkZoneWithLists('u1', 'z1');

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('fills the plain zone answer too, so a later checkZone is a hit', async () => {
    const redis = new FakeRedis();
    const { access, send } = zoneClient(redis);

    await access.checkZoneWithLists('u1', 'z1');
    expect(await access.checkZone('u1', 'z1')).toBe(true);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('treats a cached yes with no cached set as a miss', async () => {
    // Half an answer cannot be acted on: the presence rooms would not be joined.
    const redis = new FakeRedis();
    const { access, send } = zoneClient(redis);

    await access.checkZone('u1', 'z1');
    await access.checkZoneWithLists('u1', 'z1');

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('stores an empty set as a real answer rather than as a miss', async () => {
    // "You may read none of this zone's lists" is an answer, and serving it as a
    // miss would put a core round trip on every subscribe of every such member.
    const redis = new FakeRedis();
    const { access, send } = zoneClient(redis, []);

    expect((await access.checkZoneWithLists('u1', 'z1')).listIds).toEqual([]);
    expect((await access.checkZoneWithLists('u1', 'z1')).listIds).toEqual([]);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('lives under the zone key, so a zone invalidation takes it', async () => {
    const redis = new FakeRedis();
    const { access, send } = zoneClient(redis);

    await access.checkZoneWithLists('u1', 'z1');
    expect(redis.hashes.has(zoneListsAccessKey('z1'))).toBe(true);

    await access.invalidateZone('z1');
    await access.checkZoneWithLists('u1', 'z1');

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('is dropped by the three list events that change it', async () => {
    // They change the set without changing zone access, which is why they had to
    // be added to ACCESS_INVALIDATING_EVENTS for this cache rather than the other.
    for (const event of [
      RealtimeEvent.ListCreated,
      RealtimeEvent.ListDeleted,
      RealtimeEvent.ListAccessChanged,
    ]) {
      const redis = new FakeRedis();
      const { access, send } = zoneClient(redis);
      const consumer = consumerOver(redis, access);

      await access.checkZoneWithLists('u1', 'z1');
      await deliver(consumer, {
        event,
        eventId: `e-${event}`,
        zoneId: 'z1',
        listId: 'l1',
        payload: {},
      });
      await access.checkZoneWithLists('u1', 'z1');

      expect(send).toHaveBeenCalledTimes(2);
    }
  });

  it('re-asks core for the join sweep rather than reading the cache', async () => {
    const redis = new FakeRedis();
    const { access, send } = zoneClient(redis);

    await access.checkZoneWithLists('u1', 'z1');
    expect(await access.recheckZoneLists('u1', 'z1')).toEqual(['l1', 'l2']);

    expect(send).toHaveBeenCalledTimes(2);
  });
});
