import type { PriceSourceKind } from '../enums/catalog.enums';
import type { HarvestRunStatus } from '../enums/harvest.enums';
import type { AdminCredential } from './admin-auth.messages';
import type { HarvestRunView } from './harvest.messages';

/**
 * What the back office opens to (plan 0088).
 *
 * One HTTP route, `GET /v1/admin/dashboard`, composed from four subjects. Each
 * service answers a question about its own database: nothing is joined across
 * two of them and nothing here is written. The gateway fans out in parallel and
 * a block that did not answer arrives as `null`, so one stopped service costs
 * its own block and nothing else.
 *
 * Every subject is gated. Each handler verifies the forwarded operator token
 * before it counts anything, because a dashboard that skipped the check would be
 * the one unauthenticated read of the user directory in the API.
 */
export const ADMIN_DASHBOARD_PATTERNS = {
  /** Answered by auth: users, admins, failed operator logins, its own trail. */
  identity: 'admin.dashboard.identity',
  /** Answered by core: zones, memberships, lists, baskets, its own trail. */
  core: 'admin.dashboard.core',
  /** Answered by catalog: the catalog totals, prices written, its own trail. */
  catalog: 'admin.dashboard.catalog',
  /** Answered by the harvester: runs, the run in flight, the per chain queues. */
  harvest: 'admin.dashboard.harvest',
} as const;

export type AdminDashboardPattern =
  (typeof ADMIN_DASHBOARD_PATTERNS)[keyof typeof ADMIN_DASHBOARD_PATTERNS];

/**
 * The days a daily series covers, stated by the gateway (plan 0088, section 2).
 *
 * Four services bucketing "the last thirty days" for themselves disagree about
 * where a day starts the moment one clock is a second behind another, so the
 * gateway names the window once and every service fills the same one.
 */
export interface AdminDashboardWindow {
  /** The first day in the series, as `YYYY-MM-DD`, UTC. */
  from: string;
  /** The last day in the series, as `YYYY-MM-DD`, UTC. Today. */
  to: string;
}

/** What every dashboard subject takes: the operator's credential, plus the window. */
export interface AdminDashboardRequest extends AdminCredential {
  window: AdminDashboardWindow;
}

/**
 * One day of a series.
 *
 * **Every day in the window is present, in order, oldest first, with zero where
 * nothing happened.** A series with a hole is a chart that has to invent the
 * gap, and a chart that invents a gap draws a line across it as though the count
 * had been interpolated.
 */
export interface DailyCount {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  count: number;
}

/**
 * One change an operator or a service made, as the three audit tables record it
 * (plan 0088, section 4).
 *
 * `before` and `after` are deliberately not sent. They are the changed fields as
 * `jsonb`, they are what a person investigating one change reads, and a feed of
 * twenty of them is a screen nobody asked for. A row here says who changed which
 * row of which table, and when.
 */
export interface AdminActivityEntry {
  at: string;
  actorKind: 'ADMIN' | 'SERVICE';
  actorId: string;
  /** The table, as the audit row names it: `zones`, `item_prices`, `users`. */
  entity: string;
  entityId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
}

/**
 * The same row with its actor named, which the gateway does once for the whole
 * merged feed out of `adminAuth.listAdmins`.
 *
 * `actorName` is the admin's display name, else the username, else the id
 * itself, which is plan 0074 section 3's rule for a name the directory cannot
 * resolve. A `SERVICE` actor keeps its id, and the screen names the service from
 * it: the ids are provisioned per cluster and the app knows the harvester's.
 */
export interface AdminDashboardActivityEntry extends AdminActivityEntry {
  actorName: string;
}

/** One failed attempt to log in as an operator, as the dashboard shows it. */
export interface AdminLoginFailureView {
  at: string;
  username: string;
  ip: string | null;
}

/**
 * Auth's block (plan 0088, section 3.1).
 *
 * `userAgent` is stored on the row and deliberately not sent: it is 512
 * characters that tell an operator reading a tile nothing, and the row that
 * needs it is read from the database by the person investigating it.
 */
export interface AdminIdentityDashboard {
  users: {
    total: number;
    registered: number;
    temporary: number;
    /** `kind = REGISTERED` and `emailVerifiedAt` set. */
    verified: number;
  };
  /** Registered users created per day, over the window. */
  signUps: DailyCount[];
  admins: {
    total: number;
    disabled: number;
  };
  loginFailures: {
    /** Rows of `admin_login_failures` in the last twenty four hours, measured from now. */
    last24h: number;
    /** The same over seven days. */
    last7d: number;
    /** The newest rows, newest first, at most ten. */
    recent: AdminLoginFailureView[];
  };
  activity: AdminActivityEntry[];
}

/**
 * Core's block (plan 0088, section 3.2).
 *
 * `baskets` are `generated_lists`. `draft` and `completed` are the two statuses
 * a basket is ever in, since `ACTIVE` is never written and the live basket is
 * `DRAFT`, and their sum falls short of `total` only when an `ARCHIVED` row
 * exists, which is why `total` is sent rather than derived.
 */
export interface AdminCoreDashboard {
  zones: {
    total: number;
    active: number;
    markedForDeletion: number;
  };
  memberships: {
    /** `status = PENDING`: join requests nobody has answered. */
    pending: number;
  };
  lists: {
    total: number;
  };
  baskets: {
    total: number;
    draft: number;
    completed: number;
  };
  zonesCreated: DailyCount[];
  listsCreated: DailyCount[];
  activity: AdminActivityEntry[];
}

/** One source kind's series of prices first observed per day. */
export interface AdminPricesWrittenSeries {
  sourceKind: PriceSourceKind;
  points: DailyCount[];
}

/**
 * Catalog's block (plan 0088, section 3.3).
 *
 * `pricesWritten` counts by `observedAt`, the first observation, never by
 * `lastObservedAt`. A walk that confirms four thousand unchanged prices touches
 * `lastObservedAt` on four thousand rows and writes nothing new, and this chart
 * is about what was written. The confirmations are counters on the run itself,
 * in the harvest block.
 */
export interface AdminCatalogDashboard {
  supermarkets: number;
  locations: number;
  items: number;
  productGroups: number;
  supermarketItems: {
    total: number;
    /** `price` is not null. */
    priced: number;
    /** `stale` is true. */
    stale: number;
    /** `available` is false. */
    unavailable: number;
  };
  /**
   * `item_prices` rows first observed per day, one series per source kind.
   * Every kind in `PriceSourceKind` is present, in enum order, with a full
   * window of days each, so the chart's series count and colour order never
   * depend on what happened this month.
   */
  pricesWritten: AdminPricesWrittenSeries[];
  activity: AdminActivityEntry[];
}

/** How many runs ended each way, over all time. */
export interface AdminHarvestRunStatusCount {
  status: HarvestRunStatus;
  count: number;
}

/** One chain's product queue: what a run proposed, and what it could not. */
export interface AdminHarvestQueueEntry {
  supermarketId: string;
  candidate: number;
  unresolved: number;
}

/** One chain's shop queue: places a run saw and nobody has mapped. */
export interface AdminHarvestShopQueue {
  supermarketId: string;
  unmapped: number;
}

/**
 * The harvester's block (plan 0088, section 3.4).
 *
 * The queues are per chain because the queue screens are per chain: a source
 * catalog entry is keyed on (`supermarketId`, `externalId`) and there is no
 * screen over every chain's rows, so a count summed over the chains would link
 * nowhere. The chain is named by id and the screen resolves the name through the
 * supermarket reference it already holds.
 *
 * There is no activity feed here. The harvester has no audit table: what it
 * changes, it changes in catalog through `CatalogClient`, attributed to the
 * service actor, and those rows are in catalog's trail.
 */
export interface AdminHarvestDashboard {
  runs: {
    /** Every status in `HarvestRunStatus`, in enum order, over all time. */
    byStatus: AdminHarvestRunStatusCount[];
    /** Runs requested inside the window. */
    inWindow: number;
  };
  /** The run in flight: `RUNNING`, else `PENDING`, the most recently requested. Null when none. */
  running: HarvestRunView | null;
  /** The most recently requested runs, newest first, at most five, whatever their status. */
  recent: HarvestRunView[];
  queues: {
    /** Per chain, every chain with a `supermarket_sources` row, in `supermarketId` order. */
    entries: AdminHarvestQueueEntry[];
    /** `discovered_places` with `status = NEW`. */
    places: number;
    /** Per chain, as `entries`. `source_locations` with `status = UNMAPPED`. */
    shops: AdminHarvestShopQueue[];
  };
  sources: {
    total: number;
    enabled: number;
  };
}

/**
 * What `GET /v1/admin/dashboard` answers (plan 0088, section 5).
 *
 * A block is `null` when its service did not answer, and the response is still
 * 200: the screen draws the three blocks it got and says which one it did not,
 * which beats a 502 for the whole page because one service is restarting. The
 * screen has to be able to tell "did not answer" from "answered zero", which is
 * what `null` is for, so no handler ever answers `null` for a count.
 *
 * Not cached, unlike the public `GET /v1/stats`: there is one operator behind a
 * bearer token rather than a thousand anonymous visitors. `measuredAt` is on the
 * response anyway, so an operator reading a tab they opened yesterday is not
 * reading it as now.
 */
export interface AdminDashboardResponse {
  window: AdminDashboardWindow;
  identity: AdminIdentityDashboard | null;
  core: AdminCoreDashboard | null;
  catalog: AdminCatalogDashboard | null;
  harvest: AdminHarvestDashboard | null;
  /** The three trails merged, newest first, at most twenty, actors named. */
  activity: AdminDashboardActivityEntry[];
  measuredAt: string;
}

/** How many rows of one trail a service answers with (plan 0088, section 4). */
export const ADMIN_DASHBOARD_ACTIVITY_LIMIT = 10;

/** How many merged rows the response carries. */
export const ADMIN_DASHBOARD_FEED_LIMIT = 20;

/** How many finished runs the harvest block names beside the one in flight. */
export const ADMIN_DASHBOARD_RECENT_RUN_LIMIT = 5;

/** How many failed operator logins the identity block names. */
export const ADMIN_DASHBOARD_LOGIN_FAILURE_LIMIT = 10;

/** How many days a daily series covers, inclusive of both ends. */
export const ADMIN_DASHBOARD_WINDOW_DAYS = 30;
