import { expect, test } from '@playwright/test';

/**
 * The app renders only through the shell (CLAUDE.md), so every check here goes
 * through the shell's origin, never port 4205.
 *
 * The point of this suite is plan 0001, section 6.1: the shell's `velista` route
 * must stay **above** the empty-path entry that loads landingV2. An empty-path
 * route with `loadChildren` is not terminal, so if the order is ever reshuffled
 * Angular hands `velista` to landingV2's route table and the user lands on its
 * not-found page. That failure would be silent in every other suite, which is why
 * it is covered here.
 */
test.describe('velista mounts under the shell', () => {
  for (const locale of ['en', 'es']) {
    test(`/${locale}/velista resolves to this app, not landingV2`, async ({
      page,
    }) => {
      await page.goto(`/${locale}/velista`);

      // The app's own root: the element carrying its theme token scope. Nothing
      // else in the portfolio renders it, so seeing it proves the right remote
      // answered.
      await expect(page.locator('.app-root')).toBeVisible();

      // Still on the route we asked for — no not-found, no locale rewrite.
      await expect(page).toHaveURL(new RegExp(`/${locale}/velista/?$`));

      // The i18n namespace resolved through the shared RokuTranslator singleton
      // rather than rendering the raw key.
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Velista'
      );
    });
  }
});
