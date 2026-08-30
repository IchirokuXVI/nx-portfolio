import { registerAs } from '@nestjs/config';
import {
  isComparableVersion,
  redisValidationSchema,
  telemetryValidationSchema,
} from '@portfolio/luna-shopper/platform';
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

/**
 * The `{locale}` placeholder `APP_BASE_URL` may carry, substituted with the
 * locale the sign in flow started in.
 */
export const APP_BASE_URL_LOCALE_PLACEHOLDER = '{locale}';

/**
 * An absolute http(s) URL that may carry {@link APP_BASE_URL_LOCALE_PLACEHOLDER}.
 *
 * `Joi.string().uri()` cannot be used directly: braces are not valid URI
 * characters, so a perfectly good value with the placeholder in it would be
 * rejected. The placeholder is substituted before the value is parsed, which
 * checks the thing that actually matters, that what the redirect is built from
 * resolves to an absolute URL on another origin. A relative value would make the
 * `Location` relative to the API's own origin, which is the one origin this
 * redirect exists to get the user away from.
 */
const appBaseUrl = Joi.string().custom((value: string, helpers) => {
  try {
    const url = new URL(
      value.split(APP_BASE_URL_LOCALE_PLACEHOLDER).join('en')
    );
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return helpers.error('any.invalid');
    }
  } catch {
    return helpers.error('any.invalid');
  }
  return value;
}, 'absolute app URL');

export const gatewayValidationSchema = Joi.object({
  PORT: Joi.number().port().default(3000),
  NATS_URL: Joi.string().required(),

  // Redis (plan 0028). Required, not optional, and section 5 is where that was
  // decided: the throttler stores its counters here and fails **closed**, so a
  // gateway that started without it would be an open registration and password
  // reset endpoint that looked perfectly healthy. Failing at boot is the loud
  // version of a failure that is otherwise entirely silent.
  ...redisValidationSchema,
  AUTH_JWT_PUBLIC_KEY: Joi.string(),
  AUTH_JWT_PUBLIC_KEY_FILE: Joi.string(),
  CORS_ORIGINS: Joi.string().allow('').default(''),

  // Google OAuth (login with Google): the passport dance runs at the gateway,
  // which then asks auth to create or link the account (plan 0005, section 4.4).
  // Optional: when unset the /auth/google routes are simply not registered.
  GOOGLE_CLIENT_ID: Joi.string().allow('').default(''),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').default(''),
  GOOGLE_CALLBACK_URL: Joi.string().uri().allow('').default(''),

  // Where the Google callback sends the browser back to (plan 0023, section
  // 3.4). The redirect is built from this constant and never from anything the
  // client supplied, which is the whole of what keeps it from being an open
  // redirect. Required only when Google is enabled, so a deployment with the
  // OAuth variables unset still boots with nothing to configure.
  //
  // A `{locale}` placeholder is substituted with the locale the flow started in;
  // with no placeholder the locale is appended as the first path segment. The
  // placeholder exists because this frontend mounts the app under a path that
  // comes *after* the locale (`/{locale}/velista`), which a plain prefix cannot
  // express.
  APP_BASE_URL: appBaseUrl
    .allow('')
    .default('')
    .when('GOOGLE_CLIENT_ID', {
      is: Joi.string().min(1).required(),
      then: appBaseUrl.required().invalid(''),
    }),

  // The oldest client build this deployment will serve (velista plan 0034, D5).
  //
  // Empty, the default, switches the whole mechanism off: no header is advertised
  // and no request is refused, which is how both clusters run until somebody decides
  // there is a version worth retiring. When it is set it must be a semantic version,
  // validated with the same function the guard compares with, so a typo fails the
  // process at boot rather than silently retiring nobody. Failing loud matters more
  // here than usual: the quiet failure of this variable is a safety net that is not
  // there, which nothing observes until the day it was needed.
  MIN_CLIENT_VERSION: Joi.string()
    .allow('')
    .default('')
    .custom(
      (value: string, helpers) =>
        isComparableVersion(value) ? value : helpers.error('any.invalid'),
      'semantic version'
    ),

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

export interface GatewayConfig {
  port: number;
  natsUrl: string;
  redisUrl: string;
  authJwtPublicKey: string;
  corsOrigins: string[];
  /**
   * Origin (and optional path prefix) of the frontend the Google callback
   * redirects back to, optionally carrying a `{locale}` placeholder. Empty when
   * Google is not configured.
   */
  appBaseUrl: string;
  google: {
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
    /** True only when the id, secret and callback are all present. */
    enabled: boolean;
  };
  /**
   * The oldest client build this deployment serves, or an empty string when it
   * serves every one of them. Read by `MinClientVersionGuard` and by nothing else.
   */
  minClientVersion: string;
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
    redisUrl: process.env.REDIS_URL as string,
    authJwtPublicKey: readKey(
      process.env.AUTH_JWT_PUBLIC_KEY,
      process.env.AUTH_JWT_PUBLIC_KEY_FILE
    ),
    corsOrigins: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    appBaseUrl: process.env.APP_BASE_URL ?? '',
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
    minClientVersion: process.env.MIN_CLIENT_VERSION ?? '',
    logLevel: process.env.LOG_LEVEL as GatewayConfig['logLevel'],
  })
);
