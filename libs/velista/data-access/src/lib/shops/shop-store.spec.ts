import { TestBed } from '@angular/core/testing';
import type { Page, Shop } from '@portfolio/velista/models';
import { ShoppingProfileStore } from '../profiles/shopping-profile-store';
import { ShopMemory } from './shop-memory';
import {
  SHOP_SERVICE,
  type ShopQuery,
  type ShopServiceI,
} from './shop-service';
import { OTHER_CHAINS, ShopStore } from './shop-store';

/**
 * The store behind the supermarkets screen (plan 0059).
 *
 * What is asserted here is what the page cannot see: the sequence guard that drops a
 * stale answer, the revert after a failed write, and the OTHER bucket's read, which is
 * the one selection the server cannot be asked about and is therefore filtered here.
 */

const PROFILE = 'sp1';

/** A `ShoppingProfileStore` reduced to the one method this store calls on it. */
function profileStore() {
  return {
    setChainsExcluded: jest.fn().mockResolvedValue('saved' as const),
  };
}

function build(service: ShopServiceI, profiles = profileStore()) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      ShopStore,
      { provide: SHOP_SERVICE, useValue: service },
      { provide: ShoppingProfileStore, useValue: profiles },
    ],
  });

  return { store: TestBed.inject(ShopStore), profiles };
}

describe('ShopStore', () => {
  it('buckets the chains with no brand key into OTHER, and counts them together', async () => {
    const { store } = build(new ShopMemory());
    await store.open(PROFILE);

    const other = store.chains().find((chain) => chain.key === OTHER_CHAINS);

    // Two independents in the fake, one shop each, and the bucket is one button.
    expect(other?.locations).toBe(2);
    expect(other?.name).toBeNull();
    expect(store.chains().filter((chain) => chain.name === null)).toHaveLength(
      1
    );
  });

  it('reads OTHER unfiltered and keeps only the keyless chains', async () => {
    // The server has never heard the word: it is not a chain, so the read cannot name it
    // and the filtering happens here.
    const asked: ShopQuery[] = [];
    const memory = new ShopMemory();
    const { store } = build({
      summarizeChains: (profileId) => memory.summarizeChains(profileId),
      searchShops: (query) => {
        asked.push(query);
        return memory.searchShops(query);
      },
      setLocationPreferences: (profileId, locations) =>
        memory.setLocationPreferences(profileId, locations),
    });

    await store.open(PROFILE);
    await store.select(OTHER_CHAINS);

    expect(asked[0].supermarketId).toBeUndefined();
    expect(
      store
        .shops()
        .map((shop) => shop.id)
        .sort()
    ).toEqual(['shop-fruteria', 'shop-panaderia']);
  });

  it('puts a shop back when the write fails, and says which one', async () => {
    const memory = new ShopMemory();
    const { store } = build({
      summarizeChains: (profileId) => memory.summarizeChains(profileId),
      searchShops: (query) => memory.searchShops(query),
      setLocationPreferences: async () => {
        throw new Error('offline');
      },
    });

    await store.open(PROFILE);
    await store.select('sm-dia');
    const shopId = store.shops()[0].id;

    await store.toggleShop(shopId);

    // The row is back on, and the failure is named against the row it belongs to rather
    // than drawn over the whole screen.
    expect(store.shops()[0].excluded).toBe(false);
    expect(store.failed(shopId)).toBe(true);
  });

  it('moves the franchise count with the row it summarizes', async () => {
    const { store } = build(new ShopMemory());
    await store.open(PROFILE);
    await store.select('sm-mercadona');

    await store.toggleShop(store.shops()[0].id);

    expect(
      store.chains().find((chain) => chain.key === 'sm-mercadona')?.excluded
    ).toBe(1);
  });

  it('refuses to write from a row whose brand is already refused', async () => {
    // An excluded chain hides every one of its shops whatever their own rows say, so a
    // write from here would store a decision the resolver ignores.
    const memory = new ShopMemory();
    const writes = jest.fn(async () => undefined);
    const { store } = build({
      summarizeChains: (profileId) => memory.summarizeChains(profileId),
      searchShops: (query) => memory.searchShops(query),
      setLocationPreferences: writes,
    });

    memory.excludeChain(PROFILE, 'sm-dia', true);
    await store.open(PROFILE);
    await store.select('sm-dia');

    await store.toggleShop(store.shops()[0].id);

    expect(writes).not.toHaveBeenCalled();
  });

  it('writes every independent at once when OTHER is refused', async () => {
    const { store, profiles } = build(new ShopMemory());
    await store.open(PROFILE);

    await store.setChainExcluded(OTHER_CHAINS, true);

    expect(profiles.setChainsExcluded).toHaveBeenCalledWith(
      PROFILE,
      ['sm-fruteria', 'sm-panaderia'],
      true
    );
  });

  it('drops an answer that arrives after the reader has moved on', async () => {
    // Two reads can be in flight when somebody types through the beat, and they can
    // answer out of order.
    const slow = new Map<string, (page: Page<Shop>) => void>();
    const memory = new ShopMemory();
    const { store } = build({
      summarizeChains: (profileId) => memory.summarizeChains(profileId),
      searchShops: (query) =>
        new Promise<Page<Shop>>((resolve) => {
          slow.set(query.query ?? '', resolve);
        }),
      setLocationPreferences: async () => undefined,
    });

    await store.open(PROFILE);
    const first = store.search('slow');
    const second = store.search('fast');

    slow.get('fast')?.({ items: [shop('fast-shop')], nextCursor: null });
    await second;
    slow.get('slow')?.({ items: [shop('slow-shop')], nextCursor: null });
    await first;

    expect(store.shops().map((row) => row.id)).toEqual(['fast-shop']);
  });
});

/** A shop with nothing on it but an id, for the ordering test. */
function shop(id: string): Shop {
  return {
    id,
    supermarketId: 'sm-x',
    chainName: { en: 'X', es: 'X' },
    name: null,
    address: null,
    city: null,
    postalCode: '14001',
    postalCodeDerived: false,
    provider: 'OSM',
    excluded: false,
    excludedChain: false,
  };
}
