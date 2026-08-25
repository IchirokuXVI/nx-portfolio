import {
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DOMAIN_EVENT_SUBJECTS,
  listRoom,
  zoneRoom,
  type DomainEvent,
} from '@portfolio/luna-shopper/contracts';
import { readCorrelationFromHeaders } from '@portfolio/luna-shopper/platform';
import {
  AckPolicy,
  connect,
  DeliverPolicy,
  JSONCodec,
  RetentionPolicy,
  type ConsumerMessages,
  type JetStreamManager,
  type JsMsg,
  type NatsConnection,
} from 'nats';
import { Logger } from 'nestjs-pino';
import type { RealtimeConfig } from '../config/app-config';
import {
  DEDUPE_WINDOW,
  EVENT_CONSUMER_NAME,
  EVENT_STREAM_NAME,
} from '../realtime/constants';
import { EventRelayService } from '../relay/event-relay.service';

/**
 * The wire shape NestJS's NATS transport puts on an emitted event: the subject as
 * `pattern` and the {@link DomainEvent} envelope as `data`. The realtime service
 * consumes the raw JetStream message, so it decodes this envelope itself rather
 * than going through a NestJS message handler.
 */
interface NatsEventPacket {
  pattern: string;
  data: DomainEvent;
}

/**
 * Consumes the domain events from JetStream and hands them to the relay (plan
 * 0009, section 4).
 *
 * It attaches a durable consumer to a stream that captures exactly the domain
 * event subjects ({@link DOMAIN_EVENT_SUBJECTS}). Durable means the cursor
 * survives a restart and JetStream replays anything missed while the pod was
 * down. Delivery is at-least-once, so the relay is made idempotent here by
 * dropping any event id seen recently. The correlation id rides on the message
 * headers and is carried through to the fan-out so a push traces back to the
 * request that caused it (section 4).
 */
@Injectable()
export class JetStreamConsumer implements OnModuleInit, OnApplicationShutdown {
  private readonly codec = JSONCodec<NatsEventPacket>();
  private readonly seen = new Map<string, true>();
  private connection?: NatsConnection;
  private messages?: ConsumerMessages;
  private draining = false;

  constructor(
    private readonly config: ConfigService,
    private readonly relay: EventRelayService,
    private readonly logger: Logger
  ) {}

  async onModuleInit(): Promise<void> {
    const { natsUrl } = this.config.getOrThrow<RealtimeConfig>('realtime');
    this.connection = await connect({
      servers: [natsUrl],
      name: 'luna-shopper-realtime',
    });
    const jsm = await this.connection.jetstreamManager();
    await this.ensureStream(jsm);
    await this.ensureConsumer(jsm);
    // Fire and forget: the consume loop runs for the life of the process.
    void this.consumeLoop();
    this.logger.log(
      `realtime consuming ${DOMAIN_EVENT_SUBJECTS.length} domain event subjects from JetStream stream ${EVENT_STREAM_NAME}`
    );
  }

  async onApplicationShutdown(): Promise<void> {
    this.draining = true;
    await this.messages?.close();
    await this.connection?.drain();
  }

  /** Create the event stream, or widen its subjects if it already exists. */
  private async ensureStream(jsm: JetStreamManager): Promise<void> {
    const subjects = DOMAIN_EVENT_SUBJECTS as unknown as string[];
    try {
      await jsm.streams.info(EVENT_STREAM_NAME);
      await jsm.streams.update(EVENT_STREAM_NAME, { subjects });
    } catch {
      await jsm.streams.add({
        name: EVENT_STREAM_NAME,
        subjects,
        retention: RetentionPolicy.Limits,
      });
    }
  }

  /** Create the durable consumer if it is not already there. */
  private async ensureConsumer(jsm: JetStreamManager): Promise<void> {
    try {
      await jsm.consumers.info(EVENT_STREAM_NAME, EVENT_CONSUMER_NAME);
    } catch {
      await jsm.consumers.add(EVENT_STREAM_NAME, {
        durable_name: EVENT_CONSUMER_NAME,
        ack_policy: AckPolicy.Explicit,
        // A fresh consumer starts at "now"; a restarted one resumes from its last
        // ack and replays what it missed (plan 0009, section 4).
        deliver_policy: DeliverPolicy.New,
      });
    }
  }

  private async consumeLoop(): Promise<void> {
    if (!this.connection) {
      return;
    }
    const consumer = await this.connection
      .jetstream()
      .consumers.get(EVENT_STREAM_NAME, EVENT_CONSUMER_NAME);
    this.messages = await consumer.consume();
    try {
      for await (const message of this.messages) {
        this.handle(message);
        message.ack();
      }
    } catch (err) {
      if (!this.draining) {
        this.logger.error({ err }, 'realtime JetStream consume loop failed');
      }
    }
  }

  private handle(message: JsMsg): void {
    let envelope: DomainEvent;
    try {
      envelope = this.codec.decode(message.data).data;
    } catch (err) {
      // A message that cannot be decoded is acked and dropped: retrying it would
      // only wedge the consumer on the same poison message.
      this.logger.warn({ err }, 'realtime dropped an undecodable event');
      return;
    }

    if (this.isDuplicate(envelope.eventId)) {
      return;
    }

    const correlationId = readCorrelationFromHeaders(message.headers);
    // Zone/membership/merge events reach the zone room; list-scoped events reach
    // both the list room and the zone room, for a zone-level list index (section 6).
    const rooms = [zoneRoom(envelope.zoneId)];
    if (envelope.listId) {
      rooms.push(listRoom(envelope.listId));
    }

    this.relay.publish({
      rooms,
      event: envelope.event,
      payload: envelope.payload,
      correlationId,
    });
  }

  /** True when this event id was already handled, remembering it otherwise. */
  private isDuplicate(eventId: string): boolean {
    if (this.seen.has(eventId)) {
      return true;
    }
    this.seen.set(eventId, true);
    if (this.seen.size > DEDUPE_WINDOW) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) {
        this.seen.delete(oldest);
      }
    }
    return false;
  }
}
