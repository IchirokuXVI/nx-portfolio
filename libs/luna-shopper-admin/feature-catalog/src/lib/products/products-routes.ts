import type { Route } from '@angular/router';
import {
  recordEditRedirect,
  recordLeaveGuard,
  recordRoute,
  RESOURCE_DESCRIPTOR,
  resourceCreateRoute,
  resourceFormBranch,
  resourceRoutes,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { AnyResourceDescriptor } from '@portfolio/luna-shopper-admin/models';
import { CATEGORIES } from '../categories';
import { ITEMS, PRODUCT_PRICES_TAB } from '../items';
import { PRICE_POLICIES } from '../price-policies';
import { PRICES } from '../prices';
import { PRODUCT_GROUPS } from '../product-groups';
import { CategoriesPage } from './categories-page';
import { PriceRuleForm, PriceRulesPage } from './price-rules-page';
import { ProductPricesTab } from './product-prices-tab';
import { ProductsPage } from './products-page';

/** The segment the Products section owns. */
export const PRODUCTS_SEGMENT = 'products';

/**
 * The route parameter that holds the product. The `prices` resource names it
 * as the parameter of its parent, so the price form under the Prices tab
 * finds its product by this name.
 */
const PRODUCT_PARAM = 'productId';

/**
 * The five resources the Products section holds, in the order its tabs are
 * drawn: the products, their groups, their categories and the price rules.
 * The prices come last and are no tab: they sit under one product.
 *
 * The section registers these and mounts none of them through the route
 * factory: {@link productsRoutes} is where each one is.
 */
export const PRODUCT_RESOURCES: readonly AnyResourceDescriptor[] = [
  ITEMS,
  PRODUCT_GROUPS,
  CATEGORIES,
  PRICE_POLICIES,
  PRICES,
];

/**
 * A product and its prices (admin plan 0043). Relative to the section, which
 * is at `/products`:
 *
 * ```
 * /products                                  tab: the products
 * /products/new                              a new product, on the record page
 * /products/groups                           tab: the product groups
 * /products/groups/new, /{id}                a group, with "Add items"
 * /products/groups/{id}/edit                 goes to the group, its form open
 * /products/categories                       tab: the category tree
 * /products/categories/new, /{id}            a category's form
 * /products/price-rules                      tab: the price rules
 * /products/price-rules/{sourceKind}         one rule, its form open in place
 * /products/{productId}                      goes to its details
 * /products/{productId}/details              tab: the product, read or changed
 * /products/{productId}/prices               tab: its prices by chain and scope
 * /products/{productId}/prices/new           the same tab, adding a price
 * /products/{productId}/where                tab: where it is in the shops
 * /products/{productId}/sources              tab: the chain rows that name it
 * ```
 *
 * **The fixed words come before the parameter**, because a parameter matches
 * anything: declared after it, `groups` would be read as a product called
 * "groups". Every one of those words is a descriptor's own segment, so the
 * table and the registry cannot disagree about where a resource is.
 *
 * **A product and a product group are the record page** (admin plan 0055).
 * The tabs of a product are the children its descriptor names, and the
 * factory mounts them. The Prices tab is handed over whole, because the form
 * that adds a price is a route under it.
 */
export function productsRoutes(): Route[] {
  return [
    {
      path: '',
      pathMatch: 'full',
      component: ProductsPage,
      data: { [RESOURCE_DESCRIPTOR]: ITEMS },
    },
    recordRoute(ITEMS, { path: 'new', mode: 'create' }),

    // The groups are the list and the record page every resource has. A
    // group had a form at an address of its own, which now opens the form of
    // the record.
    ...withChildren(resourceRoutes(PRODUCT_GROUPS), [recordEditRedirect()]),

    // The categories are a tree and not a list, with the forms every resource
    // has beside it.
    withList(resourceFormBranch(CATEGORIES), CategoriesPage),

    // The rules are six rows, and a rule's form opens under its row. Leaving
    // a row with changes asks first.
    {
      path: PRICE_POLICIES.segment,
      component: PriceRulesPage,
      children: [
        {
          path: ':id',
          component: PriceRuleForm,
          canDeactivate: [recordLeaveGuard],
          data: { [RESOURCE_DESCRIPTOR]: PRICE_POLICIES },
        },
      ],
    },

    recordRoute(ITEMS, {
      path: `:${PRODUCT_PARAM}`,
      idFrom: PRODUCT_PARAM,
      tabs: {
        [PRODUCT_PRICES_TAB]: {
          path: PRICES.segment,
          component: ProductPricesTab,
          // The add a price form, drawn inside the tab. The route carries
          // the leave guard, so a typed price asks before it is lost.
          children: [resourceCreateRoute(PRICES)],
        },
      },
    }),
  ];
}

/** A resource's form routes, with a hand written screen as its list. */
function withList(branch: Route, list: Route['component']): Route {
  return {
    ...branch,
    children: [
      { path: '', pathMatch: 'full', component: list },
      ...(branch.children ?? []),
    ],
  };
}

/** The routes of a resource, with more routes under its segment. */
function withChildren(routes: Route[], more: Route[]): Route[] {
  return routes.map((route) => ({
    ...route,
    children: [...(route.children ?? []), ...more],
  }));
}
