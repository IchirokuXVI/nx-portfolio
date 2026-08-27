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
    this.relay.stream$.subscribe((message) => {
      for (const room of message.rooms) {
        this.server.local.to(room).emit(message.event, message.payload);
      }
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
    if (!userId || !(await this.coreAccess.checkZone(userId, body.zoneId))) {
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
