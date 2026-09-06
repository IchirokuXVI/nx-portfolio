import type { Wire } from '@portfolio/luna-shopper-admin/models';
import {
  activityRows,
  catalogTiles,
  peopleTiles,
  pricesWrittenChart,
  runsByStatusChart,
  waitingTiles,
  type Translate,
} from './dashboard-view';

/** The testing translator does not interpolate, so a spec supplies its own. */
const translate: Translate = (key, values) =>
  values === undefined
    ? key
    : `${key}(${Object.entries(values)
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(',')})`;

const nameChain = (id: string) => `chain:${id}`;

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

function catalog(
  over: Partial<Wire.AdminDashboardAdminCatalogDashboard> = {}
): Wire.AdminDashboardAdminCatalogDashboard {
  return {
    supermarkets: 3,
    locations: 40,
    items: 500,
    productGroups: 20,
    supermarketItems: { total: 900, priced: 800, stale: 61, unavailable: 12 },
    pricesWritten: [],
    activity: [],
    ...over,
  };
}

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

function response(
  over: Partial<Wire.AdminAdminDashboardResponse> = {}
): Wire.AdminAdminDashboardResponse {
  return {
    window: { from: '2026-08-05', to: '2026-09-03' },
    identity: identity(),
    core: core(),
    catalog: catalog(),
    harvest: harvest(),
    activity: [],
    measuredAt: '2026-09-03T10:00:00.000Z',
    ...over,
  };
}

describe('waitingTiles', () => {
  it('counts the join requests and opens the zones', () => {
    const [tile] = waitingTiles(response(), translate, nameChain);

    expect(tile.key).toBe('memberships');
    expect(tile.value).toBe(2);
    expect(tile.link).toEqual(['/', 'zones']);
  });

  /** A queue with rows in it is the reason this screen exists. */
  it('puts a tile with rows in it in the attention tone', () => {
    const tiles = waitingTiles(response(), translate, nameChain);
    const memberships = tiles.find((tile) => tile.key === 'memberships');
    const places = tiles.find((tile) => tile.key === 'places');

    expect(memberships?.tone).toBe('attention');
    expect(places?.tone).toBe('quiet');
  });

  /**
   * A row of zeros reads as noise, and the reader is looking for the one that is
   * not zero.
   */
  it('draws no tile for a chain with nothing waiting', () => {
    const document = response({
      harvest: harvest({
        queues: {
          entries: [
            { supermarketId: 'a', candidate: 2, unresolved: 3 },
            { supermarketId: 'b', candidate: 0, unresolved: 0 },
          ],
          places: 0,
          shops: [
            { supermarketId: 'a', unmapped: 4 },
            { supermarketId: 'b', unmapped: 0 },
          ],
        },
      }),
    });

    const keys = waitingTiles(document, translate, nameChain).map(
      (tile) => tile.key
    );

    expect(keys).toContain('entries-a');
    expect(keys).not.toContain('entries-b');
    expect(keys).toContain('shops-a');
    expect(keys).not.toContain('shops-b');
  });

  it('sums the two states a product queue holds', () => {
    const document = response({
      harvest: harvest({
        queues: {
          entries: [{ supermarketId: 'a', candidate: 2, unresolved: 3 }],
          places: 0,
          shops: [],
        },
      }),
    });
    const tile = waitingTiles(document, translate, nameChain).find(
      (entry) => entry.key === 'entries-a'
    );

    expect(tile?.value).toBe(5);
  });

  /** The one queue that reads its chain from the query string. */
  it('opens the product queue on the chain and every other queue unfiltered', () => {
    const document = response({
      harvest: harvest({
        queues: {
          entries: [{ supermarketId: 'a', candidate: 1, unresolved: 0 }],
          places: 3,
          shops: [{ supermarketId: 'a', unmapped: 1 }],
        },
      }),
    });
    const tiles = waitingTiles(document, translate, nameChain);
    const entries = tiles.find((tile) => tile.key === 'entries-a');
    const shops = tiles.find((tile) => tile.key === 'shops-a');
    const places = tiles.find((tile) => tile.key === 'places');

    expect(entries?.link).toEqual(['/', 'harvest', 'entries']);
    expect(entries?.query).toEqual({ supermarketId: 'a' });
    expect(shops?.link).toEqual(['/', 'harvest', 'shops']);
    expect(shops?.query).toBeNull();
    expect(places?.link).toEqual(['/', 'harvest', 'places']);
  });

  it('sends the stale prices to the price list', () => {
    const tile = waitingTiles(response(), translate, nameChain).find(
      (entry) => entry.key === 'stale'
    );

    expect(tile?.value).toBe(61);
    expect(tile?.link).toEqual(['/', 'prices']);
  });

  /** The rows are further down this same page, so the tile opens nothing. */
  it('gives the failed sign ins no link', () => {
    const tile = waitingTiles(response(), translate, nameChain).find(
      (entry) => entry.key === 'loginFailures'
    );

    expect(tile?.link).toBeNull();
  });

  /**
   * "The harvester did not answer" and "nothing is waiting" must never look the
   * same, so a block that did not answer contributes no tile at all.
   */
  it('contributes nothing for a block that did not answer', () => {
    const keys = waitingTiles(
      response({ harvest: null, core: null }),
      translate,
      nameChain
    ).map((tile) => tile.key);

    expect(keys).toEqual(['stale', 'loginFailures']);
  });
});

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

describe('pricesWrittenChart', () => {
  const series = (
    kind: Wire.EnumsPriceSourceKind,
    ...counts: readonly number[]
  ) => ({ sourceKind: kind, points: days(...counts) });

  it('gives a kind the colour of its position in the enum, always', () => {
    const chart = pricesWrittenChart(
      catalog({
        pricesWritten: [
          series('OFFICIAL_API', 0, 0, 0),
          series('OFFICIAL_WEB', 1, 2, 3),
          series('OFFICIAL_LEAFLET', 0, 0, 0),
          series('ADMIN', 4, 0, 0),
          series('USER_RECEIPT', 0, 0, 0),
          series('USER_REPORTED', 0, 0, 0),
        ],
      }),
      translate
    );

    expect(chart.series.map((entry) => [entry.key, entry.colour])).toEqual([
      ['OFFICIAL_WEB', 2],
      ['ADMIN', 4],
    ]);
  });

  it('leaves a kind that wrote nothing out of the drawing', () => {
    const chart = pricesWrittenChart(
      catalog({
        pricesWritten: [
          series('OFFICIAL_API', 1, 0, 0),
          series('USER_RECEIPT', 0, 0, 0),
        ],
      }),
      translate
    );

    expect(chart.series.map((entry) => entry.key)).toEqual(['OFFICIAL_API']);
    expect(chart.bars.map((bar) => bar.values)).toEqual([[1], [0], [0]]);
  });

  it('draws one category per day of the window', () => {
    const chart = pricesWrittenChart(
      catalog({ pricesWritten: [series('OFFICIAL_API', 1, 2, 3)] }),
      translate
    );

    expect(chart.bars.map((bar) => bar.key)).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
    ]);
  });
});

describe('peopleTiles', () => {
  it('carries the seven day delta and the sparkline on the users tile', () => {
    const tiles = peopleTiles(
      identity({ signUps: days(...Array.from({ length: 14 }, () => 1)) }),
      core(),
      translate
    );
    const users = tiles[0];

    expect(users.key).toBe('users');
    expect(users.delta?.value).toBe(0);
    expect(users.trend).toHaveLength(14);
  });

  it('draws only what answered', () => {
    expect(
      peopleTiles(null, core(), translate).map((tile) => tile.key)
    ).toEqual(['zones', 'lists', 'baskets']);
    expect(
      peopleTiles(identity(), null, translate).map((tile) => tile.key)
    ).toEqual(['users']);
  });
});

describe('catalogTiles', () => {
  it('is five tiles, the last of which opens the price list', () => {
    const tiles = catalogTiles(catalog(), translate);

    expect(tiles.map((tile) => tile.key)).toEqual([
      'supermarkets',
      'locations',
      'items',
      'productGroups',
      'supermarketItems',
    ]);
    expect(tiles[4].link).toEqual(['/', 'prices']);
    expect(tiles[4].value).toBe(900);
  });
});

describe('activityRows', () => {
  const since = () => 'a moment ago';
  const instant = (value: string | null) => value ?? '';

  function entry(
    over: Partial<Wire.AdminDashboardAdminDashboardActivityEntry> = {}
  ): Wire.AdminDashboardAdminDashboardActivityEntry {
    return {
      at: '2026-09-03T09:59:00.000Z',
      actorKind: 'ADMIN',
      actorId: 'admin-1',
      actorName: 'Ichiroku',
      entity: 'zones',
      entityId: 'zone-1',
      action: 'UPDATE',
      ...over,
    };
  }

  it('opens a row this app has a screen for', () => {
    const [row] = activityRows([entry()], translate, since, instant);

    expect(row.link).toEqual(['/', 'zones', 'zone-1']);
    expect(row.who).toBe('Ichiroku');
  });

  /** A guessed URL would land on the not found page, which costs a navigation. */
  it('leaves a row with no screen as text', () => {
    const [row] = activityRows(
      [entry({ entity: 'list_lines', entityId: 'line-1' })],
      translate,
      since,
      instant
    );

    expect(row.link).toBeNull();
  });

  /**
   * The ids are provisioned per cluster and the harvester is the only service
   * that writes, so the row says what it is rather than printing a uuid.
   */
  it('names a service actor rather than printing its id', () => {
    const [row] = activityRows(
      [entry({ actorKind: 'SERVICE', actorId: 'uuid', actorName: 'uuid' })],
      translate,
      since,
      instant
    );

    expect(row.who).toBe('dashboard.activity.service');
  });

  it('says the table where this app has no noun for it', () => {
    const [row] = activityRows(
      [entry({ entity: 'admin_login_failures' })],
      translate,
      since,
      instant
    );

    expect(row.what).toContain('admin_login_failures');
  });
});
