import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';
import { parseDurationMs } from './duration';
import { readKey } from './read-key';

/**
 * Core service configuration (plan 0002, section 1).
 *
 * Core owns its own database and verifies access tokens offline with the auth
 * public key (inline in the cluster, or a file path locally); it never reads the
 * auth database. `PORT` is the small HTTP health port (the real surface is the
 * NATS broker). Validated on boot, read from the environment only.
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

export const coreValidationSchema = Joi.object({
  PORT: Joi.number().port().default(3003),
  NATS_URL: Joi.string().required(),
  CORE_DB_URL: Joi.string().required(),
  AUTH_JWT_PUBLIC_KEY: Joi.string(),
  AUTH_JWT_PUBLIC_KEY_FILE: Joi.string(),

  // Zone reaper (plan 0011, section 3): deletes zones marked for deletion that
  // are past the grace period with no owner claim, cascading their lists/lines.
  ZONE_REAPER_ENABLED: Joi.boolean().default(true),
  ZONE_DELETION_GRACE: Joi.string().default('7d'),
  ZONE_REAPER_INTERVAL: Joi.string().default('1h'),
  ZONE_REAPER_BATCH: Joi.number().integer().min(1).default(200),

  LOG_LEVEL: Joi.string()
    .valid(...LOG_LEVELS)
    .default('info'),
}).or('AUTH_JWT_PUBLIC_KEY', 'AUTH_JWT_PUBLIC_KEY_FILE');

export interface CoreConfig {
  port: number;
  natsUrl: string;
  dbUrl: string;
  authJwtPublicKey: string;
  reaper: {
    enabled: boolean;
    graceMs: number;
    intervalMs: number;
    batchSize: number;
  };
  logLevel: (typeof LOG_LEVELS)[number];
}

export const coreConfiguration = registerAs(
  'core',
  (): CoreConfig => ({
    port: Number(process.env.PORT),
    natsUrl: process.env.NATS_URL as string,
    dbUrl: process.env.CORE_DB_URL as string,
    authJwtPublicKey: readKey(
      process.env.AUTH_JWT_PUBLIC_KEY,
      process.env.AUTH_JWT_PUBLIC_KEY_FILE
    ),
    reaper: {
      enabled: process.env.ZONE_REAPER_ENABLED !== 'false',
      graceMs: parseDurationMs(process.env.ZONE_DELETION_GRACE as string),
      intervalMs: parseDurationMs(process.env.ZONE_REAPER_INTERVAL as string),
      batchSize: Number(process.env.ZONE_REAPER_BATCH),
    },
    logLevel: process.env.LOG_LEVEL as CoreConfig['logLevel'],
  })
);
