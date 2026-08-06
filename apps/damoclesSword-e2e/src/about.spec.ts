import { expect, Page, test } from '@playwright/test';

/**
 * Smoke test for the damoclesSword About page. It renders through the shell
 * (remotes render blank on their own port), so `baseURL` points at the shell's
 * damoclesSword route (see playwright.config.ts). We assert the three About
 * sections mount with their titles and that the "Our Values" section renders the
 * four value cards.
 */

/**
 * Wait for the lazy-loaded remote and web fonts to settle before asserting.
 * Mirrors the render-idle signal used by the horizontal-scroll spec: web fonts
 * ready plus a quiet window with no structural DOM mutations.
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

test.describe('damoclesSword About page', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    expect(
      baseURL,
      'baseURL must be configured in playwright.config.ts'
    ).toBeTruthy();
    await page.goto(`${baseURL}/about`);
    await settle(page);
  });

  test('renders the three About sections', async ({ page }) => {
    await expect(
      page.locator('lib-damocles-sword-section-who-we-are')
    ).toBeVisible();
    await expect(
      page.locator('lib-damocles-sword-section-our-values')
    ).toBeVisible();
    await expect(
      page.locator('lib-damocles-sword-section-future')
    ).toBeVisible();

    await expect(page.getByText('Who We Are', { exact: true })).toBeVisible();
    await expect(page.getByText('Our Values', { exact: true })).toBeVisible();
    await expect(
      page.getByText("Damocle'Sword In The Future", { exact: true })
    ).toBeVisible();
  });

  test('renders the four value cards', async ({ page }) => {
    const cards = page.locator(
      'lib-damocles-sword-section-our-values lib-damocles-sword-info-card'
    );
    await expect(cards).toHaveCount(4);

    await expect(
      page.getByText('Quality And Demand', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText('Social Responsibility', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText('Respect For Our Own', { exact: true })
    ).toBeVisible();
    await expect(page.getByText('Curiosity', { exact: true })).toBeVisible();
  });
});
