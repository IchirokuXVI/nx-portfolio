import {
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import {
  generatedListPresenceRoom,
  generatedListRoom,
  listPresenceRoom,
  listRoom,
  RealtimeEvent,
  zoneRoom,
  type GeneratedListPresence,
  type ListPresence,
  type ParticipantPresenceEntry,
  type PresenceEditor,
  type PresenceUser,
  type ZonePresence,
} from '@portfolio/luna-shopper/contracts';
import { RedisService } from '@portfolio/luna-shopper/platform';
import { Logger } from 'nestjs-pino';
import {
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_KEY_TTL_SECONDS,
  PRESENCE_TTL_MS,
  generatedListPresenceKey,
  listEditorsKey,
  listViewersKey,
  zonePresenceKey,
} from '../realtime/constants';
import { EventRelayService } from '../relay/event-relay.service';

/**
 * What one socket **held by this pod** is currently present on.
 *
 * `userId` is empty for a participant socket (plan 0051, section 9), which
 * authenticates with a token naming no user at all. That is why the basket half
 * below carries its own identity rather than reading this one: a guest has
 * nothing here to read.
 */
interface SocketPresence {
  userId: string;
  zones: Set<string>;
  lists: Set<string>;
  /** listId to the line the socket is editing on that list (one at a time). */
  editing: Map<string, string>;
  /**
   * Who this socket is on a shared basket, when it is a participant socket
   * (plan 0051, section 7). Absent on an ordinary account socket.
   */
  participant?: ParticipantPresenceEntry;
  /** The baskets this socket is present in. In practice one. */
  baskets: Set<string>;
}

/** A participant entry as it is stored, carrying its own liveness. */
interface StoredParticipant extends ParticipantPresenceEntry {
  seenAt: number;
}

/** An editor entry as it is stored, carrying its own liveness. */
interface StoredEditor {
  userId: string;
  lineId: string;
  seenAt: number;
}

/**
 * Tracks and broadcasts presence (plan 0009, section 7): who is online in a zone,
 * and who is viewing or editing a list right now.
 *
 * ## What changed, and why the shape is what it is
 *
 * This used to be four in process `Map`s, which was correct for exactly one
 * replica. At two, each pod broadcast a snapshot built only from its own
 * sockets, so every presence event overwrote the other pod's view and the online
 * list flapped between two halves of the truth. That is worse than presence
 * being absent, because it looks like it works. Plan 0028, section 2.2 moves the
 * shared facts into Redis.
 *
 * The one in memory `Map` that remains is deliberate and is **not** the old
 * state: `sockets` is what *this pod* holds. A pod is the only thing that can
 * know which of its own connections are alive, and that is what drives both the
 * heartbeat and the disconnect cleanup. The union across pods lives in Redis.
 *
 * ## Sorted sets rather than plain sets
 *
 * Section 2.2 sketches plain sets with a TTL on the key. A key TTL cannot
 * express what is actually needed here, because it is one expiry for the whole
 * room: any live pod refreshing the key to keep its own members present would
 * equally keep a dead pod's members present forever, which is precisely the
 * ghost this mechanism exists to prevent.
 *
 * So liveness is **per member**: a sorted set scored by the last heartbeat, and
 * the editors hash stores `seenAt` alongside each entry. Reading a room prunes
 * anything older than {@link PRESENCE_TTL_MS} first, so a pod that was OOM
 * killed and never ran a single disconnect handler drains out of every room it
 * held, on its own, within the window. The key itself still carries a TTL, which
 * now does the humbler job of collecting a room nobody has touched in a long
 * time.
 *
 * ## Failure
 *
 * Presence **fails open and empty** (section 5). A snapshot that cannot be read
 * is broadcast as nobody present, never as an error to the client. Presence is a
 * social affordance, not a guarantee, and a chat that says "no one is here" is a
 * great deal better than one that shows an error where the avatars go.
 */
@Injectable()
export class PresenceService implements OnModuleInit, OnApplicationShutdown {
  /** This pod's own sockets. The shared view is in Redis. */
  private readonly sockets = new Map<string, SocketPresence>();
  private heartbeat?: ReturnType<typeof setInterval>;

  constructor(
    private readonly relay: EventRelayService,
    private readonly redis: RedisService,
    private readonly logger: Logger
  ) {}

  onModuleInit(): void {
    this.heartbeat = setInterval(() => {
      void this.runHeartbeat();
    }, PRESENCE_HEARTBEAT_MS);
    // Nothing should be held open by this timer: a pod whose only remaining work
    // is refreshing presence should still be allowed to exit.
    this.heartbeat.unref?.();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
    }
    // A graceful stop removes this pod's sockets immediately rather than leaving
    // the other pods to notice their absence a minute and a half later. The TTL
    // is the backstop for the ungraceful case, not the ordinary path.
    await Promise.all(
      [...this.sockets.keys()].map((socketId) => this.disconnect(socketId))
    );
  }

  /**
   * The ids of this pod's sockets that belong to a user (plan 0031, section 7).
   *
   * The eviction sweep needs "which of my sockets are this person's", and this
   * map is already the answer: it is the per pod half whose union lives in
   * Redis. Nothing about its shape changes to serve the read, and a linear pass
   * is right for it, because a sweep runs on a kick or a role change rather than
   * on traffic.
   */
  socketsOf(userId: string): string[] {
    const found: string[] = [];
    for (const [socketId, socket] of this.sockets) {
      if (socket.userId === userId) {
        found.push(socketId);
      }
    }
    return found;
  }

  /** Remember an authenticated socket so later signals can resolve its user. */
  register(socketId: string, userId: string): void {
    this.sockets.set(socketId, {
      userId,
      zones: new Set(),
      lists: new Set(),
      editing: new Map(),
      baskets: new Set(),
    });
  }

  /**
   * Remember a socket that authenticated as a **participant** rather than a user
   * (plan 0051, sections 7 and 9).
   *
   * `userId` is set to the participant's account when they have one and left
   * empty for a guest, who has none. Nothing keys off it on this path: the basket
   * rooms are keyed by participant throughout, which is what makes a guest
   * addressable at all.
   */
  registerParticipant(
    socketId: string,
    participant: ParticipantPresenceEntry
  ): void {
    this.sockets.set(socketId, {
      userId: participant.userId ?? '',
      zones: new Set(),
      lists: new Set(),
      editing: new Map(),
      participant,
      baskets: new Set(),
    });
  }

  /** Enter a shared basket, and tell the room (plan 0051, section 7). */
  async joinGeneratedList(
    socketId: string,
    generatedListId: string
  ): Promise<void> {
    const socket = this.sockets.get(socketId);
    if (!socket?.participant) {
      return;
    }
    socket.baskets.add(generatedListId);
    await this.writeParticipant(generatedListId, socketId, {
      ...socket.participant,
      seenAt: Date.now(),
    });
    await this.broadcastGeneratedList(generatedListId);
  }

  /** Leave one, on an unsubscribe or on a revocation sweep. */
  async leaveGeneratedList(
    socketId: string,
    generatedListId: string
  ): Promise<void> {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      return;
    }
    socket.baskets.delete(generatedListId);
    await this.removeParticipant(generatedListId, socketId);
    await this.broadcastGeneratedList(generatedListId);
  }

  async joinZone(socketId: string, zoneId: string): Promise<void> {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      return;
    }
    socket.zones.add(zoneId);
    await this.touchMember(zonePresenceKey(zoneId), member(socket.userId, socketId));
    await this.broadcastZone(zoneId);
  }

  async leaveZone(socketId: string, zoneId: string): Promise<void> {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      return;
    }
    socket.zones.delete(zoneId);
    await this.removeMember(
      zonePresenceKey(zoneId),
      member(socket.userId, socketId)
    );
    await this.broadcastZone(zoneId);
  }

  async viewList(socketId: string, listId: string): Promise<void> {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      return;
    }
    socket.lists.add(listId);
    await this.touchMember(
      listViewersKey(listId),
      member(socket.userId, socketId)
    );
    await this.broadcastList(listId);
  }

  async unviewList(socketId: string, listId: string): Promise<void> {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      return;
    }
    socket.lists.delete(listId);
    socket.editing.delete(listId);
    await this.removeMember(
      listViewersKey(listId),
      member(socket.userId, socketId)
    );
    await this.removeEditor(listId, socketId);
    await this.broadcastList(listId);
  }

  async editLine(
    socketId: string,
    listId: string,
    lineId: string
  ): Promise<void> {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      return;
    }
    socket.editing.set(listId, lineId);
    await this.writeEditor(listId, socketId, {
      userId: socket.userId,
      lineId,
      seenAt: Date.now(),
    });
    await this.broadcastList(listId);
  }

  async stopEditLine(socketId: string, listId: string): Promise<void> {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      return;
    }
    socket.editing.delete(listId);
    await this.removeEditor(listId, socketId);
    await this.broadcastList(listId);
  }

  /** Drop a disconnected socket from every room and rebroadcast what changed. */
  async disconnect(socketId: string): Promise<void> {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      return;
    }
    // Removed from the local map first, so a heartbeat that fires mid cleanup
    // cannot refresh the very members being removed back to life.
    this.sockets.delete(socketId);

    for (const zoneId of socket.zones) {
      await this.removeMember(
        zonePresenceKey(zoneId),
        member(socket.userId, socketId)
      );
      await this.broadcastZone(zoneId);
    }
    for (const listId of socket.lists) {
      await this.removeMember(
        listViewersKey(listId),
        member(socket.userId, socketId)
      );
      await this.removeEditor(listId, socketId);
      await this.broadcastList(listId);
    }
    for (const generatedListId of socket.baskets) {
      await this.removeParticipant(generatedListId, socketId);
      await this.broadcastGeneratedList(generatedListId);
    }
  }

  /**
   * Re score every member this pod is responsible for, then rebroadcast any room
   * where pruning actually removed somebody.
   *
   * The rebroadcast is the half that makes the exit criterion true. Refreshing
   * alone would let a dead pod's members expire silently, and the clients still
   * connected here would keep rendering them until something else happened to
   * cause a broadcast. Only rooms this pod holds a socket in are considered, so
   * the work is proportional to what this pod is actually serving.
   */
  private async runHeartbeat(): Promise<void> {
    const zones = new Set<string>();
    const lists = new Set<string>();
    const baskets = new Set<string>();

    try {
      for (const [socketId, socket] of this.sockets) {
        for (const zoneId of socket.zones) {
          zones.add(zoneId);
          await this.touchMember(
            zonePresenceKey(zoneId),
            member(socket.userId, socketId)
          );
        }
        for (const listId of socket.lists) {
          lists.add(listId);
          await this.touchMember(
            listViewersKey(listId),
            member(socket.userId, socketId)
          );
        }
        for (const [listId, lineId] of socket.editing) {
          lists.add(listId);
          await this.writeEditor(listId, socketId, {
            userId: socket.userId,
            lineId,
            seenAt: Date.now(),
          });
        }
        for (const generatedListId of socket.baskets) {
          if (!socket.participant) {
            continue;
          }
          baskets.add(generatedListId);
          await this.writeParticipant(generatedListId, socketId, {
            ...socket.participant,
            seenAt: Date.now(),
          });
        }
      }

      for (const zoneId of zones) {
        if (await this.pruneZone(zoneId)) {
          await this.broadcastZone(zoneId);
        }
      }
      for (const listId of lists) {
        if (await this.pruneList(listId)) {
          await this.broadcastList(listId);
        }
      }
      for (const generatedListId of baskets) {
        if (await this.pruneGeneratedList(generatedListId)) {
          await this.broadcastGeneratedList(generatedListId);
        }
      }
    } catch (err) {
      // A heartbeat that throws must not kill the interval, or this pod's own
      // members quietly expire while it is still serving them.
      this.logger.warn({ err }, 'presence heartbeat failed');
    }
  }

  /** Add or refresh a member's liveness in a sorted set room. */
  private async touchMember(key: string, value: string): Promise<void> {
    await this.redis.tryCommand(async (client) => {
      await client.zadd(key, Date.now(), value);
      await client.expire(key, PRESENCE_KEY_TTL_SECONDS);
    }, `presence touch ${key}`);
  }

  private async removeMember(key: string, value: string): Promise<void> {
    await this.redis.tryCommand(
      (client) => client.zrem(key, value),
      `presence remove ${key}`
    );
  }

  private async writeEditor(
    listId: string,
    socketId: string,
    editor: StoredEditor
  ): Promise<void> {
    await this.redis.tryCommand(async (client) => {
      const key = listEditorsKey(listId);
      await client.hset(key, socketId, JSON.stringify(editor));
      await client.expire(key, PRESENCE_KEY_TTL_SECONDS);
    }, `presence edit ${listId}`);
  }

  private async removeEditor(listId: string, socketId: string): Promise<void> {
    await this.redis.tryCommand(
      (client) => client.hdel(listEditorsKey(listId), socketId),
      `presence unedit ${listId}`
    );
  }

  private async writeParticipant(
    generatedListId: string,
    socketId: string,
    entry: StoredParticipant
  ): Promise<void> {
    await this.redis.tryCommand(async (client) => {
      const key = generatedListPresenceKey(generatedListId);
      await client.hset(key, socketId, JSON.stringify(entry));
      await client.expire(key, PRESENCE_KEY_TTL_SECONDS);
    }, `presence basket ${generatedListId}`);
  }

  private async removeParticipant(
    generatedListId: string,
    socketId: string
  ): Promise<void> {
    await this.redis.tryCommand(
      (client) =>
        client.hdel(generatedListPresenceKey(generatedListId), socketId),
      `presence unbasket ${generatedListId}`
    );
  }

  /** Drop entries last seen before the window. True when something was dropped. */
  private async pruneGeneratedList(generatedListId: string): Promise<boolean> {
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    const stale = await this.redis.tryCommand(async (client) => {
      const key = generatedListPresenceKey(generatedListId);
      const entries = await client.hgetall(key);
      const expired = Object.entries(entries)
        .filter(([, raw]) => {
          const parsed = parseParticipant(raw);
          return !parsed || parsed.seenAt <= cutoff;
        })
        .map(([socketId]) => socketId);
      if (expired.length > 0) {
        await client.hdel(key, ...expired);
      }
      return expired.length;
    }, `presence prune basket ${generatedListId}`);
    return (stale ?? 0) > 0;
  }

  /**
   * Who is in the shop right now (plan 0051, section 7).
   *
   * **One entry per socket, not per person**, which is where this departs from
   * {@link broadcastZone}'s "one entry per user however many sockets they hold".
   * One person on a phone and a laptop is two participants and appears twice: it
   * is truthful, since it is two sessions, and deduplicating by typed name would
   * be exactly the mistake section 3.5 warns about.
   */
  private async broadcastGeneratedList(
    generatedListId: string
  ): Promise<void> {
    await this.pruneGeneratedList(generatedListId);

    const entries =
      (await this.redis.tryCommand(
        (client) =>
          client.hgetall(generatedListPresenceKey(generatedListId)),
        `presence read basket ${generatedListId}`
      )) ?? {};

    const present: ParticipantPresenceEntry[] = Object.values(entries)
      .map((raw) => parseParticipant(raw))
      .filter((entry): entry is StoredParticipant => entry !== undefined)
      .map(({ seenAt: _seenAt, ...entry }) => entry);

    const payload: GeneratedListPresence = { generatedListId, present };
    this.relay.publish({
      // Both rooms, for the reason the list pair splits: the basket room is where
      // somebody working the list is, and the presence room is where a client
      // that only wants to know who else is there subscribes without taking every
      // line edit with it.
      rooms: [
        generatedListRoom(generatedListId),
        generatedListPresenceRoom(generatedListId),
      ],
      event: RealtimeEvent.PresenceGeneratedListUpdated,
      payload,
    });
  }

  /** Drop members last seen before the window. True when something was dropped. */
  private async pruneZone(zoneId: string): Promise<boolean> {
    const removed = await this.redis.tryCommand(
      (client) =>
        client.zremrangebyscore(
          zonePresenceKey(zoneId),
          0,
          Date.now() - PRESENCE_TTL_MS
        ),
      `presence prune zone ${zoneId}`
    );
    return (removed ?? 0) > 0;
  }

  private async pruneList(listId: string): Promise<boolean> {
    const cutoff = Date.now() - PRESENCE_TTL_MS;

    const removedViewers = await this.redis.tryCommand(
      (client) => client.zremrangebyscore(listViewersKey(listId), 0, cutoff),
      `presence prune list ${listId}`
    );

    const stale = await this.redis.tryCommand(async (client) => {
      const key = listEditorsKey(listId);
      const entries = await client.hgetall(key);
      const expired = Object.entries(entries)
        .filter(([, raw]) => {
          const editor = parseEditor(raw);
          return !editor || editor.seenAt <= cutoff;
        })
        .map(([socketId]) => socketId);
      if (expired.length > 0) {
        await client.hdel(key, ...expired);
      }
      return expired.length;
    }, `presence prune editors ${listId}`);

    return (removedViewers ?? 0) > 0 || (stale ?? 0) > 0;
  }

  private async broadcastZone(zoneId: string): Promise<void> {
    await this.pruneZone(zoneId);

    const members =
      (await this.redis.tryCommand(
        (client) => client.zrange(zonePresenceKey(zoneId), 0, -1),
        `presence read zone ${zoneId}`
      )) ?? [];

    // One entry per user, however many sockets they hold: the rule the in memory
    // version had, unchanged.
    const online: PresenceUser[] = [
      ...new Set(members.map((entry) => userOf(entry))),
    ].map((userId) => ({ userId }));

    const payload: ZonePresence = { zoneId, online };
    this.relay.publish({
      rooms: [zoneRoom(zoneId)],
      event: RealtimeEvent.PresenceZoneUpdated,
      payload,
    });
  }

  private async broadcastList(listId: string): Promise<void> {
    await this.pruneList(listId);

    const viewerMembers =
      (await this.redis.tryCommand(
        (client) => client.zrange(listViewersKey(listId), 0, -1),
        `presence read viewers ${listId}`
      )) ?? [];

    const editorEntries =
      (await this.redis.tryCommand(
        (client) => client.hgetall(listEditorsKey(listId)),
        `presence read editors ${listId}`
      )) ?? {};

    const viewers: PresenceUser[] = [
      ...new Set(viewerMembers.map((entry) => userOf(entry))),
    ].map((userId) => ({ userId }));

    const editors = Object.values(editorEntries)
      .map(parseEditor)
      .filter((editor): editor is StoredEditor => editor !== undefined)
      .map(({ userId, lineId }) => ({ userId, lineId }));

    const payload: ListPresence = {
      listId,
      viewers,
      editors: dedupeEditors(editors),
    };
    // Both rooms (plan 0032, section 3). The list room is whoever has it open;
    // the presence room is everyone in the zone who may read it, so a group page
    // can show who is shopping from each row. One payload, no per recipient
    // variation, and nobody who may not read the list is in either room.
    this.relay.publish({
      rooms: [listRoom(listId), listPresenceRoom(listId)],
      event: RealtimeEvent.PresenceListUpdated,
      payload,
    });
  }
}

/**
 * A room member: the user, and the socket that puts them there.
 *
 * The socket id is part of the member so several sockets of one user are several
 * members, which is what lets one of them close without the user disappearing.
 * Neither half contains a colon (a UUID and a socket.io id), so the first one
 * separates them unambiguously.
 */
function member(userId: string, socketId: string): string {
  return `${userId}:${socketId}`;
}

function userOf(entry: string): string {
  const separator = entry.indexOf(':');
  return separator === -1 ? entry : entry.slice(0, separator);
}

function parseEditor(raw: string): StoredEditor | undefined {
  try {
    return JSON.parse(raw) as StoredEditor;
  } catch {
    // Unreadable entries are treated as expired, so a bad write cannot pin a
    // phantom editor to a line forever.
    return undefined;
  }
}

/**
 * Read one stored participant entry (plan 0051, section 7). Like
 * {@link parseEditor}, an unreadable entry is treated as expired, so a bad write
 * cannot pin a phantom shopper to a basket forever.
 */
function parseParticipant(raw: string): StoredParticipant | undefined {
  try {
    return JSON.parse(raw) as StoredParticipant;
  } catch {
    return undefined;
  }
}

/** Collapse several sockets of one user editing the same line into one entry. */
function dedupeEditors(editors: PresenceEditor[]): PresenceEditor[] {
  const byKey = new Map<string, PresenceEditor>();
  for (const editor of editors) {
    byKey.set(`${editor.userId}:${editor.lineId}`, editor);
  }
  return [...byKey.values()];
}
