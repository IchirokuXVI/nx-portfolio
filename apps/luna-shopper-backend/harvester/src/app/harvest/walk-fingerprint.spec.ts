import { HarvestRunMode } from '@portfolio/luna-shopper/contracts';
import { createHash } from 'node:crypto';
import type { SupermarketSource } from '../entities';
import {
  canonicalJson,
  runWalkConfig,
  walkConfigFingerprint,
} from './walk-fingerprint';

/**
 * The digest of what shaped a walk outside its request (owner decision 130b).
 */
describe('walkConfigFingerprint', () => {
  function source(over: Partial<SupermarketSource> = {}): SupermarketSource {
    return {
      id: 'source-1',
      supermarketId: 'chain-1',
      adapterKey: 'carrefour-web',
      enabled: true,
      autoImportPlaces: false,
      config: {
        seedPath: '/supermercado/frescos/cat20002/c',
        baseUrl: 'https://example.test',
        nested: { b: 2, a: [3, 1] },
      },
      workers: 2,
      maxRequestsPerSecond: 1.5,
      lastRunAt: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
      ...over,
    } as SupermarketSource;
  }

  it('is a sha256 in hex over the canonical JSON of the adapter and the config', () => {
    const row = source();
    expect(walkConfigFingerprint(row)).toBe(
      createHash('sha256')
        .update(
          canonicalJson({ adapterKey: row.adapterKey, config: row.config })
        )
        .digest('hex')
    );
    expect(walkConfigFingerprint(row)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is equal for an equal config whose keys are in another order, at every depth', () => {
    const reordered = source({
      config: {
        nested: { a: [3, 1], b: 2 },
        baseUrl: 'https://example.test',
        seedPath: '/supermercado/frescos/cat20002/c',
      },
    });
    expect(walkConfigFingerprint(reordered)).toBe(
      walkConfigFingerprint(source())
    );
  });

  it('differs when a config value differs', () => {
    const base = walkConfigFingerprint(source());
    expect(
      walkConfigFingerprint(
        source({
          config: {
            ...source().config,
            seedPath: '/supermercado/bebidas/cat20003/c',
          },
        })
      )
    ).not.toBe(base);
    expect(
      walkConfigFingerprint(
        source({ config: { ...source().config, nested: { b: 2, a: [1, 3] } } })
      )
    ).not.toBe(base);
    // A key added to the config is a different configuration too.
    expect(
      walkConfigFingerprint(
        source({ config: { ...source().config, delistCountsCrawl: true } })
      )
    ).not.toBe(base);
  });

  it('differs when the adapter differs', () => {
    expect(walkConfigFingerprint(source({ adapterKey: 'deza-web' }))).not.toBe(
      walkConfigFingerprint(source())
    );
  });

  it('does not change with the rate or the switch of the row', () => {
    const base = walkConfigFingerprint(source());
    expect(
      walkConfigFingerprint(
        source({
          workers: 8,
          maxRequestsPerSecond: 4,
          enabled: false,
          autoImportPlaces: true,
          consecutiveFailures: 3,
          lastRunAt: new Date(),
        })
      )
    ).toBe(base);
  });

  it('reads an absent config as an empty one', () => {
    expect(
      walkConfigFingerprint(
        source({ config: undefined as unknown as Record<string, unknown> })
      )
    ).toBe(walkConfigFingerprint(source({ config: {} })));
  });
});

describe('canonicalJson', () => {
  it('sorts the keys of objects and keeps the order of arrays', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,1]},"b":1}'
    );
  });

  it('leaves out a key whose value is undefined, as JSON does', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

/**
 * Which adapter a run stores as the one that walks it (owner decision 137b).
 */
describe('runWalkConfig', () => {
  const osm = {
    adapterKey: 'osm-places',
    configFingerprint: walkConfigFingerprint({
      adapterKey: 'osm-places',
      config: {},
    }),
  };

  it('gives a store discovery with no source row osm-places', () => {
    expect(runWalkConfig(HarvestRunMode.STORE_DISCOVERY, null)).toEqual(osm);
  });

  it('gives a store discovery of a chain that lists no shops osm-places', () => {
    expect(
      runWalkConfig(HarvestRunMode.STORE_DISCOVERY, {
        adapterKey: 'manual',
        config: { note: 'typed by hand' },
      })
    ).toEqual(osm);
  });

  it("gives a store discovery of a chain that lists its shops the chain's row", () => {
    const row = { adapterKey: 'lidl-api' as const, config: { country: 'ES' } };
    expect(runWalkConfig(HarvestRunMode.STORE_DISCOVERY, row)).toEqual({
      adapterKey: 'lidl-api',
      configFingerprint: walkConfigFingerprint(row),
    });
  });

  it("gives a catalog discovery its source row's values", () => {
    const row = { adapterKey: 'carrefour-web' as const, config: { a: 1 } };
    expect(runWalkConfig(HarvestRunMode.CATALOG_DISCOVERY, row)).toEqual({
      adapterKey: 'carrefour-web',
      configFingerprint: walkConfigFingerprint(row),
    });
  });

  it('gives a file import neither, whatever row its chain has', () => {
    expect(
      runWalkConfig(HarvestRunMode.FILE_IMPORT, {
        adapterKey: 'mercadona-api',
        config: {},
      })
    ).toEqual({ adapterKey: null, configFingerprint: null });
  });
});
