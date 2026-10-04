import { inject } from '@angular/core';
import {
  Router,
  type Params,
  type RedirectFunction,
  type Route,
  type UrlTree,
} from '@angular/router';
import { ResourceRegistry } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  HARVEST_IMPORT,
  harvestReviewPath,
  harvestRunsPath,
  harvestSetupPath,
  PLACES_GROUPED_VIEW,
  REVIEW_CHAIN_PARAM,
  type ReviewQueue,
} from '@portfolio/luna-shopper-admin/models';
import { QUEUE_VIEW_PARAM } from '@portfolio/luna-shopper-admin/ui';

/**
 * The addresses the harvester's ten screens had, kept as redirects (admin
 * plan 0044, target 8). Admin plan 0047 deletes them.
 *
 * | Old address                                | Goes to                              |
 * | ------------------------------------------ | ------------------------------------ |
 * | `entries`                                  | Review, the products queue           |
 * | `shops`                                    | Review, the shops queue              |
 * | `places`                                   | Review, the places queue             |
 * | `places/groups`                            | the places queue, grouped by chain   |
 * | `suggested-brands`                         | Review, the brands queue             |
 * | `presets`                                  | Runs                                 |
 * | `imports/upload`                           | the file import, under Runs          |
 * | `sources`                                  | Setup, the chain sources             |
 * | `brands`, `/new`, `/{id}`, `/{id}/edit`    | Setup, the registered brands         |
 * | `postal-codes`, `/new`, `/{id}`            | Setup, the postal codes              |
 *
 * A bookmark, a link in a chat and the browser's own history still hold the
 * old addresses, and each one lands where the same rows are now. `runs` and
 * `runs/{id}` did not move.
 *
 * **Every one keeps its query parameters**, so a queue that was linked to
 * narrowed opens narrowed. The products queue named its chain `supermarketId`
 * and the four queues share `chain` now, so that one parameter is renamed on
 * the way.
 *
 * The targets of the two resources are asked of the registry, so a redirect
 * cannot point at an address the route table does not have.
 *
 * **Relative to the section's segment**, `harvest`.
 */
export function oldHarvestAddresses(): Route[] {
  return [
    { path: 'entries', pathMatch: 'full', redirectTo: toProducts },
    { path: 'shops', pathMatch: 'full', redirectTo: toQueue('shops') },
    // Before `places`, which is a prefix of it only by its first segment, and
    // both are matched in full, so the order is for the reader.
    { path: 'places/groups', pathMatch: 'full', redirectTo: toGroupedPlaces },
    { path: 'places', pathMatch: 'full', redirectTo: toQueue('places') },
    {
      path: 'suggested-brands',
      pathMatch: 'full',
      redirectTo: toQueue('brands'),
    },
    {
      path: 'presets',
      pathMatch: 'full',
      redirectTo: ({ queryParams }) => tree(harvestRunsPath(), queryParams),
    },
    {
      path: 'imports/upload',
      pathMatch: 'full',
      redirectTo: ({ queryParams }) =>
        tree(harvestRunsPath(HARVEST_IMPORT), queryParams),
    },
    {
      path: 'sources',
      pathMatch: 'full',
      redirectTo: ({ queryParams }) => tree(harvestSetupPath(), queryParams),
    },
    ...resource('brands'),
    ...resource('postal-codes'),
  ];
}

/** One queue of Review, with the query kept. */
function toQueue(queue: ReviewQueue): RedirectFunction {
  return ({ queryParams }) => tree(harvestReviewPath(queue), queryParams);
}

/**
 * The products queue. Its chain was `supermarketId`, and it is the `chain`
 * the four queues share now. Every other parameter is kept as it was.
 */
const toProducts: RedirectFunction = ({ queryParams }) => {
  const { supermarketId, ...kept } = queryParams;

  return tree(
    harvestReviewPath('products'),
    typeof supermarketId === 'string' && supermarketId !== ''
      ? { ...kept, [REVIEW_CHAIN_PARAM]: supermarketId }
      : kept
  );
};

/** "Grouped by chain" is a view of the places queue, and no page. */
const toGroupedPlaces: RedirectFunction = ({ queryParams }) =>
  tree(harvestReviewPath('places'), {
    ...queryParams,
    [QUEUE_VIEW_PARAM]: PLACES_GROUPED_VIEW,
  });

/**
 * A resource that moved under Setup: its list, and everything under its list.
 *
 * Whatever followed the old segment follows the new one, so the form of a new
 * row, a row's page and a row's edit form each land on their own new address
 * without a line here for each.
 */
function resource(name: string): Route[] {
  return [
    {
      path: name,
      pathMatch: 'full',
      redirectTo: ({ queryParams }) => tree(listPath(name), queryParams),
    },
    {
      path: name,
      children: [
        {
          path: '**',
          redirectTo: ({ url, queryParams }) =>
            tree(
              [...listPath(name), ...url.map((segment) => segment.path)],
              queryParams
            ),
        },
      ],
    },
  ];
}

/** Where a resource's list is, or the Setup tab when the app did not mount it. */
function listPath(resource: string): readonly string[] {
  return inject(ResourceRegistry).pathOf(resource) ?? harvestSetupPath();
}

function tree(path: readonly string[], queryParams: Params): UrlTree {
  return inject(Router).createUrlTree([...path], { queryParams });
}
