import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';
import { readKey } from './read-key';

/**
 * Realtime service configuration (plan 0002, section 1).
 *
 * Validated on boot; fails fast on a missing required variable. The service
 * authenticates the socket handshake offline with the auth public key (supplied
 * inline in the cluster, or as a file path locally) and reads everything from
 * the environment only. Its Redis backplane variables join this schema later,
 * when Redis is introduced (plan 0001, 2.4).
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
  AUTH_JWT_PUBLIC_KEY: Joi.string(),
  AUTH_JWT_PUBLIC_KEY_FILE: Joi.string(),
  CORS_ORIGINS: Joi.string().allow('').default(''),
  LOG_LEVEL: Joi.string()
    .valid(...LOG_LEVELS)
    .default('info'),
}).or('AUTH_JWT_PUBLIC_KEY', 'AUTH_JWT_PUBLIC_KEY_FILE');

export interface RealtimeConfig {
  port: number;
  natsUrl: string;
  authJwtPublicKey: string;
  corsOrigins: string[];
  logLevel: (typeof LOG_LEVELS)[number];
}

export const realtimeConfiguration = registerAs(
  'realtime',
  (): RealtimeConfig => ({
    port: Number(process.env.PORT),
    natsUrl: process.env.NATS_URL as string,
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
