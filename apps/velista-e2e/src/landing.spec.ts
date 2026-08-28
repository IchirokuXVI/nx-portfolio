import { expect, test, type Page } from '@playwright/test';

/**
 * The front door, through the shell (CLAUDE.md), which is the only place this app
 * renders.
 *
 * Two things are checked here that no unit test can reach, because both were reported
 * from a running browser and both were invisible to a green suite:
 *
 * - **Plan 0006, criteria 3 and 4.** Every string on this screen used to render as its
 *   raw key. A spec with a fake loader would never have caught it: it needed the real
 *   nested JSON, the real module federation singleton and the real route resolver.
 * - **Plan 0007, criterion 6a.** The language control did nothing on click. A unit
 *   test clicking a `DebugElement` cannot see a control nothing is wired to, which is
 *   roughly how it survived.
 */

/** A raw i18n key: dotted, lower camel, no spaces. What a failed lookup renders. */
const RAW_KEY = /(^|\s)[a-z][\w-]*(\.[\w-]+)+(\s|$)/;

async function appText(page: Page): Promise<string> {
  return (await page.locator('.app-root').innerText()).trim();
}

test.describe('velista landing page', () => {
  test('renders translated English, with no key left on screen', async ({
    page,
  }) => {
    await page.goto('/velista/en');

    await expect(page.locator('.app-root')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'One list. Everyone in sync.'
    );

    // The whole screen, not just the heading. The defect dropped five of six top
    // level branches of the namespace, so any single binding could have been the
    // one that happened to work.
    expect(await appText(page)).not.toMatch(RAW_KEY);
  });

  test('renders Spanish at /es, including the invented preview list', async ({
    page,
  }) => {
    await page.goto('/velista/es');

    const text = await appText(page);

    expect(text).not.toMatch(RAW_KEY);
    // Plan 0007 section 7 reversed the decision to leave these in English: they are
    // the only words on the front door that say what the product does.
    expect(text).toContain('Leche');
  });

  test('the language control opens, and switches the locale in place', async ({
    page,
  }) => {
    await page.goto('/velista/en');

    const trigger = page.locator('.locale');

    // The reported symptom, asserted as the precondition: before the fix this
    // control had no menu to open and no expanded state to report.
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.menu')).toHaveCount(0);

    await trigger.click();

    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.menu [role="menuitem"]')).toHaveCount(2);
    await expect(
      page.locator('.menu [role="menuitem"][aria-current="true"]')
    ).toHaveText('EN');

    await page.locator('.menu [role="menuitem"]', { hasText: 'ES' }).click();

    // A router navigation, not a reload: the URL carries the new locale and the
    // strings follow it without a round trip.
    await expect(page).toHaveURL(/\/velista\/es\/?$/);
    await expect(trigger).toHaveText('ES');
    await expect(page.locator('.menu')).toHaveCount(0);
    expect(await appText(page)).not.toMatch(RAW_KEY);
  });

  test('the menu closes on an outside click and on Escape', async ({
    page,
  }) => {
    await page.goto('/velista/en');

    const trigger = page.locator('.locale');

    await trigger.click();
    await expect(page.locator('.menu')).toBeVisible();
    await page.locator('h1').click();
    await expect(page.locator('.menu')).toHaveCount(0);

    await trigger.click();
    await expect(page.locator('.menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.menu')).toHaveCount(0);
  });

  test('signing in is not required to reach the front door, and the dashboard is guarded', async ({
    page,
  }) => {
    // Plan 0007 criterion 2: an anonymous visitor asking for the dashboard is sent
    // back to the front door, and the locale segment survives the redirect.
    await page.goto('/velista/es/home');

    await expect(page).toHaveURL(/\/velista\/es\/?$/);
  });

  test('the content column is centred on a wide viewport', async ({ page }) => {
    // Plan 0007 criterion 7. `AppLayout` was sizing to its content instead of
    // filling the shell's flex row, so a 480px column was centred inside a 480px
    // box pinned to the left edge.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/velista/en');

    const measured = await page.locator('.app-main').boundingBox();

    expect(measured).not.toBeNull();

    const box = measured as NonNullable<typeof measured>;

    expect(box.width).toBeLessThanOrEqual(481);
    // Centred in the viewport, not merely centred inside a box that is itself
    // pinned to the left edge, which is exactly what the defect looked like.
    expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThan(2);
  });
});
