import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  HarvestRunStatus,
  type HarvestRunMode,
  type HarvestRunTrigger,
} from '@portfolio/luna-shopper/contracts';
import { NotFoundException } from '@portfolio/luna-shopper/platform';
import { LessThan, QueryFailedError, Repository } from 'typeorm';
import { HarvestRun } from '../entities';

const PG_UNIQUE_VIOLATION = '23505';

/** Raised when the active-run index refuses a second run (plan 0038, 4.2). */
export class ActiveRunExistsError extends Error {
  constructor(readonly activeRunId: string | null) {
    super('A run is already in progress');
    this.name = 'ActiveRunExistsError';
  }
}

export interface RunCounters {
  processed?: number;
  created?: number;
  updated?: number;
  unchanged?: number;
  notFound?: number;
  failed?: number;
}

/** The only column names `addCounters` will ever write. */
const COUNTER_COLUMNS = [
  'processed',
  'created',
  'updated',
  'unchanged',
  'notFound',
  'failed',
] as const satisfies ReadonlyArray<keyof RunCounters>;

/**
 * Every read and write of a `harvest_runs` row, in one place.
 *
 * It exists as its own class so the surface (`HarvestRunService`), the executor
 * and the three runners can all touch a run without depending on each other,
 * which is what keeps the module free of a cycle.
 *
 * **Progress is written every batch and at least every 10 seconds** (plan 0038,
 * section 6.6). That is what survives a page reload, and it rides along with a
 * write that is already happening rather than costing one of its own.
 */
@Injectable()
export class HarvestRunStore {
  private readonly logger = new Logger(HarvestRunStore.name);

  constructor(
    @InjectRepository(HarvestRun)
    private readonly runs: Repository<HarvestRun>
  ) {}

  /**
   * Insert a PENDING run, letting the **database** decide whether one is already
   * active. Checking first and inserting second loses that race by construction,
   * which is why the guard is a partial unique index rather than a query.
   */
  async create(input: {
    mode: HarvestRunMode;
    trigger: HarvestRunTrigger;
    supermarketId: string | null;
    sourceId: string | null;
    priceScopeId: string | null;
    requestedByUserId: string | null;
    correlationId: string | null;
    payload: Record<string, unknown>;
  }): Promise<HarvestRun> {
    try {
      return await this.runs.save(
        this.runs.create({
          mode: input.mode,
          trigger: input.trigger,
          supermarketId: input.supermarketId,
          sourceId: input.sourceId,
          priceScopeId: input.priceScopeId,
          requestedByUserId: input.requestedByUserId,
          correlationId: input.correlationId,
          input: input.payload,
          status: HarvestRunStatus.PENDING,
          requestedAt: new Date(),
        })
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        const active = await this.findActive(input.mode, input.supermarketId);
        throw new ActiveRunExistsError(active?.id ?? null);
      }
      throw error;
    }
  }

  async findActive(
    mode: HarvestRunMode,
    supermarketId: string | null
  ): Promise<HarvestRun | null> {
    const qb = this.runs
      .createQueryBuilder('r')
      .where('r.status IN (:...states)', {
        states: [HarvestRunStatus.PENDING, HarvestRunStatus.RUNNING],
      });
    if (supermarketId) {
      qb.andWhere('r."supermarketId" = :sid', { sid: supermarketId });
    } else {
      qb.andWhere('r.mode = :mode', { mode });
      qb.andWhere('r."supermarketId" IS NULL');
    }
    return qb.getOne();
  }

  async load(runId: string): Promise<HarvestRun> {
    const row = await this.runs.findOne({ where: { id: runId } });
    if (!row) {
      throw new NotFoundException('Harvest run not found');
    }
    return row;
  }

  async markRunning(runId: string, stage: string, label: string): Promise<void> {
    await this.runs.update(
      { id: runId },
      {
        status: HarvestRunStatus.RUNNING,
        startedAt: new Date(),
        heartbeatAt: new Date(),
        stage,
        stageLabel: label,
      }
    );
  }

  async setStage(runId: string, stage: string, label: string): Promise<void> {
    await this.runs.update(
      { id: runId },
      { stage, stageLabel: label, heartbeatAt: new Date() }
    );
  }

  async setTotalPlanned(runId: string, total: number): Promise<void> {
    await this.runs.update(
      { id: runId },
      { totalPlanned: total, heartbeatAt: new Date() }
    );
  }

  /**
   * Add to the counters and touch the heartbeat in **one** statement.
   *
   * `col = col + $n` rather than read-modify-write, so two workers reporting in
   * the same moment cannot lose one another's count. The column names come from
   * the fixed key list below and never from the caller, so the interpolation is
   * not a place user input can reach.
   */
  async addCounters(runId: string, counters: RunCounters): Promise<void> {
    const sets: string[] = [];
    const values: number[] = [];
    for (const key of COUNTER_COLUMNS) {
      const value = counters[key];
      if (value) {
        values.push(value);
        sets.push(`"${key}" = "${key}" + $${values.length + 1}`);
      }
    }
    if (sets.length === 0) {
      await this.touchHeartbeat(runId);
      return;
    }
    await this.runs.query(
      `UPDATE "harvest_runs"
         SET ${sets.join(', ')}, "heartbeatAt" = now(), "updatedAt" = now()
       WHERE id = $1`,
      [runId, ...values]
    );
  }

  async touchHeartbeat(runId: string): Promise<void> {
    await this.runs.update({ id: runId }, { heartbeatAt: new Date() });
  }

  async requestAbort(runId: string): Promise<HarvestRun> {
    const row = await this.load(runId);
    if (
      row.status !== HarvestRunStatus.PENDING &&
      row.status !== HarvestRunStatus.RUNNING
    ) {
      return row;
    }
    row.abortRequestedAt = new Date();
    return this.runs.save(row);
  }

  async isAbortRequested(runId: string): Promise<boolean> {
    const row = await this.runs.findOne({
      where: { id: runId },
      select: { id: true, abortRequestedAt: true },
    });
    return Boolean(row?.abortRequestedAt);
  }

  async finish(
    runId: string,
    status: HarvestRunStatus,
    error?: string
  ): Promise<void> {
    await this.runs.update(
      { id: runId },
      {
        status,
        finishedAt: new Date(),
        heartbeatAt: new Date(),
        error: error ?? null,
      }
    );
  }

  /**
   * The stale reaper (plan 0038, section 6.6): a RUNNING run whose heartbeat
   * stopped is marked STALE, logged, and its lock released.
   *
   * **This is the only recovery path for a force killed harvester and none other
   * is designed.** A lost run costs one refresh cycle, and building resumption
   * machinery for that is how a twenty minute job grows a checkpoint log.
   */
  async reapStale(olderThanSeconds: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanSeconds * 1000);
    const stale = await this.runs.find({
      where: [
        { status: HarvestRunStatus.RUNNING, heartbeatAt: LessThan(cutoff) },
        { status: HarvestRunStatus.PENDING, heartbeatAt: LessThan(cutoff) },
      ],
    });
    for (const run of stale) {
      this.logger.warn(
        `Reaping harvest run ${run.id} (${run.mode}): no heartbeat since ${
          run.heartbeatAt?.toISOString() ?? 'never'
        }`
      );
      await this.finish(
        run.id,
        HarvestRunStatus.STALE,
        'No heartbeat; the run was reaped so the lock could be released.'
      );
    }
    return stale.length;
  }

  /**
   * A PENDING run with no heartbeat at all is one whose process died between the
   * insert and the first tick. The reaper needs a timestamp to compare, so a run
   * is given one the moment it is created rather than when it starts working.
   */
  async seedHeartbeat(runId: string): Promise<void> {
    await this.runs.update({ id: runId }, { heartbeatAt: new Date() });
  }

  repository(): Repository<HarvestRun> {
    return this.runs;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error as { driverError?: { code?: string } }).driverError?.code ===
      PG_UNIQUE_VIOLATION
  );
}
