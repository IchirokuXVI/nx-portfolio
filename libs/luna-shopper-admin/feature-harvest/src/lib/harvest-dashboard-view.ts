import {
  failureBlockReason,
  type Translate,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import type { BarChartView, RunRow } from '@portfolio/luna-shopper-admin/ui';

/**
 * The harvest block of the dashboard document, as the harvester screen draws it.
 *
 * Both functions came from `feature-dashboard` with admin plan 0022 and neither
 * changed. They are here because this is the library that owns the runs list
 * they link to, and because `recentRunRows` builds the same `RunRow` that list
 * builds: two screens drawing one row rather than two that drift.
 */

/**
 * The failures and the oldest wait in the postal code queue, as one line.
 *
 * Neither is worth a number of its own beside the count: a queue of three with
 * one failure that has waited a month is one situation rather than three.
 * `null` when there is nothing to add, which is a drained queue.
 *
 * In this library because two screens draw it: the card on this section's
 * dashboard, where the failures and the age belong beside the runs that produced
 * them, and the caption under the overview's work waiting tile, where the queued
 * count earns its place because it stands for people opening velista and being
 * told we have nothing for them (admin plan 0022, section 9).
 */
export function postalCodeCaption(
  summary: Wire.HarvestPostalCodeDiscoverySummaryView,
  translate: Translate,
  since: (value: string) => string
): string | null {
  const parts: string[] = [];

  if (summary.failed > 0) {
    parts.push(
      translate('dashboard.waiting.postalCodesFailed', {
        count: summary.failed,
      })
    );
  }
  if (summary.oldestQueuedAt !== null) {
    parts.push(
      translate('dashboard.waiting.postalCodesOldest', {
        since: since(summary.oldestQueuedAt),
      })
    );
  }

  return parts.length === 0 ? null : parts.join(' · ');
}

/** Every harvest run status, in the order that fixes the bar chart's categories. */
const RUN_STATUSES: readonly Wire.EnumsHarvestRunStatus[] = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'ABORTED',
  'STALE',
];

/**
 * The last five runs, as the runs list draws them.
 *
 * The instants are formatted by the caller, which is what keeps `Intl` out of a
 * template.
 */
export function recentRunRows(
  runs: readonly Wire.HarvestHarvestRunView[],
  formatInstant: (value: string | null) => string
): RunRow[] {
  return runs.map((run) => ({
    id: run.id,
    mode: run.mode,
    status: run.status,
    requested: formatInstant(run.requestedAt),
    processed: run.processed,
    failed: run.failed,
    reverted: formatInstant(run.revertedAt),
    revertedBy: run.revertedByUserId ?? '',
    reasonKey: reasonKey(failureBlockReason(run)),
  }));
}

function reasonKey(reason: string | null): string | null {
  return reason === null ? null : `harvest.blocked.${reason}`;
}

/**
 * Runs by status, as one series over six categories.
 *
 * One series, so every bar is `--admin-chart-1`: colour by category would be
 * identity the x axis already carries, and six colours for six statuses say
 * nothing the labels do not (plan 0015, section 3.2).
 */
export function runsByStatusChart(
  harvest: Wire.AdminDashboardAdminHarvestDashboard,
  translate: Translate
): BarChartView {
  const counts = new Map(
    harvest.runs.byStatus.map((entry) => [entry.status, entry.count])
  );

  return {
    bars: RUN_STATUSES.map((status) => ({
      key: status,
      label: translate(`harvest.status.${status}`),
      values: [counts.get(status) ?? 0],
    })),
    series: [
      {
        key: 'runs',
        label: translate('dashboard.harvest.byStatus'),
        colour: 1,
      },
    ],
  };
}
