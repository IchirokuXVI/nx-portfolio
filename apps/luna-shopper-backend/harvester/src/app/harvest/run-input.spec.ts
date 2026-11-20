import {
  HarvestDetailFetch,
  HarvestRunMode,
  HarvestRunStatus,
  HarvestRunTrigger,
  HarvestRunWrites,
  PriceSourceKind,
} from '@portfolio/luna-shopper/contracts';
import type { HarvestRun } from '../entities';
import { toHarvestRunView } from './harvest.mappers';
import { readRunInput } from './run-input';

/**
 * A run's view carries the run's own request (owner decision 114a), read back
 * from `harvest_runs.input` and never from the preset it came from.
 */

function run(mode: HarvestRunMode, input: unknown): HarvestRun {
  return {
    id: 'run-1',
    supermarketId: 'chain-1',
    sourceId: 'source-1',
    mode,
    trigger: HarvestRunTrigger.MANUAL,
    status: HarvestRunStatus.RUNNING,
    requestedAt: new Date('2026-11-20T08:00:00Z'),
    startedAt: null,
    finishedAt: null,
    heartbeatAt: null,
    totalPlanned: null,
    processed: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    notFound: 0,
    skipped: 0,
    failed: 0,
    stage: null,
    stageLabel: null,
    warnings: [],
    documentSha256: null,
    abortRequestedAt: null,
    error: null,
    report: {},
    correlationId: null,
    requestedByUserId: 'admin-1',
    presetId: 'preset-1',
    input,
  } as unknown as HarvestRun;
}

describe('toHarvestRunView input', () => {
  it('carries what the walk stored, with its resolved defaults', () => {
    // The payload `HarvestRunService.validate` stores for a Mercadona walk.
    const view = toHarvestRunView(
      run(HarvestRunMode.CATALOG_DISCOVERY, {
        supermarketId: 'chain-1',
        priceScopeId: null,
        priceScopeIds: ['scope-a', 'scope-b'],
        detailBackfill: false,
        scopeCopies: [{ from: 'scope-a', to: ['scope-c'] }],
        writes: HarvestRunWrites.PRICES,
        details: HarvestDetailFetch.NEW,
      })
    );

    expect(view.input).toEqual({
      mode: HarvestRunMode.CATALOG_DISCOVERY,
      priceScopeIds: ['scope-a', 'scope-b'],
      scopeCopies: [{ from: 'scope-a', to: ['scope-c'] }],
      writes: HarvestRunWrites.PRICES,
      details: HarvestDetailFetch.NEW,
    });
  });

  it('answers null when the stored input cannot be read, never throws', () => {
    expect(
      toHarvestRunView(
        run(HarvestRunMode.CATALOG_DISCOVERY, { priceScopeIds: 'scope-a' })
      ).input
    ).toBeNull();
    expect(
      toHarvestRunView(run(HarvestRunMode.CATALOG_DISCOVERY, null)).input
    ).toBeNull();
  });
});

describe('toHarvestRunView walk configuration', () => {
  it('carries the fingerprint and the adapter the spawn stored', () => {
    const digest = 'e'.repeat(64);
    const view = toHarvestRunView({
      ...run(HarvestRunMode.CATALOG_DISCOVERY, {}),
      configFingerprint: digest,
      adapterKey: 'carrefour-web',
    });
    expect(view.configFingerprint).toBe(digest);
    expect(view.adapterKey).toBe('carrefour-web');
  });

  it('answers null for both on a run stored before the columns', () => {
    // The row of `run()` has neither field, as a row hydrated before them.
    const view = toHarvestRunView(run(HarvestRunMode.CATALOG_DISCOVERY, {}));
    expect(view.configFingerprint).toBeNull();
    expect(view.adapterKey).toBeNull();
    const stored = toHarvestRunView({
      ...run(HarvestRunMode.CATALOG_DISCOVERY, {}),
      configFingerprint: null,
      adapterKey: null,
    });
    expect(stored.configFingerprint).toBeNull();
    expect(stored.adapterKey).toBeNull();
  });
});

describe('readRunInput', () => {
  it('reads a backfill with its single scope', () => {
    expect(
      readRunInput(HarvestRunMode.CATALOG_DISCOVERY, {
        supermarketId: 'chain-1',
        priceScopeId: 'national',
        priceScopeIds: [],
        detailBackfill: true,
        scopeCopies: [],
        writes: HarvestRunWrites.PRICES_AND_AVAILABILITY,
        details: HarvestDetailFetch.ALL,
      })
    ).toEqual({
      mode: HarvestRunMode.CATALOG_DISCOVERY,
      priceScopeId: 'national',
      detailBackfill: true,
      writes: HarvestRunWrites.PRICES_AND_AVAILABILITY,
      details: HarvestDetailFetch.ALL,
    });
  });

  it('reads a walk stored before writes and details as its runner read it', () => {
    // `readWrites` and `readDetails` in the executor: both writes, every detail.
    expect(
      readRunInput(HarvestRunMode.CATALOG_DISCOVERY, {
        supermarketId: 'chain-1',
        priceScopeId: 'scope-a',
      })
    ).toEqual({
      mode: HarvestRunMode.CATALOG_DISCOVERY,
      priceScopeId: 'scope-a',
      writes: HarvestRunWrites.PRICES_AND_AVAILABILITY,
      details: HarvestDetailFetch.ALL,
    });
  });

  it('reads a store discovery, leaving out the empty centre', () => {
    expect(
      readRunInput(HarvestRunMode.STORE_DISCOVERY, {
        postalCode: '',
        country: 'es',
        radiusMetres: 3000,
        brandKeys: [],
        postalCodes: ['14013'],
      })
    ).toEqual({
      mode: HarvestRunMode.STORE_DISCOVERY,
      country: 'es',
      radiusMetres: 3000,
      brandKeys: [],
      postalCodes: ['14013'],
    });
  });

  it('reads a radius around a centre', () => {
    expect(
      readRunInput(HarvestRunMode.STORE_DISCOVERY, {
        postalCode: '14013',
        radiusMetres: 1500,
      })
    ).toEqual({
      mode: HarvestRunMode.STORE_DISCOVERY,
      postalCode: '14013',
      country: 'es',
      radiusMetres: 1500,
      brandKeys: [],
      postalCodes: [],
    });
  });

  it('reads the source kind and the window of an import, and leaves its document out', () => {
    // What `validateFileImport` stores (owner decision 129b).
    expect(
      readRunInput(HarvestRunMode.FILE_IMPORT, {
        supermarketId: 'chain-1',
        priceScopeId: 'national',
        sourceKind: 'OFFICIAL_LEAFLET',
        validFrom: '2026-11-01T00:00:00.000Z',
        validUntil: '2026-11-08T00:00:00.000Z',
        document: { products: [{ name: 'Leche' }] },
      })
    ).toEqual({
      mode: HarvestRunMode.FILE_IMPORT,
      priceScopeId: 'national',
      sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
      validFrom: '2026-11-01T00:00:00.000Z',
      validUntil: '2026-11-08T00:00:00.000Z',
    });
  });

  it('reads an import stored with no window, and one stored with neither field, as absent fields', () => {
    // A document that states no window resolves to none, which is what a
    // walk's export is: the spawn stores no instant then.
    expect(
      readRunInput(HarvestRunMode.FILE_IMPORT, {
        supermarketId: 'chain-1',
        priceScopeId: null,
        sourceKind: 'OFFICIAL_API',
        document: { products: [] },
      })
    ).toEqual({
      mode: HarvestRunMode.FILE_IMPORT,
      sourceKind: PriceSourceKind.OFFICIAL_API,
    });
    // An old row with neither field is not unreadable and states no null.
    const old = readRunInput(HarvestRunMode.FILE_IMPORT, {
      priceScopeId: 'national',
    });
    expect(old).toEqual({
      mode: HarvestRunMode.FILE_IMPORT,
      priceScopeId: 'national',
    });
    expect(old).not.toHaveProperty('sourceKind');
    expect(old).not.toHaveProperty('validFrom');
    expect(old).not.toHaveProperty('validUntil');
  });

  it.each([
    ['an array', HarvestRunMode.CATALOG_DISCOVERY, []],
    ['a string', HarvestRunMode.CATALOG_DISCOVERY, 'NEW'],
    [
      'a writes it does not know',
      HarvestRunMode.CATALOG_DISCOVERY,
      { writes: 'ALL' },
    ],
    [
      'a details it does not know',
      HarvestRunMode.CATALOG_DISCOVERY,
      { details: 'SOME' },
    ],
    [
      'a copy with no from',
      HarvestRunMode.CATALOG_DISCOVERY,
      { scopeCopies: [{ to: [] }] },
    ],
    [
      'a backfill flag that is text',
      HarvestRunMode.CATALOG_DISCOVERY,
      { detailBackfill: 'true' },
    ],
    [
      'a radius that is text',
      HarvestRunMode.STORE_DISCOVERY,
      { radiusMetres: '3000' },
    ],
    [
      'postal codes that are numbers',
      HarvestRunMode.STORE_DISCOVERY,
      { postalCodes: [14013] },
    ],
    [
      'a source kind it does not know',
      HarvestRunMode.FILE_IMPORT,
      { sourceKind: 'GUESSED' },
    ],
    [
      'a window bound that is a number',
      HarvestRunMode.FILE_IMPORT,
      { sourceKind: 'OFFICIAL_LEAFLET', validFrom: 1762000000000 },
    ],
    ['a mode this build does not know', 'REFRESH' as HarvestRunMode, {}],
  ])('answers null for %s', (_case, mode, stored) => {
    expect(readRunInput(mode, stored)).toBeNull();
  });
});
