/**
 * When a run of refusals stops being a few refused products and becomes a
 * chain that has stopped answering (plan 0215, section 3).
 *
 * **This library holds no numbers.** Each adapter library exports its own
 * constant beside its client (`MERCADONA_REFUSAL_POLICY` and so on), because
 * the numbers are a fact about that storefront and not about the guard. A
 * change for one chain is then one line in that chain's library.
 */
export interface RefusalPolicy {
  /** Refusals in a row that trip the guard. */
  consecutive: number;
  /** The window rule, or null for none. */
  window: { size: number; refusals: number } | null;
  /** How many times a run may pause before a trip stops it: 0 or 1. */
  coolDowns: 0 | 1;
  /** How long a pause lasts. */
  coolDownMs: number;
  /** How many probes, one at a time, may be refused after a pause before the run stops. */
  probes: number;
}
