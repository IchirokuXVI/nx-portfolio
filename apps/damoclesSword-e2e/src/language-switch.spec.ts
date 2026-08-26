import { expect, test } from './support/fixtures';
import {
  currentUrlLocale,
  settle,
  usableLocales,
} from './support/locale-helpers';

/**
 * The damoclesSword language switcher performs a runtime locale switch (0003):
 * no full page reload, the URL locale segment updates, content re-renders in the
 * new language, and the choice is persisted per app.
 *
 * The locale list is read live from the switcher, so this never needs editing
 * when a language is added or removed.
 */
test.describe('damoclesSword language switcher', () => {
  test('switches language in place, updates the URL, and persists', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL, 'baseURL must be configured').toBeTruthy();

    // Use a wide viewport so the header shows its inline layout and the switcher
    // dropdown is directly interactive. The locale switch itself is
    // viewport-independent, so this keeps the test deterministic across engines
    // without depending on the mobile hamburger nav's open/close animation.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/damoclesSword');
    await settle(page);

    const locales = await usableLocales(page);
    test.skip(
      locales.length < 2,
      'needs at least two usable locales to switch'
    );

    const from = currentUrlLocale(page);
    const to = locales.find((l) => l !== from) as string;

    const before = await page.evaluate(() => document.body.innerText);

    // Marker cleared by a full document reload; it must survive an in-place switch.
    await page.evaluate(() => {
      (window as unknown as { __noReload?: string }).__noReload = 'kept';
    });

    // Open the dropdown, then pick the target locale from the now-open option
    // list (the `.shown` class marks the open one, and waiting for it to be
    // visible ensures the buttons are laid out before we click).
    await page.locator('.selected-language-container:visible').first().click();

    const openOptions = page.locator(
      'lib-damocles-sword-language-selector .selectable-languages.shown'
    );
    await expect(openOptions).toBeVisible();

    // Match by accessible name rather than an anchored text regex: each option's
    // raw textContent carries the template's surrounding whitespace, so `^es$`
    // never matches. The locale code is unique across the options, so a
    // (whitespace-normalized) name match is unambiguous.
    await openOptions.getByRole('button', { name: to }).first().click();

    // URL locale segment updates without a reload.
    await page.waitForURL(new RegExp(`/${to}/damoclesSword`));
    await settle(page);

    const marker = await page.evaluate(
      () => (window as unknown as { __noReload?: string }).__noReload
    );
    expect(marker, 'the page must not have fully reloaded').toBe('kept');

    // Content actually re-rendered in the new language.
    const after = await page.evaluate(() => document.body.innerText);
    expect(after).not.toBe(before);

    // The choice is persisted per app: visiting the locale-less path redirects
    // back to the chosen locale.
    await page.goto('/damoclesSword');
    await settle(page);
    await expect(page).toHaveURL(new RegExp(`/${to}/damoclesSword`));
  });
});
