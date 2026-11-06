import type {
  AdapterKey,
  SourceProbeSummary,
  SourceProbeView,
} from '@portfolio/luna-shopper/contracts';
import type { SourceProbe } from '../../entities';
import type { LatestProbe } from './source-probe.store';

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

/** One probe on the wire (plan 0219, section 8). */
export function toSourceProbeView(row: SourceProbe): SourceProbeView {
  const startedAt = new Date(row.startedAt);
  const finishedAt = row.finishedAt ? new Date(row.finishedAt) : null;
  return {
    id: row.id,
    sourceId: row.sourceId,
    supermarketId: row.supermarketId,
    adapterKey: row.adapterKey as AdapterKey,
    trigger: row.trigger,
    status: row.status,
    previousStatus: row.previousStatus ?? null,
    changed: row.changed,
    attempt: Number(row.attempt ?? 1),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt ? finishedAt.toISOString() : null,
    durationMs: finishedAt
      ? Math.max(0, finishedAt.getTime() - startedAt.getTime())
      : null,
    requests: row.requests,
    steps: row.steps ?? [],
    error: row.error ?? null,
    requestedByUserId: row.requestedByUserId ?? null,
  };
}

/** The newest probe that is not `ABORTED`, on the source view. */
export function toSourceProbeSummary(row: LatestProbe): SourceProbeSummary {
  return {
    id: row.id,
    status: row.status,
    startedAt: iso(row.startedAt) as string,
    finishedAt: iso(row.finishedAt),
    changed: row.changed,
  };
}
