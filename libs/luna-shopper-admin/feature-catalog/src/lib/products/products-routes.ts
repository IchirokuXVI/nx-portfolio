import type { Route } from '@angular/router';
import {
  RESOURCE_DESCRIPTOR,
  RESOURCE_FORM_MODE,
  RESOURCE_ID_FROM,
  resourceCreateRoute,
  resourceFormBranch,
  resourceRoutes,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { AnyResourceDescriptor } from '@portfolio/luna-shopper-admin/models';
import { CATEGORIES } from '../categories';
import { ItemFormPage } from '../item-form-page';
import { ITEMS } from '../items';
import { PRICE_POLICIES } from '../price-policies';
import { PRICES } from '../prices';
import { PRODUCT_GROUPS } from '../product-groups';
import { CategoriesPage } from './categories-page';
import { PriceRuleForm, PriceRulesPage } from './price-rules-page';
import {
  PRODUCT_DETAILS_TAB,
  PRODUCT_PARAM,
  PRODUCT_SOURCES_TAB,
  PRODUCT_WHERE_TAB,
  ProductPage,
} from './product-page';
import { ProductPricesTab } from './product-prices-tab';
import { ProductSourcesTab, ProductWhereTab } from './product-tabs';
import { ProductsPage } from './products-page';

/** The segment the Products section owns. */
export const PRODUCTS_SEGMENT = 'products';

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
 * /products/new                              a new product
 * /products/groups                           tab: the product groups
 * /products/groups/new, /{id}, /{id}/edit    a group, with "Add items"
 * /products/categories                       tab: the category tree
 * /products/categories/new, /{id}            a category's form
 * /products/price-rules                      tab: the price rules
 * /products/price-rules/{sourceKind}         one rule, its form open in place
 * /products/{productId}                      goes to its details
 * /products/{productId}/details              tab: the product's form
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
 */
export function productsRoutes(): Route[] {
  return [
    {
      path: '',
      pathMatch: 'full',
      component: ProductsPage,
      data: { [RESOURCE_DESCRIPTOR]: ITEMS },
    },
    resourceCreateRoute(ITEMS),

    // The groups are the list, the form and the detail every resource has.
    ...resourceRoutes(PRODUCT_GROUPS),

    // The categories are a tree and not a list, with the forms every resource
    // has beside it.
    withList(resourceFormBranch(CATEGORIES), CategoriesPage),

    // The rules are six rows, and a rule's form opens under its row.
    {
      path: PRICE_POLICIES.segment,
      component: PriceRulesPage,
      children: [
        {
          path: ':id',
          component: PriceRuleForm,
          data: {
            [RESOURCE_DESCRIPTOR]: PRICE_POLICIES,
            [RESOURCE_FORM_MODE]: 'edit',
          },
        },
      ],
    },

    {
      path: `:${PRODUCT_PARAM}`,
      children: [
        {
          path: '',
          component: ProductPage,
          children: [
            { path: '', pathMatch: 'full', redirectTo: PRODUCT_DETAILS_TAB },
            {
              path: PRODUCT_DETAILS_TAB,
              component: ItemFormPage,
              data: {
                [RESOURCE_DESCRIPTOR]: ITEMS,
                [RESOURCE_FORM_MODE]: 'edit',
                [RESOURCE_ID_FROM]: PRODUCT_PARAM,
              },
            },
            {
              path: PRICES.segment,
              component: ProductPricesTab,
              // The add a price form, drawn inside the tab.
              children: [resourceCreateRoute(PRICES)],
            },
            { path: PRODUCT_WHERE_TAB, component: ProductWhereTab },
            { path: PRODUCT_SOURCES_TAB, component: ProductSourcesTab },
          ],
        },
      ],
    },
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
