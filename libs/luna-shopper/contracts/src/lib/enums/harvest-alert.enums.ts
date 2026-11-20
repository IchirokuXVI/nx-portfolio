/**
 * What a harvest alert reports (plan 0218, section 2). One row of
 * `harvest_alerts` holds one of these, and the mail says it in its subject.
 *
 * Nothing else writes an alert: an abort of any kind, a busy chain, a late
 * slot and a failing skip are not on this list on purpose.
 */
export enum HarvestAlertKind {
  /** A `MANUAL` or `SCHEDULED` run ended `FAILED`. */
  RUN_FAILED = 'RUN_FAILED',
  /** The same, and the run stopped because the chain kept refusing it (plan 0215). */
  RUN_BLOCKED = 'RUN_BLOCKED',
  /** The stale reaper marked a run of any trigger `STALE` (the owner, 2026-11-05). */
  RUN_STALE = 'RUN_STALE',
  /** The postal code queue gave up on a code after its last attempt (the owner, 2026-11-05). */
  POSTAL_CODE_FAILED = 'POSTAL_CODE_FAILED',
  /** A schedule slot or its retry ended `REFUSED`. */
  SLOT_REFUSED = 'SLOT_REFUSED',
  /** A person asked for a test mail. */
  TEST = 'TEST',
  /**
   * A probe found the storefront changed shape or refusing, as a change, or
   * unreachable at its third attempt (plan 0247, section 4.1).
   */
  PROBE_FAILED = 'PROBE_FAILED',
  /** A schedule slot or its retry was skipped because its probe did not pass (plan 0247). */
  SLOT_PROBE_FAILED = 'SLOT_PROBE_FAILED',
}

/**
 * Where one alert row is on its way to the inbox (plan 0218, section 5).
 * `SENT`, `SUPPRESSED` and `GAVE_UP` are final.
 */
export enum HarvestAlertStatus {
  PENDING = 'PENDING',
  SENDING = 'SENDING',
  SENT = 'SENT',
  /** No recipient or no SMTP host was configured when a worker claimed it. */
  SUPPRESSED = 'SUPPRESSED',
  /** Six send attempts failed. */
  GAVE_UP = 'GAVE_UP',
}
