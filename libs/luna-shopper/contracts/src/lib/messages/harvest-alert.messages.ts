import type { AdminCredential } from './admin-auth.messages';

/**
 * The harvester's alerts to the owner (plan 0218, section 7).
 *
 * The alerts themselves are written by the harvester in the transaction of the
 * outcome they report, and sent by its own worker. The one subject here is the
 * test: an alert path that nobody has seen deliver is a trap, so the owner can
 * queue one mail and look in the inbox.
 */
export const HARVEST_ALERT_PATTERNS = {
  /** Queue one `TEST` alert. The worker sends it within 30 seconds. */
  sendTest: 'harvestAlert.sendTest',
} as const;

/** A test alert names no subject of its own: the credential is the request. */
export type SendHarvestTestAlertRequest = AdminCredential;

/**
 * The test alert that was queued, and whether this deployment can send it.
 *
 * The two flags say what the worker will do with the row: with either false it
 * marks the row `SUPPRESSED` and sends nothing. The recipient itself is never
 * answered, because it lives in a Secret.
 */
export interface HarvestTestAlertView {
  /** The id of the `harvest_alerts` row. */
  id: string;
  queuedAt: string;
  /** `HARVEST_ALERT_EMAIL` holds at least one address. */
  recipientConfigured: boolean;
  /** `SMTP_HOST` is set. */
  smtpConfigured: boolean;
}
