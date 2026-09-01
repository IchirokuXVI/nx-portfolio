import { registerAs } from '@nestjs/config';
import {
  VOICE_COMMENT_CONTENT_TYPES,
  VOICE_COMMENT_MAX_BYTES,
} from '@portfolio/luna-shopper/contracts';
import { telemetryValidationSchema } from '@portfolio/luna-shopper/platform';
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

  /**
   * How long a basket nobody has shopped goes on claiming its lines (plan 0052,
   * section 4.1).
   *
   * A basket that is neither finished nor archived holds its lines forever, so
   * somebody who generates one on Tuesday and does not go shopping leaves the
   * household reading "Ana is buying this" for a month. Deriving the claim rather
   * than storing it turns that into a question about the basket, and this is the
   * answer: a live basket older than this window claims nothing.
   *
   * Plan 0052 section 4.1 asks for the retention window plan 0050 section 7
   * defines, so that there is one number rather than two that can disagree. That
   * section left retention **unbounded**, so there is no number to borrow and this
   * is the single definition: a cap or an age based archive, when one lands,
   * should read this rather than declare a second one beside it.
   */
  GENERATED_LIST_CLAIM_WINDOW: Joi.string().default('7d'),

  /**
   * The voice comment caps (plan 0045, section 6).
   *
   * They are here as well as on the gateway on purpose, and the two are not a
   * duplication to be tidied away: the interceptor's cap is what stops a large
   * upload being buffered at all, and this one is what stops a payload that
   * reached the broker by some other route being written to the database. Plan
   * 0041 section 5 states the rule the first of those follows; this is the
   * second half of it.
   */
  VOICE_COMMENT_MAX_BYTES: Joi.number()
    .integer()
    .min(1024)
    .default(VOICE_COMMENT_MAX_BYTES),
  /** Comma separated. Empty falls back to the contract's own list. */
  VOICE_COMMENT_CONTENT_TYPES: Joi.string().allow('').default(''),

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
  generatedList: {
    /** A live basket older than this claims nothing (plan 0052, section 4.1). */
    claimWindowMs: number;
  };
  voiceComment: {
    maxBytes: number;
    /** Base types, lowercased, with no parameters. */
    contentTypes: string[];
  };
  logLevel: (typeof LOG_LEVELS)[number];
}

/**
 * A comma separated allowlist, or the contract's own list when the variable is
 * empty.
 *
 * Falling back rather than defaulting to nothing, because an empty allowlist is a
 * feature that refuses every recording and looks like a browser problem from the
 * outside.
 */
export function parseContentTypes(raw: string | undefined): string[] {
  const listed = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return listed.length > 0 ? listed : [...VOICE_COMMENT_CONTENT_TYPES];
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
    generatedList: {
      claimWindowMs: parseDurationMs(
        process.env.GENERATED_LIST_CLAIM_WINDOW as string
      ),
    },
    voiceComment: {
      maxBytes: Number(
        process.env.VOICE_COMMENT_MAX_BYTES ?? VOICE_COMMENT_MAX_BYTES
      ),
      contentTypes: parseContentTypes(process.env.VOICE_COMMENT_CONTENT_TYPES),
    },
    logLevel: process.env.LOG_LEVEL as CoreConfig['logLevel'],
  })
);
