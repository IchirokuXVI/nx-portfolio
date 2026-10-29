import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ACCOUNT_DELETION_STREAM } from '@portfolio/luna-shopper/contracts';
import {
  AckPolicy,
  connect,
  DeliverPolicy,
  nanos,
  type ConsumerConfig,
  type ConsumerMessages,
  type JsMsg,
  type NatsConnection,
} from 'nats';
import type { CoreConfig } from '../config/app-config';
import { AccountDeletionService } from './account-deletion.service';

/** Backoff between rebuilds of a consume loop that ended. Exponential, capped. */
const CONSUME_RETRY_BASE_MS = 1_000;
const CONSUME_RETRY_CAP_MS = 30_000;

/** How long a deletion that threw waits before it is delivered again. */
const MESSAGE_RETRY_MS = 30_000;

/** How often a deletion still running tells the stream it is alive. */
const WORKING_EVERY_MS = 20_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The durable consumer's settings (plan 0232, section 5): explicit acks, no
 * limit on deliveries, and a backoff for a delivery nobody acked.
 *
 * The server takes the first backoff step as the ack wait, so it is the
 * contract's 60 seconds; the later steps space out a deletion whose handler
 * died without a nak (a pod killed mid transaction).
 */
const CONSUMER: Partial<ConsumerConfig> = {
  durable_name: ACCOUNT_DELETION_STREAM.consumers.core,
  ack_policy: AckPolicy.Explicit,
  ack_wait: nanos(ACCOUNT_DELETION_STREAM.ackWaitSeconds * 1_000),
  max_deliver: -1,
  backoff: [60, 120, 300, 900, 1_800].map((seconds) => nanos(seconds * 1_000)),
  filter_subject: ACCOUNT_DELETION_STREAM.subject,
  // A fresh consumer reads the whole stream: a deletion published before core
  // ever started must still reach it.
  deliver_policy: DeliverPolicy.All,
};

/**
 * Hands each `user.deleted` on {@link ACCOUNT_DELETION_STREAM} to the deletion
 * (plan 0232, section 5).
 *
 * Shaped as realtime's `JetStreamConsumer`: a loop that owns its own recovery
 * and rebuilds the subscription whenever it ends. Unlike realtime it does not
 * create the stream. Auth ensures it at boot, because auth is the side that
 * must never publish into nothing, so a core that starts first meets no stream
 * and keeps retrying with the loop's backoff instead of crashing the process.
 *
 * The message is acked after the deletion's transaction commits and naked with
 * a delay on a throw, so a deletion that meets a failure is done again from the
 * start. An undecodable message is acked and logged: no redelivery would ever
 * decode it.
 *
 * Started by `main.ts`, not by the module, so a one off command that boots the
 * same module (`reconcile-deletions.ts`) never pulls from the stream.
 */
@Injectable()
export class AccountDeletionConsumer implements OnApplicationShutdown {
  private readonly logger = new Logger(AccountDeletionConsumer.name);
  private connection?: NatsConnection;
  private messages?: ConsumerMessages;
  private draining = false;
  private started = false;

  constructor(
    private readonly config: ConfigService,
    private readonly deletions: AccountDeletionService
  ) {}

  /** Start consuming for the life of the process. Returns at once. */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    void this.consumeLoop();
  }

  async onApplicationShutdown(): Promise<void> {
    this.draining = true;
    await this.messages?.close();
    await this.connection?.drain();
  }

  private async consumeLoop(): Promise<void> {
    let attempt = 0;
    while (!this.draining) {
      try {
        const handled = await this.consumeUntilItEnds();
        attempt = handled > 0 ? 0 : attempt + 1;
      } catch (err) {
        attempt += 1;
        if (!this.draining) {
          this.logger.warn(
            { err, attempt },
            'account deletion consumer is not consuming, retrying'
          );
        }
      }
      if (this.draining) {
        return;
      }
      await this.pause(
        Math.min(
          CONSUME_RETRY_CAP_MS,
          CONSUME_RETRY_BASE_MS * 2 ** Math.max(attempt - 1, 0)
        )
      );
    }
  }

  /** Connect, attach the durable consumer, and consume until the iterator ends. */
  private async consumeUntilItEnds(): Promise<number> {
    if (!this.connection || this.connection.isClosed()) {
      const { natsUrl } = this.config.getOrThrow<CoreConfig>('core');
      this.connection = await connect({
        servers: [natsUrl],
        name: 'luna-shopper-backend-core-account-deletion',
      });
    }
    const jsm = await this.connection.jetstreamManager();
    const stream = ACCOUNT_DELETION_STREAM.name;
    const durable = ACCOUNT_DELETION_STREAM.consumers.core;
    let exists = true;
    try {
      await jsm.consumers.info(stream, durable);
    } catch {
      exists = false;
    }
    if (exists) {
      // A consumer made by an older release takes the settings of this one.
      try {
        await jsm.consumers.update(stream, durable, {
          ack_wait: CONSUMER.ack_wait,
          max_deliver: CONSUMER.max_deliver,
          backoff: CONSUMER.backoff,
        });
      } catch (err) {
        this.logger.warn(
          { err },
          'account deletion consumer kept its earlier settings'
        );
      }
    } else {
      // Throws while the stream does not exist yet, which the loop retries.
      await jsm.consumers.add(stream, CONSUMER);
    }

    const consumer = await this.connection
      .jetstream()
      .consumers.get(stream, durable);
    const messages = await consumer.consume();
    this.messages = messages;

    let handled = 0;
    for await (const message of messages) {
      await this.handle(message);
      handled += 1;
    }
    return handled;
  }

  /** One message: decode, delete, then ack, or nak with a delay on a throw. */
  async handle(message: JsMsg): Promise<void> {
    const userId = decodeUserId(message.data);
    if (!userId) {
      this.logger.error(
        { subject: message.subject, seq: message.seq },
        'account deletion consumer dropped an undecodable message'
      );
      message.ack();
      return;
    }

    // A deletion with many rows can outlast the ack wait. Telling the stream it
    // is still being worked on keeps it from handing the same id to a second
    // replica meanwhile.
    const alive = setInterval(() => message.working(), WORKING_EVERY_MS);
    alive.unref?.();
    try {
      const applied = await this.deletions.handleUserDeleted(userId);
      message.ack();
      this.logger.log(
        { seq: message.seq, applied },
        applied
          ? 'account deletion applied'
          : 'account deletion was already applied'
      );
    } catch (err) {
      this.logger.error(
        { err, seq: message.seq, redeliveries: message.info.redeliveryCount },
        'account deletion failed and rolled back, retrying it later'
      );
      message.nak(MESSAGE_RETRY_MS);
    } finally {
      clearInterval(alive);
    }
  }

  /** Sleep, without holding the process open if shutdown is what ends the wait. */
  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms).unref?.();
    });
  }
}

/**
 * The user id of a message: raw JSON `{ "userId": "<uuid>" }`, published by
 * auth with `js.publish` and not inside Nest's `{ pattern, data }` envelope.
 * Null for anything else.
 */
export function decodeUserId(data: Uint8Array): string | null {
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(data));
    if (typeof body !== 'object' || body === null) {
      return null;
    }
    const userId = (body as { userId?: unknown }).userId;
    return typeof userId === 'string' && UUID.test(userId)
      ? userId.toLowerCase()
      : null;
  } catch {
    return null;
  }
}
