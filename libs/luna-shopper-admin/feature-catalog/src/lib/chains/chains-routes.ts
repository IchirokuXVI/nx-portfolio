import type { Route } from '@angular/router';
import {
  recordRoute,
  resourceFormBranch,
  resourceSplitRoute,
  resourceTabRoute,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { AnyResourceDescriptor } from '@portfolio/luna-shopper-admin/models';
import { LOCATION_ITEMS } from '../location-items';
import { LOCATIONS } from '../locations';
import { PRICE_SCOPES } from '../price-scopes';
import { SECTIONS } from '../sections';
import { SUPERMARKETS } from '../supermarkets';

/**
 * The route parameter that holds the chain. The descriptors under a chain
 * name it as the parameter of their parent, and
 * `catalog-descriptors.spec.ts` holds the two together.
 */
const CHAIN_PARAM = 'chainId';

/** The route parameter that holds the shop, for the reason above. */
const SHOP_PARAM = 'shopId';

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
 * /chains/{chainId}/shops/{shopId}/details      tab: the shop, read or changed
 * /chains/{chainId}/shops/{shopId}/sections     tab: the order it walks
 * /chains/{chainId}/shops/{shopId}/products     tab: its products
 * /chains/{chainId}/shops/{shopId}/products/new       a product at the shop
 * /chains/{chainId}/shops/{shopId}/products/{id}      one of them
 * /chains/{chainId}/sections                    tab: the chain's sections
 * /chains/{chainId}/sections/new, /{id}         a section's form
 * /chains/{chainId}/scopes                      tab: the chain's price scopes
 * /chains/{chainId}/scopes/new, /{id}           a scope's form
 * /chains/{chainId}/details                     tab: the chain, read or changed
 * ```
 *
 * Every segment but `details` and the two parameters is a descriptor's own,
 * so the table and the registry cannot disagree about where a resource is.
 *
 * ## A chain and a shop are the record page
 *
 * Both are `RecordPage` (admin plan 0056), and their tabs are the children
 * their descriptors name. Three tabs are handed over whole, because each has
 * routes that belong with it:
 *
 * - **The shops of a chain** are a split, and a shop opens inside it.
 * - **The price scopes of a chain** and **the products of a shop** are lists
 *   whose rows open and that add rows. The factory mounts by itself only a
 *   list that reads.
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
        recordRoute(SUPERMARKETS, { path: 'new', mode: 'create' }),
        {
          path: `:${CHAIN_PARAM}`,
          children: [
            recordRoute(SUPERMARKETS, {
              path: '',
              idFrom: CHAIN_PARAM,
              // Below 72 rem an open shop is the page, and the chain draws
              // no header over it.
              yieldsTo: LOCATIONS.segment,
              tabs: {
                [LOCATIONS.name]: shopsTab(),
                [PRICE_SCOPES.name]: resourceTabRoute(PRICE_SCOPES),
              },
            }),
            resourceFormBranch(SECTIONS),
            resourceFormBranch(PRICE_SCOPES),
          ],
        },
      ],
    }),
  ];
}

/**
 * The Shops tab of a chain: the shops as a column under the chain's header,
 * with the shop that is open beside it.
 */
function shopsTab(): Route {
  return resourceSplitRoute(LOCATIONS, {
    // The 340 px of the mock.
    listWidth: '21.25rem',
    underHeader: true,
    emptyKey: 'catalog.shops.choose',
    children: [
      recordRoute(LOCATIONS, { path: 'new', mode: 'create' }),
      {
        path: `:${SHOP_PARAM}`,
        children: [
          recordRoute(LOCATIONS, {
            path: '',
            idFrom: SHOP_PARAM,
            tabs: {
              [LOCATION_ITEMS.name]: resourceTabRoute(LOCATION_ITEMS),
            },
          }),
          resourceFormBranch(LOCATION_ITEMS),
        ],
      },
    ],
  });
}
