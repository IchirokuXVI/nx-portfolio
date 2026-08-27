import { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { settle, usableLocales } from './support/locale-helpers';

/**
 * Regression guard against horizontal scroll on the damoclesSword pages.
 *
 * A page should never be wider than its viewport: if it is, the user gets an
 * unwanted horizontal scrollbar. We check every viewport across a range of
 * sizes, since overflow bugs are almost always viewport-specific, and every
 * usable locale, since a longer translation (Spanish runs longer than English)
 * is a common source of overflow.
 *
 * Routes are not hardcoded: each viewport test discovers the locale set once (in
 * the default language) and then crawls starting from `baseURL` (the
 * damoclesSword page, from the Playwright config, which also spins up the dev
 * server), following only in-app links that stay within that route subtree, so
 * newly added damoclesSword routes are covered automatically while the shared
 * shell navigation into other micro-frontends (landing/odontogram) is excluded.
 * Crawling happens in the default locale at the viewport under test — the layout
 * that hides or reveals links is the same one being probed for overflow, so a
 * route is only discovered (and only checked) at sizes where it is actually
 * reachable — and each discovered route is then measured for overflow in every
 * locale.
 */

const viewports = [
  { name: 'mobile-sm', width: 320, height: 720 },
  { name: 'mobile', width: 420, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'desktop', width: 1920, height: 1080 },

  // High-DPI panels at a browser zoom that enlarges content, which lowers the
  // *effective* CSS viewport the layout responds to: a 25% zoom makes everything
  // 25% bigger, so 1920x1080 lays out as 1440x810, and 3840x2160 as 2880x1620.
  // 2560x1440 @ 25% and 3840x2160 @ 50% both resolve to 1920x1080, which the
  // 'desktop' entry above already covers.
  { name: '1080p@25%', width: 1440, height: 810 },
  { name: '4k@25%', width: 2880, height: 1620 },
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
 * Swap this app's locale segment for another locale.
 *
 * The locale sits **below** the mount now (`/damoclesSword/en/about`), so the
 * segment to replace is the one after the mount rather than the first one. Swapping
 * index 0 would replace `damoclesSword` itself and crawl a different app entirely.
 */
function withLocale(path: string, locale: string, mount: string): string {
  const segments = path.split('/').filter(Boolean);
  const index = mount.split('/').filter(Boolean).length;

  if (segments.length <= index) return `${mount}/${locale}`;

  segments[index] = locale;
  return '/' + segments.join('/');
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
    // One test here is a whole crawl: every discovered route is loaded once to
    // read its links and then once more per non-default locale, so the work is
    // routes x locales navigations, each followed by a settle. Today that is
    // already 15 navigations, and the crawl exists precisely so that new routes
    // are picked up without editing this file, so a fixed per-test budget goes
    // stale the moment the app grows one more page. Scale
    // the budget with the crawl's own ceiling instead.
    test.setTimeout(MAX_ROUTES * 6_000);

    expect(
      baseURL,
      'baseURL must be configured in playwright.config.ts'
    ).toBeTruthy();

    const scope = normalizePath(new URL(baseURL as string).pathname);
    // `scope` is `/damoclesSword/en`: the mount, then the locale below it. It used
    // to be `/en/damoclesSword`, so the two were the other way round and the locale
    // was segment 0 (plan 0003).
    const scopeSegments = scope.split('/').filter(Boolean);
    const mount = `/${scopeSegments[0]}`;
    const defaultLocale = scopeSegments[1];

    // The usable-locale set is app config (viewport-independent), so discover it
    // once, up front, at a wide viewport where the switcher's options are laid
    // out and readable.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(scope);
    await settle(page);
    const locales = await usableLocales(page);
    expect(
      locales.length,
      'expected at least one usable locale'
    ).toBeGreaterThan(0);

    // Breadth-first crawl seeded from `baseURL`'s path, at the viewport under
    // test: routes are discovered in the default locale, and each is then
    // measured for horizontal scroll in every locale.
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });

    const seen = new Set<string>();
    const queue: string[] = [scope];
    const visited: string[] = [];

    while (queue.length && visited.length < MAX_ROUTES) {
      const route = normalizePath(queue.shift() as string);
      if (seen.has(route)) continue;
      seen.add(route);

      // Discover this route's in-app links once, in the default locale, at the
      // viewport under test (the links a narrow layout hides feed nothing to the
      // queue, so unreachable routes aren't crawled). A late-loading webfont can
      // widen nowrap text, so settle before reading anything.
      await page.goto(route);
      await settle(page);
      visited.push(route);
      for (const next of await inScopeLinks(page, scope)) {
        if (!seen.has(next) && !queue.includes(next)) queue.push(next);
      }

      // Measure the same route in every locale. The default locale is already
      // loaded from the link-discovery navigation above, so probe it in place.
      for (const locale of locales) {
        const localeRoute = withLocale(route, locale, mount);
        if (locale !== defaultLocale) {
          await page.goto(localeRoute);
          await settle(page);
        }

        const probe = await probeHorizontalScroll(page);

        const detail =
          `\nRoute "${localeRoute}" @ ${viewport.name} (${viewport.width}px):` +
          `\n  scrolledX=${probe.scrolledX}px (expected 0)` +
          `\n  scrollWidth=${probe.scrollWidth} clientWidth=${probe.clientWidth}` +
          (probe.offenders.length
            ? `\n  overflowing elements:\n    ${probe.offenders.join('\n    ')}`
            : '');

        // Soft assertions so every route/locale is reported in a single run,
        // rather than stopping at the first failure.
        expect
          .soft(probe.scrolledX, `Page scrolled horizontally.${detail}`)
          .toBe(0);
        expect
          .soft(
            probe.scrollWidth,
            `Content is wider than the viewport.${detail}`
          )
          .toBeLessThanOrEqual(probe.clientWidth + TOLERANCE_PX);
      }
    }

    console.log(
      `[crawl] ${viewport.name} visited routes:`,
      JSON.stringify(visited),
      `x ${locales.length} locale(s):`,
      JSON.stringify(locales)
    );
  });
}
