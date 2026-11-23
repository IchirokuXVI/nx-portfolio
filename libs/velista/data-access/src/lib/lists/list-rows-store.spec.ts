import { TestBed } from '@angular/core/testing';
import {
  provideFakeBrowserFacade,
  StorageKeys,
} from '@portfolio/velista/platform';
import { ListRowsStore } from './list-rows-store';

/** Velista `0202`, section 2: the device's choice of view, kept under one key. */
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

describe('ListRowsStore (velista 0202)', () => {
  it('is the default view with no record', () => {
    expect(store(new Map()).layout()).toBe('default');
  });

  it.each([
    ['not JSON', '{compact'],
    ['not a record', '"compact"'],
    ['an unknown layout', '{"version":2,"layout":"dense"}'],
    ['no layout', '{"version":2}'],
    ['of no version', '{"layout":"compact"}'],
    ['of version 1', '{"version":1,"layout":"compact"}'],
    ['of a later version', '{"version":3,"layout":"compact"}'],
  ])('reads a record that is %s as the default', (_, raw) => {
    expect(store(new Map([[StorageKeys.listRows, raw]])).layout()).toBe(
      'default'
    );
  });

  it.each(['default', 'compact'] as const)(
    'reads back a version 2 record of the %s view',
    (layout) => {
      const storage = new Map([
        [StorageKeys.listRows, JSON.stringify({ version: 2, layout })],
      ]);
      expect(store(storage).layout()).toBe(layout);
    }
  );

  it('sets the signal and writes one record of version 2', () => {
    const storage = new Map<string, string>();
    const rows = store(storage);

    rows.setLayout('compact');

    expect(rows.layout()).toBe('compact');
    expect(JSON.parse(storage.get(StorageKeys.listRows) ?? 'null')).toEqual({
      version: 2,
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
