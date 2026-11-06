import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  HarvestRunTrigger,
  SourceProbeStatus,
  type SourceProbeStepView,
} from '@portfolio/luna-shopper/contracts';
import { NotFoundException } from '@portfolio/luna-shopper/platform';
import { Repository, type EntityManager } from 'typeorm';
import { SourceProbe, type SupermarketSource } from '../../entities';
import type { HarvestAlertDraft } from '../alerts/harvest-alert.rules';
import { insertAlert } from '../alerts/harvest-alert.store';
import type { GateProbe } from '../schedule-probe-gate';
import { probeDueAttempt, type NewestProbe } from './source-probe.due';

/** A probe the worker claimed, and the source row it was claimed for. */
export interface ClaimedProbe {
  probe: SourceProbe;
  source: SupermarketSource;
}

/** What a finished probe writes on its row. */
export interface SourceProbeFinish {
  status: SourceProbeStatus;
  previousStatus: SourceProbeStatus | null;
  changed: boolean;
  finishedAt: Date;
  requests: number;
  steps: SourceProbeStepView[];
  error: string | null;
}

/** The newest probe of a source, for its source view. */
export interface LatestProbe {
  id: string;
  sourceId: string;
  status: SourceProbeStatus;
  startedAt: Date;
  finishedAt: Date | null;
  changed: boolean;
}

/** The name of the partial unique index on a running probe per source. */
export const RUNNING_PROBE_INDEX = 'uq_source_probe_running';

/**
 * Every read and write of `source_probes`, in one place (plan 0219, section 4).
 *
 * **This is the only table a probe writes**, besides the alert row its
 * verdict may add to the outbox in the same transaction (plan 0247, section
 * 4.1). Nothing here touches `supermarket_sources`, `harvest_runs` or
 * `harvest_schedules`: the claim locks a source row and reads two others, and
 * writes a probe.
 */
@Injectable()
export class SourceProbeStore {
  constructor(
    @InjectRepository(SourceProbe)
    private readonly probes: Repository<SourceProbe>
  ) {}

  async load(id: string): Promise<SourceProbe> {
    const row = await this.probes.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Source probe not found');
    }
    return row;
  }

  async findRunning(sourceId: string): Promise<SourceProbe | null> {
    return this.probes.findOne({
      where: { sourceId, status: SourceProbeStatus.RUNNING },
    });
  }

  /**
   * Insert a `RUNNING` probe, or answer null when the source already has one.
   * The partial unique index decides, so two starts that race each other
   * cannot both pass.
   */
  async insertRunning(input: {
    source: Pick<SupermarketSource, 'id' | 'supermarketId' | 'adapterKey'>;
    trigger: HarvestRunTrigger;
    startedAt: Date;
    requestedByUserId: string | null;
    /**
     * The attempt of the series, 1 when absent. A manual probe passes none.
     * The probe a schedule slot runs passes the attempt of its series (plan
     * 0247, section 2).
     */
    attempt?: number;
    /**
     * The schedule whose slot runs this probe as its gate (plan 0247, the
     * owner on 2026-11-06). Null or absent for a manual probe.
     */
    scheduleId?: string | null;
  }): Promise<SourceProbe | null> {
    try {
      return await this.probes.save(
        this.probes.create({
          sourceId: input.source.id,
          supermarketId: input.source.supermarketId,
          adapterKey: input.source.adapterKey,
          trigger: input.trigger,
          status: SourceProbeStatus.RUNNING,
          previousStatus: null,
          changed: false,
          // A manual probe always starts a series (2026-11-06).
          attempt: input.attempt ?? 1,
          startedAt: input.startedAt,
          finishedAt: null,
          requests: 0,
          steps: [],
          error: null,
          requestedByUserId: input.requestedByUserId,
          scheduleId: input.scheduleId ?? null,
        })
      );
    } catch (error) {
      if (isRunningProbeConflict(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Claim the due source whose newest probe is oldest, and insert its
   * `SCHEDULED` probe with the attempt the due rule gives it, in one
   * transaction (section 7). Null when nothing is due.
   *
   * A source can be due when its row is on (option (a) of O1), its adapter
   * has a probe, no run of its chain is `PENDING` or `RUNNING`, and no probe of
   * it is `RUNNING`. Whether it is due then is {@link probeDueAttempt}: its
   * own interval from `config`, and the retry of an `UNREACHABLE` probe (the
   * owner's decision of 2026-11-06).
   *
   * **The lock is on the source rows**, with `FOR UPDATE SKIP LOCKED`, so a
   * second harvester skips every row the first is still claiming. The lock
   * alone does not prevent a double claim. Under READ COMMITTED a second
   * process can lock the row just after the first committed, take its first
   * snapshot before the new `RUNNING` row was visible, leave `RUNNING` rows
   * out of the newest probes, and decide the source is due. The insert is
   * thus `ON CONFLICT DO NOTHING` on `uq_source_probe_running`: that process
   * inserts nothing, the claim answers null, and its tick starts nothing.
   */
  async claimDue(
    now: Date,
    adapterKeys: readonly string[]
  ): Promise<ClaimedProbe | null> {
    return this.probes.manager.transaction(async (manager) => {
      const candidates: SupermarketSource[] = await manager.query(
        `SELECT s.*
           FROM "supermarket_sources" AS s
          WHERE ${CAN_BE_DUE}
          ORDER BY s."id" ASC
            FOR UPDATE OF s SKIP LOCKED`,
        [[...adapterKeys]]
      );
      if (candidates.length === 0) {
        return null;
      }
      const newest: Array<NewestProbe & { sourceId: string }> =
        await manager.query(
          `SELECT DISTINCT ON ("sourceId")
                  "sourceId", "status", "attempt", "startedAt"
             FROM "source_probes"
            WHERE "sourceId" = ANY($1)
              AND "status" <> 'RUNNING'
            ORDER BY "sourceId", "startedAt" DESC, "id" DESC`,
          [candidates.map((source) => source.id)]
        );
      const newestOf = new Map(newest.map((row) => [row.sourceId, row]));
      const due = candidates
        .map((source) => {
          const last = newestOf.get(source.id) ?? null;
          return {
            source,
            last,
            attempt: probeDueAttempt(source.config, last, now),
          };
        })
        .filter((each) => each.attempt !== null)
        .sort(
          (a, b) =>
            startedOf(a.last) - startedOf(b.last) ||
            a.source.id.localeCompare(b.source.id)
        );
      const chosen = due[0];
      if (!chosen) {
        return null;
      }
      const { source } = chosen;
      const inserted: SourceProbe[] = await manager.query(
        `INSERT INTO "source_probes"
           ("sourceId", "supermarketId", "adapterKey", "trigger", "status",
            "attempt", "startedAt")
         VALUES ($1, $2, $3, $4, 'RUNNING', $5, $6)
         ON CONFLICT ("sourceId") WHERE "status" = 'RUNNING' DO NOTHING
         RETURNING *`,
        [
          source.id,
          source.supermarketId,
          source.adapterKey,
          HarvestRunTrigger.SCHEDULED,
          chosen.attempt,
          now,
        ]
      );
      // A probe of the source that another process committed meanwhile.
      if (inserted.length === 0) {
        return null;
      }
      return { probe: inserted[0], source };
    });
  }

  /**
   * Write what a probe found. Only a row still `RUNNING` is written, so a
   * probe the reaper already marked `ABORTED` stays aborted.
   *
   * `alert` is the probe's alert to the owner (plan 0247, section 4.1). With
   * one, the verdict and the alert row are written in one transaction, so no
   * alert exists for a verdict that did not commit, and an alert for a row
   * the reaper already ended is not written.
   */
  async finish(
    id: string,
    write: SourceProbeFinish,
    alert?: HarvestAlertDraft
  ): Promise<boolean> {
    if (!alert) {
      return this.writeFinish(this.probes.manager, id, write);
    }
    return this.probes.manager.transaction(async (manager) => {
      const written = await this.writeFinish(manager, id, write);
      if (written) {
        await insertAlert(manager, alert);
      }
      return written;
    });
  }

  private async writeFinish(
    manager: Pick<EntityManager, 'query'>,
    id: string,
    write: SourceProbeFinish
  ): Promise<boolean> {
    const [rows]: [{ id: string }[], number] = await manager.query(
      `UPDATE "source_probes"
          SET "status" = $2,
              "previousStatus" = $3,
              "changed" = $4,
              "finishedAt" = $5,
              "requests" = $6,
              "steps" = $7::jsonb,
              "error" = $8,
              "updatedAt" = now()
        WHERE "id" = $1
          AND "status" = 'RUNNING'
       RETURNING "id"`,
      [
        id,
        write.status,
        write.previousStatus,
        write.changed,
        write.finishedAt,
        write.requests,
        JSON.stringify(write.steps),
        write.error,
      ]
    );
    return rows.length > 0;
  }

  /**
   * The status of the newest finished probe of the source before `excludeId`
   * that is not `ABORTED`, or null when there is none (section 4).
   */
  async previousStatus(
    sourceId: string,
    excludeId: string
  ): Promise<SourceProbeStatus | null> {
    const rows: { status: SourceProbeStatus }[] = await this.probes.query(
      `SELECT "status"
         FROM "source_probes"
        WHERE "sourceId" = $1
          AND "id" <> $2
          AND "status" NOT IN ('RUNNING', 'ABORTED')
        ORDER BY "startedAt" DESC, "id" DESC
        LIMIT 1`,
      [sourceId, excludeId]
    );
    return rows[0]?.status ?? null;
  }

  /**
   * The probes of a source the schedule gate reads (plan 0247, section 2):
   * every one that is `RUNNING`, and every one that started at or after
   * `since`, newest first. A probe that started before the window cannot let
   * a slot start, so the read never grows with the history.
   */
  async gateProbes(sourceId: string, since: Date): Promise<GateProbe[]> {
    const rows: GateProbe[] = await this.probes.query(
      `SELECT "id", "status", "startedAt", "error"
         FROM "source_probes"
        WHERE "sourceId" = $1
          AND ("status" = 'RUNNING' OR "startedAt" >= $2)
        ORDER BY "startedAt" DESC, "id" DESC`,
      [sourceId, since]
    );
    return rows.map((row) => ({ ...row, startedAt: new Date(row.startedAt) }));
  }

  /**
   * The newest probe of a source that is not `RUNNING`, as the due rule of
   * the claim reads it, for the attempt of a probe a slot runs (plan 0247,
   * section 2). Null when the source has none.
   */
  async newestForSeries(sourceId: string): Promise<NewestProbe | null> {
    const rows: NewestProbe[] = await this.probes.query(
      `SELECT "status", "attempt", "startedAt"
         FROM "source_probes"
        WHERE "sourceId" = $1
          AND "status" <> 'RUNNING'
        ORDER BY "startedAt" DESC, "id" DESC
        LIMIT 1`,
      [sourceId]
    );
    const row = rows[0];
    return row ? { ...row, startedAt: new Date(row.startedAt) } : null;
  }

  /** The probes of one source, newest first, keyset paged. */
  async list(
    sourceId: string,
    limit: number,
    after?: { startedAt: string; id: string }
  ): Promise<SourceProbe[]> {
    const qb = this.probes
      .createQueryBuilder('p')
      .where('p."sourceId" = :sourceId', { sourceId })
      .orderBy('p.startedAt', 'DESC')
      .addOrderBy('p.id', 'DESC')
      .take(limit);
    if (after) {
      qb.andWhere('(p."startedAt", p.id) < (:startedAt, :id)', after);
    }
    return qb.getMany();
  }

  /**
   * The newest probe that is not `ABORTED` of each source, in one query over
   * the index of section 4, not one query per row (section 8).
   *
   * The source list shows a `RUNNING` probe as the newest. `finishedOnly`
   * reads past it too, for the forecast of the schedule view (plan 0247,
   * section 3): a red chain keeps its block while a probe of it runs.
   */
  async latestBySources(
    sourceIds: string[],
    options: { finishedOnly?: boolean } = {}
  ): Promise<Map<string, LatestProbe>> {
    if (sourceIds.length === 0) {
      return new Map();
    }
    const rows: LatestProbe[] = await this.probes.query(
      `SELECT DISTINCT ON ("sourceId")
              "id", "sourceId", "status", "startedAt", "finishedAt", "changed"
         FROM "source_probes"
        WHERE "sourceId" = ANY($1)
          AND "status" <> 'ABORTED'${
            options.finishedOnly ? `\n          AND "status" <> 'RUNNING'` : ''
          }
        ORDER BY "sourceId", "startedAt" DESC, "id" DESC`,
      [sourceIds]
    );
    return new Map(rows.map((row) => [row.sourceId, row]));
  }

  /**
   * Mark `ABORTED` every `RUNNING` probe that started before `startedBefore`
   * (section 7). A probe lives in the memory of the process that started it,
   * and a pod killed during one leaves its row `RUNNING`.
   */
  async reap(startedBefore: Date, now: Date): Promise<number> {
    const [rows]: [{ id: string }[], number] = await this.probes.query(
      `UPDATE "source_probes"
          SET "status" = 'ABORTED',
              "finishedAt" = $2,
              "error" = 'The probe was still running after ten minutes, so ' ||
                        'the process that ran it is gone.',
              "updatedAt" = now()
        WHERE "status" = 'RUNNING'
          AND "startedAt" < $1
       RETURNING "id"`,
      [startedBefore, now]
    );
    return rows.length;
  }

  /**
   * Delete the probes that started before `startedBefore` (section 4.2),
   * always keeping the newest probe of each source and the newest one that is
   * not `ABORTED`, which the source view shows.
   */
  async prune(startedBefore: Date): Promise<number> {
    const [rows]: [{ id: string }[], number] = await this.probes.query(
      `DELETE FROM "source_probes" AS p
        WHERE p."startedAt" < $1
          AND p."status" <> 'RUNNING'
          AND p."id" <> (
                SELECT q."id" FROM "source_probes" AS q
                 WHERE q."sourceId" = p."sourceId"
                 ORDER BY q."startedAt" DESC, q."id" DESC
                 LIMIT 1
              )
          AND p."id" IS DISTINCT FROM (
                SELECT q."id" FROM "source_probes" AS q
                 WHERE q."sourceId" = p."sourceId"
                   AND q."status" <> 'ABORTED'
                 ORDER BY q."startedAt" DESC, q."id" DESC
                 LIMIT 1
              )
       RETURNING p."id"`,
      [startedBefore]
    );
    return rows.length;
  }

  repository(): Repository<SourceProbe> {
    return this.probes;
  }
}

/**
 * What a source needs before the due rule is asked, over `s`, with `$1` the
 * adapters: its row is on, its adapter has a probe, and nothing of it is in
 * flight.
 */
const CAN_BE_DUE = `s."enabled"
            AND s."adapterKey" = ANY($1)
            AND NOT EXISTS (
                  SELECT 1 FROM "source_probes" AS p
                   WHERE p."sourceId" = s."id" AND p."status" = 'RUNNING'
                )
            AND NOT EXISTS (
                  SELECT 1 FROM "harvest_runs" AS r
                   WHERE r."supermarketId" = s."supermarketId"
                     AND r."status" IN ('PENDING', 'RUNNING')
                )`;

/** When a probe started, for the order of the claim. None sorts first. */
function startedOf(probe: NewestProbe | null): number {
  return probe ? new Date(probe.startedAt).getTime() : -Infinity;
}

function isRunningProbeConflict(error: unknown): boolean {
  const record = error as {
    code?: unknown;
    constraint?: unknown;
    driverError?: { code?: unknown; constraint?: unknown };
  };
  const code = record?.code ?? record?.driverError?.code;
  const constraint = record?.constraint ?? record?.driverError?.constraint;
  return code === '23505' && constraint === RUNNING_PROBE_INDEX;
}
