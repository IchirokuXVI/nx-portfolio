import { registerAs } from '@nestjs/config';
import { telemetryValidationSchema } from '@portfolio/luna-shopper/platform';
import * as Joi from 'joi';
import { readKey } from './read-key';

/**
 * Harvester configuration (plan 0038, section 4.1).
 *
 * Two switches decide whether this service does anything at all, and they are
 * both **off by default**:
 *
 * - `HARVEST_ENABLED` gates every run mode. With it false the service boots,
 *   answers its health probes and its read subjects, and refuses to spawn.
 * - `MERCADONA_ENABLED` gates the one third party storefront specifically, so
 *   the chain can be dropped without dropping the service (section 8.1). If
 *   Mercadona ever asks, this goes false and the catalog keeps working on hand
 *   entered prices, which is the property backlog 0001 section 5.4 designs for.
 *
 * Defaulting both to false is deliberate: a deploy that turns fetching on is a
 * decision someone makes, never something that happens because a pod started.
 */
export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

export const harvesterValidationSchema = Joi.object({
  PORT: Joi.number().port().default(3005),
  NATS_URL: Joi.string().required(),
  HARVESTER_DB_URL: Joi.string().required(),
  AUTH_JWT_PUBLIC_KEY: Joi.string(),
  AUTH_JWT_PUBLIC_KEY_FILE: Joi.string(),
  PLATFORM_ADMIN_USER_IDS: Joi.string().allow('').default(''),
  LOG_LEVEL: Joi.string()
    .valid(...LOG_LEVELS)
    .default('info'),

  /**
   * The uuid catalog knows this service by (backlog 0001, section 4.1). It is
   * listed in catalog's own `PLATFORM_ADMIN_USER_IDS`, so every write the
   * harvester makes passes the existing platform admin gate and is attributable
   * in the log exactly like the owner's own writes. No new authorization
   * machinery, and no shared secret.
   */
  HARVESTER_ACTOR_ID: Joi.string().uuid().allow('').default(''),

  HARVEST_ENABLED: Joi.boolean().default(false),
  HARVEST_USER_AGENT: Joi.string().default(
    'LunaShopper/0.1 (+https://velista.app; personal price comparison; contact@velista.app)'
  ),
  HARVEST_BATCH_SIZE: Joi.number().integer().min(1).default(200),
  HARVEST_DEFAULT_WORKERS: Joi.number().integer().min(1).max(64).default(4),
  HARVEST_DEFAULT_MAX_RPS: Joi.number().positive().max(100).default(4),
  /** A RUNNING run whose heartbeat is older than this is reaped as STALE. */
  HARVEST_STALE_AFTER: Joi.number().integer().min(60).default(900),
  /** A run fails outright once this fraction of its planned work has failed. */
  HARVEST_FAILURE_RATIO: Joi.number().min(0).max(1).default(0.25),

  /**
   * The postal code discovery queue (plan 0063). Four numbers, and the first
   * two are the ones that matter.
   *
   * `HARVEST_DISCOVERY_RADIUS` is **not** the profile's nearby radius and must
   * not be given one key with it (section 7). That one decides which postal
   * codes a person shops in; this one decides how far around a code's centre to
   * look for shops, and it is comfortably larger because a shop at the edge of a
   * code is still that code's shop.
   *
   * `HARVEST_DISCOVERY_COOLDOWN_DAYS` is 30 because a supermarket opening is a
   * rare event and a supermarket closing rarer, so a thousand users in one
   * postcode should cost one run a month between them.
   */
  HARVEST_DISCOVERY_RADIUS: Joi.number().integer().min(100).default(5000),
  HARVEST_DISCOVERY_COOLDOWN_DAYS: Joi.number().integer().min(1).default(30),
  /** Attempts before a code is left FAILED for a person to look at. */
  HARVEST_DISCOVERY_MAX_ATTEMPTS: Joi.number().integer().min(1).default(3),
  /** How often the drain worker looks for a due row. */
  HARVEST_DISCOVERY_POLL_SECONDS: Joi.number().integer().min(5).default(60),

  MERCADONA_ENABLED: Joi.boolean().default(false),
  MERCADONA_BASE_URL: Joi.string().allow('').default(''),
  OVERPASS_URL: Joi.string().allow('').default(''),
  NOMINATIM_URL: Joi.string().allow('').default(''),

  ...telemetryValidationSchema,
}).or('AUTH_JWT_PUBLIC_KEY', 'AUTH_JWT_PUBLIC_KEY_FILE');

export interface HarvesterConfig {
  port: number;
  natsUrl: string;
  dbUrl: string;
  authJwtPublicKey: string;
  platformAdminUserIds: string[];
  logLevel: (typeof LOG_LEVELS)[number];
  actorId: string;
  harvestEnabled: boolean;
  userAgent: string;
  batchSize: number;
  defaultWorkers: number;
  defaultMaxRequestsPerSecond: number;
  staleAfterSeconds: number;
  failureRatio: number;
  discoveryRadiusMetres: number;
  discoveryCooldownDays: number;
  discoveryMaxAttempts: number;
  discoveryPollSeconds: number;
  mercadonaEnabled: boolean;
  mercadonaBaseUrl: string | undefined;
  overpassUrl: string | undefined;
  nominatimUrl: string | undefined;
}

function parseAdminIds(raw?: string): string[] {
  return (raw ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/** Joi coerces to a real boolean, but process.env is read directly here too. */
function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  return raw === 'true' || raw === '1';
}

function optional(raw: string | undefined): string | undefined {
  return raw && raw.trim().length > 0 ? raw.trim() : undefined;
}

export const harvesterConfiguration = registerAs(
  'harvester',
  (): HarvesterConfig => ({
    port: Number(process.env.PORT),
    natsUrl: process.env.NATS_URL as string,
    dbUrl: process.env.HARVESTER_DB_URL as string,
    authJwtPublicKey: readKey(
      process.env.AUTH_JWT_PUBLIC_KEY,
      process.env.AUTH_JWT_PUBLIC_KEY_FILE
    ),
    platformAdminUserIds: parseAdminIds(process.env.PLATFORM_ADMIN_USER_IDS),
    logLevel: process.env.LOG_LEVEL as HarvesterConfig['logLevel'],
    actorId: process.env.HARVESTER_ACTOR_ID ?? '',
    harvestEnabled: parseBoolean(process.env.HARVEST_ENABLED, false),
    userAgent: process.env.HARVEST_USER_AGENT as string,
    batchSize: Number(process.env.HARVEST_BATCH_SIZE ?? 200),
    defaultWorkers: Number(process.env.HARVEST_DEFAULT_WORKERS ?? 4),
    defaultMaxRequestsPerSecond: Number(
      process.env.HARVEST_DEFAULT_MAX_RPS ?? 4
    ),
    staleAfterSeconds: Number(process.env.HARVEST_STALE_AFTER ?? 900),
    failureRatio: Number(process.env.HARVEST_FAILURE_RATIO ?? 0.25),
    discoveryRadiusMetres: Number(process.env.HARVEST_DISCOVERY_RADIUS ?? 5000),
    discoveryCooldownDays: Number(
      process.env.HARVEST_DISCOVERY_COOLDOWN_DAYS ?? 30
    ),
    discoveryMaxAttempts: Number(
      process.env.HARVEST_DISCOVERY_MAX_ATTEMPTS ?? 3
    ),
    discoveryPollSeconds: Number(
      process.env.HARVEST_DISCOVERY_POLL_SECONDS ?? 60
    ),
    mercadonaEnabled: parseBoolean(process.env.MERCADONA_ENABLED, false),
    mercadonaBaseUrl: optional(process.env.MERCADONA_BASE_URL),
    overpassUrl: optional(process.env.OVERPASS_URL),
    nominatimUrl: optional(process.env.NOMINATIM_URL),
  })
);
