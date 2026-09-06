/**
 * Research script. Not production code.
 *
 * Opens a lidl.es page in a real browser and records every XHR/fetch request the
 * page makes, so we can find the JSON endpoints behind the storefront instead of
 * guessing them from the bundles.
 *
 * Usage:
 *   node tools/research/lidl/capture-network.mjs <url> [outName]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });

const url = process.argv[2] ?? 'https://www.lidl.es/q/search?q=leche';
const outName = process.argv[3] ?? 'network';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'es-ES',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
});
const page = await context.newPage();

const calls = [];
page.on('response', async (response) => {
  const req = response.request();
  const type = req.resourceType();
  if (type !== 'xhr' && type !== 'fetch' && type !== 'document') return;
  const ct = (response.headers()['content-type'] ?? '').split(';')[0];
  let bodyLen = null;
  let sample = null;
  if (ct.includes('json')) {
    try {
      const text = await response.text();
      bodyLen = text.length;
      sample = text.slice(0, 400);
    } catch {
      /* body already consumed or redirected */
    }
  }
  calls.push({
    method: req.method(),
    url: response.url(),
    status: response.status(),
    resourceType: type,
    contentType: ct,
    postData: req.postData()?.slice(0, 600) ?? null,
    bodyLen,
    sample,
  });
});

await page
  .goto(url, { waitUntil: 'networkidle', timeout: 90_000 })
  .catch((e) => console.error('goto:', e.message));

// Accept the cookie banner if it shows, then scroll to trigger lazy loads.
for (const sel of [
  '#onetrust-accept-btn-handler',
  'button:has-text("Aceptar")',
  '[data-testselector*="accept"]',
]) {
  const el = page.locator(sel).first();
  if (await el.isVisible().catch(() => false)) {
    await el.click().catch(() => {});
    break;
  }
}
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, 2500);
  await page.waitForTimeout(900);
}
await page.waitForTimeout(2000);

writeFileSync(
  join(outDir, `${outName}.calls.json`),
  JSON.stringify(calls, null, 2)
);
writeFileSync(join(outDir, `${outName}.page.html`), await page.content());

const json = calls.filter((c) => c.contentType.includes('json'));
console.log(`total captured: ${calls.length}, json: ${json.length}`);
for (const c of json)
  console.log(`${c.status} ${c.method} ${c.url} (${c.bodyLen} bytes)`);

await browser.close();
