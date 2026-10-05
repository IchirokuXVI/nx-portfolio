import type { Type } from '@angular/core';
import type { Route } from '@angular/router';
import {
  recordEditRedirect,
  resourceFormBranch,
  resourceTabRoute,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  HARVEST_IMPORT,
  HARVEST_NEW_RUN,
  HARVEST_REVIEW_TAB,
  HARVEST_RUNS_TAB,
  HARVEST_SETUP_TAB,
  REVIEW_QUEUES,
  SETUP_SOURCES_PART,
  type AnyResourceDescriptor,
  type ReviewQueue,
} from '@portfolio/luna-shopper-admin/models';
import type { ShellLink } from '@portfolio/luna-shopper-admin/ui';
import { EntriesQueuePage } from './entries-queue-page';
import { HARVEST_SEGMENT } from './harvest-paths';
import { ImportUploadPage } from './import-upload-page';
import { NewRunPage } from './new-run-page';
import { PlacesQueuePage } from './places-queue-page';
import { HarvestReviewPage } from './review-page';
import { RunPage } from './run-page';
import { RunsPage } from './runs-page';
import { HarvestSetupPage } from './setup-page';
import { ShopsQueuePage } from './shops-queue-page';
import { SOURCES } from './sources';
import { SourcesPage } from './sources-page';

export { HARVEST_SEGMENT };

/**
 * What the app gives the harvester's route table, because it lives in a
 * library this one cannot import.
 *
 * The suggested brands are a queue of Review and the registered brands are a
 * part of Setup, and both are in `feature-brands`, which imports this
 * library. So the app, which sees both, hands them in.
 */
export interface HarvestRouteParts {
  /** The queue of suggested brands, which Review mounts as its fourth. */
  readonly brandsQueue: Type<unknown>;
  /**
   * The resources Setup holds, in the order its switch shows them after the
   * chain sources: the registered brands, then the postal codes.
   */
  readonly setup: readonly AnyResourceDescriptor[];
}

/**
 * The harvester in three tabs (admin plan 0044). Relative to the section,
 * which is at `/harvest`:
 *
 * ```
 * /harvest                              goes to Review
 * /harvest/review                       goes to its first queue
 * /harvest/review/products              queue: source products
 * /harvest/review/shops                 queue: source shops
 * /harvest/review/places                queue: discovered places
 * /harvest/review/brands                queue: suggested brands
 * /harvest/runs                         tab: presets, import, runs
 * /harvest/runs/new                     the run form
 * /harvest/runs/import                  the file import
 * /harvest/runs/{id}                    one run
 * /harvest/setup                        goes to the chain sources
 * /harvest/setup/sources                part: chain sources
 * /harvest/setup/sources/new, /{id}       the record page of a source
 * /harvest/setup/brands                 part: registered brands
 * /harvest/setup/brands/new, /{id}        the record page of a brand
 * /harvest/setup/brands/{id}/edit         goes to /{id}?edit=1
 * /harvest/setup/postal-codes           part: postal codes
 * /harvest/setup/postal-codes/new, /{id}
 * ```
 *
 * There were ten screens in one flat row, and they are three kinds of work.
 * Four are queues where a person decides something, three start or follow
 * work, and three are set up once and then left alone. Each kind is a tab.
 *
 * **Review and Setup are pages with a switch**, and what the switch picks is a
 * child route, so each queue and each part has an address and the browser's
 * back button walks them. The forms of a Setup resource are mounted beside
 * that page and not inside it: a form is a page of its own, with its own
 * header and its own way back.
 *
 * **The fixed words come before the parameter**, because a parameter matches
 * anything: declared after it, `new` would be read as a run called "new".
 *
 * Every path is a plain segment, because this app carries no `:locale`
 * (plan 0001, section 3): one operator, one browser, no links sent to anyone.
 */
export function harvestRoutes(parts: HarvestRouteParts): Route[] {
  const queues: Readonly<Record<ReviewQueue, Type<unknown>>> = {
    products: EntriesQueuePage,
    shops: ShopsQueuePage,
    places: PlacesQueuePage,
    brands: parts.brandsQueue,
  };

  return [
    {
      path: HARVEST_REVIEW_TAB,
      component: HarvestReviewPage,
      children: [
        // Review opens on the products, the queue with the most in it.
        { path: '', pathMatch: 'full', redirectTo: REVIEW_QUEUES[0] },
        ...REVIEW_QUEUES.map((queue) => ({
          path: queue,
          component: queues[queue],
        })),
      ],
    },

    { path: HARVEST_RUNS_TAB, component: RunsPage },
    { path: `${HARVEST_RUNS_TAB}/${HARVEST_NEW_RUN}`, component: NewRunPage },
    {
      path: `${HARVEST_RUNS_TAB}/${HARVEST_IMPORT}`,
      component: ImportUploadPage,
    },
    { path: `${HARVEST_RUNS_TAB}/:id`, component: RunPage },

    {
      path: HARVEST_SETUP_TAB,
      component: HarvestSetupPage,
      children: [
        { path: '', pathMatch: 'full', redirectTo: SETUP_SOURCES_PART },
        { path: SETUP_SOURCES_PART, component: SourcesPage },
        ...parts.setup.map(resourceTabRoute),
      ],
    },
    // The forms and the detail pages of the Setup resources, beside the page
    // above and not inside it. The router tries this branch when no part of
    // the page matched the rest of the address.
    {
      path: HARVEST_SETUP_TAB,
      children: [
        // The chain sources are this library's own, so nothing hands them in
        // (admin plan 0059). A source never had a form at `{id}/edit`, so it
        // gets no redirect from there.
        resourceFormBranch(SOURCES),
        ...parts.setup.map(setupFormBranch),
      ],
    },
  ];
}

/**
 * The pages of one Setup resource, under its segment.
 *
 * A resource whose page is the record page keeps the address its old form
 * had, `{id}/edit`, as a way to the record with its form open (admin plan
 * 0054, section 4.3). That is a resource that names no page of its own and
 * can be changed, which is the brand. Before `{id}` for readability only: a
 * parameter cannot match two segments.
 */
function setupFormBranch(descriptor: AnyResourceDescriptor): Route {
  const branch = resourceFormBranch(descriptor);
  const onRecordPage =
    descriptor.detail === undefined &&
    descriptor.editor === undefined &&
    descriptor.actions?.edit === true;

  return onRecordPage
    ? {
        ...branch,
        children: [recordEditRedirect(), ...(branch.children ?? [])],
      }
    : branch;
}

/**
 * The three tabs, as the navigation entries of the section.
 *
 * Beside the routes rather than in the app, so a tab cannot end up without a
 * route or a route without a tab. The frame draws these under every page
 * header of the section, and asks the section's counter for the count on
 * Review.
 */
export const HARVEST_TABS: readonly ShellLink[] = [
  {
    path: `/${HARVEST_SEGMENT}/${HARVEST_REVIEW_TAB}`,
    label: 'harvest.tab.review',
  },
  {
    path: `/${HARVEST_SEGMENT}/${HARVEST_RUNS_TAB}`,
    label: 'harvest.tab.runs',
  },
  {
    path: `/${HARVEST_SEGMENT}/${HARVEST_SETUP_TAB}`,
    label: 'harvest.tab.setup',
  },
];
