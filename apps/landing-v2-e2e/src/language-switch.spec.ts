import { expect, test } from '@playwright/test';
import {
  currentUrlLocale,
  settle,
  usableLocales,
} from './support/locale-helpers';

/**
 * The landingV2 language switcher performs a runtime locale switch (0003): no
 * full page reload, the URL locale segment updates, content re-renders in the new
 * language, and the choice is persisted per app.
 *
 * The locale list is read live from the switcher, so this never needs editing
 * when a language is added or removed.
 */
test.describe('landingV2 language switcher', () => {
  test('switches language in place, updates the URL, and persists', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL, 'baseURL must be configured').toBeTruthy();

    await page.goto('/en');
    await settle(page);

    const locales = await usableLocales(page);
    test.skip(locales.length < 2, 'needs at least two usable locales to switch');

    const from = currentUrlLocale(page);
    const to = locales.find((l) => l !== from) as string;

    const before = await page.evaluate(() => document.body.innerText);

    // Marker cleared by a full document reload; it must survive an in-place switch.
    await page.evaluate(() => {
      (window as unknown as { __noReload?: string }).__noReload = 'kept';
    });

    // Match by accessible name rather than an anchored text regex: the option's
    // raw textContent carries the template's surrounding whitespace, so `^es$`
    // never matches. The locale code is unique across the options.
    await page
      .locator('lib-landing-v2-language-switch')
      .getByRole('button', { name: to })
      .first()
      .click();

    // URL locale segment updates without a reload.
    await page.waitForURL(new RegExp(`/${to}(/|$)`));
    await settle(page);

    const marker = await page.evaluate(
      () => (window as unknown as { __noReload?: string }).__noReload
    );
    expect(marker, 'the page must not have fully reloaded').toBe('kept');

    // The switched-to option is now the active/pressed one.
    await expect(
      page
        .locator('lib-landing-v2-language-switch')
        .getByRole('button', { name: to })
        .first()
    ).toHaveAttribute('aria-pressed', 'true');

    // Content actually re-rendered in the new language.
    const after = await page.evaluate(() => document.body.innerText);
    expect(after).not.toBe(before);

    // The choice is persisted per app: visiting the locale-less root redirects
    // back to the chosen locale.
    await page.goto('/');
    await settle(page);
    await expect(page).toHaveURL(new RegExp(`/${to}(/|$)`));
  });
});
