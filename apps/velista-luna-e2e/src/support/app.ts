import {
  expect,
  type Browser,
  type Locator,
  type Page,
} from '@playwright/test';
import { DEMO_PASSWORD } from '@portfolio/luna-shopper/test-fixtures';
import { VELISTA_BASE_URL } from '../../playwright.config';

/**
 * The screens, as a spec drives them. Every string here is the English copy
 * from `libs/velista/ui/assets/i18n/en.json`, and every selector is one the
 * app draws for a person: a role, a label, a visible name. Nothing is a test id.
 *
 * Standalone velista mounts at the empty path, so a URL is `/{locale}/{rest}`
 * with no mount segment (CLAUDE.md, app owned locale routing).
 */

/** Sign in with email and password, and land on the dashboard. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/en/auth/login');
  await page.locator('#sign-in-email').fill(email);
  await page.locator('#sign-in-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/home\/?$/);
}

/**
 * From the dashboard, open the get list sheet, draw from exactly the named
 * lists, generate, and return the basket id from the URL it opens on.
 */
export async function generateBasket(
  page: Page,
  lists: string[],
  name?: string
): Promise<string> {
  await page.goto('/en/home');
  await page.getByRole('button', { name: 'Get shopping list' }).click();
  await expect(page).toHaveURL(/\/home\/sheet\/get$/);

  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: 'Get shopping list' })
  ).toBeVisible();
  if (name) await dialog.locator('#get-list-name').fill(name);

  // The lists sit under a disclosure per group, closed until opened. Open every
  // group, so a list is on screen whichever group it belongs to.
  const disclosures = dialog.locator('button.zone-disclosure');
  await expect(disclosures.first()).toBeVisible();
  for (const disclosure of await disclosures.all()) {
    if ((await disclosure.getAttribute('aria-expanded')) === 'false') {
      await disclosure.click();
      await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    }
  }

  // A list row is a checkbox named by its own list name. Tick the ones asked
  // for and untick the rest, whatever state the sheet opened in. Each row is
  // addressed by name, because a click re-renders the tree and an index into
  // the old render is what the row used to be.
  const rows = dialog.locator('button.list-row[role="checkbox"]');
  await expect(rows.first()).toBeVisible();
  const names = (await rows.locator('.list-name').allInnerTexts()).map((n) =>
    n.trim()
  );
  for (const name of names) {
    const rowByName = rows.filter({
      has: page.locator('.list-name', {
        hasText: new RegExp(`^\\s*${name}\\s*$`),
      }),
    });
    const wanted = lists.includes(name);
    const checked = (await rowByName.getAttribute('aria-checked')) === 'true';
    if (wanted !== checked) await rowByName.click();
    await expect(rowByName).toHaveAttribute('aria-checked', String(wanted));
  }

  await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/shopping-lists\/[0-9a-f-]{36}$/);
  return page.url().split('/shopping-lists/')[1];
}

/** The basket rows on screen, and the one for a named line. */
export function rows(page: Page): Locator {
  return page.locator('lib-basket-line-row');
}

export function row(page: Page, name: string): Locator {
  return rows(page).filter({
    has: page.locator('.content', { hasText: new RegExp(`^\\s*${name}\\s*$`) }),
  });
}

/** The reel on a basket row, or in a sheet by its label. */
export function reel(scope: Locator | Page, label: string | RegExp): Locator {
  return scope.getByRole('spinbutton', { name: label });
}

/**
 * Move a reel by keyboard and let it commit. A run of key presses commits once
 * after the idle window, or at once on blur; both are used so the commit is
 * not left to the timer alone.
 */
export async function nudge(control: Locator, delta: number): Promise<void> {
  await control.focus();
  const key = delta > 0 ? 'ArrowUp' : 'ArrowDown';
  for (let i = 0; i < Math.abs(delta); i++) {
    await control.press(key);
  }
  await control.blur();
}

/** The sheet currently open, by its title. */
export function sheet(page: Page, title: string | RegExp): Locator {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: title }),
  });
}

/** Open a basket row's settle sheet by pressing the row itself. */
export async function openSettleSheet(
  page: Page,
  name: string
): Promise<Locator> {
  await row(page, name).locator('button.body').click();
  await expect(page).toHaveURL(/\/sheet\/lines\/[0-9a-f-]{36}\/settle$/);
  const dialog = sheet(page, name);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Wait for a sheet to be gone, by the URL it leaves behind. */
export async function expectBasketUrl(
  page: Page,
  basketId: string
): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/en/shopping-lists/${basketId}$`));
}

/** The tools row's filter control, whatever its count. */
export function filterTool(page: Page): Locator {
  return page.getByRole('button', { name: /^Filter and order/ });
}

/** Open the filter sheet from the tools row. */
export async function openFilterSheet(page: Page): Promise<Locator> {
  await filterTool(page).click();
  await expect(page).toHaveURL(/\/sheet\/filter$/);
  const dialog = sheet(page, 'Filter and order');
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The chip row's chips, by label. */
export function chip(page: Page, label: string): Locator {
  return page.locator('lib-chip-row button.chip', { hasText: label });
}

/**
 * A second person: their own browser context, signed in to nothing, on the
 * same origin and with the same certificate allowance as the main page.
 * `browser.newContext()` inherits none of the config's `use` options, so both
 * are stated here rather than assumed.
 */
export async function newVisitor(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    baseURL: VELISTA_BASE_URL,
    ignoreHTTPSErrors: true,
  });
  return context.newPage();
}

/** Open the share sheet as the owner, read the link it shows, and close it. */
export async function readShareLinkFromSheet(
  page: Page,
  basketId: string
): Promise<string> {
  await page.getByRole('button', { name: 'Share this list' }).click();
  await expect(page).toHaveURL(/\/sheet\/share$/);
  const dialog = sheet(page, 'Share this list');
  const link = dialog.locator('code.link-url');
  await expect(link).toHaveText(/\/s\/[A-Za-z0-9_-]+/);
  const url = (await link.textContent())?.trim() ?? '';
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expectBasketUrl(page, basketId);
  return url;
}
