import {
  HarvestRunTrigger,
  SourceProbeStatus,
} from '@portfolio/luna-shopper/contracts';
import { NotFoundException } from '@portfolio/luna-shopper/platform';
import type { SourceProbe, SupermarketSource } from '../../entities';
import { probeDueAttempt, type NewestProbe } from './source-probe.due';
import type {
  ClaimedProbe,
  LatestProbe,
  SourceProbeFinish,
  SourceProbeStore,
} from './source-probe.store';

/**
 * An in memory `source_probes` that answers as the real store does, for the
 * service and worker specs (plan 0219). The real claim between two processes
 * is the integration spec's.
 *
 * Every read answers a copy, so a spec that changes what it read changes
 * nothing here, as with a database.
 */
export class FakeSourceProbeStore {
  readonly rows: SourceProbe[] = [];
  /** The source rows the claim reads. */
  sources: SupermarketSource[] = [];
  /** The chains with a run `PENDING` or `RUNNING`. */
  readonly busyChains = new Set<string>();
  private next = 0;

  asStore(): SourceProbeStore {
    return this as unknown as SourceProbeStore;
  }

  seed(
    row: Partial<SourceProbe> & { sourceId: string; startedAt: Date }
  ): SourceProbe {
    this.next += 1;
    const full = {
      id: `probe-${this.next}`,
      supermarketId: 'chain-1',
      adapterKey: 'mercadona-api',
      trigger: HarvestRunTrigger.SCHEDULED,
      status: SourceProbeStatus.PASSED,
      previousStatus: null,
      changed: false,
      attempt: 1,
      finishedAt: row.startedAt,
      requests: 5,
      steps: [],
      error: null,
      requestedByUserId: null,
      createdAt: row.startedAt,
      updatedAt: row.startedAt,
      ...row,
    } as SourceProbe;
    this.rows.push(full);
    return { ...full };
  }

  async load(id: string): Promise<SourceProbe> {
    const row = this.rows.find((each) => each.id === id);
    if (!row) {
      throw new NotFoundException('Source probe not found');
    }
    return { ...row };
  }

  async findRunning(sourceId: string): Promise<SourceProbe | null> {
    const row = this.rows.find(
      (each) =>
        each.sourceId === sourceId && each.status === SourceProbeStatus.RUNNING
    );
    return row ? { ...row } : null;
  }

  async insertRunning(input: {
    source: Pick<SupermarketSource, 'id' | 'supermarketId' | 'adapterKey'>;
    trigger: HarvestRunTrigger;
    startedAt: Date;
    requestedByUserId: string | null;
  }): Promise<SourceProbe | null> {
    if (await this.findRunning(input.source.id)) {
      return null;
    }
    return this.seed({
      sourceId: input.source.id,
      supermarketId: input.source.supermarketId,
      adapterKey: input.source.adapterKey,
      trigger: input.trigger,
      status: SourceProbeStatus.RUNNING,
      startedAt: input.startedAt,
      finishedAt: null,
      requests: 0,
      requestedByUserId: input.requestedByUserId,
    });
  }

  async claimDue(
    now: Date,
    adapterKeys: readonly string[]
  ): Promise<ClaimedProbe | null> {
    const newest = (sourceId: string): NewestProbe | null =>
      this.rows
        .filter(
          (row) =>
            row.sourceId === sourceId &&
            row.status !== SourceProbeStatus.RUNNING
        )
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0] ??
      null;
    const startedOf = (probe: NewestProbe | null) =>
      probe ? probe.startedAt.getTime() : -Infinity;
    const due = this.sources
      .filter(
        (source) =>
          source.enabled &&
          adapterKeys.includes(source.adapterKey) &&
          !this.busyChains.has(source.supermarketId) &&
          !this.rows.some(
            (row) =>
              row.sourceId === source.id &&
              row.status === SourceProbeStatus.RUNNING
          )
      )
      .map((source) => ({
        source,
        last: newest(source.id),
        attempt: probeDueAttempt(source.config, newest(source.id), now),
      }))
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
    const probe = this.seed({
      sourceId: chosen.source.id,
      supermarketId: chosen.source.supermarketId,
      adapterKey: chosen.source.adapterKey,
      trigger: HarvestRunTrigger.SCHEDULED,
      status: SourceProbeStatus.RUNNING,
      attempt: chosen.attempt as number,
      startedAt: now,
      finishedAt: null,
      requests: 0,
    });
    return { probe, source: { ...chosen.source } };
  }

  async finish(id: string, write: SourceProbeFinish): Promise<boolean> {
    const row = this.rows.find((each) => each.id === id);
    if (!row || row.status !== SourceProbeStatus.RUNNING) {
      return false;
    }
    Object.assign(row, write);
    return true;
  }

  async previousStatus(
    sourceId: string,
    excludeId: string
  ): Promise<SourceProbeStatus | null> {
    const finished = this.rows
      .filter(
        (row) =>
          row.sourceId === sourceId &&
          row.id !== excludeId &&
          row.status !== SourceProbeStatus.RUNNING &&
          row.status !== SourceProbeStatus.ABORTED
      )
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    return finished[0]?.status ?? null;
  }

  async list(sourceId: string, limit: number): Promise<SourceProbe[]> {
    return this.rows
      .filter((row) => row.sourceId === sourceId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }

  async latestBySources(ids: string[]): Promise<Map<string, LatestProbe>> {
    const latest = new Map<string, LatestProbe>();
    for (const row of [...this.rows].sort(
      (a, b) => b.startedAt.getTime() - a.startedAt.getTime()
    )) {
      if (
        ids.includes(row.sourceId) &&
        row.status !== SourceProbeStatus.ABORTED &&
        !latest.has(row.sourceId)
      ) {
        latest.set(row.sourceId, {
          id: row.id,
          sourceId: row.sourceId,
          status: row.status,
          startedAt: row.startedAt,
          finishedAt: row.finishedAt,
          changed: row.changed,
        });
      }
    }
    return latest;
  }

  async reap(startedBefore: Date, now: Date): Promise<number> {
    let reaped = 0;
    for (const row of this.rows) {
      if (
        row.status === SourceProbeStatus.RUNNING &&
        row.startedAt < startedBefore
      ) {
        row.status = SourceProbeStatus.ABORTED;
        row.finishedAt = now;
        reaped += 1;
      }
    }
    return reaped;
  }

  readonly prunes: Date[] = [];

  async prune(startedBefore: Date): Promise<number> {
    this.prunes.push(startedBefore);
    return 0;
  }
}
