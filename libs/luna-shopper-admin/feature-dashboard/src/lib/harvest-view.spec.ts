import type { Translate, Wire } from '@portfolio/luna-shopper-admin/models';
import { harvestStats, postalCodeCaption } from './harvest-view';

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
    queues: { entries: [], places: 0, shops: [], brands: 0 },
    sources: { total: 2, enabled: 1 },
    ...over,
  };
}

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

describe('harvestStats', () => {
  /**
   * Admin plan 0046, target 2: the runs in the window, the run in flight, the
   * runs that failed, and how many chains may be fetched.
   */
  it('is the four numbers the harvester counted', () => {
    const stats = harvestStats(
      harvest({
        runs: {
          byStatus: [
            { status: 'COMPLETED', count: 34 },
            { status: 'FAILED', count: 6 },
          ],
          inWindow: 14,
        },
        sources: { total: 4, enabled: 1 },
      }),
      30,
      translate
    );

    expect(stats.map((stat) => [stat.key, stat.value, stat.of])).toEqual([
      ['inWindow', 14, null],
      ['running', 0, null],
      ['failed', 6, null],
      ['sources', 1, 4],
    ]);
    // The window is the gateway's, and its length is written beside the count.
    expect(stats[0].label).toBe('dashboard.harvest.inWindow(count=30)');
  });

  /** Red on the page means danger, so a count of failures is red only above zero. */
  it('marks the failed runs only when there are some', () => {
    const failed = (count: number) =>
      harvestStats(
        harvest({
          runs: { byStatus: [{ status: 'FAILED', count }], inWindow: 0 },
        }),
        30,
        translate
      ).find((stat) => stat.key === 'failed');

    expect(failed(2)?.danger).toBe(true);
    expect(failed(0)?.danger).toBe(false);
  });

  /** The document names the run in flight or names nothing. A finished one is none. */
  it('counts one run in flight, and none once it ended', () => {
    const running = (status: Wire.EnumsHarvestRunStatus) =>
      harvestStats(
        harvest({
          running: { status } as Wire.HarvestHarvestRunView,
        }),
        30,
        translate
      ).find((stat) => stat.key === 'running')?.value;

    expect(running('RUNNING')).toBe(1);
    expect(running('PENDING')).toBe(1);
    expect(running('COMPLETED')).toBe(0);
  });

  /** The runs are the Runs tab, and the switches of the chains are in Setup. */
  it('opens the Runs tab, and Setup for the chains', () => {
    const stats = harvestStats(harvest(), 30, translate);

    expect(stats[0].link).toEqual(['/', 'harvest', 'runs']);
    expect(stats[3].link).toEqual(['/', 'harvest', 'setup', 'sources']);
  });
});
