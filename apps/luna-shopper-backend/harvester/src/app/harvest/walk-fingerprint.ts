import {
  adapterCapabilities,
  HarvestRunMode,
  type AdapterKey,
} from '@portfolio/luna-shopper/contracts';
import { createHash } from 'node:crypto';
import type { SupermarketSource } from '../entities';

/** What a run stores at its creation about the adapter that walks it. */
export interface RunWalkConfig {
  adapterKey: AdapterKey | null;
  configFingerprint: string | null;
}

/** The adapter and config of a store discovery OpenStreetMap walks. */
const OPEN_STREET_MAP_WALK: Pick<SupermarketSource, 'adapterKey' | 'config'> = {
  adapterKey: 'osm-places',
  config: {},
};

/**
 * The adapter that does a run's work, and the fingerprint of what it walks
 * under (owner decisions 127b, 130b and 137b). The spawn and the postal code
 * queue both call this, so the rule exists once.
 *
 * - A file import reads an uploaded document and no adapter of the capability
 *   table, so it stores neither. It knows its total from the document.
 * - A store discovery is walked by the chain's own adapter only when that
 *   adapter lists its own shops, which is the table `StoreDiscoveryRunner`
 *   dispatches on. Every other store discovery, with no chain or with a chain
 *   whose adapter lists no shops, is walked by OpenStreetMap: it stores
 *   `osm-places` and the fingerprint of that adapter with an empty config, so
 *   two such runs carry one fingerprint.
 * - Every other run stores its source row's adapter and fingerprint, and
 *   neither when it has no row.
 */
export function runWalkConfig(
  mode: HarvestRunMode,
  source: Pick<SupermarketSource, 'adapterKey' | 'config'> | null
): RunWalkConfig {
  if (mode === HarvestRunMode.FILE_IMPORT) {
    return { adapterKey: null, configFingerprint: null };
  }
  const walker =
    mode === HarvestRunMode.STORE_DISCOVERY &&
    !(source && adapterCapabilities(source.adapterKey).listsItsOwnStores)
      ? OPEN_STREET_MAP_WALK
      : source;
  return walker
    ? {
        adapterKey: walker.adapterKey,
        configFingerprint: walkConfigFingerprint(walker),
      }
    : { adapterKey: null, configFingerprint: null };
}

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
