import { expect, test } from '@playwright/test';
import { settle } from './support/locale-helpers';

/**
 * The damoclesSword language selector is a custom dropdown. Once it is open, a
 * click anywhere outside it must close it (the standard dropdown affordance,
 * implemented via the component's `(document:click)` host listener).
 */
test.describe('damoclesSword language selector', () => {
  test('closes the dropdown when a click lands outside it', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL, 'baseURL must be configured').toBeTruthy();

    // Wide enough that the header uses its inline (non-hamburger) layout, so the
    // switcher is directly interactive without opening the mobile nav.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/damoclesSword');
    await settle(page);

    const openDropdown = page.locator(
      'lib-damocles-sword-language-selector .selectable-languages.shown'
    );

    // Open the dropdown and confirm the options are showing.
    await page.locator('.selected-language-container:visible').first().click();
    await expect(openDropdown).toBeVisible();

    // A click outside the selector closes it. document.body.click() dispatches a
    // real click that bubbles to the component's (document:click) host listener,
    // exactly as an outside click would, and without navigating away.
    await page.evaluate(() => document.body.click());

    await expect(openDropdown).toBeHidden();
  });
});
