import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';
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
  LOG_LEVEL: Joi.string()
    .valid(...LOG_LEVELS)
    .default('info'),
}).or('AUTH_JWT_PUBLIC_KEY', 'AUTH_JWT_PUBLIC_KEY_FILE');

export interface CoreConfig {
  port: number;
  natsUrl: string;
  dbUrl: string;
  authJwtPublicKey: string;
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
    logLevel: process.env.LOG_LEVEL as CoreConfig['logLevel'],
  })
);
