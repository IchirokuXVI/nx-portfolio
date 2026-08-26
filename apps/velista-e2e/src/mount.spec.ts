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
      //
      // Asserted as "not a key" rather than by pinning one sentence. This used to
      // expect the literal 'Velista', written when the `<h1>` was the app title;
      // it is the landing hero's headline now, so a copy edit would have failed a
      // test that is really about the translation layer being wired up (plan 0005,
      // section 9, item 2). A raw key is the failure this catches, and a raw key
      // is exactly what a dotted lowercase token with no spaces looks like.
      const headline = page.getByRole('heading', { level: 1 });

      await expect(headline).toBeVisible();
      await expect(headline).not.toHaveText(/^[a-z][\w-]*(\.[\w-]+)+$/);
    });
  }
});
