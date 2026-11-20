import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { HarvestAlertStatus } from '@portfolio/luna-shopper/contracts';
import type { EntityManager, Repository } from 'typeorm';
import { HarvestAlert } from '../../entities';
import type { HarvestAlertDraft } from './harvest-alert.rules';

/** The row an insert answers, or null when the key already had one. */
export interface QueuedAlert {
  id: string;
  createdAt: Date;
}

/**
 * Insert one alert through the manager of the caller's transaction (plan
 * 0218, section 4.1).
 *
 * This is how an alert is written **in the transaction of its outcome**: the
 * run store, the schedule store and the postal code store each open one, write
 * their own row, and call this with the same manager. `ON CONFLICT DO NOTHING`
 * on the dedupe key makes a second decision of one outcome a no op.
 */
export async function insertAlert(
  manager: Pick<EntityManager, 'query'>,
  draft: HarvestAlertDraft
): Promise<QueuedAlert | null> {
  const rows: { id: string; createdAt: Date }[] = await manager.query(
    `INSERT INTO "harvest_alerts"
       ("kind", "dedupeKey", "supermarketId", "runId", "scheduleId", "payload")
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT ("dedupeKey") DO NOTHING
     RETURNING "id", "createdAt"`,
    [
      draft.kind,
      draft.dedupeKey,
      draft.supermarketId,
      draft.runId,
      draft.scheduleId,
      JSON.stringify(draft.payload),
    ]
  );
  const row = rows[0];
  return row ? { id: row.id, createdAt: new Date(row.createdAt) } : null;
}

/** The statuses a row never leaves, which the daily sweep may delete. */
export const FINAL_ALERT_STATUSES = [
  HarvestAlertStatus.SENT,
  HarvestAlertStatus.SUPPRESSED,
  HarvestAlertStatus.GAVE_UP,
] as const;

/**
 * Every read and write of a `harvest_alerts` row, in one place (plan 0218,
 * sections 4 and 5).
 *
 * The worker's writes are raw SQL so each is one statement, and the claim is
 * `FOR UPDATE SKIP LOCKED`, the shape `HarvestScheduleStore.claimDue` uses:
 * two harvester processes on one database claim disjoint rows, and neither
 * waits for the other.
 */
@Injectable()
export class HarvestAlertStore {
  constructor(
    @InjectRepository(HarvestAlert)
    private readonly alerts: Repository<HarvestAlert>
  ) {}

  /** Insert one alert in a transaction of its own, for an alert with no outcome row. */
  queue(draft: HarvestAlertDraft): Promise<QueuedAlert | null> {
    return insertAlert(this.alerts.manager, draft);
  }

  /**
   * Put back each row a worker took before `claimedBefore` and never marked.
   * A process that died while it sent leaves such a row, and delivery is at
   * least once: the other order would lose the alert.
   */
  async releaseStuck(claimedBefore: Date): Promise<number> {
    const [, count]: [unknown[], number] = await this.alerts.query(
      `UPDATE "harvest_alerts"
          SET "status" = 'PENDING',
              "claimedAt" = NULL,
              "updatedAt" = now()
        WHERE "status" = 'SENDING'
          AND "claimedAt" < $1`,
      [claimedBefore]
    );
    return count ?? 0;
  }

  /**
   * Take up to `limit` due rows, oldest first, and mark them `SENDING`.
   *
   * One statement: the inner select locks the rows it picks and skips rows
   * another process holds, and the update spends them before that lock is
   * released, so no second claim can see them as due.
   */
  async claim(now: Date, limit: number): Promise<HarvestAlert[]> {
    // An UPDATE answers `[rows, rowCount]` through TypeORM's postgres driver.
    const [rows]: [HarvestAlert[], number] = await this.alerts.query(
      `UPDATE "harvest_alerts" AS a
          SET "status" = 'SENDING',
              "claimedAt" = $1,
              "updatedAt" = now()
        WHERE a."id" IN (
          SELECT c."id"
            FROM "harvest_alerts" AS c
           WHERE c."status" = 'PENDING'
             AND c."nextAttemptAt" <= $1
           ORDER BY c."createdAt" ASC, c."id" ASC
           LIMIT $2
             FOR UPDATE SKIP LOCKED
        )
        RETURNING a.*`,
      [now, limit]
    );
    return [...rows].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
        a.id.localeCompare(b.id)
    );
  }

  async markSent(ids: readonly string[], at: Date): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.alerts.query(
      `UPDATE "harvest_alerts"
          SET "status" = 'SENT',
              "sentAt" = $2,
              "lastError" = NULL,
              "updatedAt" = now()
        WHERE "id" = ANY($1::uuid[])`,
      [ids, at]
    );
  }

  /** No recipient or no SMTP host: the rows end here, and nothing is sent later. */
  async markSuppressed(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.alerts.query(
      `UPDATE "harvest_alerts"
          SET "status" = 'SUPPRESSED',
              "updatedAt" = now()
        WHERE "id" = ANY($1::uuid[])`,
      [ids]
    );
  }

  /**
   * One failed send. `nextAttemptAt` null gives up: the row is `GAVE_UP`.
   * Otherwise it waits in `PENDING` until then.
   */
  async markFailed(
    id: string,
    attempts: number,
    error: string,
    nextAttemptAt: Date | null
  ): Promise<void> {
    await this.alerts.query(
      `UPDATE "harvest_alerts"
          SET "status" = $2,
              "attempts" = $3,
              "lastError" = $4,
              "nextAttemptAt" = COALESCE($5, "nextAttemptAt"),
              "claimedAt" = NULL,
              "updatedAt" = now()
        WHERE "id" = $1`,
      [
        id,
        nextAttemptAt ? HarvestAlertStatus.PENDING : HarvestAlertStatus.GAVE_UP,
        attempts,
        error,
        nextAttemptAt,
      ]
    );
  }

  /** Delete the rows in a final state created before `cutoff`. */
  async deleteFinishedBefore(cutoff: Date): Promise<number> {
    const [, count]: [unknown[], number] = await this.alerts.query(
      `DELETE FROM "harvest_alerts"
        WHERE "status" = ANY($1::"harvest_alert_status"[])
          AND "createdAt" < $2`,
      [[...FINAL_ALERT_STATUSES], cutoff]
    );
    return count ?? 0;
  }

  repository(): Repository<HarvestAlert> {
    return this.alerts;
  }
}
