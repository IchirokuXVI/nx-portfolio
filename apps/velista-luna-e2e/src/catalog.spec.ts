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
