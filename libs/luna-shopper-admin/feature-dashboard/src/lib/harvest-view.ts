import type { Translate, Wire } from '@portfolio/luna-shopper-admin/models';
import type { BarChartView } from '@portfolio/luna-shopper-admin/ui';

/**
 * The harvest block of the dashboard document, as the overview draws it.
 *
 * Both functions were the harvester dashboard's. That dashboard is gone (admin
 * plan 0044, target 7): its running run and its recent runs are the Runs tab,
 * and its chart is a block of the overview, which is why the chart's builder
 * is in this library again.
 */

/**
 * The failures and the oldest wait in the postal code queue, as one line.
 *
 * Neither is worth a number of its own beside the count: a queue of three with
 * one failure that has waited a month is one situation rather than three.
 * `null` when there is nothing to add, which is a drained queue.
 *
 * The caption under the overview's work waiting tile, where the queued count
 * earns its place because it stands for people opening velista and being told
 * we have nothing for them (admin plan 0022, section 9).
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

/** Every status a run can end in, in the order the gateway's enum states them. */
const RUN_STATUSES: readonly Wire.EnumsHarvestRunStatus[] = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'ABORTED',
  'STALE',
];

/**
 * Runs by status, over all time.
 *
 * Every status is a bar, in enum order, even at zero: the chart assigns colours
 * by position, so a bar that appeared only once something had failed would
 * recolour the whole chart the day it does. One series, so every bar is the
 * first colour and none of them is an identity.
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
