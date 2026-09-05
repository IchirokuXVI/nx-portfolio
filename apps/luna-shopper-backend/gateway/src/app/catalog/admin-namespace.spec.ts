import { GUARDS_METADATA } from '@nestjs/common/constants';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  AdminHarvestEntriesController,
  AdminHarvestImportsController,
  AdminHarvestPlacesController,
  AdminHarvestRunsController,
  AdminHarvestSourcesController,
} from '../harvest/harvest.controller';
import {
  AdminCatalogItemPricesController,
  AdminCatalogItemsController,
  AdminCatalogLocationItemsController,
  AdminCatalogLocationsController,
  AdminCatalogPricePoliciesController,
  AdminCatalogPriceScopesController,
  AdminCatalogProductGroupsController,
  AdminCatalogSupermarketItemsController,
  AdminCatalogSupermarketsController,
} from './catalog-admin.controller';
import {
  CatalogItemsController,
  CatalogLocationItemsController,
  CatalogLocationsController,
  CatalogPriceScopesController,
  CatalogProductGroupsController,
  CatalogScopeController,
  CatalogShopsController,
  CatalogSuggestController,
  CatalogSupermarketItemsController,
  CatalogSupermarketsController,
} from './catalog.controller';

/**
 * The admin API is its own namespace (plan 0073).
 *
 * Two things are asserted here, and they are two because the plan's rule has two
 * halves. **Different guard, different URL**: the URL half is read off the
 * committed OpenAPI document, which `openapi-document.spec.ts` already proves is
 * what the controllers produce, and the guard half is read off the controller
 * metadata, which is the only place a guard exists.
 *
 * The route table is written out rather than derived, deliberately. A test that
 * computed the expected paths from the controllers would pass no matter where the
 * controllers put them; this one fails if a route moves, which is the point of a
 * plan that is entirely about where routes are.
 */

const document = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', 'docs', 'openapi.json'),
    'utf8'
  )
) as { paths: Record<string, Record<string, unknown>> };

function has(method: string, path: string): boolean {
  return Boolean(document.paths[path]?.[method]);
}

function guardsOf(controller: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[]) ?? [];
}

/** Section 3, verbatim: every row gains an `admin/` prefix, and nothing else moves. */
const MOVED: ReadonlyArray<readonly [string, string, string]> = [
  ['post', '/v1/catalog/supermarkets', '/v1/admin/catalog/supermarkets'],
  [
    'patch',
    '/v1/catalog/supermarkets/{id}',
    '/v1/admin/catalog/supermarkets/{id}',
  ],
  [
    'delete',
    '/v1/catalog/supermarkets/{id}',
    '/v1/admin/catalog/supermarkets/{id}',
  ],
  [
    'post',
    '/v1/catalog/supermarkets/{id}/locations',
    '/v1/admin/catalog/supermarkets/{id}/locations',
  ],
  ['patch', '/v1/catalog/locations/{id}', '/v1/admin/catalog/locations/{id}'],
  ['delete', '/v1/catalog/locations/{id}', '/v1/admin/catalog/locations/{id}'],
  ['post', '/v1/catalog/items', '/v1/admin/catalog/items'],
  ['patch', '/v1/catalog/items/{id}', '/v1/admin/catalog/items/{id}'],
  ['delete', '/v1/catalog/items/{id}', '/v1/admin/catalog/items/{id}'],
  ['post', '/v1/catalog/product-groups', '/v1/admin/catalog/product-groups'],
  [
    'patch',
    '/v1/catalog/product-groups/{id}',
    '/v1/admin/catalog/product-groups/{id}',
  ],
  [
    'delete',
    '/v1/catalog/product-groups/{id}',
    '/v1/admin/catalog/product-groups/{id}',
  ],
  // The price writes of plan 0073's table moved to `item-prices` under plan
  // 0080: a price is inserted and removed, never upserted, and the materialized
  // row keeps one write, availability. The old paths are asserted gone below.
  ['post', '/v1/catalog/item-prices', '/v1/admin/catalog/item-prices'],
  [
    'delete',
    '/v1/catalog/item-prices/{id}',
    '/v1/admin/catalog/item-prices/{id}',
  ],
  [
    'put',
    '/v3/catalog/supermarket-items/availability',
    '/v3/admin/catalog/supermarket-items/availability',
  ],
  [
    'patch',
    '/v1/catalog/price-policies/{sourceKind}',
    '/v1/admin/catalog/price-policies/{sourceKind}',
  ],
  ['post', '/v1/catalog/price-scopes', '/v1/admin/catalog/price-scopes'],
  [
    'patch',
    '/v1/catalog/price-scopes/{id}',
    '/v1/admin/catalog/price-scopes/{id}',
  ],
  [
    'delete',
    '/v1/catalog/price-scopes/{id}',
    '/v1/admin/catalog/price-scopes/{id}',
  ],
  ['put', '/v1/catalog/location-items', '/v1/admin/catalog/location-items'],
];

/** Section 3's other list: what velista calls, which does not move. */
const STAYED: ReadonlyArray<readonly [string, string]> = [
  ['get', '/v1/catalog/supermarkets'],
  ['get', '/v1/catalog/supermarkets/{id}'],
  ['get', '/v1/catalog/supermarkets/{id}/locations'],
  ['get', '/v1/catalog/locations/{id}'],
  ['get', '/v1/catalog/locations/{id}/offers'],
  ['get', '/v1/catalog/shops'],
  ['get', '/v1/catalog/shops/summary'],
  ['get', '/v1/catalog/items'],
  ['get', '/v1/catalog/items/{id}'],
  ['get', '/v1/catalog/items/offers'],
  ['get', '/v1/catalog/items/{id}/offers'],
  ['get', '/v1/catalog/product-groups'],
  ['get', '/v1/catalog/product-groups/{id}'],
  ['get', '/v1/catalog/product-groups/{id}/items'],
  ['get', '/v1/catalog/suggest'],
  ['get', '/v1/catalog/scope'],
  ['get', '/v3/catalog/supermarket-items'],
  ['get', '/v1/catalog/price-scopes'],
  ['get', '/v1/catalog/price-scopes/{id}/offers'],
  ['get', '/v1/catalog/location-items'],
];

const ADMIN_CONTROLLERS = [
  AdminCatalogSupermarketsController,
  AdminCatalogLocationsController,
  AdminCatalogItemsController,
  AdminCatalogProductGroupsController,
  AdminCatalogSupermarketItemsController,
  AdminCatalogItemPricesController,
  AdminCatalogPricePoliciesController,
  AdminCatalogPriceScopesController,
  AdminCatalogLocationItemsController,
  AdminHarvestRunsController,
  AdminHarvestPlacesController,
  AdminHarvestEntriesController,
  // The one upload route, which replaced the leaflet one (plan 0086, D6).
  AdminHarvestImportsController,
  AdminHarvestSourcesController,
];

const USER_CONTROLLERS = [
  CatalogSupermarketsController,
  CatalogLocationsController,
  CatalogShopsController,
  CatalogItemsController,
  CatalogProductGroupsController,
  CatalogSuggestController,
  CatalogScopeController,
  CatalogSupermarketItemsController,
  CatalogPriceScopesController,
  CatalogLocationItemsController,
];

describe('the admin API is its own namespace', () => {
  describe('every write of section 3 moved, and left nothing behind', () => {
    it.each(MOVED)('%s %s is now %s', (method, oldPath, newPath) => {
      expect(has(method, newPath)).toBe(true);
      // A 404 at the old path, which is what "left nothing behind" means over
      // HTTP: the operation is gone from the document, so Nest matches no route.
      expect(has(method, oldPath)).toBe(false);
    });
  });

  describe('every read velista calls stayed exactly where it was', () => {
    it.each(STAYED)('%s %s', (method, path) => {
      expect(has(method, path)).toBe(true);
    });

    /**
     * The one the plan singles out, and the one a mechanical "move every non
     * GET" refactor breaks. It is a read: it takes a body of ids because it
     * takes a list, it is how a list line renders its product, and velista holds
     * a user token.
     */
    it('POST /v1/catalog/items/lookup is a read and did not move', () => {
      expect(has('post', '/v1/catalog/items/lookup')).toBe(true);
      expect(has('post', '/v1/admin/catalog/items/lookup')).toBe(false);
    });

    /**
     * Plan 0080 retired the price upsert and the effective row's delete with
     * the overwriting they implemented, and moved the supermarket items
     * controllers to v3. Nothing answers at the old version.
     */
    it('leaves nothing at v2 supermarket-items, and no price upsert anywhere', () => {
      expect(has('get', '/v2/catalog/supermarket-items')).toBe(false);
      expect(has('get', '/v2/admin/catalog/supermarket-items')).toBe(false);
      expect(has('put', '/v3/admin/catalog/supermarket-items')).toBe(false);
      expect(has('delete', '/v3/admin/catalog/supermarket-items/{id}')).toBe(
        false
      );
      expect(has('get', '/v1/admin/catalog/item-prices')).toBe(true);
      expect(has('get', '/v1/admin/catalog/price-policies')).toBe(true);
    });

    it('leaves no other write outside the namespace', () => {
      const strays = Object.entries(document.paths).flatMap(([path, item]) =>
        path.includes('/catalog') && !path.includes('/admin/')
          ? Object.keys(item)
              .filter((method) => method !== 'get')
              .map((method) => `${method.toUpperCase()} ${path}`)
          : []
      );

      expect(strays).toEqual(['POST /v1/catalog/items/lookup']);
    });
  });

  describe('the guard is what the namespace is for', () => {
    it.each(ADMIN_CONTROLLERS.map((c) => [c.name, c] as const))(
      '%s requires an operator token',
      (_name, controller) => {
        expect(guardsOf(controller)).toEqual([AdminJwtGuard]);
      }
    );

    it.each(USER_CONTROLLERS.map((c) => [c.name, c] as const))(
      '%s requires a velista token',
      (_name, controller) => {
        expect(guardsOf(controller)).toEqual([JwtAuthGuard]);
      }
    );

    /**
     * Exit criterion: no route is reachable by both principals. The guards name
     * different passport strategies verifying against different keys, so holding
     * exactly one of them is the whole property, and a controller holding both
     * would accept whichever token turned up.
     */
    it('gives no controller both guards', () => {
      for (const controller of [...ADMIN_CONTROLLERS, ...USER_CONTROLLERS]) {
        const guards = guardsOf(controller);
        expect(guards).toHaveLength(1);
      }
    });
  });
});
