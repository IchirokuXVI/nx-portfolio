import { registerAs } from '@nestjs/config';
import {
  VOICE_COMMENT_CONTENT_TYPES,
  VOICE_COMMENT_MAX_BYTES,
} from '@portfolio/luna-shopper/contracts';
import { telemetryValidationSchema } from '@portfolio/luna-shopper/platform';
import * as Joi from 'joi';
import { parseDurationMs } from './duration';
import { DEFAULT_LOCATION_MAX_DISTANCE_METRES } from './location-max-distance';
import {
  DEFAULT_NEARBY_RADIUS_METRES,
  parseRadiusByCountry,
  type NearbyRadiusConfig,
} from './nearby-radius';
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
   * How long a basket nobody has finished goes on claiming its lines (plan 0052,
   * section 4.1), and how old a live basket may get before the sweep finishes it
   * (plan 0059, section 4).
   *
   * A basket that is neither finished nor archived holds its lines forever, so
   * somebody who generates one on Tuesday and does not go shopping leaves the
   * household reading "Ana is buying this" for a month. Deriving the claim rather
   * than storing it turns that into a question about the basket, and this is the
   * answer: a live basket older than this window claims nothing.
   *
   * **Two readers, one number, on purpose.** `LINE_CLAIMS_SQL` stops counting a
   * basket past this age, and `GeneratedListSweepService` moves it to
   * `COMPLETED` past the same age. Past the window the claim has already
   * expired, so the sweep is writing down what the read already believed rather
   * than changing what anybody sees, and a second number here would be a way for
   * the status and the claim to disagree. The invariant to keep when changing
   * it: a live basket never outlives its own claim.
   *
   * Sixty hours rather than a flat two days (plan 0059, section 4.3): a basket
   * generated on Friday evening and shopped on Sunday afternoon is two days later
   * at a different hour, and `48h` would close it on Sunday morning, before the
   * shopping. The half day covers the second day whatever time of day the trip
   * happens, and stops well short of a third. Seven days was plan 0052's
   * placeholder for a retention window plan 0050 section 7 left unbounded, and
   * that section still has no number to borrow; a cap or an age based archive,
   * when one lands, should read this rather than declare another beside it.
   */
  GENERATED_LIST_CLAIM_WINDOW: Joi.string().default('60h'),

  // The sweep (plan 0059, section 4): finishes live baskets older than the claim
  // window, one `update` each so the household hears the release. Switched the
  // same way the zone reaper above is, and on by default like it.
  GENERATED_LIST_SWEEP_ENABLED: Joi.boolean().default(true),
  GENERATED_LIST_SWEEP_INTERVAL: Joi.string().default('1h'),
  GENERATED_LIST_SWEEP_BATCH: Joi.number().integer().min(1).default(100),

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

  /**
   * How far a postal code reaches for its neighbours (plan 0062, section 4).
   *
   * Configuration from the first commit, and per country from the first commit
   * too: `PROFILE_NEARBY_RADIUS_BY_COUNTRY` is `es=2000,bo=5000`, and any country
   * it does not name takes `PROFILE_NEARBY_RADIUS_METRES`.
   */
  PROFILE_NEARBY_RADIUS_METRES: Joi.number()
    .integer()
    .min(0)
    .default(DEFAULT_NEARBY_RADIUS_METRES),
  PROFILE_NEARBY_RADIUS_BY_COUNTRY: Joi.string().allow('').default(''),

  /**
   * How far a device may be from a centroid and still be placed in that code
   * (`apps/velista/plans/0058`, section 3). Beyond it the answer is "we don't
   * know" and the screen offers typing instead.
   */
  PROFILE_LOCATION_MAX_DISTANCE_METRES: Joi.number()
    .integer()
    .min(0)
    .default(DEFAULT_LOCATION_MAX_DISTANCE_METRES),

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
    /**
     * A live basket older than this claims nothing (plan 0052, section 4.1) and
     * is finished by the sweep (plan 0059, section 4.2). One number for both.
     */
    claimWindowMs: number;
    sweep: {
      enabled: boolean;
      intervalMs: number;
      /** A cap per tick, not per run: whatever is left waits for the next one. */
      batchSize: number;
    };
  };
  voiceComment: {
    maxBytes: number;
    /** Base types, lowercased, with no parameters. */
    contentTypes: string[];
  };
  /** The radius a postal code brings its neighbours from (plan 0062). */
  nearbyRadius: NearbyRadiusConfig;
  /** How far a device may be from the code it is placed in (velista plan 0058). */
  locationMaxDistanceMetres: number;
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
      sweep: {
        enabled: process.env.GENERATED_LIST_SWEEP_ENABLED !== 'false',
        intervalMs: parseDurationMs(
          process.env.GENERATED_LIST_SWEEP_INTERVAL as string
        ),
        batchSize: Number(process.env.GENERATED_LIST_SWEEP_BATCH),
      },
    },
    voiceComment: {
      maxBytes: Number(
        process.env.VOICE_COMMENT_MAX_BYTES ?? VOICE_COMMENT_MAX_BYTES
      ),
      contentTypes: parseContentTypes(process.env.VOICE_COMMENT_CONTENT_TYPES),
    },
    nearbyRadius: {
      defaultMetres: Number(
        process.env.PROFILE_NEARBY_RADIUS_METRES ?? DEFAULT_NEARBY_RADIUS_METRES
      ),
      byCountry: parseRadiusByCountry(
        process.env.PROFILE_NEARBY_RADIUS_BY_COUNTRY
      ),
    },
    locationMaxDistanceMetres: Number(
      process.env.PROFILE_LOCATION_MAX_DISTANCE_METRES ??
        DEFAULT_LOCATION_MAX_DISTANCE_METRES
    ),
    logLevel: process.env.LOG_LEVEL as CoreConfig['logLevel'],
  })
);
