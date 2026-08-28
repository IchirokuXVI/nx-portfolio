import { type OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import {
  listPresenceRoom,
  listRoom,
  RealtimeClientMessage,
  zoneRoom,
  zoneStaffRoom,
  type EditLineSignal,
  type StopEditLineSignal,
} from '@portfolio/luna-shopper/contracts';
import { Logger } from 'nestjs-pino';
import { Server, Socket } from 'socket.io';
import { TokenVerifierService } from '../auth/token-verifier.service';
import { CoreAccessClient } from '../messaging/core-access.client';
import { PresenceService } from '../presence/presence.service';
import { EventRelayService } from '../relay/event-relay.service';
import { RoomSyncService } from './room-sync.service';

interface ZoneSubscription {
  zoneId: string;
}
interface ListSubscription {
  listId: string;
}
interface Ack {
  ok: boolean;
}

/**
 * The client-facing WebSocket surface (plan 0009, section 3).
 *
 * On connect the socket is authenticated offline from its access token; an
 * unauthenticated socket is dropped. A client then subscribes only to the zone
 * and list rooms it is authorized for (core confirms each subscription, section
 * 5), and signals presence intents (viewing a list, editing a line). Domain
 * events arrive from the relay and are fanned out to the rooms they target, so
 * the gateway itself holds no domain logic.
 *
 * CORS is permissive here because the reverse proxy fronts this service on its
 * own hostname in every deployed environment (plan 0002); browser origin control
 * lives there, not in the socket server.
 */
/**
 * **WebSocket only, no long polling** (plan 0028, section 2.1, decided at step 6).
 *
 * At more than one replica the two transports need different things. The
 * WebSocket transport is one connection to one pod and needs nothing: the Redis
 * adapter carries the room bookkeeping. HTTP long polling is several requests
 * per handshake that must all land on the same pod, which means session affinity
 * on the Service and its HTTPRoute.
 *
 * The choice is made here rather than left to be discovered from a support
 * report, and it is to drop polling. The SSE endpoints already exist as the
 * read only fallback for a client behind a proxy that blocks WebSocket, so
 * affinity would be infrastructure bought for a case that is already served, and
 * affinity has its own cost: it pins a client to a pod across a rollout.
 *
 * The consequence for the client: `socket.io-client` must be constructed with
 * `transports: ['websocket']` too. Its default is to open with polling and
 * upgrade, and against this server that first request is refused.
 */
@WebSocketGateway({
  transports: ['websocket'],
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer() private server!: Server;

  constructor(
    private readonly tokenVerifier: TokenVerifierService,
    private readonly coreAccess: CoreAccessClient,
    private readonly presence: PresenceService,
    private readonly relay: EventRelayService,
    private readonly roomSync: RoomSyncService,
    private readonly logger: Logger
  ) {}

  /**
   * Fan every relay message out to the rooms it targets, **on this pod only**.
   *
   * `server.local.to(room)` rather than `server.to(room)`, and the difference is
   * the whole of plan 0028 section 2.3. Every pod already received this message
   * on its own relay subscription, so every pod is about to emit it. A plain
   * `.to()` would ask the socket.io Redis adapter to carry the same event across
   * the pod boundary a second time, and each client would receive it once per
   * replica. The event crosses once, through the relay channel; the emit is
   * local.
   */
  onModuleInit(): void {
    // Only a gateway is handed the socket server, and only something holding it
    // can take a room away from a socket (plan 0031).
    this.roomSync.bind(this.server);

    this.relay.stream$.subscribe((message) => {
      // One emit to the union of the rooms, not one per room. Socket.io resolves
      // an array of rooms to a set of sockets, so a client in two of them is
      // sent the event once; a loop would send it once per room it holds. Plan
      // 0032 makes that unavoidable rather than merely possible, since everyone
      // in `list:{id}` is also in `list:{id}:presence`.
      this.server.local.to(message.rooms).emit(message.event, message.payload);
      if (message.correlationId) {
        this.logger.debug(
          { correlationId: message.correlationId, event: message.event },
          'realtime fanned out an event'
        );
      }
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const claims = await this.tokenVerifier.verify(this.tokenOf(client));
      client.data.userId = claims.sub;
      this.presence.register(client.id, claims.sub);
    } catch {
      // Unauthenticated sockets never join a room; drop the connection.
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    await this.presence.disconnect(client.id);
  }

  @SubscribeMessage(RealtimeClientMessage.SubscribeZone)
  async subscribeZone(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: ZoneSubscription
  ): Promise<Ack> {
    const userId = this.userOf(client);
    if (!userId) {
      return { ok: false };
    }
    const zone = await this.coreAccess.checkZoneWithLists(userId, body.zoneId);
    if (!zone.allowed) {
      return { ok: false };
    }
    await client.join(zoneRoom(body.zoneId));
    // Owners and admins also join the governance side room, which is where the
    // join request counts arrive filled in (plan 0017, section 9). A member
    // promoted mid session joins it on their next resubscribe or reconnect;
    // `member.roleChanged` has already told the client its role changed.
    if (await this.coreAccess.checkZoneStaff(userId, body.zoneId)) {
      await client.join(zoneStaffRoom(body.zoneId));
    }
    /**
     * A presence room per readable list, on the server's initiative (plan 0032).
     *
     * The client never asks for these, which is what lets a group page light a
     * dot on eight rows while holding one subscription. It is here rather than in
     * `handleConnection` because connecting is currently a token verification and
     * nothing else: enumerating every readable list across every zone would put
     * the most expensive query this service makes on the critical path of every
     * connect, and connects are bursty in exactly the worst conditions, since a
     * deploy reconnects every client at once.
     *
     * Room membership is the access control, not a filter on the broadcast:
     * whoever may not read the list is not in the room to hear that it exists.
     */
    for (const listId of zone.listIds) {
      await client.join(listPresenceRoom(listId));
    }
    await this.presence.joinZone(client.id, body.zoneId);
    return { ok: true };
  }

  @SubscribeMessage(RealtimeClientMessage.UnsubscribeZone)
  async unsubscribeZone(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: ZoneSubscription
  ): Promise<Ack> {
    await client.leave(zoneRoom(body.zoneId));
    await client.leave(zoneStaffRoom(body.zoneId));
    /**
     * The list presence rooms go with the subscription that acquired them (plan
     * 0032, section 4), for the same reason the staff room does: they are not
     * rooms of their own on the client, so nothing else will ever release them.
     *
     * The set is asked for again rather than remembered on the socket, and it is
     * the cached answer the subscribe used, so this is a Redis read rather than a
     * round trip. Bookkeeping per socket would be a third place to keep in step
     * with the two sweeps, and any drift it could avoid is drift those sweeps
     * already exist to fix.
     */
    const userId = this.userOf(client);
    if (userId) {
      const { listIds } = await this.coreAccess.checkZoneWithLists(
        userId,
        body.zoneId
      );
      for (const listId of listIds) {
        await client.leave(listPresenceRoom(listId));
      }
    }
    await this.presence.leaveZone(client.id, body.zoneId);
    return { ok: true };
  }

  @SubscribeMessage(RealtimeClientMessage.SubscribeList)
  async subscribeList(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: ListSubscription
  ): Promise<Ack> {
    const userId = this.userOf(client);
    if (!userId || !(await this.coreAccess.checkList(userId, body.listId))) {
      return { ok: false };
    }
    await client.join(listRoom(body.listId));
    return { ok: true };
  }

  @SubscribeMessage(RealtimeClientMessage.UnsubscribeList)
  async unsubscribeList(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: ListSubscription
  ): Promise<Ack> {
    await client.leave(listRoom(body.listId));
    await this.presence.unviewList(client.id, body.listId);
    return { ok: true };
  }

  @SubscribeMessage(RealtimeClientMessage.ViewList)
  async viewList(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: ListSubscription
  ): Promise<Ack> {
    // Presence intents trust the room membership established at subscribe time,
    // so no extra core round-trip is needed to accept them.
    if (!client.rooms.has(listRoom(body.listId))) {
      return { ok: false };
    }
    await this.presence.viewList(client.id, body.listId);
    return { ok: true };
  }

  @SubscribeMessage(RealtimeClientMessage.UnviewList)
  async unviewList(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: ListSubscription
  ): Promise<Ack> {
    await this.presence.unviewList(client.id, body.listId);
    return { ok: true };
  }

  @SubscribeMessage(RealtimeClientMessage.EditLine)
  async editLine(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: EditLineSignal
  ): Promise<Ack> {
    if (!client.rooms.has(listRoom(body.listId))) {
      return { ok: false };
    }
    await this.presence.editLine(client.id, body.listId, body.lineId);
    return { ok: true };
  }

  @SubscribeMessage(RealtimeClientMessage.StopEditLine)
  async stopEditLine(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: StopEditLineSignal
  ): Promise<Ack> {
    await this.presence.stopEditLine(client.id, body.listId);
    return { ok: true };
  }

  /** The token from the socket handshake: auth payload, then bearer header, then query. */
  private tokenOf(client: Socket): string | undefined {
    const auth = client.handshake.auth as { token?: string } | undefined;
    if (auth?.token) {
      return auth.token;
    }
    const header = client.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      return header.slice(7);
    }
    const query = client.handshake.query.token;
    return typeof query === 'string' ? query : undefined;
  }

  private userOf(client: Socket): string | undefined {
    return client.data.userId as string | undefined;
  }
}
