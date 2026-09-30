import { TestBed } from '@angular/core/testing';
import { provideFakeBrowserFacade } from '@portfolio/velista/platform';
import { MappingSettingsStore } from './mapping-settings-store';
import { ShopDetailMemory } from './shop-detail-memory';
import { SHOP_DETAIL_SERVICE } from './shop-detail-service';
import { ShopDetailStore } from './shop-detail-store';
import {
  MEMORY_OTHER_WALK_ID,
  MEMORY_SHOWN_WALK_ID,
  ShopWalkMemory,
} from './shop-walk-memory';
import { SHOP_WALK_SERVICE } from './shop-walk-service';
import { ShopWalksStore } from './shop-walks-store';

function harness(storage = new Map<string, string>()) {
  const memory = new ShopWalkMemory();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideFakeBrowserFacade(storage),
      ShopWalksStore,
      ShopDetailStore,
      MappingSettingsStore,
      { provide: SHOP_WALK_SERVICE, useValue: memory },
      { provide: SHOP_DETAIL_SERVICE, useValue: new ShopDetailMemory() },
    ],
  });
  return { store: TestBed.inject(ShopWalksStore), memory, storage };
}

/** Velista `0122`: a shop's walks, a walk, its log, and the writes on them. */
describe('ShopWalksStore', () => {
  it('lists a shop’s walks with the shown one first', async () => {
    const { store } = harness();

    expect(store.walksAt('loc-tejares')).toEqual({ kind: 'loading' });
    await store.loadWalks('loc-tejares');

    const read = store.walksAt('loc-tejares');
    expect(read.kind === 'walks' && read.walks.map((walk) => walk.id)).toEqual([
      MEMORY_SHOWN_WALK_ID,
      MEMORY_OTHER_WALK_ID,
    ]);
  });

  it('adds a new walk to the list, empty and not shown', async () => {
    const { store } = harness();
    await store.loadWalks('loc-tejares');

    const outcome = await store.create('loc-tejares', '  Spring  ');

    expect(outcome.state).toBe('done');
    const walk = outcome.state === 'done' ? outcome.value : null;
    expect(walk).toMatchObject({ name: 'Spring', shown: false, lastSeq: 0 });
    const read = store.walksAt('loc-tejares');
    expect(read.kind === 'walks' && read.walks.length).toBe(3);
  });

  it('showing one walk hides the other, in the list and in a held walk', async () => {
    const { store } = harness();
    await store.loadWalks('loc-tejares');
    await store.loadWalk(MEMORY_SHOWN_WALK_ID);

    await store.setShown(MEMORY_OTHER_WALK_ID, true);

    expect(store.summary(MEMORY_OTHER_WALK_ID)?.shown).toBe(true);
    expect(store.summary(MEMORY_SHOWN_WALK_ID)?.shown).toBe(false);
  });

  it('renames a walk everywhere it is held', async () => {
    const { store } = harness();
    await store.loadWalks('loc-tejares');
    await store.loadWalk(MEMORY_SHOWN_WALK_ID);

    await store.rename(MEMORY_SHOWN_WALK_ID, 'Winter');

    const read = store.walk(MEMORY_SHOWN_WALK_ID);
    expect(read.kind === 'walk' && read.detail.walk.name).toBe('Winter');
    const list = store.walksAt('loc-tejares');
    expect(list.kind === 'walks' && list.walks[0].name).toBe('Winter');
  });

  it('takes a deleted walk off the list and reads it as missing', async () => {
    const { store } = harness();
    await store.loadWalks('loc-tejares');

    await store.remove(MEMORY_OTHER_WALK_ID);

    const list = store.walksAt('loc-tejares');
    expect(list.kind === 'walks' && list.walks.map((walk) => walk.id)).toEqual([
      MEMORY_SHOWN_WALK_ID,
    ]);
    expect(store.walk(MEMORY_OTHER_WALK_ID)).toEqual({ kind: 'missing' });
  });

  describe('rewind', () => {
    it('appends a rewound entry on the lastSeq the log was read with', async () => {
      const { store, memory } = harness();
      await store.loadLog(MEMORY_SHOWN_WALK_ID);

      const outcome = await store.rewind(MEMORY_SHOWN_WALK_ID, 100_000);

      expect(outcome).toEqual({ state: 'rewound' });
      expect(memory.appended).toHaveLength(1);
      expect(memory.appended[0]).toMatchObject({
        kind: 'rewound',
        baseSeq: 9,
        logFrom: 260_000,
        logTo: 260_000,
        rewoundTo: 100_000,
        events: [],
      });
      // Read again, so the history shows the new entry.
      const log = store.log(MEMORY_SHOWN_WALK_ID);
      expect(log.kind === 'log' && log.log.lastSeq).toBe(10);
    });

    it('reads the walk again when another phone saved first', async () => {
      const { store, memory } = harness();
      await store.loadLog(MEMORY_SHOWN_WALK_ID);
      memory.appendElsewhere(MEMORY_SHOWN_WALK_ID);

      const outcome = await store.rewind(MEMORY_SHOWN_WALK_ID, 100_000);

      expect(outcome).toEqual({ state: 'changed' });
      const log = store.log(MEMORY_SHOWN_WALK_ID);
      expect(log.kind === 'log' && log.log.lastSeq).toBe(10);
      expect(memory.appended).toHaveLength(1);
    });

    it('never goes past the end of the log or before its start', async () => {
      const { store, memory } = harness();
      await store.loadLog(MEMORY_SHOWN_WALK_ID);

      await store.rewind(MEMORY_SHOWN_WALK_ID, -5);

      expect(memory.appended[0].rewoundTo).toBe(0);
    });
  });
});

describe('MappingSettingsStore', () => {
  it('walks across a shelf into a path by default', () => {
    harness();
    const settings = TestBed.inject(MappingSettingsStore);

    expect(settings.settings()).toEqual({ walkingAcrossMakesPath: true });
  });

  it('keeps the choice on the device under one key', () => {
    const storage = new Map<string, string>();
    harness(storage);
    TestBed.inject(MappingSettingsStore).setWalkingAcrossMakesPath(false);

    harness(storage);

    expect(TestBed.inject(MappingSettingsStore).settings()).toEqual({
      walkingAcrossMakesPath: false,
    });
    expect([...storage.keys()]).toEqual(['mapping-settings:velista']);
  });

  it('reads an unreadable record as the defaults', () => {
    harness(new Map([['mapping-settings:velista', '{not json']]));

    expect(TestBed.inject(MappingSettingsStore).settings()).toEqual({
      walkingAcrossMakesPath: true,
    });
  });
});
