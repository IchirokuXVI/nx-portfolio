import { inject } from '@angular/core';
import {
  Router,
  type RedirectFunction,
  type Route,
  type UrlTree,
} from '@angular/router';
import { ResourceRegistry } from '@portfolio/luna-shopper-admin/feature-resource';

/**
 * The addresses the five flat screens had, kept as redirects (admin plan 0042,
 * target 9). Admin plan 0047 deletes them.
 *
 * Supermarkets, shops, shop sections, price scopes and the products of a shop
 * were five lists under `/catalog`. A bookmark, a link in a chat and the
 * browser's own history still hold those addresses, and each one lands where
 * the same rows are now:
 *
 * | Old address                         | Goes to                                  |
 * | ----------------------------------- | ---------------------------------------- |
 * | `supermarkets`                      | the chains                               |
 * | `supermarkets/{id}`                 | that chain                               |
 * | `locations/{id}`                    | that shop, under the chain it reads      |
 * | `locations`, `sections`,            | the chains, or the chain a               |
 * | `price-scopes`, `location-items`    | `supermarketId` parameter names          |
 *
 * Every target is asked of the registry, so a redirect cannot point at an
 * address the route table does not have.
 *
 * **Relative to the section that held the old screens**, which is the catalog:
 * these are mounted among its hand written screens.
 */
export function oldChainAddresses(): Route[] {
  return [
    { path: 'supermarkets', pathMatch: 'full', redirectTo: toChains },
    { path: 'supermarkets/:id', redirectTo: toChain },
    { path: 'locations', pathMatch: 'full', redirectTo: toChains },
    // Before `:id`, which would otherwise read a shop called "new".
    { path: 'locations/new', redirectTo: toChains },
    { path: 'locations/:id', redirectTo: toShop },
    // A prefix each, so that a row of the old list lands with its list. The
    // rows had no address a chain could be read from without a request, and a
    // section, a scope or a shop product is one press away from its chain.
    { path: 'sections', redirectTo: toChains },
    { path: 'price-scopes', redirectTo: toChains },
    { path: 'location-items', redirectTo: toChains },
  ];
}

/** The chains, or the one chain a `supermarketId` parameter names. */
const toChains: RedirectFunction = ({ queryParams }) => {
  const chain: unknown = queryParams['supermarketId'];

  return typeof chain === 'string' && chain !== ''
    ? chainTree(chain)
    : chainsTree();
};

/** One chain, by the id the old address carried. */
const toChain: RedirectFunction = ({ params }) => chainTree(params['id']);

/**
 * One shop. The old address named the shop alone and the new one sits under
 * its chain, so the shop is read to find which chain that is. A shop that
 * cannot be read lands on the chains.
 */
const toShop: RedirectFunction = async ({ params }) => {
  const registry = inject(ResourceRegistry);
  const router = inject(Router);
  const fallback = chainsTree();
  const shops = registry.byName('locations');
  const id: unknown = params['id'];

  if (shops === undefined || typeof id !== 'string') {
    return fallback;
  }

  try {
    const shop = await registry.gatewayFor(shops).read(id);
    const path = registry.rowPath('locations', id, shop);
    return path === null ? fallback : router.createUrlTree([...path]);
  } catch {
    return fallback;
  }
};

function chainsTree(): UrlTree {
  const path = inject(ResourceRegistry).pathOf('supermarkets') ?? ['/'];
  return inject(Router).createUrlTree([...path]);
}

function chainTree(id: string): UrlTree {
  const registry = inject(ResourceRegistry);
  const path =
    registry.rowPath('supermarkets', id) ??
    registry.pathOf('supermarkets') ?? ['/'];
  return inject(Router).createUrlTree([...path]);
}
