import { expect, test } from '@playwright/test';
import { settle } from './support/locale-helpers';

/**
 * Smoke test for the landingV2 landing page. It renders through the shell
 * (remotes render blank on their own port), so `baseURL` points at the
 * shell's locale root (see playwright.config.ts).
 */

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
