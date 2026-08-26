import { STATS_PATTERNS } from '../../lib/messages/stats.messages';
import { integer, JsonSchema, object, schemaId } from '../builders';

/**
 * Platform totals (plan 0017, section 8). Each subject takes no argument, so both
 * share one empty request schema: `additionalProperties: false` over no
 * properties, which rejects a caller that invents a filter rather than silently
 * ignoring it.
 */
export const STATS_SCHEMA_IDS = {
  request: schemaId('msg/stats/request'),
  identityStats: schemaId('stats/IdentityStats'),
  coreStats: schemaId('stats/CoreStats'),
} as const;

const statsRequest = object(STATS_SCHEMA_IDS.request, {}, []);

const identityStats = object(
  STATS_SCHEMA_IDS.identityStats,
  {
    users: integer({ minimum: 0 }),
    registeredUsers: integer({ minimum: 0 }),
    temporaryUsers: integer({ minimum: 0 }),
  },
  ['users', 'registeredUsers', 'temporaryUsers']
);

const coreStats = object(
  STATS_SCHEMA_IDS.coreStats,
  {
    zones: integer({ minimum: 0 }),
    activeZones: integer({ minimum: 0 }),
  },
  ['zones', 'activeZones']
);

export const statsSchemas: JsonSchema[] = [
  statsRequest,
  identityStats,
  coreStats,
];

export const statsMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [STATS_PATTERNS.identity]: {
    request: STATS_SCHEMA_IDS.request,
    response: STATS_SCHEMA_IDS.identityStats,
  },
  [STATS_PATTERNS.core]: {
    request: STATS_SCHEMA_IDS.request,
    response: STATS_SCHEMA_IDS.coreStats,
  },
};
