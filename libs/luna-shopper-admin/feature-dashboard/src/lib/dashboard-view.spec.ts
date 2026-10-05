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
    queues: { entries: [], places: 0, shops: [], brands: 0 },
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

/** Where the Admins section keeps the failed sign ins, as the page hands it over. */
const failedSignIns = ['/', 'admins', 'failed-sign-ins'] as const;

function tilesOf(
  document: Wire.AdminAdminDashboardResponse,
  resolve: PathOf = pathOf
) {
  return waitingTiles(
    document,
    null,
    translate,
    nameChain,
    resolve,
    failedSignIns
  );
}

describe('waitingTiles', () => {
  /**
   * Admin plan 0046, target 1: the same tiles on every visit, so that the row
   * does not jump. The order is the mock's.
   */
  it('is the same row whatever waits', () => {
    expect(tilesOf(response()).map((tile) => tile.key)).toEqual([
      'entries',
      'shops',
      'places',
      'memberships',
      'stale',
      'loginFailures',
    ]);
  });

  /**
   * Admin plan 0045, section 2: the tile opens the Zones tab already narrowed
   * to the zones where a request waits.
   */
  it('counts the join requests and opens the zones that have one', () => {
    const tile = tilesOf(response()).find(
      (entry) => entry.key === 'memberships'
    );

    expect(tile?.value).toBe(2);
    expect(tile?.link).toEqual(['/', 'shoppers', 'zones']);
    expect(tile?.query).toEqual({ hasPending: 'true' });
  });

  /** A tile with a count above zero takes the waiting wash. One at zero is plain. */
  it('marks a tile that has something waiting, and keeps one at zero plain', () => {
    const tiles = tilesOf(response());
    const memberships = tiles.find((tile) => tile.key === 'memberships');
    const places = tiles.find((tile) => tile.key === 'places');

    expect(memberships?.tone).toBe('attention');
    expect(places?.value).toBe(0);
    expect(places?.tone).toBe('quiet');
  });

  /**
   * The two queues that are kept per chain are one tile each: the sum, and the
   * chains with their counts as the second line, most first. A chain with
   * nothing waiting is not named.
   */
  it('makes one tile of each per chain queue, with the chains on its second line', () => {
    const document = response({
      harvest: harvest({
        queues: {
          entries: [
            { supermarketId: 'a', candidate: 2, unresolved: 3 },
            { supermarketId: 'b', candidate: 0, unresolved: 0 },
            { supermarketId: 'c', candidate: 30, unresolved: 5 },
          ],
          places: 0,
          shops: [
            { supermarketId: 'a', unmapped: 4 },
            { supermarketId: 'b', unmapped: 0 },
          ],
          brands: 0,
        },
      }),
    });
    const tiles = tilesOf(document);
    const entries = tiles.find((tile) => tile.key === 'entries');
    const shops = tiles.find((tile) => tile.key === 'shops');

    expect(entries?.value).toBe(40);
    expect(entries?.caption).toBe('chain:c 35, chain:a 5');
    expect(shops?.value).toBe(4);
    expect(shops?.caption).toBe('chain:a 4');
  });

  it('gives a per chain queue with nothing waiting no second line', () => {
    const entries = tilesOf(response()).find((tile) => tile.key === 'entries');

    expect(entries?.value).toBe(0);
    expect(entries?.caption).toBeNull();
  });

  it('names three chains and counts the rest', () => {
    const document = response({
      harvest: harvest({
        queues: {
          entries: ['a', 'b', 'c', 'd', 'e'].map((supermarketId, index) => ({
            supermarketId,
            candidate: 10 - index,
            unresolved: 0,
          })),
          places: 0,
          shops: [],
          brands: 0,
        },
      }),
    });

    expect(
      tilesOf(document).find((tile) => tile.key === 'entries')?.caption
    ).toBe(
      'dashboard.waiting.moreChains(chains=chain:a 10, chain:b 9, chain:c 8,count=2)'
    );
  });

  /**
   * The queues are the Review tab's (admin plan 0044). A tile is about every
   * chain now, so it opens its queue whole.
   */
  it('opens each queue of Review', () => {
    const tiles = tilesOf(response());
    const link = (key: string) => tiles.find((tile) => tile.key === key)?.link;

    expect(link('entries')).toEqual(['/', 'harvest', 'review', 'products']);
    expect(link('shops')).toEqual(['/', 'harvest', 'review', 'shops']);
    expect(link('places')).toEqual(['/', 'harvest', 'review', 'places']);
    expect(tiles.find((tile) => tile.key === 'entries')?.query).toBeNull();
  });

  it('sends the stale prices to the products, wherever they are mounted', () => {
    const tile = tilesOf(response()).find((entry) => entry.key === 'stale');

    expect(tile?.value).toBe(61);
    expect(tile?.link).toEqual(['/', 'catalog', 'items']);
  });

  /**
   * A tile whose screen this app did not mount keeps its number and loses its
   * link, rather than pointing at a URL that answers the not found page.
   */
  it('draws an unlinked tile where the screen is not mounted', () => {
    const stale = tilesOf(response(), nothing).find(
      (tile) => tile.key === 'stale'
    );

    expect(stale?.value).toBe(61);
    expect(stale?.link).toBeNull();
  });

  /** Admin plan 0046, target 5: the table is the second tab of Admins. */
  it('opens the failed sign ins of Admins', () => {
    const tile = tilesOf(
      response({
        identity: identity({
          loginFailures: { last24h: 3, last7d: 5, recent: [] },
        }),
      })
    ).find((entry) => entry.key === 'loginFailures');

    expect(tile?.value).toBe(3);
    expect(tile?.tone).toBe('attention');
    expect(tile?.link).toEqual(['/', 'admins', 'failed-sign-ins']);
  });

  /** The postal codes are read beside the document and take their place in the row. */
  it('puts the postal codes between the join requests and the prices', () => {
    const postalCodes = {
      key: 'postalCodes',
      label: 'postal',
      value: 4,
      caption: null,
      delta: null,
      trend: null,
      link: null,
      query: null,
      tone: 'attention' as const,
    };
    const keys = waitingTiles(
      response(),
      postalCodes,
      translate,
      nameChain,
      pathOf,
      failedSignIns
    ).map((tile) => tile.key);

    expect(keys).toEqual([
      'entries',
      'shops',
      'places',
      'memberships',
      'postalCodes',
      'stale',
      'loginFailures',
    ]);
  });

  /**
   * "The harvester did not answer" and "nothing is waiting" must never look the
   * same, so a block that did not answer contributes no tile at all.
   */
  it('contributes nothing for a block that did not answer', () => {
    expect(
      tilesOf(response({ harvest: null, core: null })).map((tile) => tile.key)
    ).toEqual(['stale', 'loginFailures']);
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

  /** The feed is a list of sentences: who did what (admin plan 0046, target 3). */
  it('says who did what as one line', () => {
    const [row] = activityRows([entry()], translate, since, instant, pathOf);

    expect(row.line).toBe(
      `dashboard.activity.line(who=Ichiroku,what=${row.what})`
    );
    expect(row.when).toBe('a moment ago');
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
