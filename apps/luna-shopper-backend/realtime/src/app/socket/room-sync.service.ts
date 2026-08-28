import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  listRoom,
  parseRoom,
  zoneRoom,
  zoneStaffRoom,
  type ParsedRoom,
} from '@portfolio/luna-shopper/contracts';
import { Logger } from 'nestjs-pino';
import type { Server, Socket } from 'socket.io';
import { CoreAccessClient } from '../messaging/core-access.client';
import { PresenceService } from '../presence/presence.service';
import {
  EventRelayService,
  type RelayDirective,
} from '../relay/event-relay.service';

/**
 * Takes rooms away from sockets that have lost the right to be in them (plan
 * 0031).
 *
 * ## The hole this fills
 *
 * Nothing else in this service ever removes a socket from a room. The only
 * `leave` calls in the gateway are the two client-initiated unsubscribes, so
 * every room a socket holds is held until its client asks to drop it or the
 * connection ends. The access cache and its invalidation gate the *next*
 * subscribe; they say nothing about a socket already in a room.
 *
 * It looks like it works because the client cooperates: a kicked member's app
 * receives `member.kicked`, drops the zone, and the released subscription emits
 * `zone.unsubscribe`. That is a well behaved client choosing to leave, not an
 * access control, and it fails for an old build, for a socket driven by anything
 * else, and for `list.accessChanged`, whose payload names nobody so a client
 * cannot tell that *it* is the one that lost access.
 *
 * ## Re-validate, do not compute the difference
 *
 * The obvious implementation works out from each event exactly who lost what.
 * One fact settles it against: `list.accessChanged` carries `{ listId }` and
 * names no user, so there is no set to target and reconstructing one means
 * asking core who *used* to have access, which nobody ever knew.
 *
 * So the sweep is deliberately blunt. Take every socket the event could concern,
 * re-ask the access question for **every room that socket holds**, and leave the
 * ones that now answer no. Re-checking a room that was never at risk costs one
 * question; failing to check one costs a socket a room it should not have. The
 * scope decides which sockets to sweep, never which of their rooms to check —
 * a member kicked from a zone loses its lists too, and working out which lists
 * those are is exactly the lookup this design refuses to need.
 *
 * ## Leaving a room is more than `leave`
 *
 * A socket removed from a room must come out of that room's presence as well, or
 * a kicked member stays lit up in a group they are no longer in, which everybody
 * else can see. So the eviction path goes through {@link PresenceService}'s own
 * methods rather than calling `socket.leave` alone, and the remaining members get
 * a presence broadcast at once instead of watching the kicked member fade out on
 * the ninety second heartbeat timeout.
 *
 * ## What it does not do
 *
 * It does not disconnect the socket: losing one zone is not losing the session,
 * and a user with three groups removed from one keeps the other two. It does not
 * tell the client it was evicted, because the event that caused it already did,
 * and a second message would be a parallel channel that can disagree with the
 * first. It does not sweep on a timer; the cache TTL remains the backstop for an
 * access change that publishes no event at all.
 */
@Injectable()
export class RoomSyncService implements OnModuleInit {
  private server?: Server;

  constructor(
    private readonly relay: EventRelayService,
    private readonly presence: PresenceService,
    private readonly coreAccess: CoreAccessClient,
    private readonly logger: Logger
  ) {}

  onModuleInit(): void {
    this.relay.directives$.subscribe((directive) => {
      void this.apply(directive);
    });
  }

  /**
   * The gateway hands over the socket server once Nest has built it.
   *
   * Only a gateway can be given the server by the framework, and only something
   * holding it can move a socket between rooms, so the two are wired this way
   * round rather than putting the sweep in the gateway, which would then be
   * consuming the relay for two unrelated reasons.
   */
  bind(server: Server): void {
    this.server = server;
  }

  /**
   * Ask every pod to sweep the sockets this directive names.
   *
   * A user's sockets can be on any pod, so the sweep crosses the pod boundary
   * the way an event does: once, through the relay, with each pod acting on what
   * it holds. Not `fetchSockets()` and not remote `leave` calls — plan 0028
   * settled that a thing crosses exactly once, and a second mechanism would be a
   * second answer to a question that already has one.
   */
  sweep(directive: RelayDirective): void {
    this.relay.publishDirective(directive);
  }

  /** Run one directive over this pod's own sockets. */
  private async apply(directive: RelayDirective): Promise<void> {
    if (!this.server) {
      return;
    }

    try {
      // One answer per user and room for the whole sweep: a user's several
      // sockets ask the same questions, and a list room swept by
      // `list.accessChanged` holds several of them.
      const answers = new Map<string, Promise<boolean>>();

      for (const socket of this.localSockets(directive)) {
        if (directive.direction === 'evict') {
          await this.evict(socket, answers);
        }
      }
    } catch (err) {
      // A sweep that throws must not take the directive subscription down with
      // it, or this pod stops evicting anybody for the life of the process.
      this.logger.warn({ err, directive }, 'realtime room sweep failed');
    }
  }

  /**
   * The sockets on this pod that a directive concerns.
   *
   * `userIds` resolves through presence, which already knows which of this pod's
   * sockets belong to whom. `rooms` reads the adapter's room index, which holds
   * this pod's sockets only — the Redis adapter keeps remote membership on the
   * other pods, which is exactly the split this wants, since each pod is sweeping
   * its own.
   */
  private localSockets(directive: RelayDirective): Socket[] {
    const server = this.server;
    if (!server) {
      return [];
    }

    const ids = new Set<string>();
    for (const userId of directive.userIds ?? []) {
      for (const socketId of this.presence.socketsOf(userId)) {
        ids.add(socketId);
      }
    }
    for (const room of directive.rooms ?? []) {
      for (const socketId of server.sockets.adapter.rooms.get(room) ?? []) {
        ids.add(socketId);
      }
    }

    return [...ids]
      .map((id) => server.sockets.sockets.get(id))
      .filter((socket): socket is Socket => socket !== undefined);
  }

  /** Re-ask every room this socket holds, and leave the ones that answer no. */
  private async evict(
    socket: Socket,
    answers: Map<string, Promise<boolean>>
  ): Promise<void> {
    const userId = socket.data.userId as string | undefined;
    if (!userId) {
      return;
    }

    for (const room of [...socket.rooms]) {
      const parsed = parseRoom(room);
      if (!parsed) {
        // The socket's own id room, which no access question governs.
        continue;
      }
      if (await this.allowed(userId, room, parsed, answers)) {
        continue;
      }
      await this.leave(socket, parsed);
    }
  }

  private allowed(
    userId: string,
    room: string,
    parsed: ParsedRoom,
    answers: Map<string, Promise<boolean>>
  ): Promise<boolean> {
    const key = `${userId}|${room}`;
    const known = answers.get(key);
    if (known) {
      return known;
    }

    const asked = this.ask(userId, parsed);
    answers.set(key, asked);
    return asked;
  }

  private ask(userId: string, parsed: ParsedRoom): Promise<boolean> {
    switch (parsed.kind) {
      case 'zone':
        return this.coreAccess.recheckZone(userId, parsed.zoneId);
      case 'zoneStaff':
        return this.coreAccess.recheckZoneStaff(userId, parsed.zoneId);
      case 'list':
        return this.coreAccess.recheckList(userId, parsed.listId);
    }
  }

  /** Leave a room, and whatever presence that room carries. */
  private async leave(socket: Socket, parsed: ParsedRoom): Promise<void> {
    switch (parsed.kind) {
      case 'zone':
        await socket.leave(zoneRoom(parsed.zoneId));
        await this.presence.leaveZone(socket.id, parsed.zoneId);
        return;
      case 'zoneStaff':
        // The staff room has no presence of its own; a demotion costs the
        // governance counts and nothing else.
        await socket.leave(zoneStaffRoom(parsed.zoneId));
        return;
      case 'list':
        await socket.leave(listRoom(parsed.listId));
        // Removes the viewer and drops any line the socket was editing, and
        // rebroadcasts, so the line is not left locked to somebody who is gone.
        await this.presence.unviewList(socket.id, parsed.listId);
        return;
    }
  }
}
