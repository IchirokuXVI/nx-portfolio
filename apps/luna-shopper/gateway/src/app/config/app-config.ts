import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';
import { readKey } from './read-key';

/**
 * Gateway configuration (plan 0002, section 1).
 *
 * Every variable is read from the environment only, never hard coded, and the
 * whole set is validated on boot by the Joi schema below so a missing or
 * malformed required variable fails the process fast. Nothing here is secret at
 * build time: values arrive at runtime from Kubernetes Secrets/ConfigMaps (or,
 * locally, from `.env` files).
 *
 * The auth public key can be supplied either inline (`AUTH_JWT_PUBLIC_KEY`, how
 * the cluster injects it from a Secret) or as a file path (`_FILE`, how local
 * dev points at secrets/jwt.pub); exactly the file-or-inline pair is required.
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

export const gatewayValidationSchema = Joi.object({
  PORT: Joi.number().port().default(3000),
  NATS_URL: Joi.string().required(),
  AUTH_JWT_PUBLIC_KEY: Joi.string(),
  AUTH_JWT_PUBLIC_KEY_FILE: Joi.string(),
  CORS_ORIGINS: Joi.string().allow('').default(''),

  // Google OAuth (login with Google): the passport dance runs at the gateway,
  // which then asks auth to create or link the account (plan 0005, section 4.4).
  // Optional: when unset the /auth/google routes are simply not registered.
  GOOGLE_CLIENT_ID: Joi.string().allow('').default(''),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').default(''),
  GOOGLE_CALLBACK_URL: Joi.string().uri().allow('').default(''),

  LOG_LEVEL: Joi.string()
    .valid(...LOG_LEVELS)
    .default('info'),
}).or('AUTH_JWT_PUBLIC_KEY', 'AUTH_JWT_PUBLIC_KEY_FILE');

export interface GatewayConfig {
  port: number;
  natsUrl: string;
  authJwtPublicKey: string;
  corsOrigins: string[];
  google: {
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
    /** True only when the id, secret and callback are all present. */
    enabled: boolean;
  };
  logLevel: (typeof LOG_LEVELS)[number];
}

/**
 * Maps the validated environment into a typed, namespaced config object read
 * elsewhere as `config.get('gateway')`.
 */
export const gatewayConfiguration = registerAs(
  'gateway',
  (): GatewayConfig => ({
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
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      callbackUrl: process.env.GOOGLE_CALLBACK_URL ?? '',
      enabled: Boolean(
        process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.GOOGLE_CALLBACK_URL
      ),
    },
    logLevel: process.env.LOG_LEVEL as GatewayConfig['logLevel'],
  })
);
