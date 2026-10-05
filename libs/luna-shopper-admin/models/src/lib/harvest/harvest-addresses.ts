/**
 * Where the harvester's screens are (admin plan 0044).
 *
 * The section has three tabs: Review, Runs and Setup. Their screens are hand
 * written, so no descriptor names them and the resource registry cannot answer
 * for them. These functions are that answer.
 *
 * They live in `models`, the one library every other admin library may read.
 * A chain's page links to Setup and a price row links to the run that wrote
 * it, and both are in `feature-catalog`, which `feature-harvest` imports. An
 * address kept in `feature-harvest` would close that circle.
 *
 * The registered brands and the postal codes are resources. Their addresses
 * come from the registry, like every other resource's, and are not here.
 */

/** The segment the Harvest section owns. */
export const HARVEST_SEGMENT = 'harvest';

/** The three tabs of the section, as the segment each one owns. */
export const HARVEST_REVIEW_TAB = 'review';
export const HARVEST_RUNS_TAB = 'runs';
export const HARVEST_SETUP_TAB = 'setup';

/** The four queues of the Review tab, in the order the switch shows them. */
export const REVIEW_QUEUES = ['products', 'shops', 'places', 'brands'] as const;

/** One queue of the Review tab, as its segment. */
export type ReviewQueue = (typeof REVIEW_QUEUES)[number];

/** The part of Setup that is no resource: the chain sources. */
export const SETUP_SOURCES_PART = 'sources';

/**
 * The query parameter that holds the chain the four queues are narrowed to.
 *
 * One name for all four, so that a move from one queue to the next keeps the
 * chain.
 */
export const REVIEW_CHAIN_PARAM = 'chain';

/**
 * The view of the places queue that reads the same places grouped by chain,
 * as the `view` query parameter holds it.
 */
export const PLACES_GROUPED_VIEW = 'groups';

/** The Review tab, or one queue of it. */
export function harvestReviewPath(queue?: ReviewQueue): readonly string[] {
  return queue === undefined
    ? ['/', HARVEST_SEGMENT, HARVEST_REVIEW_TAB]
    : ['/', HARVEST_SEGMENT, HARVEST_REVIEW_TAB, queue];
}

/** The Runs tab, or a fixed screen under it: `new`, or `import`. */
export function harvestRunsPath(
  under?: typeof HARVEST_NEW_RUN | typeof HARVEST_IMPORT
): readonly string[] {
  return under === undefined
    ? ['/', HARVEST_SEGMENT, HARVEST_RUNS_TAB]
    : ['/', HARVEST_SEGMENT, HARVEST_RUNS_TAB, under];
}

/** The segment of the run form, under the Runs tab. */
export const HARVEST_NEW_RUN = 'new';

/** The segment of the file import, under the Runs tab. */
export const HARVEST_IMPORT = 'import';

/** One run. */
export function harvestRunPath(runId: string): readonly string[] {
  return ['/', HARVEST_SEGMENT, HARVEST_RUNS_TAB, runId];
}

/** The chain sources, which is where Setup opens. */
export function harvestSetupPath(): readonly string[] {
  return ['/', HARVEST_SEGMENT, HARVEST_SETUP_TAB, SETUP_SOURCES_PART];
}
