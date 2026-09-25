import { TestBed } from '@angular/core/testing';
import type { BasketShop } from '@portfolio/velista/models';
import {
  BrowserFacade,
  fakeBrowserFacade,
  StorageKeys,
} from '@portfolio/velista/platform';
import {
  BOUGHT_SHOP_LIFETIME_MS,
  BoughtShopMemory,
  boughtShopRecord,
  parseBoughtShop,
} from './bought-shop-memory';

/**
 * The shop the zone list's "I bought this" starts on (velista `0114`): remembered on
 * a choice, forgotten on a clear, and ignored once the trip it belonged to is over.
 */

const NOW = Date.parse('2026-09-25T10:00:00.000Z');

const SHOP: BasketShop = {
  id: 'loc-1',
  supermarketId: 'chain-1',
  chain: { es: 'Mercadona', en: 'Mercadona' },
  label: { es: 'Ronda', en: 'Ronda' },
  address: 'Ronda de los Tejares 1',
  city: 'Córdoba',
  postalCode: '14008',
  inProfile: false,
};

describe('parseBoughtShop', () => {
  it('reads back the shop it was given', () => {
    expect(parseBoughtShop(boughtShopRecord(SHOP, NOW), NOW + 1000)).toEqual(
      SHOP
    );
  });

  it('forgets it once the trip is over', () => {
    const record = boughtShopRecord(SHOP, NOW);

    expect(
      parseBoughtShop(record, NOW + BOUGHT_SHOP_LIFETIME_MS - 1)
    ).not.toBeNull();
    expect(parseBoughtShop(record, NOW + BOUGHT_SHOP_LIFETIME_MS)).toBeNull();
  });

  it.each([
    ['nothing stored', null],
    ['something that is not JSON', '{nope'],
    ['another version', JSON.stringify({ version: 2, shop: {} })],
    [
      'a shop with no chain',
      JSON.stringify({ version: 1, shop: { value: { id: 'x' }, until: null } }),
    ],
    [
      'a date that is not a date',
      JSON.stringify({
        version: 1,
        shop: {
          value: { id: 'x', supermarketName: { es: 'A', en: 'A' } },
          until: 'soon',
        },
      }),
    ],
  ])('reads %s as no shop', (_name, raw) => {
    expect(parseBoughtShop(raw, NOW)).toBeNull();
  });
});

describe('BoughtShopMemory', () => {
  function build() {
    const storage = new Map<string, string>();
    TestBed.configureTestingModule({
      providers: [
        { provide: BrowserFacade, useValue: fakeBrowserFacade(storage) },
      ],
    });
    return { memory: TestBed.inject(BoughtShopMemory), storage };
  }

  it('remembers a shop under its own key and forgets it on a clear', () => {
    const { memory, storage } = build();

    memory.remember(SHOP, NOW);
    expect(storage.has(StorageKeys.boughtShop)).toBe(true);
    expect(memory.read(NOW)).toEqual(SHOP);

    memory.forget();
    expect(storage.has(StorageKeys.boughtShop)).toBe(false);
    expect(memory.read(NOW)).toBeNull();
  });
});
