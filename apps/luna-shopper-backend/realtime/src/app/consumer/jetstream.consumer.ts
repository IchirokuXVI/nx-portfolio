import {
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { context as otelContext } from '@opentelemetry/api';
import {
  DOMAIN_EVENT_SUBJECTS,
  listRoom,
  RealtimeEvent,
  zoneRoom,
  zoneStaffRoom,
  type DomainEvent,
  type ZoneCountsUpdatedPayload,
} from '@portfolio/luna-shopper/contracts';
import {
  beginConsumerSpan,
  readCorrelationFromHeaders,
  recordFanoutLatency,
  RedisService,
  runWithRequestContext,
} from '@portfolio/luna-shopper/platform';
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
import { CoreAccessClient } from '../messaging/core-access.client';
import {
  ACCESS_INVALIDATING_EVENTS,
  DEDUPE_KEY_PREFIX,
  DEDUPE_WINDOW_SECONDS,
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

/** Backoff between rebuilds of a consume loop that ended. Exponential, capped. */
const CONSUME_RETRY_BASE_MS = 1_000;
const CONSUME_RETRY_CAP_MS = 30_000;

/**
 * How long JetStream waits before redelivering a message this pod failed on.
 *
 * A delay rather than an immediate `nak`, because the failures worth retrying are
 * transient (a Redis blip, a broker hiccup) and an undelayed redelivery of a
 * message that fails deterministically is a hot loop.
 */
const MESSAGE_RETRY_MS = 5_000;

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
  private connection?: NatsConnection;
  private messages?: ConsumerMessages;
  private draining = false;

  constructor(
    private readonly config: ConfigService,
    private readonly relay: EventRelayService,
    private readonly redis: RedisService,
    private readonly coreAccess: CoreAccessClient,
    private readonly logger: Logger
  ) {}

  async onModuleInit(): Promise<void> {
    const { natsUrl } = this.config.getOrThrow<RealtimeConfig>('realtime');
    this.connection = await connect({
      servers: [natsUrl],
      name: 'luna-shopper-backend-realtime',
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

  /**
   * Consume for the life of the process, rebuilding the subscription whenever it
   * ends.
   *
   * ## Why this is a loop and not a `for await`
   *
   * It used to be one pass: build the iterator, iterate, and log if it threw. Both
   * ways out of that were terminal. A throw from {@link handle} left the catch and
   * returned; an iterator that simply **ended**, which a dropped connection or a
   * missed heartbeat is enough to do, returned with no error to log at all. Either
   * way the process stayed up and healthy in every way anyone was measuring: the
   * socket server kept accepting connections, presence kept broadcasting, rooms
   * kept being joined, and not one domain event was ever fanned out again.
   *
   * That is the worst shape a failure can take here. Nothing is down, so nothing
   * restarts and no probe fails; the app simply stops being live, for everybody,
   * until somebody notices by hand that their groups do not update. It was found
   * exactly that way, with the durable consumer sitting 26 messages behind and its
   * `num_waiting` at zero: nobody was pulling.
   *
   * So the loop owns its own recovery. The subscription is rebuilt after a backoff,
   * and the backoff resets on any pass that actually delivered something, since
   * that is the proof the connection works.
   */
  private async consumeLoop(): Promise<void> {
    let attempt = 0;

    while (!this.draining) {
      try {
        const handled = await this.consumeUntilItEnds();
        attempt = handled > 0 ? 0 : attempt + 1;
        if (!this.draining) {
          this.logger.warn(
            { handled },
            'realtime JetStream consume loop ended, rebuilding it'
          );
        }
      } catch (err) {
        attempt += 1;
        if (!this.draining) {
          this.logger.error(
            { err },
            'realtime JetStream consume loop failed, rebuilding it'
          );
        }
      }

      if (this.draining) {
        return;
      }

      await this.pause(
        Math.min(
          CONSUME_RETRY_CAP_MS,
          CONSUME_RETRY_BASE_MS * 2 ** (attempt - 1)
        )
      );
    }
  }

  /**
   * One subscription's worth of messages. Answers how many it handled.
   *
   * **A message that fails must not end this.** The handler already swallows the
   * failures it knows about, so an exception reaching here is an unexpected one,
   * and taking the whole fan out down for the process is never the right answer to
   * a single bad event. It is naked instead, with a delay, and the next message is
   * taken: the broker redelivers it while everybody else's updates keep flowing.
   */
  private async consumeUntilItEnds(): Promise<number> {
    if (!this.connection) {
      return 0;
    }

    const consumer = await this.connection
      .jetstream()
      .consumers.get(EVENT_STREAM_NAME, EVENT_CONSUMER_NAME);
    const messages = await consumer.consume();
    this.messages = messages;

    let handled = 0;
    for await (const message of messages) {
      try {
        // Awaited, so the dedupe claim settles before the next message is
        // handled and before this one is acked. It also keeps the fan out in
        // stream order, which the synchronous version got for free.
        await this.handle(message);
        message.ack();
      } catch (err) {
        this.logger.error(
          { err, subject: message.subject },
          'realtime failed to handle an event, retrying it later'
        );
        message.nak(MESSAGE_RETRY_MS);
      }
      handled += 1;
    }

    return handled;
  }

  /** Sleep, without holding the process open if shutdown is what ends the wait. */
  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms).unref?.();
    });
  }

  private async handle(message: JsMsg): Promise<void> {
    let envelope: DomainEvent;
    try {
      envelope = this.codec.decode(message.data).data;
    } catch (err) {
      // A message that cannot be decoded is acked and dropped: retrying it would
      // only wedge the consumer on the same poison message.
      this.logger.warn({ err }, 'realtime dropped an undecodable event');
      return;
    }

    if (await this.isDuplicate(envelope.eventId)) {
      return;
    }

    // Before the fan out, not after (plan 0028, section 2.6). A member kicked in
    // this event must not be answered from cache by a subscribe that arrives in
    // the same tick as the push telling them they were kicked.
    await this.invalidateAccessCache(envelope);

    const correlationId = readCorrelationFromHeaders(message.headers);

    /**
     * The fan out, wrapped in a consumer span parented to the publish in core
     * (plan 0016, section 4.3). This is the hop that completes the single most
     * valuable trace in the system: one tree running from the user's HTTP request
     * through core and the broker to the push another user's browser receives.
     * The latency from receiving the event to pushing it is recorded alongside,
     * from the same place, so span and metric cannot disagree.
     */
    const fanOut = () => {
      const scope = beginConsumerSpan(message.subject, message.headers);
      const startedAt = Date.now();
      try {
        otelContext.with(scope.context, () => {
          // Zone/membership/merge events reach the zone room; list-scoped events
          // reach both the list room and the zone room, for a zone-level list
          // index (section 6).
          const rooms = [zoneRoom(envelope.zoneId)];
          if (envelope.listId) {
            rooms.push(listRoom(envelope.listId));
          }

          if (envelope.event === RealtimeEvent.ZoneCountsUpdated) {
            this.fanOutZoneCounts(envelope, correlationId);
            return;
          }

          this.relay.publish({
            rooms,
            event: envelope.event,
            payload: envelope.payload,
            correlationId,
          });
        });
        scope.finish();
      } catch (err) {
        scope.finish(err);
        throw err;
      } finally {
        recordFanoutLatency(envelope.event, Date.now() - startedAt);
      }
    };

    // Only when the publisher supplied one, so an uncorrelated internal event
    // still logs exactly as it does today rather than gaining a minted id.
    if (correlationId) {
      runWithRequestContext({ correlationId }, fanOut);
    } else {
      fanOut();
    }
  }

  /**
   * The one event that reaches two rooms with two different payloads (plan 0017,
   * section 9).
   *
   * The zone room is every approved member, so publishing the counts as core
   * sent them would hand every member exactly what section 6 withholds over
   * REST. Core publishes the block filled, and the split happens here, because
   * this is where room routing lives: the staff room gets it as sent, the plain
   * zone room gets a copy with both governance fields nulled. `null` is "not
   * your business" and `0` is "nobody is waiting", so the copy nulls rather than
   * zeroes.
   */
  private fanOutZoneCounts(
    envelope: DomainEvent,
    correlationId?: string
  ): void {
    const payload = envelope.payload as ZoneCountsUpdatedPayload;

    this.relay.publish({
      rooms: [zoneStaffRoom(envelope.zoneId)],
      event: envelope.event,
      payload,
      correlationId,
    });

    this.relay.publish({
      rooms: [zoneRoom(envelope.zoneId)],
      event: envelope.event,
      payload: {
        ...payload,
        counts: {
          ...payload.counts,
          pendingRequestCount: null,
          firstPendingRequesterName: null,
        },
      },
      correlationId,
    });
  }

  /**
   * Drop the cached access answers this event invalidates (plan 0028, section
   * 2.6).
   *
   * This is the half of the access cache that makes it acceptable at all. The
   * cache buys a revocation delay, and section 2.6 is explicit that the delay is
   * not tolerable on its own and that the invalidation ships in the same change
   * rather than as a follow up. The realtime service already consumes every one
   * of these events for the fan out, so this costs one `DEL` on an event that
   * was going to be handled anyway.
   *
   * Every event in {@link ACCESS_INVALIDATING_EVENTS} drops the zone's entries.
   * That set is deliberately generous: it is cheaper to re ask core than to
   * reason, per payload, about exactly whose access an event moved, and being
   * wrong in that reasoning means a revoked member keeps hearing a room.
   *
   * Any event carrying a `listId` also drops that list's entries. `list.deleted`
   * and `list.accessChanged` are the ones that matter, and including the rest
   * costs a `DEL` on a key that is about to be rebuilt anyway.
   */
  private async invalidateAccessCache(envelope: DomainEvent): Promise<void> {
    const invalidatesZone = ACCESS_INVALIDATING_EVENTS.has(envelope.event);

    if (invalidatesZone) {
      await this.coreAccess.invalidateZone(envelope.zoneId);
    }
    if (envelope.listId) {
      await this.coreAccess.invalidateList(envelope.listId);
    }
  }

  /**
   * True when this event id was already handled, claiming it otherwise (plan
   * 0028, section 2.5).
   *
   * `SET key 1 NX EX window` is the whole of it: the reply tells the caller
   * whether it was the first delivery, in one atomic round trip, so two pods
   * handed the same redelivery cannot both conclude they were first. The window
   * is a TTL rather than the count of ids this used to keep in memory.
   *
   * **Fails open.** With no answer from Redis the event is treated as new and
   * fanned out. Between publishing an event twice and dropping it entirely, the
   * duplicate is the recoverable one: clients render the same update again,
   * where a dropped event leaves a list stale until the next mutation. The
   * silent version of this failure is the one that costs something.
   */
  private async isDuplicate(eventId: string): Promise<boolean> {
    const key = `${DEDUPE_KEY_PREFIX}:${eventId}`;
    try {
      const claimed = await this.redis.client.set(
        key,
        1,
        'EX',
        DEDUPE_WINDOW_SECONDS,
        'NX'
      );
      return claimed === null;
    } catch (err) {
      this.logger.warn(
        { err, eventId },
        'realtime dedupe check failed, treating the event as new'
      );
      return false;
    }
  }
}
