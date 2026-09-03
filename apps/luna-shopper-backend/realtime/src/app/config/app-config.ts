import { registerAs } from '@nestjs/config';
import {
  redisValidationSchema,
  telemetryValidationSchema,
} from '@portfolio/luna-shopper/platform';
import * as Joi from 'joi';
import { readKey } from './read-key';

/**
 * Realtime service configuration (plan 0002, section 1).
 *
 * Validated on boot; fails fast on a missing required variable. The service
 * authenticates the socket handshake offline with the auth public key (supplied
 * inline in the cluster, or as a file path locally) and reads everything from
 * the environment only. `REDIS_URL` is the backplane the earlier plans deferred
 * to, and it arrived with plan 0028; it is required, because without it the
 * socket adapter, the relay channel and presence are all per pod state and the
 * service is incorrect at more than one replica.
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

export const realtimeValidationSchema = Joi.object({
  PORT: Joi.number().port().default(3001),
  NATS_URL: Joi.string().required(),
  ...redisValidationSchema,
  AUTH_JWT_PUBLIC_KEY: Joi.string(),
  AUTH_JWT_PUBLIC_KEY_FILE: Joi.string(),
  CORS_ORIGINS: Joi.string().allow('').default(''),
  LOG_LEVEL: Joi.string()
    .valid(...LOG_LEVELS)
    .default('info'),

  // Tracing and metrics (plan 0016, section 7). Declared once in the platform
  // library so all seven services accept the same names. Every one is optional
  // with a working default: with none of them set the service runs exactly as it
  // did before, and what the validation buys is failing fast on a malformed
  // value rather than silently sampling everything.
  ...telemetryValidationSchema,
}).or('AUTH_JWT_PUBLIC_KEY', 'AUTH_JWT_PUBLIC_KEY_FILE');

export interface RealtimeConfig {
  port: number;
  natsUrl: string;
  redisUrl: string;
  authJwtPublicKey: string;
  corsOrigins: string[];
  logLevel: (typeof LOG_LEVELS)[number];
}

export const realtimeConfiguration = registerAs(
  'realtime',
  (): RealtimeConfig => ({
    port: Number(process.env.PORT),
    natsUrl: process.env.NATS_URL as string,
    redisUrl: process.env.REDIS_URL as string,
    authJwtPublicKey: readKey(
      process.env.AUTH_JWT_PUBLIC_KEY,
      process.env.AUTH_JWT_PUBLIC_KEY_FILE
    ),
    corsOrigins: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    logLevel: process.env.LOG_LEVEL as RealtimeConfig['logLevel'],
  })
);
