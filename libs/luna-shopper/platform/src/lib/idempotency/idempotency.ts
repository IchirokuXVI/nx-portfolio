/**
 * Idempotency building blocks (plan 0004, section 9).
 *
 * JetStream delivers at least once, so every event consumer must be idempotent:
 * a redelivered event has no extra effect. And orchestrated commands that span
 * services carry an idempotency key so a retry after a partial failure does not
 * create a duplicate. These are the shared primitives the consumer and saga code
 * in later plans build on; the concrete store (a table, a Redis set) is chosen
 * where it is used.
 */

/**
 * A dedupe store: `firstSeen` records a key and returns whether it was new. An
 * implementation is backed by a uniqueness constraint (an inbox table) or a TTL
 * set; consumers call it with the event id (or a natural key) before applying an
 * effect.
 */
export interface IdempotencyStore {
  /**
   * Records `key` and returns `true` if this is the first time it has been seen,
   * `false` if it was already recorded (a redelivery). Must be atomic.
   */
  firstSeen(key: string): Promise<boolean>;
}

/**
 * Runs `effect` at most once per `key`. On a redelivery (the key was already
 * seen) the effect is skipped and `undefined` is returned, so a consumer wraps
 * its handler in this to become idempotent without bespoke dedupe logic.
 */
export async function runOnce<T>(
  store: IdempotencyStore,
  key: string,
  effect: () => Promise<T>
): Promise<T | undefined> {
  const isFirst = await store.firstSeen(key);
  if (!isFirst) {
    return undefined;
  }
  return effect();
}

/**
 * Builds the dedupe key for an orchestrated command from its idempotency key and
 * a step name, so each step of a multi service saga dedupes independently (mint
 * temporary user, then create zone) under one client supplied key.
 */
export function commandStepKey(idempotencyKey: string, step: string): string {
  return `${idempotencyKey}:${step}`;
}
