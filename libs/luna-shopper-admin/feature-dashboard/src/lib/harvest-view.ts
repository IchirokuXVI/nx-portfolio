import {
  harvestRunsPath,
  harvestSetupPath,
  isTerminalRun,
  type Translate,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import type { StatView } from './dashboard-view';

/**
 * The harvest block of the dashboard document, as the overview draws it.
 *
 * The caption was the harvester dashboard's. That dashboard is gone (admin
 * plan 0044, target 7): its running run and its recent runs are the Runs tab,
 * and its numbers are a block of the overview.
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

/**
 * What the harvester did and what it may do (admin plan 0046, target 2): the
 * runs in the window, the run in flight, the runs that failed, and how many
 * chains may be fetched.
 *
 * **Each number is one the harvester counted.** The window is the one the
 * gateway sends, and the page writes its length beside the first number. The
 * failed runs are over all time, which is the only count of them the document
 * holds, so the label says so. "Running" is one or none: the harvester runs
 * one at a time, and the document names that run or names nothing.
 */
export function harvestStats(
  harvest: Wire.AdminDashboardAdminHarvestDashboard,
  days: number,
  translate: Translate
): StatView[] {
  const failed =
    harvest.runs.byStatus.find((entry) => entry.status === 'FAILED')?.count ??
    0;

  return [
    {
      key: 'inWindow',
      label: translate('dashboard.harvest.inWindow', { count: days }),
      value: harvest.runs.inWindow,
      of: null,
      link: harvestRunsPath(),
      danger: false,
    },
    {
      key: 'running',
      label: translate('dashboard.harvest.running'),
      value:
        harvest.running !== null && !isTerminalRun(harvest.running) ? 1 : 0,
      of: null,
      link: harvestRunsPath(),
      danger: false,
    },
    {
      key: 'failed',
      label: translate('dashboard.harvest.failed'),
      value: failed,
      of: null,
      link: harvestRunsPath(),
      danger: failed > 0,
    },
    {
      key: 'sources',
      label: translate('dashboard.harvest.sources'),
      value: harvest.sources.enabled,
      of: harvest.sources.total,
      link: harvestSetupPath(),
      danger: false,
    },
  ];
}
