import { TestBed } from '@angular/core/testing';
import {
  provideFakeBrowserFacade,
  StorageKeys,
} from '@portfolio/velista/platform';
import { ListRowsStore } from './list-rows-store';

/** Velista `0191`, section 1: the device's choice of row, kept under one key. */
function store(
  storage: Map<string, string>,
  overrides: Parameters<typeof provideFakeBrowserFacade>[1] = {}
): ListRowsStore {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideFakeBrowserFacade(storage, overrides), ListRowsStore],
  });
  return TestBed.inject(ListRowsStore);
}

describe('ListRowsStore (velista 0191)', () => {
  it('is the row of today with no record', () => {
    expect(store(new Map()).layout()).toBe('default');
  });

  it.each([
    ['not JSON', '{compact'],
    ['not a record', '"compact"'],
    ['an unknown layout', '{"version":1,"layout":"dense"}'],
    ['no layout', '{"version":1}'],
  ])('reads a record that is %s as the default', (_, raw) => {
    expect(store(new Map([[StorageKeys.listRows, raw]])).layout()).toBe(
      'default'
    );
  });

  it('reads back a compact record', () => {
    const storage = new Map([
      [StorageKeys.listRows, '{"version":1,"layout":"compact"}'],
    ]);
    expect(store(storage).layout()).toBe('compact');
  });

  it('sets the signal and writes one versioned record', () => {
    const storage = new Map<string, string>();
    const rows = store(storage);

    rows.setLayout('compact');

    expect(rows.layout()).toBe('compact');
    expect(JSON.parse(storage.get(StorageKeys.listRows) ?? 'null')).toEqual({
      version: 1,
      layout: 'compact',
    });
    // A second store on the same device reads the choice back.
    expect(store(storage).layout()).toBe('compact');
  });

  it('keeps the choice for the document when the storage throws', () => {
    const rows = store(new Map(), {
      writeStorage: () => {
        throw new Error('QuotaExceededError');
      },
    });

    rows.setLayout('compact');

    expect(rows.layout()).toBe('compact');
  });
});
