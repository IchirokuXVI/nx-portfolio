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
    // swallowed the press and said nothing at all (D5). Forced, because Playwright's
    // own actionability check reads `aria-disabled="true"` as not enabled and would
    // otherwise wait forever for the exact state this screen is in on purpose.
    // eslint-disable-next-line playwright/no-force-option -- aria-disabled is the state under test
    await create.click({ force: true });

    await expect(page.locator('[role="status"]')).toBeVisible();
    await expect(page).toHaveURL(/\/velista\/en\/?$/);
  });

  test('holds the outlet closed on every other page', async ({ page }) => {
    await stubBackendUnreachable(page);

    // The sign-in page: a real page that is not landing and carries no flag, so it
    // waits. Its guard reads only the local session store, so the URL is reached and
    // settled without the backend; what is held is only the drawing. A guarded page
    // like a group's would not do here (`authenticatedGuard` sends an anonymous
    // visitor to landing, which draws), and neither would a URL that matches nothing
    // (the app's 404 hangs outside `AppLayout`, where there is no gate to see).
    await page.goto('/velista/en/auth/login');

    // The panel inside the screen, because the host element is inline with block
    // children: its own bounding box is empty, and Playwright reads that as hidden.
    await expect(page.locator('lib-startup-screen .panel')).toBeVisible();
    // The outlet inside the layout, not every outlet on the page: the shell and the
    // app root above the gate keep theirs, held or not.
    await expect(page.locator('lib-app-layout router-outlet')).toHaveCount(0);
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
