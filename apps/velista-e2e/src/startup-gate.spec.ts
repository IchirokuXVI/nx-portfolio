import { expect, test } from '@playwright/test';
import { stubBackendReady, stubBackendUnreachable } from './support/gateway';

/**
 * Plan 0071, acceptance criteria 1, 2 and 5, through the shell as every velista suite
 * runs (CLAUDE.md).
 *
 * The app used to find out it had no backend from whichever request the user's first
 * tap happened to send, which on this screen is the tap that creates an account. What
 * these check is the two halves of the fix that only a browser can show: the landing
 * page still appears at once, and its four ways in do not act until the backend has
 * answered.
 */
test.describe('the startup gate', () => {
  test('draws the front door with its actions held while the backend is silent', async ({
    page,
  }) => {
    await stubBackendUnreachable(page);
    await page.goto('/velista/en');

    // Criterion 1: landing is the one route that renders while connecting. It is the
    // front door, and a visitor who tapped a link must see what the product is.
    await expect(page.locator('.app-root')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const create = page.getByRole('button', { name: /create/i });

    await expect(create).toBeVisible();
    await expect(create).toHaveAttribute('aria-disabled', 'true');

    // Criterion 2: pressing one says why, and creates nothing. `disabled` would have
    // swallowed the press and said nothing at all (D5).
    await create.click();

    await expect(page.locator('[role="status"]')).toBeVisible();
    await expect(page).toHaveURL(/\/velista\/en\/?$/);
  });

  test('holds the outlet closed on every other page', async ({ page }) => {
    await stubBackendUnreachable(page);

    // A group's page, which is not landing and carries no flag, so it waits. The URL
    // is reached and the locale guard settles it; what is held is only the drawing.
    await page.goto('/velista/en/zones');

    await expect(page.locator('lib-startup-screen')).toBeVisible();
    await expect(page.locator('router-outlet')).toHaveCount(0);
  });

  test('lets go as soon as the backend answers, with no reload', async ({
    page,
  }) => {
    await stubBackendReady(page);
    await page.goto('/velista/en');

    // Criterion 5, from the other side: with the probe answered the four ways in are
    // ordinary controls again.
    const create = page.getByRole('button', { name: /create/i });

    await expect(create).toBeVisible();
    await expect(create).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('[role="status"]')).toHaveCount(0);
  });
});
