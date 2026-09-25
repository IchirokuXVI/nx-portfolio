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
 * From the history, open the get list sheet, draw from exactly the named
 * lists, generate, and return the basket id from the URL it opens on.
 *
 * The history and not the dashboard, since velista `0097`: home's button row was
 * replaced by the app's own bottom bar, so the two screens that offer this now are
 * the history and the third tab. The history is the one a spec can always use, because
 * the tab redirects to whatever basket is already being shopped and a spec that
 * generates a second one would find no button there.
 */
export async function generateBasket(
  page: Page,
  lists: string[],
  name?: string
): Promise<string> {
  await page.goto('/en/shopping-lists');
  await page.getByRole('button', { name: 'Get shopping list' }).click();
  await expect(page).toHaveURL(/\/shopping-lists\/sheet\/get$/);

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
  return page.locator('lib-basket-row');
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
  await expect(page).toHaveURL(/\/sheet\/rows\/[0-9a-f-]{36}\/settle$/);
  const dialog = sheet(page, name);
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * On an open settle sheet, say which product of a row of several was got
 * (velista `0092`, section 5).
 *
 * Change opens "Which did you get?", a radio group, and choosing closes that
 * pane back onto the settle pane. Nothing is written: the choice rides on the
 * next purchase made **from this sheet**. The row's own glyph and reel do not
 * carry it (the page binds the row to `insteadOf`, velista `0102`), so a spec
 * that means to buy a named product buys it here.
 */
export async function chooseProduct(
  dialog: Locator,
  product: string
): Promise<void> {
  await dialog.getByRole('button', { name: 'Change', exact: true }).click();
  const option = dialog.getByRole('radio', {
    name: new RegExp(`^\\s*${product}\\b`),
  });
  // The choice lasts the visit, so it may already be this one, and checking a
  // checked radio fires nothing. The pane's Cancel is then the way back.
  if (await option.isChecked()) {
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  } else {
    // A click, not `check()`: choosing closes the pane, and `check()` then
    // waits to confirm a radio that is gone.
    await option.click();
  }
  await expect(dialog.getByRole('radio')).toHaveCount(0);
}

/**
 * The "got" reel of one list on an open settle sheet (velista `0090`, 9.2).
 * Raising it buys that many for that household alone, as the product chosen
 * on the sheet, and leaves the sheet open.
 */
export function gotReel(dialog: Locator, list: string): Locator {
  return reel(
    dialog.locator('lib-row-entries'),
    new RegExp(`^${list}.*, got$`)
  );
}

/**
 * Close a settle sheet by Escape, and wait for the basket's URL.
 *
 * The key goes to the sheet's own title (it takes focus, `tabindex="-1"`),
 * because a pane that held focus may be gone and Escape pressed on the page
 * body reaches no sheet.
 */
export async function closeSettleSheet(
  page: Page,
  dialog: Locator,
  basketId: string
): Promise<void> {
  await dialog.locator('#settle-title').press('Escape');
  await expectBasketUrl(page, basketId);
}

/**
 * Add a line from the basket's composer, to the named list (velista `0092`
 * section 7, `0110`).
 *
 * A basket over more than one list adds to the list chosen beside the field,
 * and the field is locked until one is. The chip names the list once one is
 * chosen, so it is pressed whatever it says.
 */
export async function addInTheAisle(
  page: Page,
  basketId: string,
  list: string,
  content: string
): Promise<void> {
  await page.locator('.composer-dock button.target').click();
  const target = sheet(page, 'Which list is this for?');
  // A click, not `check()`: choosing closes the sheet, and `check()` then
  // waits to confirm a radio that is gone. The chip below is the confirmation.
  await target.getByRole('radio', { name: list, exact: true }).click();
  await expectBasketUrl(page, basketId);
  await expect(page.locator('.composer-dock .target')).toHaveText(
    `To: ${list}`
  );

  const composer = page.locator('lib-line-composer');
  await composer.getByRole('combobox', { name: 'Add something' }).fill(content);
  await composer.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(row(page, content)).toBeVisible();
}

/**
 * Wait for a sheet to be gone, by the URL it leaves behind. An open search
 * keeps itself in the query (`?search=1`), so a query is allowed.
 */
export async function expectBasketUrl(
  page: Page,
  basketId: string
): Promise<void> {
  await expect(page).toHaveURL(
    new RegExp(`/en/shopping-lists/${basketId}(\\?.*)?$`)
  );
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

/**
 * Open the share sheet as the owner, make a link, read it, and close the sheet.
 *
 * A basket has no link until somebody asks for one (velista `0094`): the sheet
 * opens on "This list has no link right now" and a Make a link button.
 */
export async function readShareLinkFromSheet(
  page: Page,
  basketId: string
): Promise<string> {
  await page.getByRole('button', { name: 'Share this list' }).click();
  await expect(page).toHaveURL(/\/sheet\/share$/);
  const dialog = sheet(page, 'Share this list');
  await dialog
    .getByRole('button', { name: 'Make a link', exact: true })
    .click();
  const link = dialog.locator('code.link-url');
  await expect(link).toHaveText(/\/s\/[A-Za-z0-9_-]+/);
  const url = (await link.textContent())?.trim() ?? '';
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expectBasketUrl(page, basketId);
  return url;
}
