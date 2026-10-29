import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  ACCOUNT_DELETION_STREAM,
  type UserDeletedEvent,
} from '@portfolio/luna-shopper/contracts';
import { buildNatsHeaders } from '@portfolio/luna-shopper/platform';
import {
  JSONCodec,
  nanos,
  RetentionPolicy,
  StorageType,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
} from 'nats';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AccountDeletion } from '../entities';

/** Injection token for {@link AccountDeletionPublisherOptions}. */
export const ACCOUNT_DELETION_PUBLISHER_OPTIONS =
  'ACCOUNT_DELETION_PUBLISHER_OPTIONS';

/** What the publisher needs from outside, so a spec can hand it doubles. */
export interface AccountDeletionPublisherOptions {
  /** Opens the connection the publisher owns and drains at shutdown. */
  connect: () => Promise<NatsConnection>;
  /** Between two passes over whatever the outbox still holds. */
  intervalMs: number;
}

/** The timer of plan 0232, section 5. */
export const ACCOUNT_DELETION_PUBLISH_INTERVAL_MS = 30_000;

/** Rows one read of the outbox takes. A pass reads again until it is empty. */
const BATCH = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Hands each committed account deletion to the `LUNA_ACCOUNT_DELETIONS` stream
 * (plan 0232, section 5).
 *
 * The delete writes an `account_deletions` row in its own transaction. This
 * publishes the row with a JetStream publish that waits for the stream's ack,
 * and deletes the row only after the ack. A deletion is thus either still in
 * the outbox or already in the stream, and a crash between the two publishes it
 * again, which every consumer treats as a no op. That replaces the plain NATS
 * emit `IdentityEventsPublisher` used to send, which reached nobody when no
 * core replica happened to be connected.
 *
 * A pass runs at once after each delete commits ({@link publishSoon}) and on a
 * timer for anything a failed pass left behind. Passes never overlap: a trigger
 * that arrives during one makes it read the outbox again before it ends, so the
 * row that trigger committed is not left for the timer.
 *
 * Auth ensures the stream at boot, the way realtime ensures its own, because
 * auth is the side that must never publish into nothing.
 */
@Injectable()
export class AccountDeletionPublisher
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(AccountDeletionPublisher.name);
  private readonly codec = JSONCodec<UserDeletedEvent>();
  private connection?: NatsConnection;
  private js?: JetStreamClient;
  private timer?: ReturnType<typeof setInterval>;
  private pass?: Promise<number>;
  private again = false;
  private closing = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(ACCOUNT_DELETION_PUBLISHER_OPTIONS)
    private readonly options: AccountDeletionPublisherOptions
  ) {}

  async onModuleInit(): Promise<void> {
    this.connection = await this.options.connect();
    await this.ensureStream(await this.connection.jetstreamManager());
    this.js = this.connection.jetstream();
    // Unref'd, so the timer alone never keeps a process alive that is
    // otherwise finished.
    this.timer = setInterval(() => this.publishSoon(), this.options.intervalMs);
    this.timer.unref();
    // Whatever an earlier process committed and did not publish.
    this.publishSoon();
  }

  async onApplicationShutdown(): Promise<void> {
    this.closing = true;
    if (this.timer) {
      clearInterval(this.timer);
    }
    // Let a pass in flight finish its current publish, so the row it acked is
    // also deleted rather than published a second time by the next process.
    await this.pass?.catch(() => undefined);
    await this.connection?.drain();
  }

  /**
   * Start a pass and return at once (plan 0232, section 5). For the delete
   * paths, which must not wait on the broker after their transaction is
   * already committed: a failure is logged, and the row waits for the timer.
   */
  publishSoon(): void {
    this.publishPending().catch((err: unknown) =>
      this.logger.error(
        `Publishing account deletions failed; the timer retries: ${String(err)}`
      )
    );
  }

  /**
   * Publish every row the outbox holds, oldest first, and answer how many were
   * published. A pass already running is joined rather than doubled.
   */
  publishPending(): Promise<number> {
    if (this.pass) {
      this.again = true;
      return this.pass;
    }
    this.pass = this.drain().finally(() => {
      this.pass = undefined;
    });
    return this.pass;
  }

  private async drain(): Promise<number> {
    let published = 0;
    do {
      this.again = false;
      published += await this.publishAll();
    } while (this.again && !this.closing);
    return published;
  }

  private async publishAll(): Promise<number> {
    const js = await this.jetstream();
    if (!js) {
      // Not connected yet: the first pass after boot picks the rows up.
      return 0;
    }
    const outbox = this.dataSource.getRepository(AccountDeletion);
    let published = 0;
    for (;;) {
      const rows = await outbox.find({
        order: { deletedAt: 'ASC', userId: 'ASC' },
        take: BATCH,
      });
      for (const row of rows) {
        if (this.closing) {
          return published;
        }
        // A throw here ends the pass with this row and every later one still
        // in the outbox, in order, for the next pass.
        await js.publish(
          ACCOUNT_DELETION_STREAM.subject,
          this.codec.encode({ userId: row.userId }),
          {
            msgID: messageId(row.userId),
            expect: { streamName: ACCOUNT_DELETION_STREAM.name },
            headers: buildNatsHeaders(),
          }
        );
        await outbox.delete({ userId: row.userId });
        published += 1;
      }
      if (rows.length < BATCH) {
        return published;
      }
    }
  }

  /**
   * The client for this pass, or none before boot and during shutdown. A
   * connection the client closed for good (it gave up reconnecting, or the
   * server closed it) is replaced here, so a broker outage delays the outbox
   * and never strands it until auth restarts. The stream is ensured again on
   * the new connection, because a broker that lost its store lost it too.
   */
  private async jetstream(): Promise<JetStreamClient | undefined> {
    if (!this.connection || !this.js || this.closing) {
      return undefined;
    }
    if (this.connection.isClosed()) {
      this.logger.warn(
        'The NATS connection for account deletions was closed; reconnecting'
      );
      const connection = await this.options.connect();
      try {
        await this.ensureStream(await connection.jetstreamManager());
      } catch (err) {
        // Keep the closed one, so the next pass tries all of this again.
        await connection.close().catch(() => undefined);
        throw err;
      }
      this.connection = connection;
      this.js = connection.jetstream();
    }
    return this.js;
  }

  /** Create the stream, or bring an existing one to this configuration. */
  private async ensureStream(jsm: JetStreamManager): Promise<void> {
    const subjects = [ACCOUNT_DELETION_STREAM.subject];
    const maxAge = nanos(ACCOUNT_DELETION_STREAM.maxAgeDays * DAY_MS);
    try {
      await jsm.streams.info(ACCOUNT_DELETION_STREAM.name);
    } catch {
      await jsm.streams.add({
        name: ACCOUNT_DELETION_STREAM.name,
        subjects,
        storage: StorageType.File,
        retention: RetentionPolicy.Limits,
        max_age: maxAge,
      });
      return;
    }
    await jsm.streams.update(ACCOUNT_DELETION_STREAM.name, {
      subjects,
      max_age: maxAge,
    });
  }
}

/**
 * The stream's dedupe id for one deletion. The same for every publish of one
 * row, so a publish retried inside the stream's duplicate window is stored
 * once. A hash rather than the id itself, so the header the stream keeps
 * beside the body is not a second copy of the id under another name.
 */
export function messageId(userId: string): string {
  return `user.deleted:${createHash('sha256').update(userId).digest('hex')}`;
}
