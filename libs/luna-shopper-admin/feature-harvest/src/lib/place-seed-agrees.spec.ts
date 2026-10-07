import { TestBed } from '@angular/core/testing';
import {
  ContentLocaleStore,
  PLACE_CHAIN_SEED,
  PLACE_SHOP_SEED,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  LOCATIONS,
  SUPERMARKETS,
} from '@portfolio/luna-shopper-admin/feature-catalog';
import {
  provideResources,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';

/**
 * The memory harvester and the memory catalog hold the same shops (admin plan
 * 0061, target 10).
 *
 * The harvester works out which shop a place may be against catalog. With
 * nothing listening there are two seeds in two libraries, and the one of the
 * harvester is a copy. A copy drifts, and then a place names a candidate that
 * the shop picker beside it cannot find. So the copy is compared here, where
 * both libraries can be read.
 */

const FIELDS = [
  'id',
  'supermarketId',
  'label',
  'address',
  'city',
  'country',
  'postalCode',
  'postalCodeSource',
  'latitude',
  'longitude',
  'externalRef',
  'externalProvider',
] as const;

function registry(): ResourceRegistry {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [ContentLocaleStore, provideResources(SUPERMARKETS, LOCATIONS)],
  });
  return TestBed.inject(ResourceRegistry);
}

describe('the shops the memory harvester knows', () => {
  it('are the chains of the catalog seed, each with its brand key', async () => {
    const page = await registry()
      .gatewayFor(SUPERMARKETS)
      .list({ filters: {}, limit: 100 });

    expect(
      page.items.map((row) => ({
        id: row['id'],
        name: row['name'],
        brandKey: row['externalBrandKey'],
      }))
    ).toEqual(PLACE_CHAIN_SEED.map((chain) => ({ ...chain })));
  });

  it('are the shops of the catalog seed, field for field', async () => {
    const resources = registry();
    const shops: Record<string, unknown>[] = [];

    for (const chain of PLACE_CHAIN_SEED) {
      const page = await resources
        .gatewayFor(LOCATIONS)
        .list({ filters: { supermarketId: chain.id }, limit: 100 });
      for (const row of page.items) {
        shops.push(
          Object.fromEntries(FIELDS.map((field) => [field, row[field]]))
        );
      }
    }

    expect(shops).toEqual(PLACE_SHOP_SEED.map((shop) => ({ ...shop })));
  });
});
