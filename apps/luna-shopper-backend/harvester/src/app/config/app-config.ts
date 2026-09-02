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
   * TEMPORARY (catalog seeding): create a catalog `Item` for every product a
   * CATALOG_DISCOVERY run sees, and write its price, instead of leaving the
   * assortment in the review queue. This exists to seed the catalog once, so it
   * can be dumped and restored into staging and production; the review queue in
   * section 6.2 is the real design and this flag is expected to be deleted.
   */
  HARVEST_AUTO_IMPORT: Joi.boolean().default(false),

  /**
   * TEMPORARY (catalog seeding): restrict a run to these level 2 category ids,
   * so the import can be proved on a handful of products covering the awkward
   * cases before it is turned loose on 4,233. Empty means the whole assortment.
   */
  HARVEST_ONLY_CATEGORY_IDS: Joi.string().allow('').default(''),

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
  /** TEMPORARY (catalog seeding). See HARVEST_AUTO_IMPORT above. */
  autoImport: boolean;
  /** TEMPORARY (catalog seeding). Level 2 category ids, empty for all. */
  onlyCategoryIds: number[];
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
    autoImport: parseBoolean(process.env.HARVEST_AUTO_IMPORT, false),
    onlyCategoryIds: (process.env.HARVEST_ONLY_CATEGORY_IDS ?? '')
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isFinite(id) && id > 0),
    mercadonaEnabled: parseBoolean(process.env.MERCADONA_ENABLED, false),
    mercadonaBaseUrl: optional(process.env.MERCADONA_BASE_URL),
    overpassUrl: optional(process.env.OVERPASS_URL),
    nominatimUrl: optional(process.env.NOMINATIM_URL),
  })
);
