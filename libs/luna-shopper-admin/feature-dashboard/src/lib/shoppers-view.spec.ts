import type {
  PathOf,
  Translate,
  Wire,
} from '@portfolio/luna-shopper-admin/models';
import { shopperStats, signUpsChart } from './shoppers-view';

/** The testing translator does not interpolate, so a spec supplies its own. */
const translate: Translate = (key, values) =>
  values === undefined
    ? key
    : `${key}(${Object.entries(values)
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(',')})`;

/** Every shoppers resource, mounted where admin plan 0022 puts it. */
const pathOf: PathOf = (name) => ['/', 'shoppers', name];

/** An app that mounted none of them, which draws a tile with no link. */
const nothing: PathOf = () => null;

function days(...counts: readonly number[]): Wire.AdminDashboardDailyCount[] {
  return counts.map((count, index) => ({
    day: `2026-08-${String(index + 1).padStart(2, '0')}`,
    count,
  }));
}

function identity(
  over: Partial<Wire.AdminDashboardAdminIdentityDashboard> = {}
): Wire.AdminDashboardAdminIdentityDashboard {
  return {
    users: { total: 10, registered: 7, temporary: 3, verified: 5 },
    signUps: days(1, 1, 1),
    admins: { total: 2, disabled: 0 },
    loginFailures: { last24h: 0, last7d: 0, recent: [] },
    activity: [],
    ...over,
  };
}

function core(
  over: Partial<Wire.AdminDashboardAdminCoreDashboard> = {}
): Wire.AdminDashboardAdminCoreDashboard {
  return {
    zones: { total: 4, active: 3, markedForDeletion: 1 },
    memberships: { pending: 2 },
    lists: { total: 9 },
    baskets: { total: 6, open: 1, finished: 4, live: 1 },
    zonesCreated: days(1, 0, 2),
    listsCreated: days(0, 3, 1),
    activity: [],
    ...over,
  };
}

describe('shopperStats', () => {
  /** Admin plan 0046, target 2: people, zones, lists, being shopped. */
  it('is people, zones, lists and the shopping lists being shopped', () => {
    const stats = shopperStats(
      identity(),
      core({ baskets: { total: 6, open: 2, finished: 3, live: 1 } }),
      translate,
      pathOf
    );

    expect(stats.map((stat) => [stat.key, stat.value])).toEqual([
      ['users', 10],
      ['zones', 4],
      ['lists', 9],
      ['beingShopped', 2],
    ]);
  });

  it('draws only what answered', () => {
    expect(
      shopperStats(null, core(), translate, pathOf).map((stat) => stat.key)
    ).toEqual(['zones', 'lists', 'beingShopped']);
    expect(
      shopperStats(identity(), null, translate, pathOf).map((stat) => stat.key)
    ).toEqual(['users']);
  });

  /**
   * The last number opens the `baskets` resource, whose segment is
   * `shopping-lists`: the gateway's own word for a basket. It used to be
   * that segment written out, which is a second copy of a fact the descriptor
   * already holds and is wrong the moment the screen moves into a section.
   */
  it('opens each of them by resource name rather than by segment', () => {
    const stats = shopperStats(identity(), core(), translate, (name) => [
      '/',
      'shoppers',
      `resolved:${name}`,
    ]);

    expect(stats.map((stat) => stat.link?.[2])).toEqual([
      'resolved:users',
      'resolved:zones',
      'resolved:lists',
      'resolved:baskets',
    ]);
  });

  it('draws a number with no link where the screen is not mounted', () => {
    const stats = shopperStats(identity(), core(), translate, nothing);

    expect(stats.map((stat) => stat.link)).toEqual([null, null, null, null]);
    expect(stats[0].value).toBe(10);
  });
});

describe('signUpsChart', () => {
  it('is one line over the window', () => {
    const [series] = signUpsChart(identity(), translate);

    expect(series.key).toBe('signUps');
    expect(series.colour).toBe(1);
    expect(series.points.map((point) => point.value)).toEqual([1, 1, 1]);
  });
});
