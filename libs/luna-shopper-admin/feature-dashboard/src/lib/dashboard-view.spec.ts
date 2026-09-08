import type {
  PathOf,
  Translate,
  Wire,
} from '@portfolio/luna-shopper-admin/models';
import { activityRows, waitingTiles } from './dashboard-view';

/** The testing translator does not interpolate, so a spec supplies its own. */
const translate: Translate = (key, values) =>
  values === undefined
    ? key
    : `${key}(${Object.entries(values)
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(',')})`;

const nameChain = (id: string) => `chain:${id}`;

/**
 * The mount of admin plan 0022, as far as the overview reaches into it.
 *
 * A resolver rather than a segment map, which is the whole point: a tile knows
 * which resource it opens and knows nothing about which section holds it.
 */
const pathOf: PathOf = (name) => {
  const section: Record<string, string | undefined> = {
    zones: 'shoppers',
    lists: 'shoppers',
    users: 'shoppers',
    prices: 'catalog',
    items: 'catalog',
    'postal-codes': 'harvest',
  };
  const segment = section[name];

  return segment === undefined ? null : ['/', segment, name];
};

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
    const [tile] = waitingTiles(response(), translate, nameChain, pathOf);

    expect(tile.key).toBe('memberships');
    expect(tile.value).toBe(2);
    expect(tile.link).toEqual(['/', 'shoppers', 'zones']);
  });

  /** A queue with rows in it is the reason this screen exists. */
  it('puts a tile with rows in it in the attention tone', () => {
    const tiles = waitingTiles(response(), translate, nameChain, pathOf);
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

    const keys = waitingTiles(document, translate, nameChain, pathOf).map(
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
    const tile = waitingTiles(document, translate, nameChain, pathOf).find(
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
    const tiles = waitingTiles(document, translate, nameChain, pathOf);
    const entries = tiles.find((tile) => tile.key === 'entries-a');
    const shops = tiles.find((tile) => tile.key === 'shops-a');
    const places = tiles.find((tile) => tile.key === 'places');

    expect(entries?.link).toEqual(['/', 'harvest', 'entries']);
    expect(entries?.query).toEqual({ supermarketId: 'a' });
    expect(shops?.link).toEqual(['/', 'harvest', 'shops']);
    expect(shops?.query).toBeNull();
    expect(places?.link).toEqual(['/', 'harvest', 'places']);
  });

  it('sends the stale prices to the price list, wherever it is mounted', () => {
    const tile = waitingTiles(response(), translate, nameChain, pathOf).find(
      (entry) => entry.key === 'stale'
    );

    expect(tile?.value).toBe(61);
    expect(tile?.link).toEqual(['/', 'catalog', 'prices']);
  });

  /**
   * A tile whose screen this app did not mount keeps its number and loses its
   * link, rather than pointing at a URL that answers the not found page.
   */
  it('draws an unlinked tile where the screen is not mounted', () => {
    const tiles = waitingTiles(response(), translate, nameChain, nothing);
    const stale = tiles.find((tile) => tile.key === 'stale');

    expect(stale?.value).toBe(61);
    expect(stale?.link).toBeNull();
  });

  /** The rows are further down this same page, so the tile opens nothing. */
  it('gives the failed sign ins no link', () => {
    const tile = waitingTiles(response(), translate, nameChain, pathOf).find(
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
      nameChain,
      pathOf
    ).map((tile) => tile.key);

    expect(keys).toEqual(['stale', 'loginFailures']);
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

  it('opens a row through the section that holds its screen', () => {
    const [row] = activityRows([entry()], translate, since, instant, pathOf);

    expect(row.link).toEqual(['/', 'shoppers', 'zones', 'zone-1']);
    expect(row.who).toBe('Ichiroku');
  });

  /** A guessed URL would land on the not found page, which costs a navigation. */
  it('leaves a row with no screen as text', () => {
    const [row] = activityRows(
      [entry({ entity: 'list_lines', entityId: 'line-1' })],
      translate,
      since,
      instant,
      pathOf
    );

    expect(row.link).toBeNull();
  });

  it('leaves a row as text where the resolver does not know the resource', () => {
    const [row] = activityRows([entry()], translate, since, instant, nothing);

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
      instant,
      pathOf
    );

    expect(row.who).toBe('dashboard.activity.service');
  });

  it('says the table where this app has no noun for it', () => {
    const [row] = activityRows(
      [entry({ entity: 'admin_login_failures' })],
      translate,
      since,
      instant,
      pathOf
    );

    expect(row.what).toContain('admin_login_failures');
  });
});
