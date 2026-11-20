import { HarvestRunMode } from '../enums/harvest.enums';
import { isNarrowedRun, isNarrowedRunRequest } from './run-narrowing';

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
});
