import { expect, Page, test } from '@playwright/test';

/**
 * Regression guard against horizontal scroll on the damoclesSword pages.
 *
 * A page should never be wider than its viewport: if it is, the user gets an
 * unwanted horizontal scrollbar. We check every viewport across a range of
 * sizes, since overflow bugs are almost always viewport-specific.
 *
 * Routes are not hardcoded: each viewport test crawls starting from `baseURL`
 * (the damoclesSword page, from the Playwright config, which also spins up the
 * dev server) and follows only in-app links that stay within that route
 * subtree, so newly added damoclesSword routes are covered automatically while
 * the shared shell navigation into other micro-frontends (landing/odontogram)
 * is excluded. Crawling and measuring happen together at the viewport under
 * test — the layout that hides or reveals links is the same one being probed
 * for overflow, so a route is only discovered (and only checked) at sizes where
 * it is actually reachable.
 */

const viewports = [
  { name: 'mobile-sm', width: 320, height: 720 },
  { name: 'mobile', width: 420, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'desktop', width: 1920, height: 1080 },
];

// Sub-pixel rounding can nudge scrollWidth a hair past clientWidth without a
// real scrollbar; anything beyond this is a genuine horizontal scroll.
const TOLERANCE_PX = 1;

// Safety cap so a mis-crawl can never loop forever.
const MAX_ROUTES = 50;

function normalizePath(pathname: string): string {
  const clean = (pathname || '/').replace(/\/+$/, '');
  return clean === '' ? '/' : clean;
}

/**
 * Wait for a navigated page to finish rendering before we read links or measure
 * layout.
 *
 * We wait for web fonts (so text-width measurements are final) and
 * for the DOM to go quiet: the lazy-loaded remote mounting into the
 * shell is a burst of DOM mutations, so "no structural mutations for
 * a short window" is a reliable render-idle signal. A hard cap guarantees
 * we never wait forever if something animates the DOM indefinitely.
 */
async function settle(page: Page): Promise<void> {
  await page
    .evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => {
        let quiet = setTimeout(resolve, 400);
        const observer = new MutationObserver(() => {
          clearTimeout(quiet);
          quiet = setTimeout(resolve, 400);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
          observer.disconnect();
          resolve();
        }, 8000);
      });
    })
    .catch(() => undefined);
}

interface ScrollProbe {
  scrolledX: number;
  scrollWidth: number;
  clientWidth: number;
  offenders: string[];
}

/**
 * Detects horizontal scroll two ways: behaviourally (try to scroll the page
 * sideways and see if it actually moves) and geometrically (scrollWidth vs
 * clientWidth), reporting the elements that stick out past the viewport.
 */
async function probeHorizontalScroll(page: Page): Promise<ScrollProbe> {
  return page.evaluate(async () => {
    const doc = document.documentElement;

    // Try to scroll all the way right, then read how far we actually moved.
    window.scrollTo({ left: 9999, top: window.scrollY });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const scrolledX = Math.round(window.scrollX);
    window.scrollTo({ left: 0, top: window.scrollY }); // restore

    const clientWidth = doc.clientWidth;
    const offenders = Array.from(
      document.querySelectorAll<HTMLElement>('body *')
    )
      .map((el) => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.right > clientWidth + 1 || rect.left < -1)
      .sort((a, b) => b.rect.right - a.rect.right)
      .slice(0, 8)
      .map(({ el, rect }) => {
        const cls = (el.className || '')
          .toString()
          .trim()
          .split(/\s+/)
          .join('.');
        return (
          `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} ` +
          `[left=${Math.round(rect.left)} right=${Math.round(rect.right)}]`
        );
      });

    return { scrolledX, scrollWidth: doc.scrollWidth, clientWidth, offenders };
  });
}

/**
 * Read the in-app links on the current page that stay within the crawl scope,
 * so the caller can enqueue newly reachable routes. Links a narrow layout hides
 * simply aren't returned — which is what we want: an unreachable route isn't
 * checked at a viewport where the user can't get to it.
 */
async function inScopeLinks(page: Page, scope: string): Promise<string[]> {
  const inScope = (p: string) => p === scope || p.startsWith(scope + '/');
  const origin = new URL(page.url()).origin;
  const hrefs: string[] = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href]')).map(
      (a) => (a as HTMLAnchorElement).href
    )
  );

  const paths: string[] = [];
  for (const href of hrefs) {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      continue;
    }

    if (url.origin !== origin) continue; // external link
    if (/\.[a-z0-9]+$/i.test(url.pathname)) continue; // asset file, not a route
    const next = normalizePath(url.pathname);
    if (!inScope(next)) continue; // stay within the damoclesSword subtree
    paths.push(next);
  }
  return paths;
}

for (const viewport of viewports) {
  test(`no horizontal scroll at ${viewport.name} (${viewport.width}px)`, async ({
    page,
    baseURL,
  }) => {
    expect(
      baseURL,
      'baseURL must be configured in playwright.config.ts'
    ).toBeTruthy();

    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });

    // Breadth-first crawl seeded from `baseURL`'s path, at the viewport under
    // test: every route is measured for horizontal scroll the moment it's
    // visited, and its in-app links feed the queue.
    const scope = normalizePath(new URL(baseURL as string).pathname);
    const seen = new Set<string>();
    const queue: string[] = [scope];
    const visited: string[] = [];

    while (queue.length && visited.length < MAX_ROUTES) {
      const route = normalizePath(queue.shift() as string);
      if (seen.has(route)) continue;
      seen.add(route);

      await page.goto(route);
      // Let the lazy-loaded remote and web fonts settle before measuring — a
      // late-loading webfont can widen nowrap text and change the outcome.
      await settle(page);
      visited.push(route);

      const probe = await probeHorizontalScroll(page);

      const detail =
        `\nRoute "${route}" @ ${viewport.name} (${viewport.width}px):` +
        `\n  scrolledX=${probe.scrolledX}px (expected 0)` +
        `\n  scrollWidth=${probe.scrollWidth} clientWidth=${probe.clientWidth}` +
        (probe.offenders.length
          ? `\n  overflowing elements:\n    ${probe.offenders.join('\n    ')}`
          : '');

      // Soft assertions so every route is reported in a single run, rather than
      // stopping at the first failure.
      expect
        .soft(probe.scrolledX, `Page scrolled horizontally.${detail}`)
        .toBe(0);
      expect
        .soft(probe.scrollWidth, `Content is wider than the viewport.${detail}`)
        .toBeLessThanOrEqual(probe.clientWidth + TOLERANCE_PX);

      for (const next of await inScopeLinks(page, scope)) {
        if (!seen.has(next) && !queue.includes(next)) queue.push(next);
      }
    }

    console.log(
      `[crawl] ${viewport.name} visited routes:`,
      JSON.stringify(visited)
    );
  });
}
