import {
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { RealtimeEvent } from '@portfolio/luna-shopper/contracts';
import { RedisService, type Redis } from '@portfolio/luna-shopper/platform';
import { Logger } from 'nestjs-pino';
import { Observable, Subject } from 'rxjs';

/** The Redis channel every pod publishes to and subscribes to. */
export const RELAY_CHANNEL = 'relay:events';

/**
 * One fan-out message: what to send, to which rooms, and the correlation id of
 * the request that caused it (plan 0009, section 4) so a realtime push can be
 * traced back to its originating action.
 */
export interface RelayMessage {
  rooms: string[];
  event: RealtimeEvent;
  payload: unknown;
  correlationId?: string;
}

/**
 * The single internal relay both transports read from (plan 0009, section 3),
 * with the Redis hop that makes it correct across pods (plan 0028, section 2.3).
 *
 * The JetStream consumer and the presence service publish here; the socket
 * gateway and the SSE controller subscribe. Because everything flows through one
 * stream, a WebSocket client and an SSE client receive byte-identical payloads,
 * so there is one source of truth for what an event looks like.
 *
 * ## Why the hop is here and not in the adapter
 *
 * There is one durable JetStream consumer, so exactly one pod consumes any given
 * event. That is the right shape, and it is also the shape that breaks SSE: the
 * SSE controller on the pod that did **not** consume the event would never see
 * it on a purely local `Subject`. The obvious repair, a consumer per pod, breaks
 * the other transport instead, because both pods would then emit into the same
 * room and the socket adapter would fan each emit out to every socket, so every
 * client gets every event twice.
 *
 * The rule that resolves it: **an event crosses the pod boundary exactly once**,
 * and this channel is that crossing. One pod consumes from JetStream and
 * publishes here; every pod subscribes and feeds its own `Subject` from it; SSE
 * and the socket gateway both read that `Subject`; and the gateway emits with
 * `server.local.to(room)` so the socket adapter does not carry the same event
 * across a second time.
 *
 * The consequence worth remembering when editing this file: `publish` does
 * **not** feed the local subject directly. The publisher receives its own
 * message back through its own subscription, exactly like every other pod. The
 * one exception is the degraded path below.
 */
@Injectable()
export class EventRelayService implements OnModuleInit, OnApplicationShutdown {
  private readonly subject = new Subject<RelayMessage>();
  private subscriber?: Redis;

  constructor(
    private readonly redis: RedisService,
    private readonly logger: Logger
  ) {}

  async onModuleInit(): Promise<void> {
    // A dedicated connection: one in subscribe mode cannot issue commands, and
    // `publish` below needs a connection that can.
    this.subscriber = this.redis.duplicate('pubsub', 'luna-relay-sub');

    this.subscriber.on('message', (channel: string, raw: string) => {
      if (channel !== RELAY_CHANNEL) {
        return;
      }
      try {
        this.subject.next(JSON.parse(raw) as RelayMessage);
      } catch (err) {
        this.logger.warn({ err }, 'realtime dropped an undecodable relay message');
      }
    });

    try {
      await this.subscriber.subscribe(RELAY_CHANNEL);
    } catch (err) {
      // ioredis re issues the SUBSCRIBE itself on reconnect, so a failure here
      // is the start of an outage rather than a permanent deafness. Boot
      // continues: section 5 asks this service to stay up and serve degraded.
      this.logger.error({ err }, 'realtime could not subscribe to the relay channel');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.subject.complete();
    // The connection itself is closed by RedisService, which owns every
    // connection it hands out.
    await this.subscriber?.unsubscribe(RELAY_CHANNEL).catch(() => undefined);
  }

  /**
   * Publish a message to every pod, including this one.
   *
   * Fire and forget by design: the callers are a JetStream consume loop and the
   * presence service, and neither has anything useful to do with a promise. What
   * they do need is that a Redis outage never throws into them.
   */
  publish(message: RelayMessage): void {
    void this.redis.client
      .publish(RELAY_CHANNEL, JSON.stringify(message))
      .catch((err: Error) => {
        this.logger.warn(
          { err, event: message.event },
          'realtime relay publish failed, delivering to local clients only'
        );
        // The degraded path from section 5: cross pod fan out stops, but locally
        // consumed events still reach locally connected clients. Feeding the
        // subject here cannot double deliver, because the publish that would
        // have fed it through the subscription is the one that just failed.
        this.subject.next(message);
      });
  }

  /** The shared stream of relay messages. */
  get stream$(): Observable<RelayMessage> {
    return this.subject.asObservable();
  }
}
