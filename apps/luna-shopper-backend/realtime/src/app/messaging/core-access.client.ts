import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy, NatsRecordBuilder } from '@nestjs/microservices';
import {
  REALTIME_ACCESS_PATTERNS,
  type AccessCheckResult,
  type CheckListAccessRequest,
  type CheckParticipantAccessRequest,
  type CheckZoneAccessRequest,
  type ParticipantPresenceEntry,
} from '@portfolio/luna-shopper/contracts';
import {
  buildNatsHeaders,
  RedisService,
  traceNatsSend,
} from '@portfolio/luna-shopper/platform';
import { randomUUID } from 'node:crypto';
import { firstValueFrom } from 'rxjs';
import {
  ACCESS_CACHE_TTL_SECONDS,
  listAccessKey,
  zoneAccessKey,
  zoneListsAccessKey,
  zoneStaffAccessKey,
} from '../realtime/constants';

/** Injection token for the realtime service's request/reply client to core. */
export const CORE_ACCESS_CLIENT = 'CORE_ACCESS_CLIENT';

/**
 * What a `zone.subscribe` needs to know: whether the caller is in the zone, and
 * which of its lists they may read (plan 0032, section 4.1).
 */
export interface ZoneSubscriptionAccess {
  allowed: boolean;
  listIds: string[];
}

/** How an allow and a deny are stored. Both are cached; see the class comment. */
const ALLOW = '1';
const DENY = '0';

/**
 * The realtime service's authorization link to core (plan 0009, section 5),
 * with the cache from plan 0028, section 2.6.
 *
 * Before a socket joins a room, or an SSE stream opens, the service asks core
 * whether the caller may access that zone or list. Core resolves membership from
 * its own tables, so a client cannot listen to something it has no access to.
 * Each check carries a correlation id so the authorization decision can be traced
 * alongside the connection that triggered it.
 *
 * ## Why this is the best cache in the system
 *
 * Uncached, every room subscribe is a NATS request/reply. A deploy cycles every
 * socket at once and each reconnecting client re subscribes to every zone and
 * list it had open, so an ordinary rolling update is a burst of access checks
 * proportional to connected clients times open rooms. That burst is exactly what
 * a sixty second cache removes.
 *
 * **Denies are cached too**, and are the more important half: a deny is the
 * cheaper thing to store and by far the more likely thing to be hammered, since
 * a client that has lost access tends to keep retrying.
 *
 * ## Why a hash per resource rather than a key per pair
 *
 * Section 2.6 sketches `access:zone:{userId}:{zoneId}`. Storing it that way makes
 * the read trivial and the **invalidation** impossible without a scan: a
 * membership change has to drop every user's entry for that zone, and there is no
 * way to enumerate them. One hash per resource, keyed by user, makes invalidation
 * a single `DEL` of a key whose name is already in the event.
 *
 * The expiry is set only when the key is created (`EXPIRE ... NX`), so the window
 * is a fixed sixty seconds from the first cached answer. Refreshing it on every
 * write would let a busy list keep a stale entry alive indefinitely, which is the
 * one thing a cache in front of an authorization decision must not do.
 *
 * ## Revocation
 *
 * A cache in front of access control buys a revocation delay: a kicked member
 * keeps receiving a room's events until the entry goes. Sixty seconds of that is
 * not acceptable on its own, and the fix was built in the same change rather than
 * deferred, which is what section 2.6 asks for. The realtime service already
 * consumes the membership events, so {@link invalidateZone} and
 * {@link invalidateList} run the moment one arrives and the TTL is only the
 * backstop for a case nobody modelled.
 *
 * ## Failure
 *
 * Fails open, straight through to core. That is what a cache miss already means,
 * and it is safe here because the origin is still consulted: a Redis outage costs
 * latency and NATS traffic, never an authorization it should have refused.
 */
@Injectable()
export class CoreAccessClient {
  constructor(
    @Inject(CORE_ACCESS_CLIENT) private readonly client: ClientProxy,
    private readonly redis: RedisService
  ) {}

  checkZone(userId: string, zoneId: string): Promise<boolean> {
    const req: CheckZoneAccessRequest = { userId, zoneId };
    return this.cached(zoneAccessKey(zoneId), userId, () =>
      this.check(REALTIME_ACCESS_PATTERNS.checkZone, req)
    );
  }

  /**
   * The zone check, plus the lists that same check already answered for (plan
   * 0032, section 4.1).
   *
   * What `zone.subscribe` uses. Core resolves both from one membership lookup, so
   * this is a field on an answer rather than a second call, and the two halves
   * are cached separately under the zone's name: the yes/no where every other
   * yes/no lives, the id set beside it. A cached allow with no cached set is a
   * miss, because half an answer cannot be acted on.
   *
   * The plain {@link checkZone} stays as it was, for SSE, which has no rooms to
   * join per list and should not pay for a set it will not use.
   */
  async checkZoneWithLists(
    userId: string,
    zoneId: string
  ): Promise<ZoneSubscriptionAccess> {
    const [allowed, listIds] = await Promise.all([
      this.readAnswer(zoneAccessKey(zoneId), userId),
      this.readListIds(zoneId, userId),
    ]);

    if (allowed !== undefined && listIds !== undefined) {
      return { allowed, listIds };
    }
    return this.askZoneWithLists(userId, zoneId);
  }

  /**
   * The same answer, asked of core rather than the cache, for the join sweep
   * (plan 0032, section 4.2). See {@link recheckZone} for why a sweep does not
   * read through the cache.
   */
  async recheckZoneLists(userId: string, zoneId: string): Promise<string[]> {
    return (await this.askZoneWithLists(userId, zoneId)).listIds;
  }

  /**
   * Whether the caller governs the zone, which gates the `zone:{id}:staff` room
   * (plan 0017, section 9). Core answers from the same rule that decides whether
   * a REST summary fills the governance fields.
   *
   * Cached under its own key: this is a different question from zone access, and
   * a member promoted to admin must not be answered from the entry that recorded
   * they were not one.
   */
  checkZoneStaff(userId: string, zoneId: string): Promise<boolean> {
    const req: CheckZoneAccessRequest = { userId, zoneId };
    return this.cached(zoneStaffAccessKey(zoneId), userId, () =>
      this.check(REALTIME_ACCESS_PATTERNS.checkZoneStaff, req)
    );
  }

  checkList(userId: string, listId: string): Promise<boolean> {
    const req: CheckListAccessRequest = { userId, listId };
    return this.cached(listAccessKey(listId), userId, () =>
      this.check(REALTIME_ACCESS_PATTERNS.checkList, req)
    );
  }

  /**
   * The same three questions, asked of core rather than of the cache, and the
   * cached answer replaced with what core said (plan 0031, section 4).
   *
   * The eviction sweep uses these rather than the cached readers above, for two
   * reasons that are really one. A kick invalidates the zone's entries and
   * nothing else, because the event names no list and this service has no way to
   * enumerate a zone's lists; so `access:list:{id}` still holds the allow it
   * cached for a member who has just lost the whole zone, and a sweep reading
   * through the cache would confirm exactly the answer it exists to overturn.
   * Writing what core said back is the other half: without it the sweep would
   * remove the socket from the room and the client's next subscribe would be let
   * straight back in by the same stale entry.
   *
   * It is affordable because of where it runs. These fire on a kick, a ban, a
   * role change, a zone deletion or an access change, over the handful of
   * sockets those concern, and never on ordinary traffic.
   */
  recheckZone(userId: string, zoneId: string): Promise<boolean> {
    const req: CheckZoneAccessRequest = { userId, zoneId };
    return this.fresh(zoneAccessKey(zoneId), userId, () =>
      this.check(REALTIME_ACCESS_PATTERNS.checkZone, req)
    );
  }

  recheckZoneStaff(userId: string, zoneId: string): Promise<boolean> {
    const req: CheckZoneAccessRequest = { userId, zoneId };
    return this.fresh(zoneStaffAccessKey(zoneId), userId, () =>
      this.check(REALTIME_ACCESS_PATTERNS.checkZoneStaff, req)
    );
  }

  recheckList(userId: string, listId: string): Promise<boolean> {
    const req: CheckListAccessRequest = { userId, listId };
    return this.fresh(listAccessKey(listId), userId, () =>
      this.check(REALTIME_ACCESS_PATTERNS.checkList, req)
    );
  }

  /**
   * Whether this participant may still hold a shared basket's rooms (plan 0051,
   * section 7).
   *
   * **Uncached, deliberately**, which is the one place this client departs from
   * the pattern above. Section 3.3 promises that revoking a participant bites
   * immediately and that there is no cache to wait out, and core answers it with
   * a single indexed read. Putting a TTL in front of that would trade the promise
   * for nothing: these fire on a subscribe and on a revocation sweep, over the
   * handful of sockets one basket has, and never on ordinary traffic.
   */
  async checkParticipant(
    participantId: string,
    generatedListId: string
  ): Promise<ParticipantPresenceEntry | undefined> {
    const req: CheckParticipantAccessRequest = {
      participantId,
      generatedListId,
    };
    const answer = await this.send(
      REALTIME_ACCESS_PATTERNS.checkParticipant,
      req
    );
    // The entry rides back with the yes, so admitting a socket and seeding its
    // presence are one round trip rather than two.
    return answer.allowed ? answer.participant : undefined;
  }

  /**
   * Drop every cached answer about a zone, both plain access and governance.
   *
   * Called on any membership or zone event. Deliberately broader than the event
   * strictly implies: a role change alters the staff answer, a kick alters the
   * access answer, and a merge alters both for two different users. Dropping the
   * whole zone's entries costs one round trip per user afterwards and cannot be
   * wrong, where reasoning from each payload's shape about who was affected can.
   */
  async invalidateZone(zoneId: string): Promise<void> {
    await this.redis.tryCommand(
      (client) =>
        client.del(
          zoneAccessKey(zoneId),
          zoneStaffAccessKey(zoneId),
          // The readable list set is keyed by the same zone name precisely so it
          // goes with them (plan 0032, section 4.1).
          zoneListsAccessKey(zoneId)
        ),
      `access invalidate zone ${zoneId}`
    );
  }

  /** Drop every cached answer about a list. */
  async invalidateList(listId: string): Promise<void> {
    await this.redis.tryCommand(
      (client) => client.del(listAccessKey(listId)),
      `access invalidate list ${listId}`
    );
  }

  /**
   * Read the cached answer, or ask core and remember what it said.
   *
   * A cache read that fails is a miss, and a cache write that fails is ignored:
   * neither can change the answer, because the answer always comes from core on
   * a miss.
   */
  private async cached(
    key: string,
    userId: string,
    resolve: () => Promise<boolean>
  ): Promise<boolean> {
    const hit = await this.readAnswer(key, userId);
    return hit ?? this.fresh(key, userId, resolve);
  }

  /** A cached yes or no, or `undefined` for a miss and for an unreadable cache. */
  private async readAnswer(
    key: string,
    userId: string
  ): Promise<boolean | undefined> {
    const hit = await this.redis.tryCommand(
      (client) => client.hget(key, userId),
      `access read ${key}`
    );
    return hit === ALLOW || hit === DENY ? hit === ALLOW : undefined;
  }

  /**
   * A cached readable list set, or `undefined` for a miss.
   *
   * An entry that will not parse is treated as a miss rather than as an empty
   * set: an empty set is a real answer, meaning the caller may read none of the
   * zone's lists, and serving it from a bad write would silently unlight every
   * row on their group page.
   */
  private async readListIds(
    zoneId: string,
    userId: string
  ): Promise<string[] | undefined> {
    const hit = await this.redis.tryCommand(
      (client) => client.hget(zoneListsAccessKey(zoneId), userId),
      `access read lists ${zoneId}`
    );
    if (!hit) {
      return undefined;
    }
    try {
      return JSON.parse(hit) as string[];
    } catch {
      return undefined;
    }
  }

  /** Ask core the zone question, and remember both halves of what it said. */
  private async askZoneWithLists(
    userId: string,
    zoneId: string
  ): Promise<ZoneSubscriptionAccess> {
    const req: CheckZoneAccessRequest = { userId, zoneId };
    const result = await this.send(REALTIME_ACCESS_PATTERNS.checkZone, req);
    const listIds = [...(result.listIds ?? [])];

    await this.remember(zoneAccessKey(zoneId), userId, result.allowed ? ALLOW : DENY);
    await this.remember(
      zoneListsAccessKey(zoneId),
      userId,
      JSON.stringify(listIds)
    );

    return { allowed: result.allowed, listIds };
  }

  /** Ask core, remember what it said, and answer it. The miss path, and the sweep's. */
  private async fresh(
    key: string,
    userId: string,
    resolve: () => Promise<boolean>
  ): Promise<boolean> {
    const allowed = await resolve();
    await this.remember(key, userId, allowed ? ALLOW : DENY);
    return allowed;
  }

  /** Write one cached answer under a resource's key. */
  private async remember(
    key: string,
    userId: string,
    value: string
  ): Promise<void> {
    await this.redis.tryCommand(async (client) => {
      await client.hset(key, userId, value);
      // NX: only when the key has no expiry yet, so the window runs from the
      // first cached answer rather than from the most recent write.
      await client.expire(key, ACCESS_CACHE_TTL_SECONDS, 'NX');
    }, `access write ${key}`);
  }

  private async check(subject: string, payload: object): Promise<boolean> {
    return (await this.send(subject, payload)).allowed;
  }

  private send(subject: string, payload: object): Promise<AccessCheckResult> {
    return traceNatsSend(subject, () => {
      const record = new NatsRecordBuilder(payload)
        .setHeaders(buildNatsHeaders({ correlationId: randomUUID() }))
        .build();
      return firstValueFrom(
        this.client.send<AccessCheckResult>(subject, record)
      );
    });
  }
}
