import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { HARVEST_RUN_SEED } from '../harvest/harvest-seed';
import type { DashboardDocument } from './dashboard-service';

/**
 * What the dashboard draws with nothing listening (admin plan 0016, section 1).
 *
 * **Deterministic**, and that is a requirement rather than a nicety: a
 * screenshot of this dashboard is what the pull request shows, and specs assert
 * counts against it. A seed built from `Date.now()` would produce a different
 * screen on every run and a spec that could only say a number was a number.
 *
 * Built to exercise the states the screen exists for rather than to look tidy. A
 * run in flight, so the progress bar and the faster poll are drawn at all. Two
 * chains with rows in the product queue and a third with none, so both the tile
 * and its absence are visible. Join requests waiting, so a tile is in the
 * attention tone. Failed admin sign ins in the last day, so the one number an
 * operator hopes is zero is not always zero here.
 */

/** The instant the seeded numbers were taken. Fixed, so a spec can name it. */
export const SEED_MEASURED_AT = '2026-09-03T10:00:00.000Z';

/**
 * The window, thirty days inclusive, ending on the day the numbers were taken.
 *
 * Stated rather than computed from the clock, for the same reason as the instant
 * above. It is the window the gateway would have computed on that day.
 */
export const SEED_WINDOW: Wire.AdminDashboardAdminDashboardWindow = {
  from: '2026-08-05',
  to: '2026-09-03',
};

/**
 * The chains the seeded queues are about.
 *
 * The same three ids `HARVEST_RUN_SEED` uses, so the dashboard and the harvester
 * screens describe one harvester rather than two.
 */
const MERCADONA = '11111111-1111-4111-8111-111111111111';
const CARREFOUR = '22222222-2222-4222-8222-222222222222';
const DEZA = '33333333-3333-4333-8333-333333333333';

/** The operator most of the seeded trail is attributed to. */
const OPERATOR = 'admin-1';
/** The harvester's own actor id, which the feed names as a service. */
const HARVESTER_ACTOR = '99999999-9999-4999-8999-999999999999';

/** Every day in the window, oldest first, as the gateway sends them. */
const DAYS: readonly string[] = buildDays(SEED_WINDOW.from, 30);

/**
 * A daily series with a weekday rhythm and one spike.
 *
 * A flat series draws a straight line, which says nothing about whether a chart
 * reads well; a real month is busier on weekdays and has one day somebody linked
 * to it. `spike` is the index of that day, so the shape is the same every run.
 */
function series(
  weekday: number,
  weekend: number,
  spike: { readonly at: number; readonly count: number }
): Wire.AdminDashboardDailyCount[] {
  return DAYS.map((day, index) => {
    if (index === spike.at) {
      return { day, count: spike.count };
    }
    const isWeekend = [0, 6].includes(dayOfWeek(day));
    // A small deterministic wobble, so the line is not a comb of two values.
    const wobble = index % 3;
    return { day, count: (isWeekend ? weekend : weekday) + wobble };
  });
}

/** A series that is zero for the whole window, which is a real answer. */
function silent(): Wire.AdminDashboardDailyCount[] {
  return DAYS.map((day) => ({ day, count: 0 }));
}

const IDENTITY: Wire.AdminDashboardAdminIdentityDashboard = {
  users: { total: 1284, registered: 947, temporary: 337, verified: 812 },
  signUps: series(7, 3, { at: 20, count: 34 }),
  admins: { total: 4, disabled: 1 },
  loginFailures: {
    // The number an operator hopes is zero. It is not, here, because a tile
    // that is only ever drawn as zero is a tile nobody has seen work.
    last24h: 2,
    last7d: 5,
    recent: [
      { at: '2026-09-03T08:14:00.000Z', username: 'admin', ip: '203.0.113.44' },
      { at: '2026-09-03T08:13:41.000Z', username: 'admin', ip: '203.0.113.44' },
      {
        at: '2026-08-31T22:07:12.000Z',
        username: 'root',
        // An `ip` the proxy did not pass through, which is a real row and the
        // one that would break a table that assumed a string.
        ip: null,
      },
      {
        at: '2026-08-30T03:41:55.000Z',
        username: 'ichiroku',
        ip: '198.51.100.9',
      },
      { at: '2026-08-29T19:02:03.000Z', username: 'admin', ip: '198.51.100.9' },
    ],
  },
  activity: [],
};

const CORE: Wire.AdminDashboardAdminCoreDashboard = {
  zones: { total: 218, active: 205, markedForDeletion: 13 },
  // Work waiting, which is what the screen draws it as.
  memberships: { pending: 3 },
  lists: { total: 512 },
  baskets: { total: 1046, draft: 87, completed: 951 },
  zonesCreated: series(3, 1, { at: 20, count: 11 }),
  listsCreated: series(9, 4, { at: 20, count: 26 }),
  activity: [],
};

const CATALOG: Wire.AdminDashboardAdminCatalogDashboard = {
  supermarkets: 3,
  locations: 412,
  items: 4232,
  productGroups: 318,
  supermarketItems: { total: 8940, priced: 8117, stale: 623, unavailable: 204 },
  // Every kind in enum order, including the three that wrote nothing this
  // month. The chart leaves an all zero kind out of the drawing and keeps its
  // colour for the month it comes back (admin plan 0015, section 2).
  pricesWritten: [
    {
      sourceKind: 'OFFICIAL_API',
      points: series(210, 40, { at: 12, count: 4383 }),
    },
    {
      sourceKind: 'OFFICIAL_WEB',
      points: series(60, 12, { at: 26, count: 900 }),
    },
    {
      sourceKind: 'OFFICIAL_LEAFLET',
      points: series(0, 0, { at: 7, count: 214 }),
    },
    { sourceKind: 'ADMIN', points: series(2, 0, { at: 22, count: 9 }) },
    { sourceKind: 'USER_RECEIPT', points: silent() },
    { sourceKind: 'USER_REPORTED', points: silent() },
  ],
  activity: [],
};

const HARVEST: Wire.AdminDashboardAdminHarvestDashboard = {
  runs: {
    // Every status in enum order, so the bar chart's categories never depend on
    // what happened this month.
    byStatus: [
      { status: 'PENDING', count: 0 },
      { status: 'RUNNING', count: 1 },
      { status: 'COMPLETED', count: 34 },
      { status: 'FAILED', count: 6 },
      { status: 'ABORTED', count: 2 },
      { status: 'STALE', count: 1 },
    ],
    inWindow: 14,
  },
  running: HARVEST_RUN_SEED.find((run) => run.status === 'RUNNING') ?? null,
  recent: HARVEST_RUN_SEED.slice(0, 5),
  queues: {
    // Two chains with rows and one with none, so the screen's "a chain with
    // nothing waiting draws no tile" is visible rather than asserted only.
    entries: [
      { supermarketId: MERCADONA, candidate: 18, unresolved: 42 },
      { supermarketId: CARREFOUR, candidate: 0, unresolved: 0 },
      { supermarketId: DEZA, candidate: 6, unresolved: 0 },
    ],
    places: 7,
    shops: [
      { supermarketId: MERCADONA, unmapped: 4 },
      { supermarketId: CARREFOUR, unmapped: 0 },
      { supermarketId: DEZA, unmapped: 0 },
    ],
  },
  sources: { total: 4, enabled: 3 },
};

/**
 * The three trails merged, newest first, with the actors already named.
 *
 * Twenty rows, which is what the gateway keeps. A `SERVICE` row is the harvester
 * writing into catalog through `CatalogClient`, which is most of what a walk
 * leaves behind, so the feed is mostly the service on a day a run happened. Some
 * entities have a screen and some do not, which is what makes the two halves of
 * `activityTarget` visible on the seeded screen.
 */
const ACTIVITY: Wire.AdminDashboardAdminDashboardActivityEntry[] = [
  entry(0, 'ADMIN', OPERATOR, 'Ichiroku', 'items', 'item-8841', 'UPDATE'),
  entry(
    4,
    'SERVICE',
    HARVESTER_ACTOR,
    'harvester',
    'item_prices',
    'price-91',
    'CREATE'
  ),
  entry(
    9,
    'SERVICE',
    HARVESTER_ACTOR,
    'harvester',
    'item_prices',
    'price-90',
    'CREATE'
  ),
  entry(
    14,
    'SERVICE',
    HARVESTER_ACTOR,
    'harvester',
    'supermarket_items',
    'si-4410',
    'UPDATE'
  ),
  entry(21, 'ADMIN', OPERATOR, 'Ichiroku', 'zones', 'zone-14', 'UPDATE'),
  entry(33, 'ADMIN', 'admin-2', 'Marta', 'users', 'user-208', 'UPDATE'),
  entry(
    48,
    'SERVICE',
    HARVESTER_ACTOR,
    'harvester',
    'items',
    'item-8840',
    'CREATE'
  ),
  entry(63, 'ADMIN', OPERATOR, 'Ichiroku', 'item_prices', 'price-88', 'DELETE'),
  entry(
    77,
    'ADMIN',
    'admin-2',
    'Marta',
    'zone_memberships',
    'member-77',
    'UPDATE'
  ),
  entry(
    95,
    'ADMIN',
    OPERATOR,
    'Ichiroku',
    'shopping_lists',
    'list-311',
    'UPDATE'
  ),
  entry(
    120,
    'SERVICE',
    HARVESTER_ACTOR,
    'harvester',
    'item_prices',
    'price-87',
    'CREATE'
  ),
  entry(150, 'ADMIN', 'admin-3', 'admin-3', 'users', 'user-207', 'DELETE'),
  entry(181, 'ADMIN', OPERATOR, 'Ichiroku', 'items', 'item-8802', 'UPDATE'),
  entry(
    219,
    'SERVICE',
    HARVESTER_ACTOR,
    'harvester',
    'supermarket_items',
    'si-4409',
    'UPDATE'
  ),
  entry(260, 'ADMIN', OPERATOR, 'Ichiroku', 'zones', 'zone-9', 'DELETE'),
  entry(305, 'ADMIN', 'admin-2', 'Marta', 'list_lines', 'line-902', 'UPDATE'),
  entry(
    361,
    'SERVICE',
    HARVESTER_ACTOR,
    'harvester',
    'items',
    'item-8799',
    'CREATE'
  ),
  entry(
    420,
    'ADMIN',
    OPERATOR,
    'Ichiroku',
    'shopping_lists',
    'list-310',
    'CREATE'
  ),
  entry(
    499,
    'ADMIN',
    OPERATOR,
    'Ichiroku',
    'item_prices',
    'price-84',
    'CREATE'
  ),
  entry(600, 'ADMIN', 'admin-2', 'Marta', 'zones', 'zone-8', 'CREATE'),
];

export const DASHBOARD_SEED: DashboardDocument = {
  window: SEED_WINDOW,
  identity: IDENTITY,
  core: CORE,
  catalog: CATALOG,
  harvest: HARVEST,
  activity: ACTIVITY,
  measuredAt: SEED_MEASURED_AT,
};

/**
 * A document with a block missing, for the case that block did not answer.
 *
 * Not used by the memory service, which answers a complete document. It is here
 * so a spec and a hand check have one way of producing the state rather than
 * two, and so the screen's four notices can be seen without stopping a service.
 */
export function dashboardSeedWithout(
  ...blocks: readonly ('identity' | 'core' | 'catalog' | 'harvest')[]
): DashboardDocument {
  return blocks.reduce<DashboardDocument>(
    (document, block) => ({ ...document, [block]: null }),
    DASHBOARD_SEED
  );
}

/** One feed row, `minutes` before the instant the numbers were taken. */
function entry(
  minutes: number,
  actorKind: 'ADMIN' | 'SERVICE',
  actorId: string,
  actorName: string,
  entity: string,
  entityId: string,
  action: 'CREATE' | 'UPDATE' | 'DELETE'
): Wire.AdminDashboardAdminDashboardActivityEntry {
  const at = new Date(
    Date.parse(SEED_MEASURED_AT) - minutes * 60_000
  ).toISOString();

  return { at, actorKind, actorId, actorName, entity, entityId, action };
}

/** `count` consecutive days as `YYYY-MM-DD`, starting at `from`, in UTC. */
function buildDays(from: string, count: number): string[] {
  const start = Date.parse(`${from}T00:00:00.000Z`);

  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10)
  );
}

/** Sunday is 0, as `Date` counts, read in UTC so the seed is not the reader's. */
function dayOfWeek(day: string): number {
  return new Date(`${day}T00:00:00.000Z`).getUTCDay();
}
