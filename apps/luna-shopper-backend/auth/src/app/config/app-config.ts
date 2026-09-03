import { registerAs } from '@nestjs/config';
import { telemetryValidationSchema } from '@portfolio/luna-shopper/platform';
import * as Joi from 'joi';
import { parseDurationMs } from '../tokens/duration';
import { assertDevAutologinIsSafe } from './local-host';
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

  // The operator keypair (plan 0071, section 3), and a SECOND one rather than the
  // auth key with a different audience. Five services already hold
  // AUTH_JWT_PUBLIC_KEY, so one key for both kinds of token would make every one
  // of them find an admin token structurally valid and reject it only if it
  // remembered to check `aud`. Realtime, which authenticates sockets, is exactly
  // where forgetting that is plausible and expensive. A second key makes the
  // mistake unrepresentable rather than merely discouraged.
  //
  // Required, unlike the Google and SMTP blocks below. Those are optional because
  // an unconfigured deployment degrades to a feature that is absent; a missing
  // signing key degrades to tokens signed with nothing, which is not a lesser
  // version of the feature. `provision-release.sh` generates the pair beside the
  // auth one and `--check` asserts the Secret keys resolve, so an absent key is a
  // preflight failure taking seconds rather than a pod that boots and cannot
  // authenticate anybody.
  ADMIN_JWT_PRIVATE_KEY: Joi.string(),
  ADMIN_JWT_PRIVATE_KEY_FILE: Joi.string(),
  ADMIN_JWT_PUBLIC_KEY: Joi.string(),
  ADMIN_JWT_PUBLIC_KEY_FILE: Joi.string(),
  ADMIN_JWT_KID: Joi.string().required(),
  // Configurable so development can raise it; section 8 is why that cannot leak
  // into production.
  ADMIN_ACCESS_TOKEN_TTL: Joi.string().default('15m'),

  // Lockout (plan 0071, section 7). Separate from the gateway's throttling
  // because throttling limits a source and this protects an account: one admin
  // username is a far better brute force target than a user base, since the
  // attacker knows the name is one of very few.
  ADMIN_LOGIN_LOCKOUT_THRESHOLD: Joi.number().integer().min(1).default(5),
  ADMIN_LOGIN_LOCKOUT_WINDOW: Joi.string().default('15m'),

  // Development signs in without a password (plan 0071, section 8). Its own
  // variable and NOT derived from NODE_ENV, and auth refuses to boot with it on
  // and a non local database. When on it issues a token for a named EXISTING
  // admin rather than inventing one, so a development session has a real actor id
  // and the audit rows of plan 0075 are attributable even locally.
  ADMIN_DEV_AUTOLOGIN: Joi.boolean().default(false),
  ADMIN_DEV_AUTOLOGIN_USERNAME: Joi.string().allow('').default(''),

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
  // library so all seven services accept the same names. Every one is optional
  // with a working default: with none of them set the service runs exactly as it
  // did before, and what the validation buys is failing fast on a malformed
  // value rather than silently sampling everything.
  ...telemetryValidationSchema,
})
  .or('AUTH_JWT_PRIVATE_KEY', 'AUTH_JWT_PRIVATE_KEY_FILE')
  .or('AUTH_JWT_PUBLIC_KEY', 'AUTH_JWT_PUBLIC_KEY_FILE')
  .or('ADMIN_JWT_PRIVATE_KEY', 'ADMIN_JWT_PRIVATE_KEY_FILE')
  .or('ADMIN_JWT_PUBLIC_KEY', 'ADMIN_JWT_PUBLIC_KEY_FILE');

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
    /**
     * How long a participant's basket scoped socket token lives (plan 0051,
     * section 9).
     *
     * Shorter than an access token, because it is the one token that cannot be
     * revoked: revocation is carried by the participant row, which is read when
     * the token is **refreshed** rather than when it is used. So its lifetime is
     * the window in which a revoked guest's socket can still be open, and fifteen
     * minutes is short enough for that to be a shopping trip's worth of slack
     * rather than a hole. The eviction sweep closes the window immediately in the
     * ordinary case; this is the backstop for a sweep that never ran.
     */
    participantTokenTtl: string;
  };
  /**
   * The operator identity (plan 0071). Its own key, its own TTL and its own
   * lockout, sharing nothing with the block above but the algorithm.
   */
  admin: {
    privateKey: string;
    publicKey: string;
    kid: string;
    accessTokenTtl: string;
    lockout: {
      /** Consecutive failures for one username before it is refused outright. */
      threshold: number;
      /** How far back the failures are counted, and how long the refusal lasts. */
      windowMs: number;
    };
    /**
     * Sign in with no password, for development only. False everywhere else, and
     * the boot has already refused to continue if it was true against a non local
     * database, so nothing downstream needs to re-check where it is running.
     */
    devAutologin: boolean;
    /** The existing admin a development autologin issues a token for. */
    devAutologinUsername: string;
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

/**
 * The operator block, built apart from the rest so the one thing in this file
 * that can refuse a boot has a name (plan 0071, section 8).
 *
 * The autologin check runs HERE rather than at the point of use. Config load is
 * the earliest moment the resolved database URL and the switch are both known,
 * and a check any later is a check a request path can be written around.
 */
function adminConfig(): AuthConfig['admin'] {
  const devAutologin = process.env.ADMIN_DEV_AUTOLOGIN === 'true';
  assertDevAutologinIsSafe(devAutologin, process.env.AUTH_DB_URL);

  return {
    privateKey: readKey(
      process.env.ADMIN_JWT_PRIVATE_KEY,
      process.env.ADMIN_JWT_PRIVATE_KEY_FILE
    ),
    publicKey: readKey(
      process.env.ADMIN_JWT_PUBLIC_KEY,
      process.env.ADMIN_JWT_PUBLIC_KEY_FILE
    ),
    kid: process.env.ADMIN_JWT_KID as string,
    accessTokenTtl: process.env.ADMIN_ACCESS_TOKEN_TTL ?? '15m',
    lockout: {
      threshold: Number(process.env.ADMIN_LOGIN_LOCKOUT_THRESHOLD ?? 5),
      windowMs: parseDurationMs(
        process.env.ADMIN_LOGIN_LOCKOUT_WINDOW ?? '15m'
      ),
    },
    devAutologin,
    devAutologinUsername: process.env.ADMIN_DEV_AUTOLOGIN_USERNAME ?? '',
  };
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
      // Defaulted rather than required, unlike the two above: an existing
      // deployment's env has never heard of it, and a service that refuses to
      // boot for want of a value with an obvious right answer is a worse failure
      // than the value being implicit (plan 0051, section 9).
      participantTokenTtl: process.env.PARTICIPANT_TOKEN_TTL ?? '15m',
    },
    admin: adminConfig(),
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
