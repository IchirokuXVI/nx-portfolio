import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DeploymentStore,
  GatewayError,
  ResourceMemoryGateways,
  ServerReachability,
  SessionStorage,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  adminRoutes,
  provideSections,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type {
  ResourceGateway,
  ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { ITEMS } from '../items';
import { catalogRoutes } from '../routes';
import { CHAIN_RESOURCES, chainsRoutes } from './chains-routes';
import { oldChainAddresses } from './old-addresses';

/**
 * The addresses the five flat screens had (admin plan 0042, target 9).
 *
 * Supermarkets, shops, shop sections, price scopes and the products of a shop
 * were five lists under `/catalog`. A bookmark, a link in a chat and the
 * browser's own history still hold those addresses, so each one is a redirect
 * to where the same rows are now. One test per address, against the two
 * sections as the app declares them: the chains with no segment, and the
 * catalog, which held the old screens, under `/catalog`.
 *
 * **What is asserted is where the router comes to rest.** A redirect to a
 * chain is followed by the chain's own redirect to its Shops tab, and one to a
 * shop by the shop's redirect to its Details tab, so those are the addresses
 * an operator ends on.
 */

const SECTIONS: readonly AdminSection[] = [
  {
    key: 'chains',
    label: '',
    held: CHAIN_RESOURCES,
    screens: chainsRoutes(),
  },
  {
    key: 'catalog',
    label: '',
    segment: 'catalog',
    resources: [ITEMS],
    screens: catalogRoutes(),
  },
];

/** Where a chain's page settles: its first tab. */
const chain = (id: string) => `/chains/${id}/shops`;

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

  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);

  return TestBed.inject(Router).url;
}

describe('the addresses the chain screens had', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends the supermarkets list to the chains', async () => {
    expect(await landOn('/catalog/supermarkets')).toBe('/chains');
  });

  it('sends one supermarket to that chain', async () => {
    expect(await landOn('/catalog/supermarkets/sm_mercadona')).toBe(
      chain('sm_mercadona')
    );
  });

  /**
   * The old address named the shop alone. The new one sits under its chain,
   * so the shop is read to find which chain that is.
   */
  it('reads a shop and sends it to its place under its chain', async () => {
    expect(await landOn('/catalog/locations/loc_cordoba_centro')).toBe(
      '/chains/sm_mercadona/shops/loc_cordoba_centro/details'
    );
    // A shop of another chain lands under that chain, so the chain really is
    // read off the shop and is not the first one there is.
    expect(await landOn('/catalog/locations/loc_consum_centro')).toBe(
      '/chains/sm_consum/shops/loc_consum_centro/details'
    );
  });

  it('sends a shop that cannot be read to the chains', async () => {
    expect(await landOn('/catalog/locations/loc_nowhere')).toBe('/chains');
  });

  /** Not found is one refusal among several, and all of them land the same. */
  it('sends a shop the gateway refuses to read to the chains', async () => {
    const original = ResourceMemoryGateways.prototype.for;
    jest
      .spyOn(ResourceMemoryGateways.prototype, 'for')
      .mockImplementation(function <T extends ResourceRow>(
        this: ResourceMemoryGateways,
        source: Parameters<ResourceMemoryGateways['for']>[0]
      ): ResourceGateway<T> {
        const gateway = original.call(this, source) as ResourceGateway<T>;
        if (source.path.endsWith('/locations')) {
          gateway.read = async () => {
            throw new GatewayError({
              code: 'unavailable',
              status: 503,
              correlationId: 'cid',
            });
          };
        }
        return gateway;
      });

    expect(await landOn('/catalog/locations/loc_cordoba_centro')).toBe(
      '/chains'
    );
  });

  /** Before `:id`, which would otherwise read a shop called "new". */
  it('sends the form of a new shop to the chains, where a chain is picked', async () => {
    expect(await landOn('/catalog/locations/new')).toBe('/chains');
  });

  it.each([
    ['/catalog/locations', 'the shops'],
    ['/catalog/sections', 'the shop sections'],
    ['/catalog/price-scopes', 'the price scopes'],
    ['/catalog/location-items', 'the products in a shop'],
  ])('sends %s to the chains', async (url) => {
    expect(await landOn(url)).toBe('/chains');
  });

  /**
   * The old lists could not load until a chain was picked in a filter, and the
   * filter was in the address. A link that carried one keeps its chain.
   */
  it.each([
    ['/catalog/locations', 'the shops'],
    ['/catalog/sections', 'the shop sections'],
    ['/catalog/price-scopes', 'the price scopes'],
    ['/catalog/location-items', 'the products in a shop'],
  ])('keeps the supermarketId of %s as the chain', async (url) => {
    expect(await landOn(`${url}?supermarketId=sm_consum`)).toBe(
      chain('sm_consum')
    );
  });

  it('keeps the supermarketId of the supermarkets list too', async () => {
    expect(await landOn('/catalog/supermarkets?supermarketId=sm_consum')).toBe(
      chain('sm_consum')
    );
  });

  it('reads an empty supermarketId as no chain', async () => {
    expect(await landOn('/catalog/locations?supermarketId=')).toBe('/chains');
  });

  /**
   * A row of an old list lands with its list. It had no address a chain could
   * be read from without a request, and a section, a scope or a shop product
   * is one press away from its chain.
   */
  it.each([
    ['/catalog/sections/sec_offers', 'a section'],
    ['/catalog/sections/new', 'the form of a new section'],
    ['/catalog/price-scopes/ps_mercadona_4661', 'a price scope'],
    ['/catalog/price-scopes/new', 'the form of a new price scope'],
    [
      '/catalog/location-items/it_milk_1l~loc_cordoba_centro',
      'a product in a shop',
    ],
    ['/catalog/location-items/new', 'the form of a new shop product'],
  ])('sends %s to the chains', async (url) => {
    expect(await landOn(url)).toBe('/chains');
  });

  it('keeps the supermarketId under a row of an old list as well', async () => {
    expect(
      await landOn('/catalog/sections/sec_offers?supermarketId=sm_mercadona')
    ).toBe(chain('sm_mercadona'));
  });

  /** The screen that was beside them is still where it was. */
  it('leaves the rest of the catalog where it is', async () => {
    expect(await landOn('/catalog/items')).toBe('/catalog/items');
    expect(await landOn('/catalog/items/it_milk_1l/prices')).toBe(
      '/catalog/items/it_milk_1l/prices'
    );
  });

  /**
   * Every redirect is a route of its own with no component, so none of them
   * can draw a screen at an old address by accident.
   */
  it('is redirects and nothing else', () => {
    const routes = oldChainAddresses();

    expect(routes.map((route) => route.path)).toEqual([
      'supermarkets',
      'supermarkets/:id',
      'locations',
      'locations/new',
      'locations/:id',
      'sections',
      'price-scopes',
      'location-items',
    ]);
    for (const route of routes) {
      expect([route.path, typeof route.redirectTo]).toEqual([
        route.path,
        'function',
      ]);
      expect([route.path, route.component]).toEqual([route.path, undefined]);
    }
  });
});
