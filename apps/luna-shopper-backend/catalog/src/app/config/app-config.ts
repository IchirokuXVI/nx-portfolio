import { registerAs } from '@nestjs/config';
import { telemetryValidationSchema } from '@portfolio/luna-shopper/platform';
import * as Joi from 'joi';
import {
  DEFAULT_POSTAL_CODE_DERIVE_MAX_METRES,
  postalCodeDeriveMaxMetres,
} from './postal-code-derivation';
import { readKey } from './read-key';

/**
 * Catalog service configuration (plan 0012). Catalog owns its own database and
 * verifies access tokens offline with the auth public key (inline in the cluster,
 * or a file path locally); it never reads the auth database.
 *
 * Writes are gated to the app owner, and plan 0072 changed what proves that.
 * `ADMIN_JWT_PUBLIC_KEY` is a **second** public key beside the auth one, read the
 * same way, and it is required: catalog cannot verify an operator token without
 * it, so a catalog that boots without one is a catalog whose every write would be
 * refused. `SERVICE_ACTOR_IDS` is the other door, for callers that are machines
 * rather than people (section 4), and the harvester is its only member.
 *
 * `PLATFORM_ADMIN_USER_IDS` used to sit here and is gone. It listed uuids, and a
 * uuid is not a secret.
 *
 * `PORT` is the small HTTP health port (the real surface is NATS).
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
  POSTAL_CODE_DERIVE_MAX_METRES: Joi.number()
    .positive()
    .default(DEFAULT_POSTAL_CODE_DERIVE_MAX_METRES),
  NATS_URL: Joi.string().required(),
  CATALOG_DB_URL: Joi.string().required(),
  AUTH_JWT_PUBLIC_KEY: Joi.string(),
  AUTH_JWT_PUBLIC_KEY_FILE: Joi.string(),
  ADMIN_JWT_PUBLIC_KEY: Joi.string(),
  ADMIN_JWT_PUBLIC_KEY_FILE: Joi.string(),
  SERVICE_ACTOR_IDS: Joi.string().allow('').default(''),
  LOG_LEVEL: Joi.string()
    .valid(...LOG_LEVELS)
    .default('info'),

  // Tracing and metrics (plan 0016, section 7). Declared once in the platform
  // library so all five services accept the same names. Every one is optional
  // with a working default: with none of them set the service runs exactly as it
  // did before, and what the validation buys is failing fast on a malformed
  // value rather than silently sampling everything.
  ...telemetryValidationSchema,
})
  .or('AUTH_JWT_PUBLIC_KEY', 'AUTH_JWT_PUBLIC_KEY_FILE')
  .or('ADMIN_JWT_PUBLIC_KEY', 'ADMIN_JWT_PUBLIC_KEY_FILE');

export interface CatalogConfig {
  port: number;
  natsUrl: string;
  dbUrl: string;
  authJwtPublicKey: string;
  /** The second trust root (plan 0072): what an operator token is verified with. */
  adminJwtPublicKey: string;
  /**
   * The uuids of **services** allowed to write catalog without a token (plan
   * 0072, section 4). The harvester's actor id is the only member, and it is
   * stable: creating an admin does not touch it.
   */
  serviceActorIds: string[];
  logLevel: (typeof LOG_LEVELS)[number];
  /** The bound on a derived postal code (plan 0061, section 4). */
  postalCodeDeriveMaxMetres: number;
}

function parseActorIds(raw?: string): string[] {
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
    adminJwtPublicKey: readKey(
      process.env.ADMIN_JWT_PUBLIC_KEY,
      process.env.ADMIN_JWT_PUBLIC_KEY_FILE
    ),
    serviceActorIds: parseActorIds(process.env.SERVICE_ACTOR_IDS),
    logLevel: process.env.LOG_LEVEL as CatalogConfig['logLevel'],
    postalCodeDeriveMaxMetres: postalCodeDeriveMaxMetres(),
  })
);
