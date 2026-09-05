import type { Route } from '@angular/router';
import type { ShellLink } from '@portfolio/luna-shopper-admin/ui';
import { EntriesQueuePage } from './entries-queue-page';
import { HARVEST_SEGMENT } from './harvest-paths';
import { ItemRefsQueuePage } from './item-refs-queue-page';
import { PlacesQueuePage } from './places-queue-page';
import { RunPage } from './run-page';
import { RunsPage } from './runs-page';
import { ShopsQueuePage } from './shops-queue-page';
import { SourcesPage } from './sources-page';

export { HARVEST_SEGMENT };

/**
 * The harvester's screens: the five of plan 0006, and the fourth queue admin
 * plan 0011 added beside them.
 *
 * Written out rather than generated from descriptors, which is what the plan
 * says up front: a run is a process you start, watch and abort, and an import
 * queue is a decision you make repeatedly, so neither is a resource with a form.
 * Pretending five descriptors would cover it is the thing that plan opens by
 * refusing to do.
 *
 * `runs/:id` is a screen rather than an edit form, and that is the clearest sign
 * the generic machinery does not fit here. There is nothing on a run to edit.
 *
 * Every path is a plain segment, because this app carries no `:locale`
 * (plan 0001, section 3): one operator, one browser, no links sent to anyone.
 */
export function harvestRoutes(): Route[] {
  return [
    {
      path: HARVEST_SEGMENT,
      children: [
        { path: '', pathMatch: 'full', redirectTo: 'runs' },
        { path: 'runs', component: RunsPage },
        { path: 'runs/:id', component: RunPage },
        { path: 'places', component: PlacesQueuePage },
        { path: 'entries', component: EntriesQueuePage },
        { path: 'item-refs', component: ItemRefsQueuePage },
        { path: 'shops', component: ShopsQueuePage },
        { path: 'sources', component: SourcesPage },
      ],
    },
  ];
}

/**
 * The navigation entries for those screens.
 *
 * Beside the routes rather than in the app, so a screen cannot end up reachable
 * without a link or linked without a route. That is the same property
 * `AdminShellPage` gets for resources by reading the registry, arrived at the
 * only way a hand written route table can arrive at it.
 *
 * `runs/:id` has no entry, because a run is reached from the runs list and a
 * navigation link to a route with a parameter has nothing to put in it.
 */
export const HARVEST_LINKS: readonly ShellLink[] = [
  { path: `/${HARVEST_SEGMENT}/runs`, label: 'harvest.nav.runs' },
  { path: `/${HARVEST_SEGMENT}/places`, label: 'harvest.nav.places' },
  { path: `/${HARVEST_SEGMENT}/entries`, label: 'harvest.nav.entries' },
  { path: `/${HARVEST_SEGMENT}/item-refs`, label: 'harvest.nav.itemRefs' },
  { path: `/${HARVEST_SEGMENT}/shops`, label: 'harvest.nav.shops' },
  { path: `/${HARVEST_SEGMENT}/sources`, label: 'harvest.nav.sources' },
];
