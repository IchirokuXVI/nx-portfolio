import { registerAs } from '@nestjs/config';
import { telemetryValidationSchema } from '@portfolio/luna-shopper/platform';
import * as Joi from 'joi';
import { readKey } from './read-key';

/**
 * Catalog service configuration (plan 0012). Catalog owns its own database and
 * verifies access tokens offline with the auth public key (inline in the cluster,
 * or a file path locally); it never reads the auth database. Writes are gated to a
 * platform-admin allowlist (`PLATFORM_ADMIN_USER_IDS`, comma separated), the app
 * owner alone. `PORT` is the small HTTP health port (the real surface is NATS).
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

export const catalogValidationSchema = Joi.object({
  PORT: Joi.number().port().default(3004),
  NATS_URL: Joi.string().required(),
  CATALOG_DB_URL: Joi.string().required(),
  AUTH_JWT_PUBLIC_KEY: Joi.string(),
  AUTH_JWT_PUBLIC_KEY_FILE: Joi.string(),
  PLATFORM_ADMIN_USER_IDS: Joi.string().allow('').default(''),
  LOG_LEVEL: Joi.string()
    .valid(...LOG_LEVELS)
    .default('info'),

  // Tracing and metrics (plan 0016, section 7). Declared once in the platform
  // library so all five services accept the same names. Every one is optional
  // with a working default: with none of them set the service runs exactly as it
  // did before, and what the validation buys is failing fast on a malformed
  // value rather than silently sampling everything.
  ...telemetryValidationSchema,
}).or('AUTH_JWT_PUBLIC_KEY', 'AUTH_JWT_PUBLIC_KEY_FILE');

export interface CatalogConfig {
  port: number;
  natsUrl: string;
  dbUrl: string;
  authJwtPublicKey: string;
  platformAdminUserIds: string[];
  logLevel: (typeof LOG_LEVELS)[number];
}

function parseAdminIds(raw?: string): string[] {
  return (raw ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

export const catalogConfiguration = registerAs(
  'catalog',
  (): CatalogConfig => ({
    port: Number(process.env.PORT),
    natsUrl: process.env.NATS_URL as string,
    dbUrl: process.env.CATALOG_DB_URL as string,
    authJwtPublicKey: readKey(
      process.env.AUTH_JWT_PUBLIC_KEY,
      process.env.AUTH_JWT_PUBLIC_KEY_FILE
    ),
    platformAdminUserIds: parseAdminIds(process.env.PLATFORM_ADMIN_USER_IDS),
    logLevel: process.env.LOG_LEVEL as CatalogConfig['logLevel'],
  })
);
