/**
 * Walk the Carrefour supermarket category tree and size a full crawl.
 *
 * Run: npx tsx tools/research/carrefour/walk-categories.ts [--prune] [--out tree.json]
 *
 * The tree is not published anywhere a client can read in one call. `categories-api`
 * is not routed to the internet and neither is the menu route. What is available is
 * that every listing page names its own children, in
 * `__INITIAL_STATE__.horizontalNavigation.secondLevelCategories`. So the tree is
 * discovered by walking it, at one page load per node.
 *
 * ## The frontier, and why it is not the leaves
 *
 * Paging stops at 1008 rows per category, so a category holding more than that has to
 * be read through its children. The obvious reading of that is "crawl the leaves", and
 * **the obvious reading is wrong and loses most of the catalog.**
 *
 * Measured over the full tree, 633 nodes, on 2026-09-06:
 *
 * | Strategy | Categories paged | Products found |
 * | --- | --- | --- |
 * | Every childless leaf | 106 | 2,780 |
 * | Shallowest node under the ceiling | 86 | **17,262** |
 *
 * The deep levels of this tree are curated views, not an exhaustive breakdown. "Vinos
 * Tintos" holds 257 products and its six children hold 90 between them. Descending
 * into them throws the other 167 away.
 *
 * So the rule a run follows, and what this script reports, is the **frontier**: the
 * shallowest node whose own total fits under the ceiling. Descend only past the
 * ceiling, and page the node you land on whole. Five of the ten first level categories
 * fit under the ceiling already and are paged without descending at all.
 *
 * `--prune` walks the way a run does, descending only past the ceiling. That costs
 * about 94 loads instead of 633 and finds the same frontier. The full walk is worth
 * running when the question is the shape of the tree rather than the cost of a crawl.
 *
 * Two node kinds are skipped:
 *
 * - `catmasterlist`, "Mis productos", a signed in shopper's own history, empty for an
 *   anonymous client.
 * - Promotion views, whose URL carries an `F-` token instead of a `cat` id. They
 *   re-list products a real category already holds, so walking them counts twice.
 */

import { writeFileSync } from 'node:fs';
import {
  CarrefourBrowser,
  categoryIdFromUrl,
  type CategoryLink,
} from './carrefour-browser';

/** Any listing page can seed the walk, because every one names the first level. */
const SEED = '/supermercado/la-despensa/cat20001/c';

const SKIP_IDS = new Set(['catmasterlist']);

/** Rows paging will serve for one category: 42 pages of 24. */
const CEILING = 1008;

/** Product cards on one listing page. */
const PAGE_SIZE = 24;

interface Node {
  id: string;
  name: string;
  url: string;
  depth: number;
  parentId: string | null;
  /** What the result set holds. */
  totalResults: number;
  /** What paging will actually serve: `totalPages * pageSize`. */
  pageableResults: number;
  childIds: string[];
}

function isWalkable(link: CategoryLink): boolean {
  if (SKIP_IDS.has(link.id)) return false;
  // A promotion view is addressed by a token, not a category id.
  return categoryIdFromUrl(link.url) !== null;
}

async function main(): Promise<void> {
  const outIndex = process.argv.indexOf('--out');
  const outPath = outIndex > 0 ? process.argv[outIndex + 1] : null;
  const prune = process.argv.includes('--prune');

  console.log(`# Carrefour category walk  (${new Date().toISOString()})`);
  console.log(
    prune
      ? '# --prune: descending only past the ceiling, the way a run does'
      : '# full walk: every node, for the shape of the tree'
  );

  const browser = await CarrefourBrowser.open();
  const started = Date.now();

  try {
    const seed = await browser.listing(SEED);
    if (!seed)
      throw new Error('the seed page did not answer; cannot start the walk');

    const roots = seed.firstLevelCategories.filter(isWalkable);
    console.log(`\n## ${roots.length} first level categories\n`);
    for (const r of roots)
      console.log(`  ${r.id.padEnd(14)} ${r.display_name}`);

    const nodes = new Map<string, Node>();
    const queue: Array<{
      link: CategoryLink;
      depth: number;
      parentId: string | null;
    }> = roots.map((link) => ({ link, depth: 1, parentId: null }));

    let failures = 0;
    console.log('\n## Walking\n');

    while (queue.length > 0) {
      const { link, depth, parentId } = queue.shift() as (typeof queue)[number];
      if (nodes.has(link.id)) continue;

      const listing = await browser.listing(link.url);
      if (!listing) {
        failures++;
        console.log(`  !! ${link.id} ${link.display_name}: no answer`);
        continue;
      }

      // In prune mode a node that already fits is the frontier, so it is not opened.
      const stop = prune && listing.totalResults <= CEILING;
      const children = stop
        ? []
        : listing.secondLevelCategories.filter(
            (c) => isWalkable(c) && c.id !== link.id && !nodes.has(c.id)
          );

      const node: Node = {
        id: link.id,
        name: link.display_name || listing.displayName,
        url: link.url,
        depth,
        parentId,
        totalResults: listing.totalResults,
        pageableResults: listing.totalPages * listing.pageSize,
        childIds: children.map((c) => c.id),
      };
      nodes.set(link.id, node);

      console.log(
        `  ${'  '.repeat(depth - 1)}${link.id.padEnd(14)} ` +
          `total=${String(node.totalResults).padStart(6)} ` +
          `children=${String(children.length).padStart(2)}  ${node.name}`
      );

      for (const child of children) {
        queue.push({ link: child, depth: depth + 1, parentId: link.id });
      }
    }

    report(nodes, failures, browser, started, outPath, prune);
  } finally {
    await browser.close();
  }
}

/**
 * Pick the frontier and report what crawling it costs.
 *
 * The frontier is the shallowest node under the ceiling on every branch. A node over
 * the ceiling with no children cannot be read completely, and that is the one thing a
 * run has to admit in `harvest_runs.report` rather than paper over.
 */
function report(
  nodes: Map<string, Node>,
  failures: number,
  browser: CarrefourBrowser,
  started: number,
  outPath: string | null,
  prune: boolean
): void {
  const all = [...nodes.values()];
  const roots = all.filter((n) => n.parentId === null);

  const frontier: Node[] = [];
  const capped: Node[] = [];

  const descend = (n: Node): void => {
    if (n.totalResults <= CEILING) {
      frontier.push(n);
      return;
    }
    const kids = n.childIds
      .map((id) => nodes.get(id))
      .filter((k): k is Node => !!k);
    if (kids.length === 0) {
      capped.push(n);
      return;
    }
    for (const k of kids) descend(k);
  };
  for (const r of roots) descend(r);

  const products = frontier.reduce((s, n) => s + n.totalResults, 0);
  const pages = frontier.reduce(
    (s, n) => s + Math.ceil(n.totalResults / PAGE_SIZE),
    0
  );

  const leaves = all.filter((n) => n.childIds.length === 0);
  const leafProducts = leaves.reduce((s, n) => s + n.totalResults, 0);

  console.log('\n## Shape of the tree\n');
  console.log(`nodes discovered      ${all.length}`);
  console.log(`max depth             ${Math.max(...all.map((n) => n.depth))}`);
  console.log(`page loads spent      ${browser.requests}`);
  console.log(`throttles survived    ${browser.throttles}`);
  console.log(`failures              ${failures}`);
  console.log(
    `elapsed               ${((Date.now() - started) / 60000).toFixed(1)} min`
  );

  console.log('\n## The crawl frontier\n');
  console.log(`frontier categories   ${frontier.length}`);
  console.log(`products in it        ${products}`);
  console.log(`listing pages         ${pages}`);
  console.log(
    `walk loads to find it ${prune ? browser.requests : 'run again with --prune'}`
  );
  console.log(`capped, no children   ${capped.length}`);
  for (const n of capped) {
    console.log(
      `  ${n.id.padEnd(14)} ${n.totalResults} > ${CEILING}  ${n.name}`
    );
  }

  const byDepth: Record<number, number> = {};
  for (const n of frontier) byDepth[n.depth] = (byDepth[n.depth] ?? 0) + 1;
  console.log(`frontier by depth     ${JSON.stringify(byDepth)}`);

  if (!prune) {
    console.log('\n## Why not the leaves\n');
    console.log(`childless leaves      ${leaves.length}`);
    console.log(`products in them      ${leafProducts}`);
    console.log(
      `crawling leaves instead of the frontier loses ${products - leafProducts} products`
    );
  }

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(all, null, 1), 'utf8');
    console.log(`\nwrote ${outPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
