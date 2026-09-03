import { EntriesQueuePage } from './entries-queue-page';
import { ItemRefsQueuePage } from './item-refs-queue-page';
import { PlacesQueuePage } from './places-queue-page';
import { HARVEST_LINKS, HARVEST_SEGMENT, harvestRoutes } from './routes';
import { RunPage } from './run-page';
import { RunsPage } from './runs-page';
import { SourcesPage } from './sources-page';

const [branch] = harvestRoutes();
const children = branch.children ?? [];
const pathsOf = () => children.map((route) => route.path);

describe('harvestRoutes', () => {
  it('mounts everything under one segment', () => {
    expect(branch.path).toBe(HARVEST_SEGMENT);
  });

  it('has a screen for each of the five subjects', () => {
    expect(children.map((route) => route.component)).toEqual([
      undefined,
      RunsPage,
      RunPage,
      PlacesQueuePage,
      EntriesQueuePage,
      ItemRefsQueuePage,
      SourcesPage,
    ]);
  });

  /**
   * A run is read on a screen of its own rather than in `0004`'s edit form,
   * because there is nothing on a run to edit. That is the clearest place the
   * generic machinery does not fit.
   */
  it('sends a run id to the run screen and not to a form', () => {
    const run = children.find((route) => route.path === 'runs/:id');

    expect(run?.component).toBe(RunPage);
  });

  it('lands on the runs screen', () => {
    const empty = children.find((route) => route.path === '');

    expect(empty?.redirectTo).toBe('runs');
    expect(empty?.pathMatch).toBe('full');
  });

  /**
   * A parameter matches anything, so `runs/:id` declared before `runs` would
   * never let the list render.
   */
  it('declares the runs list before the run', () => {
    const paths = pathsOf();

    expect(paths.indexOf('runs')).toBeLessThan(paths.indexOf('runs/:id'));
  });

  it('carries no locale segment, like the rest of this app', () => {
    for (const path of pathsOf()) {
      expect(path).not.toContain(':locale');
    }
  });
});

/**
 * A screen cannot end up reachable without a link or linked without a route.
 * Resources get that from the registry; a hand written screen has to be checked,
 * because its link and its route are two lists rather than one.
 */
describe('HARVEST_LINKS', () => {
  it('points every link at a route that exists', () => {
    const declared = new Set(
      pathsOf().map((path) => `/${HARVEST_SEGMENT}/${path}`)
    );

    for (const link of HARVEST_LINKS) {
      expect(declared.has(link.path)).toBe(true);
    }
  });

  /**
   * Every screen an operator can open, and only those. `runs/:id` has no entry,
   * because a navigation link to a route with a parameter has nothing to put in
   * it, and the empty redirect is not a screen.
   */
  it('links every screen except the one reached from a list', () => {
    const linked = new Set(HARVEST_LINKS.map((link) => link.path));
    const screens = pathsOf().filter(
      (path) => path !== '' && path !== 'runs/:id'
    );

    expect(screens.map((path) => `/${HARVEST_SEGMENT}/${path}`).sort()).toEqual(
      [...linked].sort()
    );
  });

  it('gives every link a translation key rather than words', () => {
    for (const link of HARVEST_LINKS) {
      expect(link.label).toMatch(/^harvest\.nav\./);
    }
  });
});
