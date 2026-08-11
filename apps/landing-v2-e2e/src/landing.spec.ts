import { expect, Page, test } from '@playwright/test';

/**
 * Smoke test for the landingV2 landing page. It renders through the shell
 * (remotes render blank on their own port), so `baseURL` points at the
 * shell's locale root (see playwright.config.ts).
 */

/**
 * Wait for the lazy-loaded remote and web fonts to settle before asserting.
 * Mirrors the render-idle signal used by the horizontal-scroll spec: web
 * fonts ready plus a quiet window with no structural DOM mutations.
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

test.describe('landingV2 landing page', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    expect(
      baseURL,
      'baseURL must be configured in playwright.config.ts'
    ).toBeTruthy();
    // A leading-slash path resolves against the origin, not baseURL's path
    // (http://localhost:4200/en) — navigate to /en explicitly.
    await page.goto('/en');
    await settle(page);
  });

  test('header has no navigation links (brief #1)', async ({ page }) => {
    await expect(page.locator('lib-landing-v2-site-header')).toBeVisible();
    await expect(page.locator('lib-landing-v2-site-header nav')).toHaveCount(
      0
    );
  });

  test('projects grid renders at least 4 cards (brief #3/#4)', async ({
    page,
  }) => {
    const cards = page.locator('lib-landing-v2-project-card');
    expect(await cards.count()).toBeGreaterThanOrEqual(4);
  });

  test('the header CV link downloads the résumé', async ({ page }) => {
    const cvLink = page.locator('.site-header__cv');
    await expect(cvLink).toHaveAttribute('download', '');
    // The bundler may content-hash the emitted filename, so only the
    // extension is asserted, not the literal "resume" name.
    await expect(cvLink).toHaveAttribute('href', /\.pdf($|\?)/);
  });

  test('footer shows the current year (brief #6)', async ({ page }) => {
    const year = new Date().getFullYear().toString();
    await expect(page.locator('.site-footer__note')).toContainText(year);
  });
});
