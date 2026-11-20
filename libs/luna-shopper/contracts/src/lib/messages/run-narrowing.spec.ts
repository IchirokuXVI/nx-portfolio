import { PriceSourceKind } from '../enums/catalog.enums';
import { HarvestRunMode } from '../enums/harvest.enums';
import type { HarvestRunInputRecord } from './harvest.messages';
import {
  isNarrowedRun,
  isNarrowedRunRequest,
  walkedUnderSameConfig,
} from './run-narrowing';

/**
 * Whether a run reads less than its chain's whole walk (owner decision 114a).
 * The back office draws no approximate total for such a run.
 */
describe('isNarrowedRunRequest', () => {
  it.each([
    [
      'a walk of named scopes',
      { mode: 'CATALOG_DISCOVERY', priceScopeIds: ['a'] },
    ],
    ['an EAN backfill', { mode: 'CATALOG_DISCOVERY', detailBackfill: true }],
    [
      'a store discovery of some postal codes',
      { mode: 'STORE_DISCOVERY', postalCodes: ['14013'] },
    ],
    [
      'a radius around a centre',
      { mode: 'STORE_DISCOVERY', postalCode: '14013' },
    ],
    ['a mode this build does not know', { mode: 'REFRESH' }],
  ])('answers true for %s', (_case, request) => {
    expect(isNarrowedRunRequest(request)).toBe(true);
  });

  it('answers true for an unknown request, null or undefined', () => {
    expect(isNarrowedRunRequest(null)).toBe(true);
    expect(isNarrowedRunRequest(undefined)).toBe(true);
  });

  it.each([
    ['a whole walk', { mode: 'CATALOG_DISCOVERY', priceScopeId: 'national' }],
    [
      'a walk that skips known details, writes availability and copies',
      {
        mode: 'CATALOG_DISCOVERY',
        details: 'NEW',
        writes: 'AVAILABILITY',
        scopeCopies: [{ from: 'a', to: ['b'] }],
      },
    ],
    [
      'a walk with blank scope ids',
      { mode: 'CATALOG_DISCOVERY', priceScopeIds: [' '] },
    ],
    [
      "a chain's whole shop list",
      {
        mode: 'STORE_DISCOVERY',
        postalCode: '',
        postalCodes: [],
        radiusMetres: 3000,
        brandKeys: ['Q1'],
      },
    ],
    ['a file import', { mode: 'FILE_IMPORT', priceScopeId: 'national' }],
  ])('answers false for %s', (_case, request) => {
    expect(isNarrowedRunRequest(request)).toBe(false);
  });

  it('names the modes of the enum', () => {
    // The file makes no value import of the enum, so its literals are checked
    // here against the values the wire carries.
    expect(isNarrowedRunRequest({ mode: HarvestRunMode.FILE_IMPORT })).toBe(
      false
    );
    expect(
      isNarrowedRunRequest({ mode: HarvestRunMode.CATALOG_DISCOVERY })
    ).toBe(false);
    expect(isNarrowedRunRequest({ mode: HarvestRunMode.STORE_DISCOVERY })).toBe(
      false
    );
  });
});

describe('isNarrowedRun', () => {
  it('answers true for a run whose input is null or absent', () => {
    expect(isNarrowedRun({ input: null })).toBe(true);
    expect(isNarrowedRun({ input: undefined })).toBe(true);
    expect(isNarrowedRun({})).toBe(true);
  });

  it('answers true for a run whose input names a mode this build does not know', () => {
    expect(isNarrowedRun({ input: { mode: 'REFRESH' } })).toBe(true);
  });

  it('answers by the input of a run that has one', () => {
    expect(
      isNarrowedRun({ input: { mode: 'STORE_DISCOVERY', postalCodes: ['1'] } })
    ).toBe(true);
    expect(isNarrowedRun({ input: { mode: 'CATALOG_DISCOVERY' } })).toBe(false);
  });

  it('answers by the input record of a file import, source kind and window included', () => {
    const input: HarvestRunInputRecord = {
      mode: HarvestRunMode.FILE_IMPORT,
      priceScopeId: 'national',
      sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
      validFrom: '2026-08-26T22:00:00.000Z',
      validUntil: '2026-09-23T21:59:59.999Z',
    };
    expect(isNarrowedRun({ input })).toBe(false);
  });
});

/**
 * Whether an earlier run may serve as the reference of a run (owner decision
 * 130b): only when both walked under one configuration that each states.
 */
describe('walkedUnderSameConfig', () => {
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);

  it.each([
    ['two equal fingerprints', A, A, true],
    ['two different fingerprints', A, B, false],
    ['a null on the run', null, A, false],
    ['a null on the reference', A, null, false],
    ['a null on both sides', null, null, false],
    ['an absent fingerprint on the run', undefined, A, false],
    ['an absent fingerprint on the reference', A, undefined, false],
    ['an absent fingerprint on both sides', undefined, undefined, false],
    ['two empty strings', '', '', false],
  ])('answers %s', (_case, run, reference, expected) => {
    expect(walkedUnderSameConfig(run, reference)).toBe(expected);
    // The order of the two runs does not matter.
    expect(walkedUnderSameConfig(reference, run)).toBe(expected);
  });
});
