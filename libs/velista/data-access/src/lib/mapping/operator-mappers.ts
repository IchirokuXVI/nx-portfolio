import type { OperatorSettings } from '@portfolio/velista/models';
import { isRecord, oneOfOrNull } from './primitives';

/**
 * `GET /v1/legal/settings` (backend `0231`, section 2) into `OperatorSettings`
 * (velista `0172`, target 1).
 *
 * Rule D4: the body is `unknown` until this says otherwise, and nothing from the
 * backend's contracts is imported, not even as a type.
 *
 * What makes the answer unreadable, and so `null`:
 *
 * - no `appName` or no `terms.version`. Without the name the documents cannot say
 *   whose they are, and without the version nobody can accept the terms;
 * - a `retention` number that is not a whole number of days, because the policy
 *   prints each one as a period, and a period this build cannot read is a sentence it
 *   must not draw. `backupDays` may be null, which means off site backups are off.
 *   `adminLoginFailureDays` is the exception: no document prints it, so it reads as
 *   null when it is missing or unreadable.
 *
 * What does not: a missing feature flag reads as `false`, so a field the server did
 * not send never offers a feature; an unreadable date reads as null and the page
 * leaves its date line out; an AI provider this build does not know reads as null.
 *
 * `published` is the server's flag **and** both of the operator's values present. A
 * page that drew a published policy with a blank controller would print a hole where
 * the law wants a name, so a body that disagrees with itself reads as unpublished.
 */
export function toOperatorSettings(raw: unknown): OperatorSettings | null {
  if (!isRecord(raw)) {
    return null;
  }

  const appName = text(raw['appName']);
  const terms = isRecord(raw['terms']) ? raw['terms'] : null;
  const version = terms === null ? null : text(terms['version']);
  if (appName === null || terms === null || version === null) {
    return null;
  }

  const retention = isRecord(raw['retention']) ? raw['retention'] : null;
  if (retention === null) {
    return null;
  }
  const auditTrailDays = days(retention['auditTrailDays']);
  // Not printed by either document, so it never fails the store: a missing or
  // unreadable value is null, and the flags plans 0173 and 0174 read stay readable.
  const adminLoginFailureDays = days(retention['adminLoginFailureDays']);
  const expiredGrantDays = days(retention['expiredGrantDays']);
  const applicationLogDays = days(retention['applicationLogDays']);
  const assistantLogDays = days(retention['assistantLogDays']);
  const rawBackupDays = retention['backupDays'];
  const backupDays =
    rawBackupDays === null || rawBackupDays === undefined
      ? null
      : days(rawBackupDays);
  if (
    auditTrailDays === null ||
    expiredGrantDays === null ||
    applicationLogDays === null ||
    assistantLogDays === null ||
    (backupDays === null &&
      rawBackupDays !== null &&
      rawBackupDays !== undefined)
  ) {
    return null;
  }

  const controllerName = text(raw['controllerName']);
  const contactEmail = text(raw['contactEmail']);
  const features = isRecord(raw['features']) ? raw['features'] : {};
  const processors = isRecord(raw['processors']) ? raw['processors'] : {};
  const privacy = isRecord(raw['privacy']) ? raw['privacy'] : {};

  return {
    appName,
    controllerName,
    contactEmail,
    published:
      raw['published'] === true &&
      controllerName !== null &&
      contactEmail !== null,
    terms: {
      version,
      updatedOn: calendarDate(terms['updatedOn']),
      acceptanceRequired: terms['acceptanceRequired'] === true,
    },
    privacyUpdatedOn: calendarDate(privacy['updatedOn']),
    features: {
      googleSignIn: features['googleSignIn'] === true,
      assistant: features['assistant'] === true,
      transcription: features['transcription'] === true,
      offsiteBackups: features['offsiteBackups'] === true,
      supportAccess: features['supportAccess'] === true,
    },
    processors: {
      hosting: text(processors['hosting']),
      email: text(processors['email']),
      aiText: oneOfOrNull(processors['aiText'], ['anthropic']),
      offsiteBackups: text(processors['offsiteBackups']),
    },
    retention: {
      auditTrailDays,
      adminLoginFailureDays,
      expiredGrantDays,
      applicationLogDays,
      assistantLogDays,
      backupDays,
    },
  };
}

/** A string with something in it, trimmed; anything else is null. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** A whole, non negative number of days, or null. */
function days(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A `YYYY-MM-DD` string, kept as a string: a calendar date has no time zone. */
function calendarDate(value: unknown): string | null {
  return typeof value === 'string' && CALENDAR_DATE.test(value) ? value : null;
}
