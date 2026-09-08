import { ADMIN_DASHBOARD_PATTERNS } from '../../lib/messages/admin-dashboard.messages';
import {
  array,
  integer,
  JsonSchema,
  nonEmptyString,
  nullableString,
  object,
  ref,
  schemaId,
  string,
} from '../builders';
import { adminCredentialProperties } from '../common.schemas';
import { CATALOG_SCHEMA_IDS } from './catalog.schemas';
import { HARVEST_SCHEMA_IDS } from './harvest.schemas';

/**
 * JSON Schemas for the four dashboard subjects (plan 0088).
 *
 * The four blocks are authored here, and the composition around them is not: no
 * broker message has the response's shape, because the gateway is what merges
 * four answers into one body. `hoistAdminDashboard()` in the gateway publishes
 * that composition to the OpenAPI document, referencing these four.
 *
 * Every count is `integer` with `minimum: 0`, so a service that answered a
 * negative or a float fails the contract rather than reaching a chart.
 */
export const ADMIN_DASHBOARD_SCHEMA_IDS = {
  window: schemaId('admin-dashboard/AdminDashboardWindow'),
  request: schemaId('msg/admin-dashboard/request'),
  dailyCount: schemaId('admin-dashboard/DailyCount'),
  activityEntry: schemaId('admin-dashboard/AdminActivityEntry'),
  dashboardActivityEntry: schemaId(
    'admin-dashboard/AdminDashboardActivityEntry'
  ),
  loginFailureView: schemaId('admin-dashboard/AdminLoginFailureView'),
  identityDashboard: schemaId('admin-dashboard/AdminIdentityDashboard'),
  coreDashboard: schemaId('admin-dashboard/AdminCoreDashboard'),
  pricesWrittenSeries: schemaId('admin-dashboard/AdminPricesWrittenSeries'),
  catalogDashboard: schemaId('admin-dashboard/AdminCatalogDashboard'),
  runStatusCount: schemaId('admin-dashboard/AdminHarvestRunStatusCount'),
  queueEntry: schemaId('admin-dashboard/AdminHarvestQueueEntry'),
  shopQueue: schemaId('admin-dashboard/AdminHarvestShopQueue'),
  harvestDashboard: schemaId('admin-dashboard/AdminHarvestDashboard'),
} as const;

const count = () => integer({ minimum: 0 });

const window = object(
  ADMIN_DASHBOARD_SCHEMA_IDS.window,
  {
    from: nonEmptyString({
      description: 'The first day in every series, as `YYYY-MM-DD`, UTC.',
    }),
    to: nonEmptyString({
      description: 'The last day in every series, as `YYYY-MM-DD`, UTC. Today.',
    }),
  },
  ['from', 'to']
);

const request = object(
  ADMIN_DASHBOARD_SCHEMA_IDS.request,
  {
    ...adminCredentialProperties,
    window: ref(ADMIN_DASHBOARD_SCHEMA_IDS.window),
  },
  ['userId', 'window']
);

const dailyCount = object(
  ADMIN_DASHBOARD_SCHEMA_IDS.dailyCount,
  { day: nonEmptyString(), count: count() },
  ['day', 'count']
);

const series = () => array(ref(ADMIN_DASHBOARD_SCHEMA_IDS.dailyCount));

const activityEntry = object(
  ADMIN_DASHBOARD_SCHEMA_IDS.activityEntry,
  {
    at: string({ format: 'date-time' }),
    actorKind: string({ enum: ['ADMIN', 'SERVICE'] }),
    actorId: nonEmptyString(),
    entity: nonEmptyString(),
    entityId: nonEmptyString(),
    action: string({ enum: ['CREATE', 'UPDATE', 'DELETE'] }),
  },
  ['at', 'actorKind', 'actorId', 'entity', 'entityId', 'action']
);

/**
 * The same row with the actor named. Not a subject's response: the gateway
 * builds it after merging the three trails, and it is here so the OpenAPI
 * composition has a schema to point at.
 */
const dashboardActivityEntry = object(
  ADMIN_DASHBOARD_SCHEMA_IDS.dashboardActivityEntry,
  {
    at: string({ format: 'date-time' }),
    actorKind: string({ enum: ['ADMIN', 'SERVICE'] }),
    actorId: nonEmptyString(),
    entity: nonEmptyString(),
    entityId: nonEmptyString(),
    action: string({ enum: ['CREATE', 'UPDATE', 'DELETE'] }),
    actorName: nonEmptyString({
      description:
        'The admin’s display name, else the username, else the id itself. A service actor keeps its id.',
    }),
  },
  ['at', 'actorKind', 'actorId', 'entity', 'entityId', 'action', 'actorName']
);

const loginFailureView = object(
  ADMIN_DASHBOARD_SCHEMA_IDS.loginFailureView,
  {
    at: string({ format: 'date-time' }),
    username: string(),
    ip: nullableString(),
  },
  ['at', 'username', 'ip']
);

const identityDashboard = object(
  ADMIN_DASHBOARD_SCHEMA_IDS.identityDashboard,
  {
    users: {
      type: 'object',
      additionalProperties: false,
      required: ['total', 'registered', 'temporary', 'verified'],
      properties: {
        total: count(),
        registered: count(),
        temporary: count(),
        verified: count(),
      },
    },
    signUps: series(),
    admins: {
      type: 'object',
      additionalProperties: false,
      required: ['total', 'disabled'],
      properties: { total: count(), disabled: count() },
    },
    loginFailures: {
      type: 'object',
      additionalProperties: false,
      required: ['last24h', 'last7d', 'recent'],
      properties: {
        last24h: count(),
        last7d: count(),
        recent: array(ref(ADMIN_DASHBOARD_SCHEMA_IDS.loginFailureView)),
      },
    },
    activity: array(ref(ADMIN_DASHBOARD_SCHEMA_IDS.activityEntry)),
  },
  ['users', 'signUps', 'admins', 'loginFailures', 'activity']
);

const coreDashboard = object(
  ADMIN_DASHBOARD_SCHEMA_IDS.coreDashboard,
  {
    zones: {
      type: 'object',
      additionalProperties: false,
      required: ['total', 'active', 'markedForDeletion'],
      properties: {
        total: count(),
        active: count(),
        markedForDeletion: count(),
      },
    },
    memberships: {
      type: 'object',
      additionalProperties: false,
      required: ['pending'],
      properties: { pending: count() },
    },
    lists: {
      type: 'object',
      additionalProperties: false,
      required: ['total'],
      properties: { total: count() },
    },
    baskets: {
      type: 'object',
      additionalProperties: false,
      required: ['total', 'draft', 'completed'],
      properties: { total: count(), draft: count(), completed: count() },
    },
    zonesCreated: series(),
    listsCreated: series(),
    activity: array(ref(ADMIN_DASHBOARD_SCHEMA_IDS.activityEntry)),
  },
  [
    'zones',
    'memberships',
    'lists',
    'baskets',
    'zonesCreated',
    'listsCreated',
    'activity',
  ]
);

const pricesWrittenSeries = object(
  ADMIN_DASHBOARD_SCHEMA_IDS.pricesWrittenSeries,
  {
    sourceKind: ref(CATALOG_SCHEMA_IDS.priceSourceKind),
    points: series(),
  },
  ['sourceKind', 'points']
);

const catalogDashboard = object(
  ADMIN_DASHBOARD_SCHEMA_IDS.catalogDashboard,
  {
    supermarkets: count(),
    locations: count(),
    items: count(),
    productGroups: count(),
    supermarketItems: {
      type: 'object',
      additionalProperties: false,
      required: ['total', 'priced', 'stale', 'unavailable'],
      properties: {
        total: count(),
        priced: count(),
        stale: count(),
        unavailable: count(),
      },
    },
    pricesWritten: array(ref(ADMIN_DASHBOARD_SCHEMA_IDS.pricesWrittenSeries)),
    activity: array(ref(ADMIN_DASHBOARD_SCHEMA_IDS.activityEntry)),
  },
  [
    'supermarkets',
    'locations',
    'items',
    'productGroups',
    'supermarketItems',
    'pricesWritten',
    'activity',
  ]
);

const runStatusCount = object(
  ADMIN_DASHBOARD_SCHEMA_IDS.runStatusCount,
  { status: ref(HARVEST_SCHEMA_IDS.harvestRunStatus), count: count() },
  ['status', 'count']
);

const queueEntry = object(
  ADMIN_DASHBOARD_SCHEMA_IDS.queueEntry,
  {
    supermarketId: nonEmptyString(),
    candidate: count(),
    unresolved: count(),
  },
  ['supermarketId', 'candidate', 'unresolved']
);

const shopQueue = object(
  ADMIN_DASHBOARD_SCHEMA_IDS.shopQueue,
  { supermarketId: nonEmptyString(), unmapped: count() },
  ['supermarketId', 'unmapped']
);

const harvestDashboard = object(
  ADMIN_DASHBOARD_SCHEMA_IDS.harvestDashboard,
  {
    runs: {
      type: 'object',
      additionalProperties: false,
      required: ['byStatus', 'inWindow'],
      properties: {
        byStatus: array(ref(ADMIN_DASHBOARD_SCHEMA_IDS.runStatusCount)),
        inWindow: count(),
      },
    },
    running: {
      anyOf: [ref(HARVEST_SCHEMA_IDS.harvestRunView), { type: 'null' }],
    },
    recent: array(ref(HARVEST_SCHEMA_IDS.harvestRunView)),
    queues: {
      type: 'object',
      additionalProperties: false,
      required: ['entries', 'places', 'shops'],
      properties: {
        entries: array(ref(ADMIN_DASHBOARD_SCHEMA_IDS.queueEntry)),
        places: count(),
        shops: array(ref(ADMIN_DASHBOARD_SCHEMA_IDS.shopQueue)),
      },
    },
    sources: {
      type: 'object',
      additionalProperties: false,
      required: ['total', 'enabled'],
      properties: { total: count(), enabled: count() },
    },
  },
  ['runs', 'running', 'recent', 'queues', 'sources']
);

export const adminDashboardSchemas: JsonSchema[] = [
  window,
  request,
  dailyCount,
  activityEntry,
  dashboardActivityEntry,
  loginFailureView,
  identityDashboard,
  coreDashboard,
  pricesWrittenSeries,
  catalogDashboard,
  runStatusCount,
  queueEntry,
  shopQueue,
  harvestDashboard,
];

export const adminDashboardMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [ADMIN_DASHBOARD_PATTERNS.identity]: {
    request: ADMIN_DASHBOARD_SCHEMA_IDS.request,
    response: ADMIN_DASHBOARD_SCHEMA_IDS.identityDashboard,
  },
  [ADMIN_DASHBOARD_PATTERNS.core]: {
    request: ADMIN_DASHBOARD_SCHEMA_IDS.request,
    response: ADMIN_DASHBOARD_SCHEMA_IDS.coreDashboard,
  },
  [ADMIN_DASHBOARD_PATTERNS.catalog]: {
    request: ADMIN_DASHBOARD_SCHEMA_IDS.request,
    response: ADMIN_DASHBOARD_SCHEMA_IDS.catalogDashboard,
  },
  [ADMIN_DASHBOARD_PATTERNS.harvest]: {
    request: ADMIN_DASHBOARD_SCHEMA_IDS.request,
    response: ADMIN_DASHBOARD_SCHEMA_IDS.harvestDashboard,
  },
};
