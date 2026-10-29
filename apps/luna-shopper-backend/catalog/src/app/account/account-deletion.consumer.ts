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
import type { CatalogConfig } from '../config/app-config';
import { AccountDeletionService } from './account-deletion.service';

const CONSUME_RETRY_BASE_MS = 1_000;
const CONSUME_RETRY_CAP_MS = 30_000;
/** How long a deletion that threw waits before it is delivered again. */
const MESSAGE_RETRY_MS = 30_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Catalog's durable consumer, the same settings as core's (plan 0232, section
 * 5): explicit acks, unlimited deliveries, and a backoff whose first step is
 * the 60 second ack wait.
 */
const CONSUMER: Partial<ConsumerConfig> = {
  durable_name: ACCOUNT_DELETION_STREAM.consumers.catalog,
  ack_policy: AckPolicy.Explicit,
  ack_wait: nanos(ACCOUNT_DELETION_STREAM.ackWaitSeconds * 1_000),
  max_deliver: -1,
  backoff: [60, 120, 300, 900, 1_800].map((seconds) => nanos(seconds * 1_000)),
  filter_subject: ACCOUNT_DELETION_STREAM.subject,
  deliver_policy: DeliverPolicy.All,
};

/**
 * Hands each `user.deleted` on {@link ACCOUNT_DELETION_STREAM} to catalog's
 * deletion (plan 0232, sections 5 and 6).
 *
 * The shape of core's `AccountDeletionConsumer`, written again here because a
 * service shares nothing with another but the contracts. A loop that rebuilds
 * the subscription whenever it ends, and keeps retrying while auth has not
 * created the stream yet. Ack after the commit, nak with a delay on a throw,
 * and ack and log a message it cannot read. Started by `main.ts`.
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
      const ms = Math.min(
        CONSUME_RETRY_CAP_MS,
        CONSUME_RETRY_BASE_MS * 2 ** Math.max(attempt - 1, 0)
      );
      await new Promise((resolve) => setTimeout(resolve, ms).unref?.());
    }
  }

  private async consumeUntilItEnds(): Promise<number> {
    if (!this.connection || this.connection.isClosed()) {
      const { natsUrl } = this.config.getOrThrow<CatalogConfig>('catalog');
      this.connection = await connect({
        servers: [natsUrl],
        name: 'luna-shopper-backend-catalog-account-deletion',
      });
    }
    const jsm = await this.connection.jetstreamManager();
    const stream = ACCOUNT_DELETION_STREAM.name;
    const durable = ACCOUNT_DELETION_STREAM.consumers.catalog;
    let exists = true;
    try {
      await jsm.consumers.info(stream, durable);
    } catch {
      exists = false;
    }
    if (!exists) {
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
    try {
      const rewritten = await this.deletions.handleUserDeleted(userId);
      message.ack();
      this.logger.log(
        { seq: message.seq, rewritten },
        'account deletion applied'
      );
    } catch (err) {
      this.logger.error(
        { err, seq: message.seq },
        'account deletion failed and rolled back, retrying it later'
      );
      message.nak(MESSAGE_RETRY_MS);
    }
  }
}

/** The user id of a raw JSON `{ "userId": "<uuid>" }` body, or null. */
export function decodeUserId(data: Uint8Array): string | null {
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(data));
    const userId =
      typeof body === 'object' && body !== null
        ? (body as { userId?: unknown }).userId
        : undefined;
    return typeof userId === 'string' && UUID.test(userId)
      ? userId.toLowerCase()
      : null;
  } catch {
    return null;
  }
}
