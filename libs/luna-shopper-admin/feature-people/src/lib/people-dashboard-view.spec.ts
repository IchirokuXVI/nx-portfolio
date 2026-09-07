import type {
  PathOf,
  Translate,
  Wire,
} from '@portfolio/luna-shopper-admin/models';
import {
  peopleTiles,
  signUpsChart,
  zonesAndListsChart,
} from './people-dashboard-view';

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
    baskets: { total: 6, draft: 1, completed: 5 },
    zonesCreated: days(1, 0, 2),
    listsCreated: days(0, 3, 1),
    activity: [],
    ...over,
  };
}

describe('peopleTiles', () => {
  it('carries the seven day delta and the sparkline on the users tile', () => {
    const tiles = peopleTiles(
      identity({ signUps: days(...Array.from({ length: 14 }, () => 1)) }),
      core(),
      translate,
      pathOf
    );
    const users = tiles[0];

    expect(users.key).toBe('users');
    expect(users.delta?.value).toBe(0);
    expect(users.trend).toHaveLength(14);
  });

  it('draws only what answered', () => {
    expect(
      peopleTiles(null, core(), translate, pathOf).map((tile) => tile.key)
    ).toEqual(['zones', 'lists', 'baskets']);
    expect(
      peopleTiles(identity(), null, translate, pathOf).map((tile) => tile.key)
    ).toEqual(['users']);
  });

  /**
   * The baskets tile opens the `baskets` resource, whose segment is
   * `shopping-lists`: the gateway's own word for a generated list. It used to be
   * that segment written out, which is a second copy of a fact the descriptor
   * already holds and is wrong the moment the screen moves into a section.
   */
  it('opens each of them by resource name rather than by segment', () => {
    const tiles = peopleTiles(identity(), core(), translate, (name) => [
      '/',
      'shoppers',
      `resolved:${name}`,
    ]);

    expect(tiles.map((tile) => tile.link?.[2])).toEqual([
      'resolved:users',
      'resolved:zones',
      'resolved:lists',
      'resolved:baskets',
    ]);
  });

  it('draws an unlinked tile where the screen is not mounted', () => {
    const tiles = peopleTiles(identity(), core(), translate, nothing);

    expect(tiles.map((tile) => tile.link)).toEqual([null, null, null, null]);
    expect(tiles[0].value).toBe(10);
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

describe('zonesAndListsChart', () => {
  it('is two lines on one chart, in a fixed colour order', () => {
    const series = zonesAndListsChart(core(), translate);

    expect(series.map((entry) => [entry.key, entry.colour])).toEqual([
      ['zones', 1],
      ['lists', 2],
    ]);
    expect(series[1].points.map((point) => point.value)).toEqual([0, 3, 1]);
  });
});
