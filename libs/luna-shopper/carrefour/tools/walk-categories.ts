/**
 * Walk the Carrefour supermarket category tree and report its size.
 *
 * Run: npx tsx libs/luna-shopper/carrefour/tools/walk-categories.ts [--out tree.json] [--depth N]
 *
 * The tree is not published anywhere a client can read in one call. `categories-api`
 * is not routed to the internet and neither is the menu route. What is available is
 * that every listing page names its own children, in
 * `__INITIAL_STATE__.horizontalNavigation.secondLevelCategories`. So the tree is
 * discovered by walking it, at one page load per node.
 *
 * Scope: everything under `/supermercado`, which is the grocery storefront. Electronics,
 * clothing, toys and the marketplace live under other sections of carrefour.es and are
 * never reachable from this walk, so no exclusion list is needed to keep them out.
 *
 * Two node kinds are skipped on purpose:
 *
 * - `catmasterlist` ("Mis productos") is a signed in shopper's own history, not a
 *   category, and is empty for an anonymous client.
 * - Promotion views, whose URL carries an `F-` token instead of a `cat` id. They
 *   re-list products a real category already holds, so walking them double counts.
 *
 * `--depth N` stops the walk at depth N. Use it for a cheap structural sample before
 * committing to the full walk, which is hundreds of page loads.
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
  const depthIndex = process.argv.indexOf('--depth');
  const maxDepth =
    depthIndex > 0 ? Number(process.argv[depthIndex + 1]) : Infinity;

  console.log(`# Carrefour category walk  (${new Date().toISOString()})`);
  if (maxDepth !== Infinity) console.log(`# stopping at depth ${maxDepth}`);

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

      const children =
        depth >= maxDepth
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
          `pageable=${String(node.pageableResults).padStart(5)} ` +
          `children=${String(children.length).padStart(2)}  ${node.name}`
      );

      for (const child of children) {
        queue.push({ link: child, depth: depth + 1, parentId: link.id });
      }
    }

    report(nodes, failures, browser, started, outPath);
  } finally {
    await browser.close();
  }
}

function report(
  nodes: Map<string, Node>,
  failures: number,
  browser: CarrefourBrowser,
  started: number,
  outPath: string | null
): void {
  const all = [...nodes.values()];
  const leaves = all.filter((n) => n.childIds.length === 0);
  const maxDepth = Math.max(...all.map((n) => n.depth));

  // A leaf whose result set exceeds what paging serves cannot be read completely from
  // that leaf alone. This count decides whether the walk can claim completeness.
  const capped = leaves.filter((n) => n.totalResults > n.pageableResults);
  const leafProducts = leaves.reduce((s, n) => s + n.totalResults, 0);
  const leafPageable = leaves.reduce(
    (s, n) => s + Math.min(n.totalResults, n.pageableResults),
    0
  );

  console.log('\n## Shape of the tree\n');
  console.log(`nodes                 ${all.length}`);
  console.log(`leaves                ${leaves.length}`);
  console.log(`max depth             ${maxDepth}`);
  console.log(`page loads            ${browser.requests}`);
  console.log(`throttles survived    ${browser.throttles}`);
  console.log(`failures              ${failures}`);
  console.log(
    `elapsed               ${((Date.now() - started) / 60000).toFixed(1)} min`
  );
  console.log('');
  console.log(
    `products over leaves  ${leafProducts}   (sum of leaf total_results)`
  );
  console.log(`reachable by paging   ${leafPageable}`);
  console.log(`capped leaves         ${capped.length}`);
  for (const n of capped) {
    console.log(
      `  ${n.id.padEnd(14)} ${String(n.totalResults).padStart(6)} > ${n.pageableResults}  ${n.name}`
    );
  }

  // Page loads a full crawl would need, at the observed 24 cards per listing page.
  const pages = leaves.reduce(
    (s, n) => s + Math.ceil(Math.min(n.totalResults, n.pageableResults) / 24),
    0
  );
  console.log('');
  console.log(`listing pages to crawl every leaf: ${pages}`);
  console.log(
    `plus ${all.length} tree walk loads = ${pages + all.length} page loads for a full run`
  );

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(all, null, 1), 'utf8');
    console.log(`\nwrote ${outPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
