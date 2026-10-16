import {
  Inject,
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy, NatsRecordBuilder } from '@nestjs/microservices';
import {
  IMPERSONATION_EVENTS,
  IMPERSONATION_PATTERNS,
  type CheckImpersonationRequest,
  type CheckImpersonationResult,
  type ImpersonationEndedEvent,
} from '@portfolio/luna-shopper/contracts';
import {
  buildNatsHeaders,
  traceNatsSend,
} from '@portfolio/luna-shopper/platform';
import { connect, JSONCodec, type NatsConnection } from 'nats';
import { Logger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { firstValueFrom, Subject, type Observable } from 'rxjs';
import type { RealtimeConfig } from '../config/app-config';
import { CORE_ACCESS_CLIENT } from '../messaging/core-access.client';

/** The room every socket of one support session is put in, on this pod. */
export const impersonationRoom = (sessionId: string): string =>
  `impersonation:${sessionId}`;

/** What NestJS's NATS transport puts on the wire for an emitted event. */
interface NatsEventPacket {
  pattern?: string;
  data?: Partial<ImpersonationEndedEvent>;
}

/**
 * The realtime service's two links to a support session (plan 0194).
 *
 * **{@link isLive}** asks auth whether a session is live, as a socket connects
 * and as an SSE stream opens. It is the same question the gateway asks on each
 * request. It is not cached: a cached yes is exactly the late answer the
 * session row exists to prevent, and the question is asked one time for each
 * connection of a rare kind.
 *
 * **{@link ended$}** names each session that auth says is over. It is a plain
 * NATS subscription with no queue group, so **every pod receives every event**
 * and each drops the sockets it holds itself. That is why it does not ride the
 * JetStream consumer: the durable consumer hands a message to one pod, and the
 * relay it feeds carries events to rooms and has no way to close a socket.
 *
 * The subscription is at most once. A pod that misses an event keeps a socket
 * until the deadline timer, which each socket of a session carries from the
 * moment it connects. That socket only reads, and every write of the session
 * goes through the gateway, which asks auth each time.
 */
@Injectable()
export class ImpersonationSessionsService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly ended = new Subject<string>();
  private connection?: NatsConnection;

  /** The id of each support session that ended, as auth announces it. */
  readonly ended$: Observable<string> = this.ended.asObservable();

  constructor(
    // The request and reply client the room checks already use. It is a plain
    // NATS client: the name says who it was made for, not who it can reach.
    @Inject(CORE_ACCESS_CLIENT) private readonly client: ClientProxy,
    private readonly config: ConfigService,
    private readonly logger: Logger
  ) {}

  async onModuleInit(): Promise<void> {
    const { natsUrl } = this.config.getOrThrow<RealtimeConfig>('realtime');
    this.connection = await connect({
      servers: [natsUrl],
      name: 'luna-shopper-backend-realtime-impersonation',
      // Reconnect for as long as the process lives. The client restores the
      // subscription itself after a reconnect.
      maxReconnectAttempts: -1,
    });
    const codec = JSONCodec<NatsEventPacket>();
    const subscription = this.connection.subscribe(IMPERSONATION_EVENTS.ended);
    void (async () => {
      for await (const message of subscription) {
        try {
          const sessionId = codec.decode(message.data).data?.sessionId;
          if (typeof sessionId === 'string' && sessionId) {
            this.ended.next(sessionId);
          }
        } catch (err) {
          this.logger.warn(
            { err },
            'realtime could not read an impersonation.ended event'
          );
        }
      }
    })();
  }

  async onApplicationShutdown(): Promise<void> {
    this.ended.complete();
    await this.connection?.drain();
  }

  /** Whether auth says the session is live right now. False when it does not answer. */
  async isLive(sessionId: string): Promise<boolean> {
    const req: CheckImpersonationRequest = { sessionId };
    try {
      const answer = await traceNatsSend(IMPERSONATION_PATTERNS.check, () => {
        const record = new NatsRecordBuilder(req)
          .setHeaders(buildNatsHeaders({ correlationId: randomUUID() }))
          .build();
        return firstValueFrom(
          this.client.send<CheckImpersonationResult>(
            IMPERSONATION_PATTERNS.check,
            record
          )
        );
      });
      return answer?.live === true;
    } catch (err) {
      // Closed, not open: a socket for a session nobody can vouch for is
      // refused, and the app connects again.
      this.logger.warn({ err }, 'realtime could not check a support session');
      return false;
    }
  }
}
