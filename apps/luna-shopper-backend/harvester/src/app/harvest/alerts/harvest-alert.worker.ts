import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describeError } from '@portfolio/luna-shopper/platform';
import type {
  HarvestAlertConfig,
  HarvesterConfig,
} from '../../config/app-config';
import type { HarvestAlert } from '../../entities';
import { CatalogClient } from '../catalog-client.service';
import { HARVEST_CLOCK, type HarvestClock } from '../schedule-slot';
import {
  ALERT_CHANNEL,
  smtpConfigured,
  type AlertChannel,
} from './alert-mailer';
import {
  alertMail,
  digestMail,
  type AlertForMessage,
  type MessageContext,
} from './harvest-alert.message';
import { HarvestAlertStore } from './harvest-alert.store';

/** How often the worker looks for a due alert. A constant, not a setting. */
export const ALERT_TICK_MS = 30_000;
/** The most rows one tick claims. */
export const ALERT_CLAIM_LIMIT = 50;
/** More due rows than this in one tick are one digest mail. */
export const ALERT_DIGEST_OVER = 3;
/** A `SENDING` row older than this was left by a process that died. */
export const ALERT_STUCK_AFTER_MS = 10 * 60_000;
/** The wait after each failed attempt, in minutes. The sixth failure gives up. */
export const ALERT_RETRY_MINUTES = [1, 5, 15, 60, 240] as const;
export const ALERT_MAX_ATTEMPTS = ALERT_RETRY_MINUTES.length + 1;
/** How long a row in a final state is kept. */
export const ALERT_KEEP_DAYS = 90;
const DAY_MS = 24 * 60 * 60_000;

/**
 * Sends the alerts the outcomes wrote (plan 0218, section 5).
 *
 * The lifecycle is the schedule worker's: a plain timer with `unref`, cleared
 * on destroy, a flag that stops the loop on the way out, one tick at a time.
 * It runs whatever `HARVEST_ENABLED` says: without runs there are no rows.
 *
 * **Delivery is at least once.** A process that dies after the relay accepted
 * a mail and before `SENT` is written sends it again 10 minutes later. That
 * costs one duplicate in a rare case, and the other order costs a lost alert.
 */
@Injectable()
export class HarvestAlertWorker
  implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown
{
  private readonly logger = new Logger(HarvestAlertWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private stopping = false;
  /** When the last daily sweep ran, in this process. */
  private sweptAt: number | null = null;

  constructor(
    private readonly store: HarvestAlertStore,
    @Inject(ALERT_CHANNEL) private readonly channel: AlertChannel,
    private readonly catalog: CatalogClient,
    private readonly config: ConfigService,
    @Inject(HARVEST_CLOCK) private readonly clock: HarvestClock
  ) {}

  private settings(): HarvestAlertConfig {
    return this.config.getOrThrow<HarvesterConfig>('harvester').alerts;
  }

  onModuleInit(): void {
    const settings = this.settings();
    if (settings.recipients.length === 0 || !smtpConfigured(settings)) {
      this.logger.log(
        'HARVEST_ALERT_EMAIL or the SMTP host is empty: alerts are recorded ' +
          'and marked SUPPRESSED, and no mail is sent.'
      );
    }
    this.timer = setInterval(() => void this.tick(), ALERT_TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  onApplicationShutdown(): void {
    this.stopping = true;
  }

  /** One pass over the outbox. Public for the specs. */
  async tick(): Promise<void> {
    if (this.ticking || this.stopping) {
      return;
    }
    this.ticking = true;
    try {
      const now = this.clock();
      await this.store.releaseStuck(
        new Date(now.getTime() - ALERT_STUCK_AFTER_MS)
      );
      await this.sweepIfDue(now);
      const rows = await this.store.claim(now, ALERT_CLAIM_LIMIT);
      if (rows.length > 0) {
        await this.deliver(rows, now);
      }
    } catch (error) {
      // A timer has no caller to return an error to, so it must never take
      // the process down. The next tick starts again from the table.
      this.logger.error(`Alert tick failed: ${describeError(error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async deliver(rows: HarvestAlert[], now: Date): Promise<void> {
    const settings = this.settings();
    if (settings.recipients.length === 0 || !smtpConfigured(settings)) {
      // An address set later does not send these: they were due while there
      // was nobody to tell.
      await this.store.markSuppressed(rows.map((row) => row.id));
      return;
    }
    const context = await this.context(rows, settings);
    if (rows.length <= ALERT_DIGEST_OVER) {
      for (const row of rows) {
        const mail = alertMail(forMessage(row), context);
        await this.attempt([row], mail.subject, mail.body, now);
      }
      return;
    }
    const mail = digestMail(rows.map(forMessage), context);
    await this.attempt(rows, mail.subject, mail.body, now);
  }

  /** One send of one mail, and what it does to the rows it carries. */
  private async attempt(
    rows: HarvestAlert[],
    subject: string,
    body: string,
    now: Date
  ): Promise<void> {
    try {
      await this.channel.send(subject, body);
    } catch (error) {
      const message = describeError(error).message;
      for (const row of rows) {
        const attempts = Number(row.attempts ?? 0) + 1;
        const wait = ALERT_RETRY_MINUTES[attempts - 1];
        const next =
          attempts >= ALERT_MAX_ATTEMPTS || wait === undefined
            ? null
            : new Date(now.getTime() + wait * 60_000);
        await this.store.markFailed(row.id, attempts, message, next);
        if (!next) {
          this.logger.error(
            `Alert ${row.id} (${row.kind}) gave up after ${attempts} ` +
              `failed sends: ${message}`
          );
        }
      }
      this.logger.warn(`An alert mail was not sent: ${message}`);
      return;
    }
    await this.store.markSent(
      rows.map((row) => row.id),
      now
    );
  }

  /** Once a day, the rows in a final state older than 90 days go. */
  private async sweepIfDue(now: Date): Promise<void> {
    if (this.sweptAt !== null && now.getTime() - this.sweptAt < DAY_MS) {
      return;
    }
    this.sweptAt = now.getTime();
    const deleted = await this.store.deleteFinishedBefore(
      new Date(now.getTime() - ALERT_KEEP_DAYS * DAY_MS)
    );
    if (deleted > 0) {
      this.logger.log(`Deleted ${deleted} alert row(s) older than 90 days`);
    }
  }

  /**
   * The names of the chains these rows name, read at send time. A failure is
   * not fatal: the message falls back to the adapter key.
   */
  private async context(
    rows: HarvestAlert[],
    settings: HarvestAlertConfig
  ): Promise<MessageContext> {
    const names = new Map<string, string | null>();
    for (const id of new Set(
      rows.map((row) => row.supermarketId).filter((id): id is string => !!id)
    )) {
      try {
        const chain = await this.catalog.getSupermarket(id);
        names.set(id, chain.name?.es ?? chain.name?.en ?? null);
      } catch (error) {
        this.logger.warn(
          `Could not read the chain ${id} for an alert: ${describeError(error).message}`
        );
        names.set(id, null);
      }
    }
    return {
      environmentName: settings.environmentName,
      adminAppBaseUrl: settings.adminAppBaseUrl,
      chainName: (id) => names.get(id) ?? null,
    };
  }
}

function forMessage(row: HarvestAlert): AlertForMessage {
  return {
    kind: row.kind,
    supermarketId: row.supermarketId ?? null,
    runId: row.runId ?? null,
    scheduleId: row.scheduleId ?? null,
    payload: row.payload ?? {},
    createdAt: new Date(row.createdAt),
  };
}
