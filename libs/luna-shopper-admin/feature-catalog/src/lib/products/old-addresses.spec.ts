import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DeploymentStore,
  ServerReachability,
  SessionStorage,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  adminRoutes,
  provideSections,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { CHAIN_RESOURCES, chainsRoutes } from '../chains/chains-routes';
import {
  OLD_CATALOG_SEGMENT,
  oldCatalogAddresses,
  oldProductAddresses,
} from './old-addresses';
import {
  PRODUCT_RESOURCES,
  PRODUCTS_SEGMENT,
  productsRoutes,
} from './products-routes';

/**
 * The addresses the five product screens had, and the Catalog section's own
 * (admin plan 0043, targets 7 and 8).
 *
 * Products, categories, product groups, prices and price policies were five
 * lists under `/catalog`, beside a dashboard at `/catalog` itself. A bookmark,
 * a link in a chat and the browser's own history still hold those addresses,
 * so each one is a redirect to where the same rows are now. One test per
 * address, against the two sections as the app declares them.
 *
 * **What is asserted is where the router comes to rest.** A redirect to a
 * product is followed by the product's own redirect to its Details tab.
 */

const SECTIONS: readonly AdminSection[] = [
  {
    key: 'chains',
    label: '',
    held: CHAIN_RESOURCES,
    screens: [...chainsRoutes(), oldCatalogAddresses()],
  },
  {
    key: 'products',
    label: '',
    segment: PRODUCTS_SEGMENT,
    held: PRODUCT_RESOURCES,
    heldTabs: true,
    screens: productsRoutes(),
  },
];

async function landOn(url: string): Promise<string> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter(adminRoutes(SECTIONS)),
      provideLocationMocks(),
      provideSections(...SECTIONS),
      SessionStorage,
      SessionStore,
      DeploymentStore,
    ],
  }).compileComponents();

  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  return router.url;
}

afterEach(() => TestBed.resetTestingModule());

describe('the address the Catalog section had', () => {
  /** Target 8: its tiles and its chart are a block of the overview now. */
  it('sends the section itself to the overview', async () => {
    expect(await landOn('/catalog')).toBe('/');
  });
});

describe('the addresses the products had', () => {
  it('sends the product list to the products', async () => {
    expect(await landOn('/catalog/items')).toBe('/products');
  });

  /** A list that was linked to narrowed opens narrowed. */
  it('keeps the query of the product list', async () => {
    expect(await landOn('/catalog/items?categoryId=cat_milk')).toBe(
      '/products?categoryId=cat_milk'
    );
    expect(await landOn('/catalog/items?productGroupId=none&query=leche')).toBe(
      '/products?productGroupId=none&query=leche'
    );
  });

  it('sends the form of a new product to its new place', async () => {
    expect(await landOn('/catalog/items/new')).toBe('/products/new');
  });

  it('sends one product to that product', async () => {
    expect(await landOn('/catalog/items/it_milk_1l')).toBe(
      '/products/it_milk_1l/details'
    );
  });

  /** The screen "one product at every scope" is the Prices tab. */
  it('sends a product at every scope to its Prices tab', async () => {
    expect(await landOn('/catalog/items/it_milk_1l/prices')).toBe(
      '/products/it_milk_1l/prices'
    );
  });
});

describe('the addresses the categories had', () => {
  it('sends the list to the Categories tab, and keeps its query', async () => {
    expect(await landOn('/catalog/categories')).toBe('/products/categories');
    expect(await landOn('/catalog/categories?kind=root')).toBe(
      '/products/categories?kind=root'
    );
  });

  it('sends a category and the form of a new one to their forms', async () => {
    expect(await landOn('/catalog/categories/cat_milk')).toBe(
      '/products/categories/cat_milk'
    );
    expect(await landOn('/catalog/categories/new')).toBe(
      '/products/categories/new'
    );
  });
});

describe('the addresses the product groups had', () => {
  it('sends the list to the Groups tab, and keeps its query', async () => {
    expect(await landOn('/catalog/product-groups')).toBe('/products/groups');
    expect(await landOn('/catalog/product-groups?query=milk')).toBe(
      '/products/groups?query=milk'
    );
  });

  it('sends a group, its form and the form of a new one to their places', async () => {
    expect(await landOn('/catalog/product-groups/pg_whole_milk')).toBe(
      '/products/groups/pg_whole_milk'
    );
    expect(await landOn('/catalog/product-groups/pg_whole_milk/edit')).toBe(
      '/products/groups/pg_whole_milk/edit'
    );
    expect(await landOn('/catalog/product-groups/new')).toBe(
      '/products/groups/new'
    );
  });
});

describe('the addresses the prices had', () => {
  /** Target 7: the Prices screen is removed. */
  it('sends the price list to the products', async () => {
    expect(await landOn('/catalog/prices')).toBe('/products');
  });

  /** The price list at one scope is the product list at that scope. */
  it('opens the products at the scope the price list was narrowed to', async () => {
    expect(await landOn('/catalog/prices?priceScopeId=ps_mercadona_4661')).toBe(
      '/products?priceScopeId=ps_mercadona_4661'
    );
  });

  it('turns its "out of date" filter into the state of the list', async () => {
    expect(
      await landOn('/catalog/prices?priceScopeId=ps_mercadona_4661&stale=true')
    ).toBe('/products?priceScopeId=ps_mercadona_4661&priceState=stale');
  });

  /**
   * A filter of the old list with no counterpart is dropped: the product
   * route would refuse a parameter it does not declare.
   */
  it('drops a filter the product list does not have', async () => {
    expect(await landOn('/catalog/prices?sourceKind=ADMIN')).toBe('/products');
    expect(await landOn('/catalog/prices?stale=true')).toBe('/products');
  });

  it('sends the price list narrowed to a product to that product’s prices', async () => {
    expect(await landOn('/catalog/prices?itemId=it_milk_1l')).toBe(
      '/products/it_milk_1l/prices'
    );
    expect(
      await landOn(
        '/catalog/prices?itemId=it_milk_1l&priceScopeId=ps_consum_centro'
      )
    ).toBe('/products/it_milk_1l/prices?scope=ps_consum_centro');
  });

  /** Target 7: one price goes to its product, with that scope open. */
  it('sends one price to the Prices tab of its product, with its scope open', async () => {
    expect(
      await landOn('/catalog/prices/it_olive_oil_1l~ps_mercadona_4661')
    ).toBe('/products/it_olive_oil_1l/prices?scope=ps_mercadona_4661');
  });

  it('sends a price address that names no product to the products', async () => {
    expect(await landOn('/catalog/prices/nonsense')).toBe('/products');
  });

  it('sends the add a price form to where a price is added now', async () => {
    expect(await landOn('/catalog/prices/new')).toBe('/products');
    expect(
      await landOn(
        '/catalog/prices/new?itemId=it_dish_soap&priceScopeId=ps_mercadona_national'
      )
    ).toBe('/products/it_dish_soap/prices?scope=ps_mercadona_national');
  });
});

describe('the addresses the price policies had', () => {
  it('sends the list to the Price rules tab', async () => {
    expect(await landOn('/catalog/price-policies')).toBe(
      '/products/price-rules'
    );
  });

  it('sends one policy to that rule, its form open', async () => {
    expect(await landOn('/catalog/price-policies/OFFICIAL_API')).toBe(
      '/products/price-rules/OFFICIAL_API'
    );
  });
});

describe('the old addresses, as routes', () => {
  /**
   * Every one is a route with no component, so none of them can draw a
   * screen at an old address by accident.
   */
  it('is redirects and nothing else', () => {
    const routes = oldProductAddresses();

    expect(routes.map((route) => route.path)).toEqual([
      'items',
      'items/new',
      'items/:id/prices',
      'items/:id',
      'categories',
      'categories/new',
      'categories/:id',
      'product-groups',
      'product-groups/new',
      'product-groups/:id/edit',
      'product-groups/:id',
      'prices',
      'prices/new',
      'prices/:id',
      'price-policies',
      'price-policies/:id',
    ]);
    for (const route of routes) {
      expect(route.redirectTo).toBeDefined();
      expect(route.component).toBeUndefined();
    }
  });

  it('holds everything that was under the catalog in one route', () => {
    const route = oldCatalogAddresses();

    expect(route.path).toBe(OLD_CATALOG_SEGMENT);
    expect(route.component).toBeUndefined();
    for (const child of route.children ?? []) {
      expect(child.redirectTo).toBeDefined();
      expect(child.component).toBeUndefined();
    }
    // The chain screens of admin plan 0042 are still among them.
    expect((route.children ?? []).map((child) => child.path)).toEqual(
      expect.arrayContaining([
        'supermarkets',
        'locations/:id',
        'items',
        'prices',
      ])
    );
  });

  /** Before the parameter, which would otherwise read a row called "new". */
  it('declares each fixed word before the parameter beside it', () => {
    const paths = oldProductAddresses().map((route) => route.path);

    for (const [fixed, parameter] of [
      ['items/new', 'items/:id'],
      ['items/:id/prices', 'items/:id'],
      ['categories/new', 'categories/:id'],
      ['product-groups/new', 'product-groups/:id'],
      ['prices/new', 'prices/:id'],
    ]) {
      expect(paths.indexOf(fixed)).toBeLessThan(paths.indexOf(parameter));
    }
  });
});
