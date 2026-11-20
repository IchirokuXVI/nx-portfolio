import { createHash } from 'node:crypto';
import type { SupermarketSource } from '../entities';

/**
 * What shaped a walk outside its request, as a digest (owner decision 130b).
 *
 * sha256, hex, over the canonical JSON of the source row's `adapterKey` and
 * its whole `config`. A Carrefour seed path lives in `config` and can shrink a
 * walk, and the request does not state it, so two runs of one preset walked
 * the same thing only when this digest is equal too.
 *
 * **A digest and never the configuration.** A digest is enough to say whether
 * two runs walked under the same configuration, and it stays small on every
 * run row and in every list answer, however large `config` grows.
 *
 * The rate (`workers`, `maxRequestsPerSecond`) and `enabled` are left out on
 * purpose: they change how fast a walk goes or whether it may start, not what
 * it walks, and an operator who slows a chain down must not lose its
 * estimates.
 */
export function walkConfigFingerprint(
  source: Pick<SupermarketSource, 'adapterKey' | 'config'>
): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        adapterKey: source.adapterKey,
        config: source.config ?? {},
      })
    )
    .digest('hex');
}

/**
 * JSON with the keys of every object sorted, so a config stored as
 * `{ a, b }` and one stored as `{ b, a }` give one string. Arrays keep their
 * order, because the order of a list can be what a runner reads. A key whose
 * value is `undefined` is left out, as `JSON.stringify` leaves it out.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value === 'object' && value !== null) {
    const bag = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(bag)
        .sort()
        .filter((key) => bag[key] !== undefined)
        .map((key) => [key, sortKeys(bag[key])])
    );
  }
  return value;
}
