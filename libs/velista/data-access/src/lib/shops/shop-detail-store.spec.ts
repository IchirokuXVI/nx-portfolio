import { TestBed } from '@angular/core/testing';
import { MEMORY_SHOP_DETAILS, ShopDetailMemory } from './shop-detail-memory';
import { SHOP_DETAIL_SERVICE } from './shop-detail-service';
import { ShopDetailStore } from './shop-detail-store';

function harness() {
  const memory = new ShopDetailMemory();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      ShopDetailStore,
      { provide: SHOP_DETAIL_SERVICE, useValue: memory },
    ],
  });
  return { store: TestBed.inject(ShopDetailStore), memory };
}

/** Velista `0121`: one shop, read once per session. */
describe('ShopDetailStore', () => {
  it('reads as loading before it is asked', () => {
    const { store } = harness();

    expect(store.read('loc-tejares')).toEqual({ kind: 'loading' });
  });

  it('holds a shop once it answers, and never asks again', async () => {
    const { store, memory } = harness();

    await Promise.all([
      store.ensure('loc-tejares'),
      store.ensure('loc-tejares'),
    ]);
    await store.ensure('loc-tejares');

    expect(store.read('loc-tejares')).toEqual({
      kind: 'shop',
      shop: MEMORY_SHOP_DETAILS['loc-tejares'],
    });
    expect(memory.asked).toEqual(['loc-tejares']);
  });

  it('holds a shop the catalog does not know as missing', async () => {
    const { store } = harness();

    await store.ensure('loc-nowhere');

    expect(store.read('loc-nowhere')).toEqual({ kind: 'missing' });
  });

  it('says a read failed, and asks again on the next call', async () => {
    const { store, memory } = harness();
    memory.failing = true;

    await store.ensure('loc-tejares');
    expect(store.read('loc-tejares')).toEqual({ kind: 'failed' });

    memory.failing = false;
    await store.ensure('loc-tejares');
    expect(store.read('loc-tejares').kind).toBe('shop');
    expect(memory.asked).toEqual(['loc-tejares', 'loc-tejares']);
  });
});
