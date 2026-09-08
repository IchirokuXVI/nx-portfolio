import type { Translate, Wire } from '@portfolio/luna-shopper-admin/models';
import {
  postalCodeCaption,
  recentRunRows,
  runsByStatusChart,
} from './harvest-dashboard-view';

/** The testing translator does not interpolate, so a spec supplies its own. */
const translate: Translate = (key, values) =>
  values === undefined
    ? key
    : `${key}(${Object.entries(values)
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(',')})`;

function harvest(
  over: Partial<Wire.AdminDashboardAdminHarvestDashboard> = {}
): Wire.AdminDashboardAdminHarvestDashboard {
  return {
    runs: { byStatus: [], inWindow: 0 },
    running: null,
    recent: [],
    queues: { entries: [], places: 0, shops: [] },
    sources: { total: 2, enabled: 1 },
    ...over,
  };
}

describe('runsByStatusChart', () => {
  it('draws every status in enum order whatever happened this month', () => {
    const chart = runsByStatusChart(
      harvest({
        runs: {
          byStatus: [{ status: 'COMPLETED', count: 4 }],
          inWindow: 4,
        },
      }),
      translate
    );

    expect(chart.bars.map((bar) => bar.key)).toEqual([
      'PENDING',
      'RUNNING',
      'COMPLETED',
      'FAILED',
      'ABORTED',
      'STALE',
    ]);
    expect(chart.bars.map((bar) => bar.values)).toEqual([
      [0],
      [0],
      [4],
      [0],
      [0],
      [0],
    ]);
  });

  /** One series, so every bar is the first colour and none of them is identity. */
  it('is one series', () => {
    const chart = runsByStatusChart(harvest(), translate);

    expect(chart.series).toHaveLength(1);
    expect(chart.series[0].colour).toBe(1);
  });
});

describe('recentRunRows', () => {
  const run = (
    over: Partial<Wire.HarvestHarvestRunView> = {}
  ): Wire.HarvestHarvestRunView =>
    ({
      id: 'run-1',
      mode: 'CATALOG_DISCOVERY',
      status: 'COMPLETED',
      requestedAt: '2026-09-03T09:00:00.000Z',
      processed: 12,
      failed: 0,
      revertedAt: null,
      revertedByUserId: null,
      ...over,
    }) as Wire.HarvestHarvestRunView;

  /**
   * The same `RunRow` the runs screen builds, so the two screens draw one row
   * rather than two that drift.
   */
  it('formats its instants through the caller, which keeps Intl out of a template', () => {
    const [row] = recentRunRows([run()], (value) => `at ${value ?? 'never'}`);

    expect(row.id).toBe('run-1');
    expect(row.requested).toBe('at 2026-09-03T09:00:00.000Z');
    expect(row.reverted).toBe('at never');
  });

  it('carries no reason for a run that was not blocked', () => {
    const [row] = recentRunRows([run()], () => '');

    expect(row.reasonKey).toBeNull();
  });
});

/**
 * A queue of three with one failure that has waited a month is one situation
 * rather than three, so neither number is worth a tile of its own.
 */
describe('postalCodeCaption', () => {
  const summary = (
    over: Partial<Wire.HarvestPostalCodeDiscoverySummaryView> = {}
  ): Wire.HarvestPostalCodeDiscoverySummaryView =>
    ({
      queued: 3,
      failed: 0,
      oldestQueuedAt: null,
      ...over,
    }) as Wire.HarvestPostalCodeDiscoverySummaryView;

  it('is nothing at all for a queue with no failure and no wait', () => {
    expect(postalCodeCaption(summary(), translate, () => 'x')).toBeNull();
  });

  it('names the failures and the oldest wait in one line', () => {
    const caption = postalCodeCaption(
      summary({ failed: 2, oldestQueuedAt: '2026-08-01T00:00:00.000Z' }),
      translate,
      () => 'a month ago'
    );

    expect(caption).toContain('dashboard.waiting.postalCodesFailed');
    expect(caption).toContain('dashboard.waiting.postalCodesOldest');
  });
});
