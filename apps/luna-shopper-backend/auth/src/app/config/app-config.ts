import { registerAs } from '@nestjs/config';
import { telemetryValidationSchema } from '@portfolio/luna-shopper/platform';
import * as Joi from 'joi';
import { parseDurationMs } from '../tokens/duration';
import { readKey } from './read-key';

/**
 * Auth service configuration (plan 0002, section 1).
 *
 * Auth is the only service that holds the JWT private key; every other service
 * holds only the public half. Both keys can be supplied inline (how the cluster
 * injects them from a Secret) or as file paths (`_FILE`, how local dev points at
 * secrets/jwt.key and secrets/jwt.pub so PEM blobs stay out of `.env`); exactly
 * the file-or-inline pair is required for each. Database credentials, OAuth
 * secret and SMTP password arrive at runtime and are validated on boot. `PORT`
 * is the small HTTP health port; the service's real surface is the NATS broker.
 *
 * GOOGLE_CALLBACK_URL, MAIL_VERIFY_BASE_URL and MAIL_RESET_BASE_URL are explicit
 * on purpose: the OAuth callback must exactly match a URI pre-registered with
 * Google (and the request Host header is untrusted), and the verification and
 * reset links live in emails pointing at the frontend (a different origin than
 * this API), so none of them can be derived from the incoming request's host.
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

export const authValidationSchema = Joi.object({
  PORT: Joi.number().port().default(3002),
  NATS_URL: Joi.string().required(),
  AUTH_DB_URL: Joi.string().required(),

  // Asymmetric JWT keypair (PEM), inline or via a file path. `AUTH_JWT_KID`
  // names the active key for rotation (plan 0004).
  AUTH_JWT_PRIVATE_KEY: Joi.string(),
  AUTH_JWT_PRIVATE_KEY_FILE: Joi.string(),
  AUTH_JWT_PUBLIC_KEY: Joi.string(),
  AUTH_JWT_PUBLIC_KEY_FILE: Joi.string(),
  AUTH_JWT_KID: Joi.string().required(),
  ACCESS_TOKEN_TTL: Joi.string().default('15m'),
  REFRESH_TOKEN_TTL: Joi.string().default('30d'),

  // Google OAuth (login with Google). Optional, and mirroring the gateway's
  // schema exactly (plan 0026, section 3.2).
  //
  // These were `.required()` with no `.allow('')`, and Joi rejects an empty
  // string for a required string. The chart ships `googleClientId: ''`, so the
  // auth pod failed validation and died during boot — in exactly the deployment
  // the gateway was carefully written to support. The chart's own comment claimed
  // an unset client id left boot unaffected, which was true of the gateway and
  // false here; nothing had ever booted this stack in a cluster to notice.
  GOOGLE_CLIENT_ID: Joi.string().allow('').default(''),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').default(''),
  GOOGLE_CALLBACK_URL: Joi.string().uri().allow('').default(''),

  // SMTP for the confirmation email. Submission port over TLS (587/465).
  //
  // Optional for the same reason and by the same mechanism (section 3.4), but
  // the decision behind it is different rather than copied. Google sign in is one
  // way in among several; email is load bearing, because without it
  // `POST /v1/auth/register` accepts a signup whose confirmation link is never
  // sent and the account is unreachable. So an unset SMTP host does not silently
  // degrade: registration answers `not_configured`, which makes an SMTP-less
  // staging cluster a supported configuration for everything except the signup
  // flow. Give staging real credentials before using it to exercise that flow.
  SMTP_HOST: Joi.string().allow('').default(''),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASS: Joi.string().allow('').default(''),
  MAIL_FROM: Joi.string().required(),
  MAIL_VERIFY_BASE_URL: Joi.string().uri().required(),
  MAIL_RESET_BASE_URL: Joi.string().uri().required(),

  // Orphan temporary-user reaper (plan 0011, section 3). Deletes temporary users
  // with no zone membership after a grace period; core is the authority on
  // membership and answers the reconciliation query.
  ORPHAN_REAPER_ENABLED: Joi.boolean().default(true),
  ORPHAN_USER_GRACE: Joi.string().default('30d'),
  ORPHAN_REAPER_INTERVAL: Joi.string().default('1h'),
  ORPHAN_REAPER_BATCH: Joi.number().integer().min(1).default(200),

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
  .or('AUTH_JWT_PRIVATE_KEY', 'AUTH_JWT_PRIVATE_KEY_FILE')
  .or('AUTH_JWT_PUBLIC_KEY', 'AUTH_JWT_PUBLIC_KEY_FILE');

export interface AuthConfig {
  port: number;
  natsUrl: string;
  dbUrl: string;
  jwt: {
    privateKey: string;
    publicKey: string;
    kid: string;
    accessTokenTtl: string;
    refreshTokenTtl: string;
  };
  google: {
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
    /**
     * All three set and non empty. The same definition the gateway derives, so
     * the two services agree on what "configured" means instead of each deciding
     * for itself (plan 0026, section 3.2).
     */
    enabled: boolean;
  };
  smtp: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
    verifyBaseUrl: string;
    resetBaseUrl: string;
    /**
     * An SMTP host is set, so mail can actually be delivered. The flows that
     * depend on a delivered email (registration, resend, password reset) answer
     * `not_configured` rather than accepting a request whose email never arrives.
     */
    enabled: boolean;
  };
  reaper: {
    enabled: boolean;
    graceMs: number;
    intervalMs: number;
    batchSize: number;
  };
  logLevel: (typeof LOG_LEVELS)[number];
}

export const authConfiguration = registerAs(
  'auth',
  (): AuthConfig => ({
    port: Number(process.env.PORT),
    natsUrl: process.env.NATS_URL as string,
    dbUrl: process.env.AUTH_DB_URL as string,
    jwt: {
      privateKey: readKey(
        process.env.AUTH_JWT_PRIVATE_KEY,
        process.env.AUTH_JWT_PRIVATE_KEY_FILE
      ),
      publicKey: readKey(
        process.env.AUTH_JWT_PUBLIC_KEY,
        process.env.AUTH_JWT_PUBLIC_KEY_FILE
      ),
      kid: process.env.AUTH_JWT_KID as string,
      accessTokenTtl: process.env.ACCESS_TOKEN_TTL as string,
      refreshTokenTtl: process.env.REFRESH_TOKEN_TTL as string,
    },
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
    smtp: {
      host: process.env.SMTP_HOST ?? '',
      port: Number(process.env.SMTP_PORT),
      user: process.env.SMTP_USER ?? '',
      pass: process.env.SMTP_PASS ?? '',
      from: process.env.MAIL_FROM as string,
      verifyBaseUrl: process.env.MAIL_VERIFY_BASE_URL as string,
      resetBaseUrl: process.env.MAIL_RESET_BASE_URL as string,
      enabled: Boolean(process.env.SMTP_HOST),
    },
    reaper: {
      enabled: process.env.ORPHAN_REAPER_ENABLED !== 'false',
      graceMs: parseDurationMs(process.env.ORPHAN_USER_GRACE as string),
      intervalMs: parseDurationMs(process.env.ORPHAN_REAPER_INTERVAL as string),
      batchSize: Number(process.env.ORPHAN_REAPER_BATCH),
    },
    logLevel: process.env.LOG_LEVEL as AuthConfig['logLevel'],
  })
);
