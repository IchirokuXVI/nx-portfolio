/**
 * Measure how fast the Carrefour storefront can be read before Cloudflare throttles.
 *
 * Run: npx tsx libs/luna-shopper/carrefour/tools/measure-rate-limit.ts [delayMs] [count]
 *   npx tsx libs/luna-shopper/carrefour/tools/measure-rate-limit.ts 4000 40
 *
 * This is the number that decides the shape of a Carrefour run, because the crawl is
 * thousands of pages and the pace sets how long that takes.
 *
 * The whole run uses one browser context and drops the Cloudflare cookies before every
 * navigation, which is what the adapter does. Keeping those cookies is what causes the
 * block, and `carrefour-browser.ts` carries the measurement that shows it. A pace run
 * without that rule measures the cookie and not the pace.
 *
 * Do not leave this running in a loop against the live site. It exists to produce one
 * number per invocation.
 */

import { CarrefourBrowser, sleep } from './carrefour-browser';

/** Real listing URLs, rotated so no single page is requested twice in a row. */
const PATHS = [
  '/supermercado/la-despensa/cat20001/c',
  '/supermercado/frescos/cat20002/c',
  '/supermercado/bebidas/cat20003/c',
  '/supermercado/cuidado-personal-e-higiene/cat20004/c',
  '/supermercado/drogueria-y-limpieza/cat20005/c',
  '/supermercado/bebe/cat20006/c',
  '/supermercado/mascotas/cat20007/c',
  '/supermercado/congelados/cat21449123/c',
];

async function main(): Promise<void> {
  const delayMs = Number(process.argv[2] ?? 4000);
  const count = Number(process.argv[3] ?? 30);
  // `--assets` lets the page load its images, which is what a real browser does. Use it
  // to test whether refusing them is itself the thing that draws a block.
  const withAssets = process.argv.includes('--assets');

  console.log(
    `# pace probe: ${count} loads, ${delayMs} ms apart, one context, assets=${withAssets ? 'on' : 'blocked'}  (${new Date().toISOString()})`
  );

  // retries 0: a retry would hide the very thing being measured.
  const browser = await CarrefourBrowser.open(delayMs, !withAssets);
  const started = Date.now();

  let ok = 0;
  let blocked = 0;
  let firstBlockAt: number | null = null;
  let products = 0;

  try {
    for (let i = 0; i < count; i++) {
      const path = `${PATHS[i % PATHS.length]}?offset=${(i % 20) * 24}`;
      const state = await browser.state(path, 0);

      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      if (state) {
        ok++;
        const results = (
          state['productCardList'] as { results?: { items?: unknown[] } }
        )?.results;
        const n = results?.items?.length ?? 0;
        products += n;
        console.log(
          `${String(i).padStart(3)}  t=${elapsed.padStart(7)}s  ok    ${String(n).padStart(3)} cards  ${path}`
        );
      } else {
        blocked++;
        if (firstBlockAt === null) firstBlockAt = i;
        console.log(
          `${String(i).padStart(3)}  t=${elapsed.padStart(7)}s  BLOCKED               ${path}`
        );
      }
    }
  } finally {
    await browser.close();
  }

  const seconds = (Date.now() - started) / 1000;
  console.log('');
  console.log(
    `ok=${ok}  blocked=${blocked}  firstBlockAt=${firstBlockAt ?? 'none'}`
  );
  console.log(
    `${count} loads in ${seconds.toFixed(1)}s = ${(count / seconds).toFixed(2)} loads/s`
  );
  console.log(
    `${products} product cards read = ${(products / seconds).toFixed(1)} cards/s`
  );

  if (blocked === 0) {
    // Project the pace onto a full crawl, using the page count walk-categories reports.
    const perPage = seconds / count;
    for (const pages of [1000, 2000, 4000]) {
      console.log(
        `  ${pages} pages at this pace = ${((pages * perPage) / 60).toFixed(0)} minutes`
      );
    }
  }
}

/**
 * Poll one page slowly until the edge stops refusing it, and report how long that took.
 *
 * Run: npx tsx libs/luna-shopper/carrefour/tools/measure-rate-limit.ts --recover [everyMs]
 *
 * This is the other half of the pace question. A limit that clears in seconds and one
 * that clears in an hour lead to very different run designs, and the block here is a
 * hard refusal rather than a challenge a browser can solve, so the only measurement is
 * to wait it out.
 *
 * Each probe opens a fresh browser context. A context that was blocked keeps being
 * blocked, so reusing one would measure the context and not the address.
 */
async function recover(): Promise<void> {
  const everyMs = Number(process.argv[3] ?? 120000);
  const started = Date.now();
  console.log(
    `# recovery probe, one load every ${everyMs / 1000}s  (${new Date().toISOString()})`
  );

  for (let i = 0; i < 40; i++) {
    const browser = await CarrefourBrowser.open(0);
    let ok = false;
    try {
      ok = (await browser.state(PATHS[i % PATHS.length], 0)) !== null;
    } finally {
      await browser.close();
    }

    const minutes = ((Date.now() - started) / 60000).toFixed(1);
    console.log(`t=${minutes.padStart(6)} min  ${ok ? 'OK' : 'blocked'}`);
    if (ok && i > 0) {
      console.log(`\nrecovered after ${minutes} minutes`);
      return;
    }
    await sleep(everyMs);
  }
  console.log('\nstill blocked at the end of the probe');
}

const entry = process.argv.includes('--recover') ? recover : main;
entry().catch((error) => {
  console.error(error);
  process.exit(1);
});
