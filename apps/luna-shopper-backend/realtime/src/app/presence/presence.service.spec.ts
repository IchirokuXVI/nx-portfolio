import {
  RealtimeEvent,
  listPresenceRoom,
  listRoom,
  zoneRoom,
  type ListPresence,
  type ZonePresence,
} from '@portfolio/luna-shopper/contracts';
import type { RedisService } from '@portfolio/luna-shopper/platform';
import type { Logger } from 'nestjs-pino';
import { PRESENCE_TTL_MS } from '../realtime/constants';
import type {
  EventRelayService,
  RelayMessage,
} from '../relay/event-relay.service';
import { PresenceService } from './presence.service';

/**
 * Presence across replicas (plan 0028, section 2.2), and the exit criterion the
 * plan names: a killed pod's users leave every room within the heartbeat TTL
 * without any pod running a disconnect handler.
 *
 * The store below is a small in memory Redis that implements only what presence
 * uses, with real sorted set semantics for the parts that matter (scores, and
 * removal by score range). That is the behaviour under test: pruning by score is
 * what gives per member liveness, which a key TTL cannot express.
 */
class FakeRedis {
  readonly zsets = new Map<string, Map<string, number>>();
  readonly hashes = new Map<string, Map<string, string>>();
  failing = false;

  private zset(key: string) {
    let set = this.zsets.get(key);
    if (!set) {
      set = new Map();
      this.zsets.set(key, set);
    }
    return set;
  }

  private hash(key: string) {
    let map = this.hashes.get(key);
    if (!map) {
      map = new Map();
      this.hashes.set(key, map);
    }
    return map;
  }

  private guard() {
    if (this.failing) {
      throw new Error('ECONNREFUSED');
    }
  }

  readonly client = {
    zadd: async (key: string, score: number, value: string) => {
      this.guard();
      this.zset(key).set(value, score);
      return 1;
    },
    zrem: async (key: string, value: string) => {
      this.guard();
      return this.zset(key).delete(value) ? 1 : 0;
    },
    zrange: async (key: string) => {
      this.guard();
      return [...this.zset(key).keys()];
    },
    zremrangebyscore: async (key: string, min: number, max: number) => {
      this.guard();
      const set = this.zset(key);
      let removed = 0;
      for (const [value, score] of [...set]) {
        if (score >= min && score <= max) {
          set.delete(value);
          removed += 1;
        }
      }
      return removed;
    },
    hset: async (key: string, field: string, value: string) => {
      this.guard();
      this.hash(key).set(field, value);
      return 1;
    },
    hdel: async (key: string, ...fields: string[]) => {
      this.guard();
      let removed = 0;
      for (const field of fields) {
        if (this.hash(key).delete(field)) {
          removed += 1;
        }
      }
      return removed;
    },
    hgetall: async (key: string) => {
      this.guard();
      return Object.fromEntries(this.hash(key));
    },
    expire: async () => {
      this.guard();
      return 1;
    },
  };

  /** Mirrors RedisService.tryCommand: degrade to undefined, never throw. */
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

/** One Redis, several pods, which is the situation the whole plan is about. */
function podOn(redis: FakeRedis) {
  const published: RelayMessage[] = [];
  const relay = {
    publish: (message: RelayMessage) => published.push(message),
  } as unknown as EventRelayService;
  const logger = { warn: jest.fn(), error: jest.fn() } as unknown as Logger;

  const presence = new PresenceService(
    relay,
    redis as unknown as RedisService,
    logger
  );
  return { presence, published };
}

function lastZoneSnapshot(published: RelayMessage[]): ZonePresence | undefined {
  const message = [...published]
    .reverse()
    .find((m) => m.event === RealtimeEvent.PresenceZoneUpdated);
  return message?.payload as ZonePresence | undefined;
}

function lastListSnapshot(published: RelayMessage[]): ListPresence | undefined {
  const message = [...published]
    .reverse()
    .find((m) => m.event === RealtimeEvent.PresenceListUpdated);
  return message?.payload as ListPresence | undefined;
}

describe('presence across two pods', () => {
  it('broadcasts one snapshot holding the users of both pods', async () => {
    const redis = new FakeRedis();
    const podA = podOn(redis);
    const podB = podOn(redis);

    podA.presence.register('s-a', 'user-a');
    podB.presence.register('s-b', 'user-b');
    await podA.presence.joinZone('s-a', 'z1');
    await podB.presence.joinZone('s-b', 'z1');

    // The defect this replaces: each pod broadcast only its own sockets, so the
    // online list flapped between two halves of the truth.
    const snapshot = lastZoneSnapshot(podB.published);
    expect(snapshot?.online.map((u) => u.userId).sort()).toEqual([
      'user-a',
      'user-b',
    ]);
  });

  it('counts a user once however many sockets they hold', async () => {
    const redis = new FakeRedis();
    const podA = podOn(redis);
    const podB = podOn(redis);

    podA.presence.register('s-1', 'user-a');
    podB.presence.register('s-2', 'user-a');
    await podA.presence.joinZone('s-1', 'z1');
    await podB.presence.joinZone('s-2', 'z1');

    expect(lastZoneSnapshot(podB.published)?.online).toEqual([
      { userId: 'user-a' },
    ]);
  });

  it('keeps a user present while any of their sockets remains', async () => {
    const redis = new FakeRedis();
    const podA = podOn(redis);
    const podB = podOn(redis);

    podA.presence.register('s-1', 'user-a');
    podB.presence.register('s-2', 'user-a');
    await podA.presence.joinZone('s-1', 'z1');
    await podB.presence.joinZone('s-2', 'z1');

    await podA.presence.disconnect('s-1');

    expect(lastZoneSnapshot(podA.published)?.online).toEqual([
      { userId: 'user-a' },
    ]);
  });

  it('removes the user when the last socket goes', async () => {
    const redis = new FakeRedis();
    const podA = podOn(redis);

    podA.presence.register('s-1', 'user-a');
    await podA.presence.joinZone('s-1', 'z1');
    await podA.presence.disconnect('s-1');

    expect(lastZoneSnapshot(podA.published)?.online).toEqual([]);
  });

  it('publishes the snapshot to the zone room, so both transports see it', async () => {
    const redis = new FakeRedis();
    const pod = podOn(redis);

    pod.presence.register('s-1', 'user-a');
    await pod.presence.joinZone('s-1', 'z1');

    expect(pod.published[0].rooms).toEqual([zoneRoom('z1')]);
  });
});

describe('a pod that stops heartbeating', () => {
  /**
   * The exit criterion, in full: pod B is killed, runs no disconnect handler at
   * all, and its user drains out of the room on pod A's next heartbeat.
   */
  it('drains out of a zone without any disconnect handler running', async () => {
    const redis = new FakeRedis();
    const podA = podOn(redis);
    const podB = podOn(redis);

    podA.presence.register('s-a', 'user-a');
    podB.presence.register('s-b', 'user-b');
    await podA.presence.joinZone('s-a', 'z1');
    await podB.presence.joinZone('s-b', 'z1');

    // Asserted on the shared state rather than on pod A's own broadcasts: each
    // pod holds its own relay double here, so pod A never observed pod B's
    // publish. What matters is that both members are in the room.
    expect([...(redis.zsets.get('presence:zone:z1')?.keys() ?? [])]).toHaveLength(
      2
    );

    // Pod B is killed. Nothing is called on it: its process is simply gone, and
    // its members sit in Redis with a score that stops advancing.
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + PRESENCE_TTL_MS + 1);

    podA.published.length = 0;
    await (
      podA.presence as unknown as { runHeartbeat: () => Promise<void> }
    ).runHeartbeat();

    const snapshot = lastZoneSnapshot(podA.published);
    // Pod A refreshed its own member and pruned the stale one, then rebroadcast
    // because the prune actually removed somebody. Without that rebroadcast the
    // clients still connected here would keep rendering a departed user.
    expect(snapshot?.online).toEqual([{ userId: 'user-a' }]);

    jest.restoreAllMocks();
  });

  it('drains out of a list viewers set too', async () => {
    const redis = new FakeRedis();
    const podA = podOn(redis);
    const podB = podOn(redis);

    podA.presence.register('s-a', 'user-a');
    podB.presence.register('s-b', 'user-b');
    await podA.presence.viewList('s-a', 'l1');
    await podB.presence.viewList('s-b', 'l1');

    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + PRESENCE_TTL_MS + 1);

    podA.published.length = 0;
    await (
      podA.presence as unknown as { runHeartbeat: () => Promise<void> }
    ).runHeartbeat();

    expect(lastListSnapshot(podA.published)?.viewers).toEqual([
      { userId: 'user-a' },
    ]);

    jest.restoreAllMocks();
  });

  it('drops a dead pod editor from the line it was holding', async () => {
    const redis = new FakeRedis();
    const podA = podOn(redis);
    const podB = podOn(redis);

    podA.presence.register('s-a', 'user-a');
    podB.presence.register('s-b', 'user-b');
    await podA.presence.viewList('s-a', 'l1');
    await podB.presence.viewList('s-b', 'l1');
    await podB.presence.editLine('s-b', 'l1', 'line-1');

    expect(lastListSnapshot(podB.published)?.editors).toHaveLength(1);

    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + PRESENCE_TTL_MS + 1);

    podA.published.length = 0;
    await (
      podA.presence as unknown as { runHeartbeat: () => Promise<void> }
    ).runHeartbeat();

    // A stuck editor is the most visible ghost of the four: it holds a line in
    // another user's editor forever.
    expect(lastListSnapshot(podA.published)?.editors).toEqual([]);

    jest.restoreAllMocks();
  });

  it('does not evict a live pod that heartbeats inside the window', async () => {
    const redis = new FakeRedis();
    const podA = podOn(redis);
    const podB = podOn(redis);

    podA.presence.register('s-a', 'user-a');
    podB.presence.register('s-b', 'user-b');
    await podA.presence.joinZone('s-a', 'z1');
    await podB.presence.joinZone('s-b', 'z1');

    const start = Date.now();
    // Both pods beat, well inside the window.
    jest.spyOn(Date, 'now').mockReturnValue(start + PRESENCE_TTL_MS / 2);
    await (
      podB.presence as unknown as { runHeartbeat: () => Promise<void> }
    ).runHeartbeat();
    await (
      podA.presence as unknown as { runHeartbeat: () => Promise<void> }
    ).runHeartbeat();

    jest.spyOn(Date, 'now').mockReturnValue(start + PRESENCE_TTL_MS * 0.9);
    podA.published.length = 0;
    await (
      podA.presence as unknown as { runHeartbeat: () => Promise<void> }
    ).runHeartbeat();

    const members = [...redis.zsets.get('presence:zone:z1')?.keys() ?? []];
    expect(members).toHaveLength(2);

    jest.restoreAllMocks();
  });
});

describe('presence editors', () => {
  it('collapses several sockets of one user on the same line', async () => {
    const redis = new FakeRedis();
    const podA = podOn(redis);
    const podB = podOn(redis);

    podA.presence.register('s-1', 'user-a');
    podB.presence.register('s-2', 'user-a');
    await podA.presence.viewList('s-1', 'l1');
    await podB.presence.viewList('s-2', 'l1');
    await podA.presence.editLine('s-1', 'l1', 'line-1');
    await podB.presence.editLine('s-2', 'l1', 'line-1');

    expect(lastListSnapshot(podB.published)?.editors).toEqual([
      { userId: 'user-a', lineId: 'line-1' },
    ]);
  });

  it('drops the editor when it stops, on either pod', async () => {
    const redis = new FakeRedis();
    const podA = podOn(redis);
    const podB = podOn(redis);

    podA.presence.register('s-1', 'user-a');
    podB.presence.register('s-2', 'user-b');
    await podA.presence.viewList('s-1', 'l1');
    await podB.presence.viewList('s-2', 'l1');
    await podA.presence.editLine('s-1', 'l1', 'line-1');

    await podA.presence.stopEditLine('s-1', 'l1');

    expect(lastListSnapshot(podB.published ?? [])).toBeDefined();
    expect(lastListSnapshot(podA.published)?.editors).toEqual([]);
  });

  it('moves an editor from one line to another rather than holding both', async () => {
    const redis = new FakeRedis();
    const pod = podOn(redis);

    pod.presence.register('s-1', 'user-a');
    await pod.presence.viewList('s-1', 'l1');
    await pod.presence.editLine('s-1', 'l1', 'line-1');
    await pod.presence.editLine('s-1', 'l1', 'line-2');

    expect(lastListSnapshot(pod.published)?.editors).toEqual([
      { userId: 'user-a', lineId: 'line-2' },
    ]);
  });

  it('publishes list presence to the list room and its presence room', async () => {
    const redis = new FakeRedis();
    const pod = podOn(redis);

    pod.presence.register('s-1', 'user-a');
    await pod.presence.viewList('s-1', 'l1');

    // Both, and one payload (plan 0032, section 3): whoever has the list open,
    // and everyone in the zone who may read it but has not.
    expect(pod.published[0].rooms).toEqual([
      listRoom('l1'),
      listPresenceRoom('l1'),
    ]);
  });
});

describe('presence when Redis is down', () => {
  /**
   * Section 5: fails open and empty. A snapshot that cannot be read is broadcast
   * as nobody present, never as an error to the client.
   */
  it('broadcasts an empty room rather than throwing', async () => {
    const redis = new FakeRedis();
    const pod = podOn(redis);

    pod.presence.register('s-1', 'user-a');
    redis.failing = true;

    await expect(pod.presence.joinZone('s-1', 'z1')).resolves.toBeUndefined();
    expect(lastZoneSnapshot(pod.published)?.online).toEqual([]);
  });

  it('never fails a disconnect', async () => {
    const redis = new FakeRedis();
    const pod = podOn(redis);

    pod.presence.register('s-1', 'user-a');
    await pod.presence.joinZone('s-1', 'z1');
    redis.failing = true;

    await expect(pod.presence.disconnect('s-1')).resolves.toBeUndefined();
  });

  it('keeps the heartbeat alive through an outage', async () => {
    const redis = new FakeRedis();
    const pod = podOn(redis);

    pod.presence.register('s-1', 'user-a');
    await pod.presence.joinZone('s-1', 'z1');
    redis.failing = true;

    // A throwing heartbeat would kill the interval, and this pod's own members
    // would then expire while it is still serving them.
    await expect(
      (
        pod.presence as unknown as { runHeartbeat: () => Promise<void> }
      ).runHeartbeat()
    ).resolves.toBeUndefined();
  });
});
