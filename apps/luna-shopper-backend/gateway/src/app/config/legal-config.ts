import {
  DEFAULT_LEGAL_APP_NAME,
  effectiveTermsVersion,
  privacyUpdatedOn,
  termsUpdatedOn,
} from '@portfolio/luna-shopper/contracts';
import * as Joi from 'joi';

/**
 * What the gateway states about its deployment for the legal documents (plan
 * 0231, section 5).
 *
 * Three kinds of value, each from its own home:
 *
 * - **The operator's own** (`LEGAL_APP_NAME` to `LEGAL_PRIVACY_REVISION`):
 *   who runs this deployment and how to reach them. Never in the repository.
 *   The chart reads them from a values entry or from the provisioned operator
 *   Secret; a self hoster on Compose sets eight environment variables.
 * - **Chart owned facts** (`TERMS_ACCEPTANCE_REQUIRED`, the log and backup
 *   periods, `LEGAL_OFFSITE_BACKUPS`, `IMPERSONATION_ENABLED`): the shape of
 *   the deployment, fine to commit.
 * - **The retention periods** (`RETENTION_*`), the very keys plan 0233
 *   enforces with, reported here in whole days. The gateway refuses the same
 *   floors as auth, core and catalog, on the exact value, so it never prints
 *   a period that those services would refuse.
 *
 * Every key defaults so that a deployment that sets none of them boots and
 * answers `published: false` (the plan 0026 rule). The one combination refused
 * at boot is acceptance required of terms nobody published.
 */

/** `YYYY-MM-DD`, or empty for no revision. */
const revision = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .allow('')
  .default('');

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

/** A short duration (`180d`, `90d`, `14d`, `24h`), as auth's `parseDurationMs` reads it. */
function durationMs(value: string): number {
  const match = /^(\d+)\s*([smhdw])$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration: ${value}`);
  }
  return Number(match[1]) * UNIT_MS[match[2]];
}

/**
 * A retention period that refuses a value below `floor`, with the floors and
 * messages of auth, core and catalog (plan 0233, section 3). The floor is
 * compared on the exact value, before the policy rounds it down to days.
 */
const durationAtLeast = (fallback: string, floor: string) => {
  const floorMs = durationMs(floor);
  return Joi.string()
    .default(fallback)
    .custom((value: string, helpers) => {
      let ms: number;
      try {
        ms = durationMs(value);
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
};

const days = (fallback: number) =>
  Joi.number().integer().min(0).default(fallback);

/** Required non empty when acceptance is required, empty allowed otherwise. */
const publishedWhenRequired = (base: Joi.StringSchema) =>
  base
    .allow('')
    .default('')
    .when('TERMS_ACCEPTANCE_REQUIRED', {
      is: Joi.boolean().valid(true).required(),
      then: base.required().invalid(''),
    });

export const legalValidationSchema = {
  LEGAL_APP_NAME: Joi.string().allow('').default(''),
  LEGAL_CONTROLLER_NAME: publishedWhenRequired(Joi.string().trim()),
  LEGAL_CONTACT_EMAIL: publishedWhenRequired(
    Joi.string()
      .trim()
      .email({ tlds: { allow: false } })
  ),
  LEGAL_HOSTING_PROVIDER: Joi.string().allow('').default(''),
  LEGAL_EMAIL_PROVIDER: Joi.string().allow('').default(''),
  LEGAL_BACKUP_PROVIDER: Joi.string().allow('').default(''),
  LEGAL_TERMS_REVISION: revision,
  LEGAL_PRIVACY_REVISION: revision,

  TERMS_ACCEPTANCE_REQUIRED: Joi.boolean().default(false),
  LEGAL_OFFSITE_BACKUPS: Joi.boolean().default(false),
  LEGAL_BACKUP_RETENTION_DAYS: days(14),
  LEGAL_APPLICATION_LOG_DAYS: days(30),
  LEGAL_ASSISTANT_LOG_DAYS: days(7),
  RETENTION_AUDIT: durationAtLeast('180d', '7d'),
  RETENTION_ADMIN_LOGIN_FAILURES: durationAtLeast('90d', '1d'),
  RETENTION_EXPIRED_GRANTS: durationAtLeast('14d', '1d'),
  // Reported to the policy only. Auth alone enforces support sessions (plan
  // 0194); the chart gives both services the same value.
  IMPERSONATION_ENABLED: Joi.boolean().default(false),
};

/** The legal block of {@link GatewayConfig}. */
export interface LegalConfig {
  appName: string;
  controllerName: string | null;
  contactEmail: string | null;
  hostingProvider: string | null;
  emailProvider: string | null;
  backupProvider: string | null;
  terms: {
    /** The effective version, computed exactly as auth computes it. */
    version: string;
    updatedOn: string;
    acceptanceRequired: boolean;
  };
  privacyUpdatedOn: string;
  offsiteBackups: boolean;
  supportAccess: boolean;
  retention: {
    auditTrailDays: number;
    adminLoginFailureDays: number;
    expiredGrantDays: number;
    applicationLogDays: number;
    assistantLogDays: number;
    backupDays: number;
  };
}

/** A validated duration in whole days, rounded down. */
export function durationDays(value: string): number {
  return Math.floor(durationMs(value) / UNIT_MS['d']);
}

/** Empty reads as null. */
function orNull(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Reads the validated environment into {@link LegalConfig}. */
export function legalConfig(env: NodeJS.ProcessEnv = process.env): LegalConfig {
  const termsRevision = env['LEGAL_TERMS_REVISION'] ?? '';
  return {
    appName: orNull(env['LEGAL_APP_NAME']) ?? DEFAULT_LEGAL_APP_NAME,
    controllerName: orNull(env['LEGAL_CONTROLLER_NAME']),
    contactEmail: orNull(env['LEGAL_CONTACT_EMAIL']),
    hostingProvider: orNull(env['LEGAL_HOSTING_PROVIDER']),
    emailProvider: orNull(env['LEGAL_EMAIL_PROVIDER']),
    backupProvider: orNull(env['LEGAL_BACKUP_PROVIDER']),
    terms: {
      version: effectiveTermsVersion(termsRevision),
      updatedOn: termsUpdatedOn(termsRevision),
      acceptanceRequired: env['TERMS_ACCEPTANCE_REQUIRED'] === 'true',
    },
    privacyUpdatedOn: privacyUpdatedOn(env['LEGAL_PRIVACY_REVISION']),
    offsiteBackups: env['LEGAL_OFFSITE_BACKUPS'] === 'true',
    supportAccess: env['IMPERSONATION_ENABLED'] === 'true',
    retention: {
      auditTrailDays: durationDays(env['RETENTION_AUDIT'] ?? '180d'),
      adminLoginFailureDays: durationDays(
        env['RETENTION_ADMIN_LOGIN_FAILURES'] ?? '90d'
      ),
      expiredGrantDays: durationDays(env['RETENTION_EXPIRED_GRANTS'] ?? '14d'),
      applicationLogDays: Number(env['LEGAL_APPLICATION_LOG_DAYS'] ?? 30),
      assistantLogDays: Number(env['LEGAL_ASSISTANT_LOG_DAYS'] ?? 7),
      backupDays: Number(env['LEGAL_BACKUP_RETENTION_DAYS'] ?? 14),
    },
  };
}
