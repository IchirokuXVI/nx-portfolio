import type { Route } from '@angular/router';
import {
  RESOURCE_DESCRIPTOR,
  RESOURCE_FORM_MODE,
  RESOURCE_ID_FROM,
  resourceCreateRoute,
  resourceFormBranch,
  resourceSplitRoute,
  resourceTabRoute,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { AnyResourceDescriptor } from '@portfolio/luna-shopper-admin/models';
import { LOCATION_ITEMS } from '../location-items';
import { LocationFormPage } from '../location-form-page';
import { LOCATIONS } from '../locations';
import { PRICE_SCOPES } from '../price-scopes';
import { SECTIONS } from '../sections';
import { SupermarketFormPage } from '../supermarket-form-page';
import { SUPERMARKETS } from '../supermarkets';
import { CHAIN_PARAM, ChainPage, DETAILS_TAB } from './chain-page';
import { ChainSectionsTab, ShopSectionsTab } from './section-tabs';
import { SHOP_PARAM, SHOP_SECTIONS_TAB, ShopPage } from './shop-page';

/**
 * The five resources the Chains section holds, in the order the registry
 * names them. The section registers these and mounts none of them as a flat
 * list: {@link chainsRoutes} is where each one is.
 */
export const CHAIN_RESOURCES: readonly AnyResourceDescriptor[] = [
  SUPERMARKETS,
  LOCATIONS,
  SECTIONS,
  PRICE_SCOPES,
  LOCATION_ITEMS,
];

/**
 * A chain holds its shops (admin plan 0042).
 *
 * ```
 * /chains                                       the chains
 * /chains/new                                   a new chain
 * /chains/{chainId}                             goes to its shops
 * /chains/{chainId}/shops                       tab: the chain's shops
 * /chains/{chainId}/shops/new                   a new shop of the chain
 * /chains/{chainId}/shops/{shopId}              goes to its details
 * /chains/{chainId}/shops/{shopId}/details      tab: the shop's form
 * /chains/{chainId}/shops/{shopId}/sections     tab: the order it walks
 * /chains/{chainId}/shops/{shopId}/products     tab: its products
 * /chains/{chainId}/shops/{shopId}/products/new       a product at the shop
 * /chains/{chainId}/shops/{shopId}/products/{id}      one of them
 * /chains/{chainId}/sections                    tab: the chain's sections
 * /chains/{chainId}/sections/new, /{id}         a section's form
 * /chains/{chainId}/scopes                      tab: the chain's price scopes
 * /chains/{chainId}/scopes/new, /{id}           a scope's form
 * /chains/{chainId}/details                     tab: the chain's form
 * ```
 *
 * Every segment but `details` and the two parameters is a descriptor's own,
 * so the table and the registry cannot disagree about where a resource is.
 *
 * ## Why a form is beside the page and not inside it
 *
 * A form for a scope, a section or a shop product is a page of its own, with
 * its own header and its way back. So it is a sibling of the page whose tab
 * lists the rows, and the router reaches it by failing the tab first: the tab
 * is a terminal route and cannot take the segment after it.
 *
 * ## Why the page of a chain is at the empty path under its parameter
 *
 * The parameter route has no component, so a route under it inherits the
 * parameter. The page and the forms beside it are then all children of the
 * one route that names the chain.
 */
export function chainsRoutes(): Route[] {
  return [
    resourceSplitRoute(SUPERMARKETS, {
      // The 216 px of the mock.
      listWidth: '13.5rem',
      emptyKey: 'catalog.chains.choose',
      children: [
        resourceCreateRoute(SUPERMARKETS),
        {
          path: `:${CHAIN_PARAM}`,
          children: [
            {
              path: '',
              component: ChainPage,
              children: [
                {
                  path: '',
                  pathMatch: 'full',
                  redirectTo: LOCATIONS.segment,
                },
                resourceSplitRoute(LOCATIONS, {
                  // The 340 px of the mock.
                  listWidth: '21.25rem',
                  underHeader: true,
                  emptyKey: 'catalog.shops.choose',
                  children: [
                    resourceCreateRoute(LOCATIONS),
                    {
                      path: `:${SHOP_PARAM}`,
                      children: [
                        {
                          path: '',
                          component: ShopPage,
                          children: [
                            {
                              path: '',
                              pathMatch: 'full',
                              redirectTo: DETAILS_TAB,
                            },
                            detailsTab(LOCATIONS, LocationFormPage, SHOP_PARAM),
                            {
                              path: SHOP_SECTIONS_TAB,
                              component: ShopSectionsTab,
                            },
                            resourceTabRoute(LOCATION_ITEMS),
                          ],
                        },
                        resourceFormBranch(LOCATION_ITEMS),
                      ],
                    },
                  ],
                }),
                { path: SECTIONS.segment, component: ChainSectionsTab },
                resourceTabRoute(PRICE_SCOPES),
                detailsTab(SUPERMARKETS, SupermarketFormPage, CHAIN_PARAM),
              ],
            },
            resourceFormBranch(SECTIONS),
            resourceFormBranch(PRICE_SCOPES),
          ],
        },
      ],
    }),
  ];
}

/**
 * The Details tab: the form of the row the page is about, reading its id from
 * the page's own parameter.
 */
function detailsTab(
  descriptor: AnyResourceDescriptor,
  component: Route['component'],
  param: string
): Route {
  return {
    path: DETAILS_TAB,
    component,
    data: {
      [RESOURCE_DESCRIPTOR]: descriptor,
      [RESOURCE_FORM_MODE]: 'edit',
      [RESOURCE_ID_FROM]: param,
    },
  };
}
