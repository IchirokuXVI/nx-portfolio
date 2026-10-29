import * as Joi from 'joi';
import { parseDurationMs } from '../config/duration';

/**
 * How long core keeps its audit trail, and the sweep that enforces it
 * (plan 0233, section 3).
 *
 * `RETENTION_AUDIT` is a number the privacy policy prints: the gateway reads
 * the same key to report it (plan 0231, section 5.3), and auth, core and
 * catalog each enforce it on their own trail, so a change of the value is a
 * change of the policy. The other two periods are auth's alone.
 *
 * Every key has a default, so the tier 2 compose file and `luna-slot.sh` need
 * no entry. A period below its floor refuses boot, because a typo such as
 * `0d`, or `180` with no unit, would otherwise delete a whole trail in one
 * tick.
 */

/**
 * A duration key that refuses a value below `floor` at boot, with a message
 * that names the key.
 */
export function durationAtLeast(
  fallback: string,
  floor: string
): Joi.StringSchema {
  const floorMs = parseDurationMs(floor);
  return Joi.string()
    .default(fallback)
    .custom((value: string, helpers) => {
      let ms: number;
      try {
        ms = parseDurationMs(value);
      } catch {
        return helpers.message({
          custom: `{{#label}} must be a duration such as ${fallback}`,
        });
      }
      if (ms < floorMs) {
        return helpers.message({
          custom: `{{#label}} must be at least ${floor}`,
        });
      }
      return value;
    });
}

export const retentionValidationSchema = {
  RETENTION_AUDIT: durationAtLeast('180d', '7d'),
  RETENTION_SWEEP_ENABLED: Joi.boolean().default(true),
  RETENTION_SWEEP_INTERVAL: durationAtLeast('1h', '1m'),
  RETENTION_SWEEP_BATCH: Joi.number().integer().min(1).default(1000),
  RETENTION_SWEEP_MAX_BATCHES: Joi.number().integer().min(1).default(50),
};

/** The retention block of `CoreConfig`. */
export interface RetentionConfig {
  /** `core_audit`, counted from `at`. */
  auditMs: number;
  sweep: {
    enabled: boolean;
    intervalMs: number;
    /** The rows one `DELETE` takes at most. */
    batchSize: number;
    /** The batches one table takes per tick at most. */
    maxBatches: number;
  };
}

/** Reads the validated environment into {@link RetentionConfig}. */
export function retentionConfig(
  env: NodeJS.ProcessEnv = process.env
): RetentionConfig {
  return {
    auditMs: parseDurationMs(env['RETENTION_AUDIT'] ?? '180d'),
    sweep: {
      enabled: env['RETENTION_SWEEP_ENABLED'] !== 'false',
      intervalMs: parseDurationMs(env['RETENTION_SWEEP_INTERVAL'] ?? '1h'),
      batchSize: Number(env['RETENTION_SWEEP_BATCH'] ?? 1000),
      maxBatches: Number(env['RETENTION_SWEEP_MAX_BATCHES'] ?? 50),
    },
  };
}
