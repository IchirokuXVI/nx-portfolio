import { expect, test, type Page } from '@playwright/test';
import { ALICE_EMAIL } from './support/api';
import { signIn } from './support/app';

/**
 * The category picker (velista plan 0119), walked once as a shopper would: the
 * catalog tab, the page of parents, one parent's children, the tab narrowed to a
 * child, and the chip cleared.
 *
 * The demo world files Milk under the `milk` leaf of Dairy and eggs and Bread under
 * `bread` of Bakery (backend plan 0166), and the catalog seed writes the tree those
 * slugs name, so both roots have a product under them and are drawn. Every name
 * asserted here is the English one the seed gives the row.
 */
test.describe('the category picker', () => {
  test('narrows the catalog by a category and clears it again', async ({
    page,
  }) => {
    await test.step('1. the tab leads its chip row with Categories', async () => {
      await signIn(page, ALICE_EMAIL);
      await page
        .getByRole('navigation', { name: 'Main sections' })
        .getByRole('link', { name: 'Catalog' })
        .click();
      await expect(page).toHaveURL(/\/en\/catalog$/);
      await expect(products(page, 'Bread')).toBeVisible();

      await page.getByRole('link', { name: 'Categories', exact: true }).click();
    });

    await test.step('2. the page of parents, with the bar lighting Catalog', async () => {
      await expect(page).toHaveURL(/\/en\/catalog\/categories$/);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Categories' })
      ).toBeVisible();
      await expectCatalogLit(page);

      // A row is one link, named "name, count".
      await expect(
        page.getByRole('link', { name: /^Bakery, \d[\d,]* products?$/ })
      ).toBeVisible();
      await page
        .getByRole('link', { name: /^Dairy and eggs, \d[\d,]* products?$/ })
        .click();
    });

    await test.step('3. one parent: Everything in it, then its children', async () => {
      await expect(page).toHaveURL(
        /\/en\/catalog\/categories\/dairy-and-eggs$/
      );
      await expect(
        page.getByRole('heading', { level: 1, name: 'Dairy and eggs' })
      ).toBeVisible();
      await expectCatalogLit(page);
      await expect(
        page.getByRole('link', {
          name: /^Everything in Dairy and eggs, \d[\d,]* products?$/,
        })
      ).toBeVisible();

      await page
        .getByRole('link', { name: /^Milk, \d[\d,]* products?$/ })
        .click();
    });

    await test.step('4. the tab, narrowed to Milk', async () => {
      await expect(page).toHaveURL(/\/en\/catalog\?category=milk$/);
      await expect(
        page.getByRole('link', {
          name: 'Dairy and eggs, Milk. Change the category',
        })
      ).toBeVisible();
      await expect(page.getByRole('searchbox')).toHaveAttribute(
        'placeholder',
        'Search in Milk'
      );
      await expect(products(page, 'Milk')).toBeVisible();
      await expect(products(page, 'Bread')).toHaveCount(0);
    });

    await test.step('5. the chip cleared: every product again', async () => {
      await page.getByRole('button', { name: 'Clear the category' }).click();

      await expect(page).toHaveURL(/\/en\/catalog$/);
      await expect(
        page.getByRole('link', { name: 'Categories', exact: true })
      ).toBeVisible();
      await expect(products(page, 'Bread')).toBeVisible();
      await expect(products(page, 'Milk')).toBeVisible();
    });
  });
});

/**
 * The Supermarket button (velista plan 0124), walked once: the picker page, a
 * chain chosen whole through its any row, every supermarket again through the x,
 * and one shop, which prices the tab there. The demo world has one chain,
 * Mercadona, with one shop, Colón, which sells Milk and Bread.
 */
test.describe('the Supermarket button', () => {
  test('narrows the catalog to a chain, clears it, then prices it at one shop', async ({
    page,
  }) => {
    const button = page.locator('lib-supermarket-button');

    await test.step('1. the tab draws one button, for every supermarket', async () => {
      await signIn(page, ALICE_EMAIL);
      await page
        .getByRole('navigation', { name: 'Main sections' })
        .getByRole('link', { name: 'Catalog' })
        .click();
      await expect(page).toHaveURL(/\/en\/catalog$/);
      await expect(button).toContainText('All supermarkets');
      await expect(products(page, 'Bread')).toBeVisible();
    });

    await test.step('2. the picker page, and Mercadona on its own screen', async () => {
      await button.locator('button.body').click();
      await expect(page).toHaveURL(/\/en\/catalog\/supermarket$/);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Supermarket' })
      ).toBeVisible();
      await expectCatalogLit(page);

      await page
        .locator('lib-franchise-buttons button', { hasText: 'Mercadona' })
        .click();
      await expect(page).toHaveURL(
        /\/en\/catalog\/supermarket\/[0-9a-f-]{36}$/
      );
      await expect(
        page.getByRole('heading', { level: 1, name: 'Mercadona' })
      ).toBeVisible();
    });

    await test.step('3. any Mercadona shop: its products, and the chain in the URL', async () => {
      await page.getByRole('radio', { name: /Any Mercadona shop/ }).check();

      await expect(page).toHaveURL(/\/en\/catalog\?chain=[0-9a-f-]{36}$/);
      await expect(button).toContainText('Mercadona');
      await expect(button).toContainText('any shop');
      await expect(page.getByRole('searchbox')).toHaveAttribute(
        'placeholder',
        'Search Mercadona'
      );
      await expect(products(page, 'Milk')).toBeVisible();
      await expect(products(page, 'Bread')).toBeVisible();
    });

    await test.step('4. the x: every supermarket again', async () => {
      await page
        .getByRole('button', { name: 'Show every supermarket' })
        .click();

      await expect(page).toHaveURL(/\/en\/catalog$/);
      await expect(button).toContainText('All supermarkets');
    });

    await test.step('5. one shop: Colón, and the prices are that shop’s', async () => {
      await button.locator('button.body').click();
      await page
        .locator('lib-franchise-buttons button', { hasText: 'Mercadona' })
        .click();
      await page.locator('label.row', { hasText: 'Colón' }).first().click();

      await expect(page).toHaveURL(
        /\/en\/catalog\?chain=[0-9a-f-]{36}&shop=[0-9a-f-]{36}$/
      );
      await expect(button).toContainText('Colón');
      await expect(page.locator('.tools .note')).toContainText('Prices at');
      await expect(products(page, 'Milk')).toBeVisible();

      // The pick replaced the picker's entry, so back leaves the catalog's
      // narrowing rather than reopening the picker.
      await page.goBack();
      await expect(page).not.toHaveURL(/\/catalog\/supermarket/);
    });
  });
});

/** One product row on the catalog tab, by the name it draws. */
function products(page: Page, name: string) {
  return page
    .locator('lib-product-row')
    .filter({ has: page.getByText(name, { exact: true }) });
}

/** The bar is drawn and its Catalog tab is the current one (velista 0097). */
async function expectCatalogLit(page: Page): Promise<void> {
  await expect(
    page
      .getByRole('navigation', { name: 'Main sections' })
      .getByRole('link', { name: 'Catalog' })
  ).toHaveAttribute('aria-current', 'page');
}
