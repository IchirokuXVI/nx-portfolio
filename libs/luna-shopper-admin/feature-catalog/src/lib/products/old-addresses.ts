import { inject } from '@angular/core';
import {
  Router,
  type Params,
  type RedirectFunction,
  type Route,
  type UrlTree,
} from '@angular/router';
import {
  ResourceRegistry,
  type KnownParents,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { compositeParts } from '@portfolio/luna-shopper-admin/models';
import { PRICE_KEY } from '../catalog-sources';
import { oldChainAddresses } from '../chains/old-addresses';
import {
  PRICE_STATE_FILTER,
  PRICES_AT_FILTER,
  type PriceState,
} from './product-list-gateway';
import { PRODUCT_SCOPE_QUERY } from './product-page';

/** The segment the Catalog section owned, which holds only redirects now. */
export const OLD_CATALOG_SEGMENT = 'catalog';

/**
 * Everything that was under `/catalog`, as redirects (admin plans 0042 and
 * 0043). Admin plan 0047 deletes them.
 *
 * The Catalog section is gone: its chain screens went to the Chains section
 * and its product screens to the Products section. A bookmark, a link in a
 * chat and the browser's own history still hold the old addresses, and each
 * one lands where the same rows are now.
 *
 * One route at the root, because no section owns the segment any more.
 */
export function oldCatalogAddresses(): Route {
  return {
    path: OLD_CATALOG_SEGMENT,
    children: [
      // The section's own dashboard, whose tiles and chart are a block of the
      // overview now.
      { path: '', pathMatch: 'full', redirectTo: '/' },
      ...oldChainAddresses(),
      ...oldProductAddresses(),
    ],
  };
}

/**
 * The addresses the five product screens had, kept as redirects (admin plan
 * 0043, targets 7 and 8).
 *
 * | Old address                             | Goes to                                   |
 * | --------------------------------------- | ----------------------------------------- |
 * | `items`, `items/new`, `items/{id}`      | the products, a new one, that product     |
 * | `items/{id}/prices`                     | the Prices tab of that product            |
 * | `categories`, `/new`, `/{id}`           | the Categories tab and its forms          |
 * | `product-groups`, `/new`, `/{id}`,      | the Groups tab and its forms              |
 * | `/{id}/edit`                            |                                           |
 * | `prices`, `prices/new`                  | the products, at the scope the old filter |
 * |                                         | named                                     |
 * | `prices/{product~scope}`                | the Prices tab of that product, with that |
 * |                                         | scope open                                |
 * | `price-policies`, `price-policies/{id}` | the Price rules tab, that rule open       |
 *
 * Every target is asked of the registry, so a redirect cannot point at an
 * address the route table does not have. Every one keeps its query
 * parameters, so a list that was linked to narrowed opens narrowed.
 *
 * **Relative to the segment that held the old screens**, `catalog`.
 */
export function oldProductAddresses(): Route[] {
  return [
    { path: 'items', pathMatch: 'full', redirectTo: list('items') },
    // Before `:id`, which would otherwise read a product called "new".
    { path: 'items/new', redirectTo: list('items', 'new') },
    { path: 'items/:id/prices', redirectTo: toProductPrices },
    { path: 'items/:id', redirectTo: row('items') },

    { path: 'categories', pathMatch: 'full', redirectTo: list('categories') },
    { path: 'categories/new', redirectTo: list('categories', 'new') },
    { path: 'categories/:id', redirectTo: row('categories') },

    {
      path: 'product-groups',
      pathMatch: 'full',
      redirectTo: list('product-groups'),
    },
    { path: 'product-groups/new', redirectTo: list('product-groups', 'new') },
    {
      path: 'product-groups/:id/edit',
      redirectTo: row('product-groups', 'edit'),
    },
    { path: 'product-groups/:id', redirectTo: row('product-groups') },

    { path: 'prices', pathMatch: 'full', redirectTo: toProductsAtScope },
    { path: 'prices/new', redirectTo: toProductsAtScope },
    { path: 'prices/:id', redirectTo: toPriceOfProduct },

    {
      path: 'price-policies',
      pathMatch: 'full',
      redirectTo: list('price-policies'),
    },
    { path: 'price-policies/:id', redirectTo: row('price-policies') },
  ];
}

/** A resource's list, or a fixed screen under it, with the query kept. */
function list(resource: string, ...under: readonly string[]): RedirectFunction {
  return ({ queryParams }) =>
    tree([...listPath(resource), ...under], queryParams);
}

/** One row of a resource, by the id the old address carried. */
function row(resource: string, ...under: readonly string[]): RedirectFunction {
  return ({ params, queryParams }) => {
    const path = inject(ResourceRegistry).rowPath(resource, params['id']);
    return tree(
      path === null ? listPath(resource) : [...path, ...under],
      queryParams
    );
  };
}

/** The Prices tab of one product. */
const toProductPrices: RedirectFunction = ({ params, queryParams }) =>
  tree(pricesPath(params['id']), queryParams);

/**
 * One product at one scope. The old address carried the pair as one id, and
 * the new one is the product's Prices tab with that scope open.
 */
const toPriceOfProduct: RedirectFunction = ({ params }) => {
  const key = compositeParts(String(params['id'] ?? ''), PRICE_KEY);
  const itemId = key?.['itemId'] ?? '';
  const scopeId = key?.['priceScopeId'] ?? '';

  return itemId === ''
    ? tree(listPath('items'), {})
    : tree(
        pricesPath(itemId),
        scopeId === '' ? {} : { [PRODUCT_SCOPE_QUERY]: scopeId }
      );
};

/**
 * The price list, which is the product list at one scope now.
 *
 * A link that narrowed the old list to a product goes to that product's
 * prices. One that narrowed it to a scope opens the products at that scope,
 * and its "out of date" filter becomes the state the list is narrowed to. Any
 * other filter of the old list has no counterpart and is dropped: the product
 * route would refuse a parameter it does not declare.
 */
const toProductsAtScope: RedirectFunction = ({ queryParams }) => {
  const itemId = text(queryParams['itemId']);
  const scopeId = text(queryParams[PRICES_AT_FILTER]);

  if (itemId !== '') {
    return tree(
      pricesPath(itemId),
      scopeId === '' ? {} : { [PRODUCT_SCOPE_QUERY]: scopeId }
    );
  }
  if (scopeId === '') {
    return tree(listPath('items'), {});
  }

  const state: PriceState | null =
    queryParams['stale'] === 'true' ? 'stale' : null;

  return tree(listPath('items'), {
    [PRICES_AT_FILTER]: scopeId,
    ...(state === null ? {} : { [PRICE_STATE_FILTER]: state }),
  });
};

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Where a resource's list is, or the root when the app did not mount it. */
function listPath(
  resource: string,
  known: KnownParents = {}
): readonly string[] {
  return inject(ResourceRegistry).pathOf(resource, known) ?? ['/'];
}

/** Where the Prices tab of one product is. */
function pricesPath(itemId: string): readonly string[] {
  return listPath('prices', { itemId });
}

function tree(path: readonly string[], queryParams: Params): UrlTree {
  return inject(Router).createUrlTree([...path], { queryParams });
}
