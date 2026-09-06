/**
 * Finding the categories a run pages (plan 0090, section 7).
 *
 * Paging stops at {@link CARREFOUR_CEILING} rows for any one category, however
 * large the result set is, so a category over the ceiling has to be read
 * through its children. The tree is not published in a form a client can read,
 * because the category API is one of the routes the edge does not route, so it
 * is discovered by walking: every listing page names its own children.
 *
 * ## The obvious rule is wrong, and it loses most of the catalog
 *
 * "Crawl the leaves" reads as the obvious answer to a paging ceiling. Measured
 * over the whole tree, 633 nodes, on 2026-09-06:
 *
 * | Strategy                      | Categories paged | Products found |
 * | ----------------------------- | ---------------- | -------------- |
 * | Every childless leaf          | 106              | 2,780          |
 * | Shallowest node under ceiling | 84               | **17,135**     |
 *
 * The deep levels of this tree are curated views and not an exhaustive
 * breakdown. "Vinos Tintos" holds 257 products and its six children hold 90
 * between them. A run that descends to the bottom throws away six products in
 * seven.
 *
 * ## The rule
 *
 * **Descend only while a node reports more than the ceiling. Page the node you
 * land on whole.** That set is the frontier, 84 categories and 851 page loads
 * for a full run, and finding it costs 95 loads because a node that already
 * fits is never opened.
 *
 * A node over the ceiling with **no** children is the one case the run cannot
 * enumerate. None was found on 2026-09-06, and that is a measurement rather
 * than a guarantee, so one is reported by name in `harvest_runs.report` rather
 * than papered over.
 */

import { readListing } from './state';
import {
  CARREFOUR_CEILING,
  CARREFOUR_PAGE_SIZE,
  type CarrefourCategory,
  type CarrefourCategoryLink,
  type CarrefourStateLoader,
} from './types';

/**
 * A signed in shopper's own purchase history. Empty for an anonymous client,
 * and not a category.
 */
const SKIPPED_IDS = new Set(['catmasterlist']);

/** `/supermercado/<seo>/<id>/c` is the shape of every category listing URL. */
const CATEGORY_URL = /\/(cat[A-Za-z0-9]+)\/c(?:$|[?#])/;

/**
 * Whether a link is a category a run may walk.
 *
 * A promotion view is addressed by an `F-` token rather than a category id, and
 * it re lists products a real category already holds, so walking one counts the
 * same products twice.
 */
export function isWalkableCategory(link: CarrefourCategoryLink): boolean {
  return !SKIPPED_IDS.has(link.id) && CATEGORY_URL.test(link.url);
}

/** The category id a listing URL addresses, or null when it addresses none. */
export function categoryIdFromUrl(url: string): string | null {
  return CATEGORY_URL.exec(url)?.[1] ?? null;
}

/**
 * The path of one page of a category.
 *
 * The seo slug in the URL is cosmetic, so `x` stands in for it wherever a run
 * builds a URL rather than following one the page gave it. Paging is an
 * `offset` in steps of the page size the page reports for itself.
 */
export function listingPath(categoryId: string, offset = 0): string {
  return `/supermercado/x/${categoryId}/c?offset=${offset}`;
}

/** How many pages a category of this size takes, bounded by the ceiling. */
export function pagesFor(totalResults: number): number {
  return Math.ceil(
    Math.min(totalResults, CARREFOUR_CEILING) / CARREFOUR_PAGE_SIZE
  );
}

/** A category the ceiling truncated: over it, and with no children to open. */
export interface CarrefourCappedCategory extends CarrefourCategoryLink {
  path: string[];
  totalResults: number;
}

export interface CarrefourFrontier {
  /** The categories to page, shallowest node under the ceiling on each branch. */
  categories: CarrefourCategory[];
  /**
   * The categories the ceiling truncated. **This is what reaches the run
   * report**, by name, because a count says something is missing and nothing
   * about what.
   */
  capped: CarrefourCappedCategory[];
  /** Pages loaded to find the frontier. The walk's own cost. */
  loads: number;
  /** Nodes that did not answer, by url. Recorded rather than retried forever. */
  unreadable: string[];
}

/**
 * Walk the tree and answer the frontier.
 *
 * The walk is breadth first from the first level categories, which any listing
 * page names, and it opens a node only when that node is over the ceiling.
 * `load` is the only thing that touches a network, which is what keeps this
 * function testable with a fake loader and no browser.
 */
export async function walkFrontier(
  load: CarrefourStateLoader,
  seedPath: string,
  options: { signal?: AbortSignal } = {}
): Promise<CarrefourFrontier> {
  const frontier: CarrefourCategory[] = [];
  const capped: CarrefourCappedCategory[] = [];
  const unreadable: string[] = [];
  const seen = new Set<string>();
  let loads = 0;

  const seedState = await load(seedPath);
  loads += 1;
  if (!seedState) {
    unreadable.push(seedPath);
    return { categories: frontier, capped, loads, unreadable };
  }

  const queue: Array<{ link: CarrefourCategoryLink; path: string[] }> =
    readListing(seedState)
      .firstLevelCategories.filter(isWalkableCategory)
      .map((link) => ({ link, path: [] }));

  while (queue.length > 0) {
    options.signal?.throwIfAborted();
    const node = queue.shift() as (typeof queue)[number];
    if (seen.has(node.link.id)) {
      continue;
    }
    seen.add(node.link.id);

    const state = await load(node.link.url);
    loads += 1;
    if (!state) {
      // A node that did not answer is recorded and stepped over. Retrying into
      // a refusal is how the block escalates (plan 0090, section 5).
      unreadable.push(node.link.url);
      continue;
    }

    const listing = readListing(state);
    const name = node.link.name || listing.displayName;
    const path = [...node.path, name];

    if (listing.totalResults <= CARREFOUR_CEILING) {
      frontier.push({
        ...node.link,
        name,
        path,
        totalResults: listing.totalResults,
      });
      continue;
    }

    const children = listing.secondLevelCategories.filter(
      (child) =>
        isWalkableCategory(child) &&
        child.id !== node.link.id &&
        !seen.has(child.id)
    );
    if (children.length === 0) {
      capped.push({
        ...node.link,
        name,
        path,
        totalResults: listing.totalResults,
      });
      continue;
    }
    for (const child of children) {
      queue.push({ link: child, path });
    }
  }

  return { categories: frontier, capped, loads, unreadable };
}
