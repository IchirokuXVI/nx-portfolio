import { HARVEST_SEGMENT } from '@portfolio/luna-shopper-admin/feature-harvest';
import {
  activityTarget,
  failureBlockReason,
  weekDelta,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import type {
  ChartBar,
  ChartDelta,
  ChartSeries,
  ChartSeriesInfo,
  RunRow,
} from '@portfolio/luna-shopper-admin/ui';

/**
 * The document turned into what the components take (admin plan 0016).
 *
 * Every function here is pure and takes its strings through `translate`, so the
 * screen is a template over these and a spec can assert a tile's count and a
 * chart's series without rendering anything. That is also what keeps the rule
 * about assertions: the numbers are on a view model, never only in interpolated
 * text the testing translator does not fill in.
 */

/** How a key becomes a sentence. The page hands the translator's `t` through. */
export type Translate = (
  key: string,
  values?: Record<string, unknown>
) => string;

/** A chain's name, or its id when the reference cannot name it (plan 0007, 4). */
export type NameChain = (supermarketId: string) => string;

/** One headline number, as `lib-stat-tile` takes it plus the caption beneath. */
export interface TileView {
  /** Stable across renders: what `@for` tracks. */
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** A line under the tile, already translated. */
  readonly caption: string | null;
  readonly delta: ChartDelta | null;
  readonly trend: readonly number[] | null;
  readonly link: readonly string[] | null;
  /**
   * Query parameters the link carries, for the one screen that reads one.
   *
   * On the tile rather than in a lookup beside it, because a tile is a value and
   * a lookup keyed on a tile's name would be a module level map two callers
   * could disagree about.
   */
  readonly query: Readonly<Record<string, string>> | null;
  readonly tone: 'quiet' | 'attention';
}

/** One row of the sign in failure table. */
export interface FailureRow {
  readonly key: string;
  readonly when: string;
  readonly username: string;
  /** The address, or the word for a request that carried none. */
  readonly ip: string;
}

/** One row of the activity feed. */
export interface ActivityRow {
  readonly key: string;
  /** How long ago, as words. */
  readonly when: string;
  /** The clock time, for the `title`. */
  readonly at: string;
  /** The admin's name, or the service's. */
  readonly who: string;
  /** The action and the table, as one sentence. */
  readonly what: string;
  /** Where the row opens, or `null` where this app has no screen for it. */
  readonly link: readonly string[] | null;
}

/** A bar chart's two inputs, which are always built together. */
export interface BarChartView {
  readonly bars: readonly ChartBar[];
  readonly series: readonly ChartSeriesInfo[];
}

/**
 * The tables a feed row can name and what one of their rows is called.
 *
 * A table missing from here is named by the audit row's own word for it, which
 * is a table name in front of an operator and is honest: this app does not know
 * what that row is, and inventing a noun for it would be worse than saying the
 * table.
 */
const ENTITY_KEYS: Readonly<Record<string, string | undefined>> = {
  zones: 'dashboard.activity.entity.zones',
  shopping_lists: 'dashboard.activity.entity.shopping_lists',
  users: 'dashboard.activity.entity.users',
  items: 'dashboard.activity.entity.items',
  item_prices: 'dashboard.activity.entity.item_prices',
  supermarket_items: 'dashboard.activity.entity.supermarket_items',
  list_lines: 'dashboard.activity.entity.list_lines',
  zone_memberships: 'dashboard.activity.entity.zone_memberships',
};

/** The six price source kinds, in the order that fixes their chart colours. */
const PRICE_SOURCE_KINDS: readonly Wire.EnumsPriceSourceKind[] = [
  'OFFICIAL_API',
  'OFFICIAL_WEB',
  'OFFICIAL_LEAFLET',
  'ADMIN',
  'USER_RECEIPT',
  'USER_REPORTED',
];

/** Every harvest run status, in the order that fixes the bar chart's categories. */
const RUN_STATUSES: readonly Wire.EnumsHarvestRunStatus[] = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'ABORTED',
  'STALE',
];

/**
 * What is waiting for a decision, as tiles that link to where it is made.
 *
 * A tile is in the attention tone whenever its count is above zero, because a
 * queue with rows in it is the reason this screen is the first thing an operator
 * sees. A chain with nothing waiting in a queue draws **no tile** for that
 * queue: a row of zeros reads as noise, and the reader is looking for the one
 * that is not zero.
 *
 * A block that did not answer contributes nothing here, and the screen draws its
 * notice in place of the tiles rather than an empty row. "The harvester did not
 * answer" and "nothing is waiting" are different sentences and must never look
 * the same.
 */
export function waitingTiles(
  document: Wire.AdminAdminDashboardResponse,
  translate: Translate,
  nameChain: NameChain
): TileView[] {
  const tiles: TileView[] = [];
  const core = document.core;
  const harvest = document.harvest;
  const catalog = document.catalog;
  const identity = document.identity;

  if (core !== null) {
    tiles.push(
      waiting(
        'memberships',
        translate('dashboard.waiting.joinRequests'),
        core.memberships.pending,
        ['/', 'zones']
      )
    );
  }

  if (harvest !== null) {
    for (const queue of harvest.queues.entries) {
      const count = queue.candidate + queue.unresolved;
      if (count > 0) {
        tiles.push(
          waiting(
            `entries-${queue.supermarketId}`,
            translate('dashboard.waiting.entries', {
              chain: nameChain(queue.supermarketId),
            }),
            count,
            // The one queue that reads a chain from the query string, so this
            // link opens it already on the chain (admin plan 0014). The others
            // do not, so their tiles open the unfiltered screen.
            ['/', HARVEST_SEGMENT, 'entries'],
            { supermarketId: queue.supermarketId }
          )
        );
      }
    }

    for (const queue of harvest.queues.shops) {
      if (queue.unmapped > 0) {
        tiles.push(
          waiting(
            `shops-${queue.supermarketId}`,
            translate('dashboard.waiting.shops', {
              chain: nameChain(queue.supermarketId),
            }),
            queue.unmapped,
            ['/', HARVEST_SEGMENT, 'shops']
          )
        );
      }
    }

    tiles.push(
      waiting(
        'places',
        translate('dashboard.waiting.places'),
        harvest.queues.places,
        ['/', HARVEST_SEGMENT, 'places']
      )
    );
  }

  if (catalog !== null) {
    tiles.push(
      waiting(
        'stale',
        translate('dashboard.waiting.stalePrices'),
        catalog.supermarketItems.stale,
        ['/', 'prices']
      )
    );
  }

  if (identity !== null) {
    tiles.push(
      // No link: the rows are further down this same page, so sending the
      // operator somewhere else to read five of them would be a worse answer.
      waiting(
        'loginFailures',
        translate('dashboard.waiting.loginFailures'),
        identity.loginFailures.last24h,
        null
      )
    );
  }

  return tiles;
}

function waiting(
  key: string,
  label: string,
  count: number,
  link: readonly string[] | null,
  query: Readonly<Record<string, string>> | null = null
): TileView {
  return {
    key,
    label,
    value: count,
    caption: null,
    delta: null,
    trend: null,
    link,
    query,
    // Above zero is work, and work is what an operator opened this to find.
    tone: count > 0 ? 'attention' : 'quiet',
  };
}

/**
 * The last five runs, as the runs list draws them.
 *
 * The same `RunRow` the runs screen builds, so the two screens draw one row
 * rather than two that drift. The instants are formatted by the caller, which is
 * what keeps `Intl` out of a template.
 */
export function recentRunRows(
  runs: readonly Wire.HarvestHarvestRunView[],
  formatInstant: (value: string | null) => string
): RunRow[] {
  return runs.map((run) => ({
    id: run.id,
    mode: run.mode,
    status: run.status,
    requested: formatInstant(run.requestedAt),
    processed: run.processed,
    failed: run.failed,
    reverted: formatInstant(run.revertedAt),
    revertedBy: run.revertedByUserId ?? '',
    reasonKey: reasonKey(failureBlockReason(run)),
  }));
}

function reasonKey(reason: string | null): string | null {
  return reason === null ? null : `harvest.blocked.${reason}`;
}

/**
 * Runs by status, as one series over six categories.
 *
 * One series, so every bar is `--admin-chart-1`: colour by category would be
 * identity the x axis already carries, and six colours for six statuses say
 * nothing the labels do not (plan 0015, section 3.2).
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

/**
 * Prices written per day, one stacked series per source kind.
 *
 * **Colour is the kind's position in the enum, one to six, always.** A kind
 * whose thirty days are all zero is left out of the drawing and the legend and
 * keeps its number for the month it comes back, which is what stops a reader who
 * learned a colour last week being lied to (plan 0015, section 2).
 */
export function pricesWrittenChart(
  catalog: Wire.AdminDashboardAdminCatalogDashboard,
  translate: Translate
): BarChartView {
  const written = new Map(
    catalog.pricesWritten.map((entry) => [entry.sourceKind, entry.points])
  );

  const drawn = PRICE_SOURCE_KINDS.map((kind, index) => ({
    kind,
    colour: index + 1,
    points: written.get(kind) ?? [],
  })).filter((entry) => entry.points.some((point) => point.count > 0));

  const days = catalog.pricesWritten[0]?.points ?? [];

  return {
    series: drawn.map((entry) => ({
      key: entry.kind,
      label: translate(`catalog.priceSourceKind.${entry.kind}`),
      colour: entry.colour,
    })),
    bars: days.map((point, index) => ({
      key: point.day,
      label: point.day,
      values: drawn.map((entry) => entry.points[index]?.count ?? 0),
    })),
  };
}

/** Registered sign ups per day, as one line. */
export function signUpsChart(
  identity: Wire.AdminDashboardAdminIdentityDashboard,
  translate: Translate
): ChartSeries[] {
  return [
    {
      key: 'signUps',
      label: translate('dashboard.people.signUps'),
      colour: 1,
      points: toPoints(identity.signUps),
    },
  ];
}

/** Zones and lists created per day, as two lines on one chart. */
export function zonesAndListsChart(
  core: Wire.AdminDashboardAdminCoreDashboard,
  translate: Translate
): ChartSeries[] {
  return [
    {
      key: 'zones',
      label: translate('dashboard.people.zonesSeries'),
      colour: 1,
      points: toPoints(core.zonesCreated),
    },
    {
      key: 'lists',
      label: translate('dashboard.people.listsSeries'),
      colour: 2,
      points: toPoints(core.listsCreated),
    },
  ];
}

function toPoints(
  series: readonly Wire.AdminDashboardDailyCount[]
): { day: string; value: number }[] {
  return series.map((point) => ({ day: point.day, value: point.count }));
}

/**
 * The people tiles: who is here, and what they have made.
 *
 * Users carries the seven day delta and the sparkline, because it is the one
 * number on this screen whose direction is the question. The other three are
 * totals with a caption breaking them down.
 */
export function peopleTiles(
  identity: Wire.AdminDashboardAdminIdentityDashboard | null,
  core: Wire.AdminDashboardAdminCoreDashboard | null,
  translate: Translate
): TileView[] {
  const tiles: TileView[] = [];

  if (identity !== null) {
    tiles.push({
      key: 'users',
      label: translate('dashboard.people.users'),
      value: identity.users.total,
      caption: translate('dashboard.people.usersCaption', {
        registered: identity.users.registered,
        temporary: identity.users.temporary,
        verified: identity.users.verified,
      }),
      delta: {
        value: weekDelta(identity.signUps),
        caption: translate('dashboard.people.inLast7Days'),
      },
      trend: identity.signUps.map((point) => point.count),
      link: ['/', 'users'],
      query: null,
      tone: 'quiet',
    });
  }

  if (core !== null) {
    tiles.push(
      {
        key: 'zones',
        label: translate('dashboard.people.zones'),
        value: core.zones.total,
        caption: translate('dashboard.people.zonesCaption', {
          active: core.zones.active,
          total: core.zones.total,
        }),
        delta: null,
        trend: null,
        link: ['/', 'zones'],
        query: null,
        tone: 'quiet',
      },
      {
        key: 'lists',
        label: translate('dashboard.people.lists'),
        value: core.lists.total,
        caption: null,
        delta: null,
        trend: null,
        link: ['/', 'lists'],
        query: null,
        tone: 'quiet',
      },
      {
        key: 'baskets',
        label: translate('dashboard.people.baskets'),
        value: core.baskets.total,
        caption: translate('dashboard.people.basketsCaption', {
          draft: core.baskets.draft,
          completed: core.baskets.completed,
        }),
        delta: null,
        trend: null,
        // `shopping-lists` is the baskets screen's segment, which is the
        // gateway's own name for a generated list.
        link: ['/', 'shopping-lists'],
        query: null,
        tone: 'quiet',
      }
    );
  }

  return tiles;
}

/** How much of the catalog there is, and how much of it carries a price. */
export function catalogTiles(
  catalog: Wire.AdminDashboardAdminCatalogDashboard,
  translate: Translate
): TileView[] {
  return [
    tile(
      'supermarkets',
      'dashboard.catalog.supermarkets',
      catalog.supermarkets,
      ['/', 'supermarkets']
    ),
    tile('locations', 'dashboard.catalog.locations', catalog.locations, [
      '/',
      'locations',
    ]),
    tile('items', 'dashboard.catalog.items', catalog.items, ['/', 'items']),
    tile(
      'productGroups',
      'dashboard.catalog.productGroups',
      catalog.productGroups,
      ['/', 'product-groups']
    ),
    {
      key: 'supermarketItems',
      label: translate('dashboard.catalog.supermarketItems'),
      value: catalog.supermarketItems.total,
      caption: translate('dashboard.catalog.supermarketItemsCaption', {
        priced: catalog.supermarketItems.priced,
        stale: catalog.supermarketItems.stale,
        unavailable: catalog.supermarketItems.unavailable,
      }),
      delta: null,
      trend: null,
      link: ['/', 'prices'],
      query: null,
      tone: 'quiet',
    },
  ];

  function tile(
    key: string,
    label: string,
    value: number,
    link: readonly string[]
  ): TileView {
    return {
      key,
      label: translate(label),
      value,
      caption: null,
      delta: null,
      trend: null,
      link,
      query: null,
      tone: 'quiet',
    };
  }
}

/** The most recent failed admin sign ins, as a short table. */
export function loginFailureRows(
  identity: Wire.AdminDashboardAdminIdentityDashboard,
  translate: Translate,
  formatInstant: (value: string | null) => string
): FailureRow[] {
  return identity.loginFailures.recent.map((failure, index) => ({
    key: `${failure.at}-${index}`,
    when: formatInstant(failure.at),
    username: failure.username,
    // A proxy that did not pass the address through is a real row, and the
    // table says so rather than drawing an empty cell that reads as a bug.
    ip: failure.ip ?? translate('dashboard.signIns.noIp'),
  }));
}

/**
 * The three trails merged, as rows that open where this app has a screen.
 *
 * A `SERVICE` actor is named by this app rather than by the gateway: the ids are
 * provisioned per cluster and the harvester is the only service that writes, so
 * the row says "harvester" and the id stays out of it (backend plan 0088,
 * section 4).
 */
export function activityRows(
  entries: readonly Wire.AdminDashboardAdminDashboardActivityEntry[],
  translate: Translate,
  formatSince: (value: string) => string,
  formatInstant: (value: string | null) => string
): ActivityRow[] {
  return entries.map((entry, index) => ({
    key: `${entry.at}-${entry.entity}-${entry.entityId}-${index}`,
    when: formatSince(entry.at),
    at: formatInstant(entry.at),
    who:
      entry.actorKind === 'SERVICE'
        ? translate('dashboard.activity.service')
        : entry.actorName,
    what: translate('dashboard.activity.entry', {
      action: translate(`dashboard.activity.action.${entry.action}`),
      entity: entityLabel(entry.entity, translate),
    }),
    link: activityTarget(entry),
  }));
}

function entityLabel(entity: string, translate: Translate): string {
  const key = ENTITY_KEYS[entity];
  // The audit row's own word for the table, where this app has no noun for it.
  // A table name in front of an operator is honest; an invented noun is not.
  return key === undefined ? entity : translate(key);
}
