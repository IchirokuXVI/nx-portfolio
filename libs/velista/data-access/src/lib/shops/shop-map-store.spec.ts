import { TestBed } from '@angular/core/testing';
import type { Basket, BasketRow } from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  StorageKeys,
} from '@portfolio/velista/platform';
import { SessionStore } from '../auth/session-store';
import { BASKET_SERVICE } from '../baskets/basket-service';
import { MEMORY_SHOP_MAPS, ShopMapMemory } from './shop-map-memory';
import { SHOP_MAP_SERVICE } from './shop-map-service';
import { keepsShopMap, ShopMapStore } from './shop-map-store';

function row(
  rowKey: string,
  state: BasketRow['state'],
  optionIds: string[]
): BasketRow {
  return {
    rowKey,
    content: rowKey,
    left: 1,
    bought: 0,
    asked: 2,
    boughtElsewhere: 0,
    state,
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    optionIds,
    touchedBy: null,
    touchedAt: null,
    entries: [],
    usual: null,
  };
}

/** Only what `shopMapLinesOf` reads of a basket. */
function basket(rows: BasketRow[]): Basket {
  return {
    rows,
    products: new Map([
      ['i-eggs', { id: 'i-eggs', sectionIds: ['sec-mercadona-eggs'] }],
    ]),
  } as unknown as Basket;
}

function harness(
  options: {
    readonly storage?: Map<string, string>;
    readonly basket?: () => Promise<Basket>;
    readonly userId?: string | null;
  } = {}
) {
  const memory = new ShopMapMemory();
  const reads: { id: string; locationId: string | undefined }[] = [];
  const read = options.basket ?? (async () => basket([]));
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      ShopMapStore,
      { provide: SHOP_MAP_SERVICE, useValue: memory },
      {
        provide: BASKET_SERVICE,
        useValue: {
          getBasket: (id: string, locationId?: string) => {
            reads.push({ id, locationId });
            return read();
          },
          getLiveBasket: (locationId?: string) => {
            reads.push({ id: 'live', locationId });
            return read();
          },
        },
      },
      provideFakeBrowserFacade(options.storage ?? new Map()),
      {
        provide: SessionStore,
        useValue: {
          userId: () => (options.userId === undefined ? 'u-1' : options.userId),
        },
      },
    ],
  });
  return { store: TestBed.inject(ShopMapStore), memory, reads };
}

/** Velista `0121`, targets 3 and 6. */
describe('ShopMapStore', () => {
  it('opens a map with no basket, so there are no lines to count', async () => {
    const { store, reads } = harness();

    await store.open('loc-tejares', null);

    expect(store.status()).toBe('map');
    expect(store.map()?.walkId).toBe('walk-tejares');
    expect(store.lines()).toBeNull();
    expect(reads).toEqual([]);
  });

  it('reads the basket at the shop and keeps the lines a badge needs', async () => {
    const { store, reads } = harness({
      basket: async () =>
        basket([
          row('eggs', 'WANTED', ['i-eggs']),
          row('gone', 'REMOVED', ['i-eggs']),
          row('note', 'DONE', []),
        ]),
    });

    await store.open('loc-tejares', 'live');

    expect(reads).toEqual([{ id: 'live', locationId: 'loc-tejares' }]);
    expect(store.lines()).toEqual([
      {
        rowKey: 'eggs',
        content: 'eggs',
        quantity: 2,
        state: 'WANTED',
        sectionIds: ['sec-mercadona-eggs'],
      },
      {
        rowKey: 'note',
        content: 'note',
        quantity: 2,
        state: 'DONE',
        sectionIds: [],
      },
    ]);
  });

  it('reads a named basket by its id', async () => {
    const { store, reads } = harness();

    await store.open('loc-tejares', 'b-1');

    expect(reads).toEqual([{ id: 'b-1', locationId: 'loc-tejares' }]);
    expect(store.lines()).toEqual([]);
  });

  it('draws no list when the basket cannot be read at the shop', async () => {
    const { store } = harness({
      basket: () => Promise.reject(new Error('basket_shop_locked')),
    });

    await store.open('loc-tejares', 'b-1');

    expect(store.status()).toBe('map');
    expect(store.lines()).toBeNull();
  });

  it('says a shop with no map has none', async () => {
    const { store } = harness();

    await store.open('loc-centro', null);

    expect(store.status()).toBe('none');
    expect(store.map()).toBeNull();
  });

  it('opens the kept map when the network does not answer', async () => {
    const storage = new Map<string, string>();
    const first = harness({
      storage,
      basket: async () => basket([row('eggs', 'WANTED', ['i-eggs'])]),
    });
    await first.store.open('loc-tejares', 'live');
    expect(storage.has(StorageKeys.shopMap)).toBe(true);

    const second = harness({
      storage,
      basket: () => Promise.reject(new Error('offline')),
    });
    second.memory.failing = true;
    await second.store.open('loc-tejares', 'live');

    expect(second.store.status()).toBe('map');
    expect(second.store.fromDevice()).toBe(true);
    expect(second.store.map()?.document.areas).toEqual(
      first.store.map()?.document.areas
    );
    expect(second.store.lines()?.map((line) => line.rowKey)).toEqual(['eggs']);
  });

  it('ignores a kept map for another shop, or one past its time', async () => {
    const storage = new Map<string, string>();
    const first = harness({ storage });
    await first.store.open('loc-tejares', null);

    const other = harness({ storage });
    other.memory.failing = true;
    await other.store.open('loc-centro', null);
    expect(other.store.status()).toBe('failed');

    const record = JSON.parse(storage.get(StorageKeys.shopMap) ?? '{}');
    storage.set(
      StorageKeys.shopMap,
      JSON.stringify({ ...record, until: '2000-01-01T00:00:00.000Z' })
    );
    const late = harness({ storage });
    late.memory.failing = true;
    await late.store.open('loc-tejares', null);
    expect(late.store.status()).toBe('failed');
  });

  it('keeps a drawn map when a later read of it fails', async () => {
    const { store, memory } = harness();
    await store.open('loc-tejares', null);

    memory.failing = true;
    await store.retry();

    expect(store.status()).toBe('map');
  });

  it('keeps the body exactly as the wire sent it', async () => {
    const storage = new Map<string, string>();
    const { store } = harness({ storage });

    await store.open('loc-tejares', null);

    const record = JSON.parse(storage.get(StorageKeys.shopMap) ?? '{}');
    expect(record.body).toEqual(MEMORY_SHOP_MAPS['loc-tejares']);
  });

  it('keys the live basket by account, so another account on the phone reads no lines', async () => {
    const storage = new Map<string, string>();
    const first = harness({
      storage,
      basket: async () => basket([row('eggs', 'WANTED', ['i-eggs'])]),
    });
    await first.store.open('loc-tejares', 'live');
    expect(JSON.parse(storage.get(StorageKeys.shopMap) ?? '{}').basket).toBe(
      'live:u-1'
    );

    const other = harness({
      storage,
      userId: 'u-2',
      basket: () => Promise.reject(new Error('offline')),
    });
    other.memory.failing = true;
    await other.store.open('loc-tejares', 'live');

    expect(other.store.status()).toBe('map');
    expect(other.store.lines()).toBeNull();
  });
});

describe('keepsShopMap', () => {
  const now = Date.parse('2026-09-30T10:00:00.000Z');
  const record = (patch: Record<string, unknown>) =>
    JSON.stringify({
      version: 1,
      locationId: 'loc-tejares',
      until: '2026-09-30T11:00:00.000Z',
      body: MEMORY_SHOP_MAPS['loc-tejares'],
      basket: null,
      lines: null,
      ...patch,
    });

  it('answers yes for a map of this shop still in its time', () => {
    expect(keepsShopMap(record({}), 'loc-tejares', now)).toBe(true);
  });

  it('answers no for another shop, a time gone by, a map it cannot draw or nothing', () => {
    expect(keepsShopMap(record({}), 'loc-centro', now)).toBe(false);
    expect(
      keepsShopMap(
        record({ until: '2026-09-30T09:00:00.000Z' }),
        'loc-tejares',
        now
      )
    ).toBe(false);
    expect(
      keepsShopMap(record({ body: { map: null } }), 'loc-tejares', now)
    ).toBe(false);
    expect(keepsShopMap(null, 'loc-tejares', now)).toBe(false);
    expect(keepsShopMap('{', 'loc-tejares', now)).toBe(false);
  });
});
