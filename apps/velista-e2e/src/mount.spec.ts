import { expect, test } from '@playwright/test';

/**
 * velista on its own origin, where the mount is empty and the locale is the first
 * segment (plan 0165 D8). The locale guard has to correct a URL with no locale and a
 * URL whose first segment is not a supported locale, or the manifest's `start_url: "/"`
 * and every old link land on the app's not found page.
 */
test.describe('velista on its own origin', () => {
  for (const locale of ['en', 'es']) {
    test(`/${locale} renders this app in that locale`, async ({ page }) => {
      await page.goto(`/${locale}`);

      // The app's own root: the element carrying its theme token scope.
      await expect(page.locator('.app-root')).toBeVisible();

      // Still on the route we asked for: no not found, no locale rewrite.
      await expect(page).toHaveURL(new RegExp(`/${locale}/?$`));

      // The i18n namespace resolved through this app's own RokuTranslator rather
      // than rendering the raw key. Asserted as "not a key" rather than by pinning a
      // sentence, so a copy edit does not fail a test about the translation layer
      // (plan 0005, section 9, item 2).
      const headline = page.getByRole('heading', { level: 1 });

      await expect(headline).toBeVisible();
      await expect(headline).not.toHaveText(/^[a-z][\w-]*(\.[\w-]+)+$/);
    });
  }

  test('a bare / is given a locale', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/(en|es)\/?$/);
    await expect(page.locator('.app-root')).toBeVisible();
  });

  test('a first segment that is not a locale is replaced by one', async ({
    page,
  }) => {
    await page.goto('/zz');

    await expect(page).toHaveURL(/\/(en|es)\/?$/);
    await expect(page.locator('.app-root')).toBeVisible();
  });
});
