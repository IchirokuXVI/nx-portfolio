import { expect, test, type Page } from '@playwright/test';
import { ALICE_EMAIL } from './support/api';
import { signIn } from './support/app';

/**
 * The category picker (velista plan 0119), walked once as a shopper would: the
 * catalog tab, the page of parents, one parent's children, the tab narrowed to a
 * child, and the choice cleared. The way in is the Category selector (velista
 * plan 0134).
 *
 * The demo world files Milk under the `milk` leaf of Eggs, milk, and butter and
 * Bread under `freshly-baked-bread` of Bakery (backend plan 0173), and the catalog
 * seed writes the tree those slugs name, so both roots have a product under them
 * and are drawn. Every name asserted here is the English one the seed gives the
 * row.
 */
test.describe('the category picker', () => {
  test('narrows the catalog by a category and clears it again', async ({
    page,
  }) => {
    await test.step('1. the Category selector says All categories', async () => {
      await signIn(page, ALICE_EMAIL);
      await page
        .getByRole('navigation', { name: 'Main sections' })
        .getByRole('link', { name: 'Catalog' })
        .click();
      await expect(page).toHaveURL(/\/en\/catalog$/);
      await expect(products(page, 'Bread')).toBeVisible();

      await expect(category(page)).toContainText('All categories');
      await category(page).click();
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
        .getByRole('link', {
          name: /^Eggs, milk, and butter, \d[\d,]* products?$/,
        })
        .click();
    });

    await test.step('3. one parent: Everything in it, then its children', async () => {
      await expect(page).toHaveURL(
        /\/en\/catalog\/categories\/eggs-milk-and-butter$/
      );
      await expect(
        page.getByRole('heading', { level: 1, name: 'Eggs, milk, and butter' })
      ).toBeVisible();
      await expectCatalogLit(page);
      await expect(
        page.getByRole('link', {
          name: /^Everything in Eggs, milk, and butter, \d[\d,]* products?$/,
        })
      ).toBeVisible();

      await page
        .getByRole('link', { name: /^Milk, \d[\d,]* products?$/ })
        .click();
    });

    await test.step('4. the tab, narrowed to Milk', async () => {
      await expect(page).toHaveURL(/\/en\/catalog\?category=milk$/);
      // The selector shows the leaf alone, and its name says the root too.
      await expect(
        page.getByRole('button', {
          name: 'Category: Eggs, milk, and butter, Milk. Change',
        })
      ).toHaveText(/Milk/);
      await expect(page.getByRole('searchbox')).toHaveAttribute(
        'placeholder',
        'Search in Milk'
      );
      await expect(products(page, 'Milk')).toBeVisible();
      await expect(products(page, 'Bread')).toHaveCount(0);
    });

    await test.step('5. the choice cleared: every product again', async () => {
      await page.getByRole('button', { name: 'Clear the category' }).click();

      await expect(page).toHaveURL(/\/en\/catalog$/);
      await expect(category(page)).toContainText('All categories');
      await expect(products(page, 'Bread')).toBeVisible();
      await expect(products(page, 'Milk')).toBeVisible();
    });
  });
});

/**
 * The Supermarket selector (velista plans 0124 and 0134), walked once: the picker
 * page, a chain chosen whole through its any row, every supermarket again through
 * the x, and one shop, which prices the tab there. The demo world has one chain,
 * Mercadona, with one shop, Colón, which sells Milk and Bread.
 */
test.describe('the Supermarket selector', () => {
  test('narrows the catalog to a chain, clears it, then prices it at one shop', async ({
    page,
  }) => {
    const button = supermarket(page);

    await test.step('1. the selector says All supermarkets', async () => {
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
      await button.click();
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
      await page.getByRole('radio', { name: /Any Mercadona shop/ }).click();

      await expect(page).toHaveURL(/\/en\/catalog\?chain=[0-9a-f-]{36}$/);
      await expect(button).toContainText('Mercadona');
      await expect(button).toHaveAccessibleName(
        'Supermarket: Mercadona, any shop. Change'
      );
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
      await button.click();
      await page
        .locator('lib-franchise-buttons button', { hasText: 'Mercadona' })
        .click();
      await page.locator('label.row', { hasText: 'Colón' }).first().click();

      await expect(page).toHaveURL(
        /\/en\/catalog\?chain=[0-9a-f-]{36}&shop=[0-9a-f-]{36}$/
      );
      // The selector names the chain. The line that heads the list names the shop.
      await expect(button).toContainText('Mercadona');
      await expect(page.locator('.head-note')).toContainText('Prices at');
      await expect(page.locator('.head-note')).toContainText('Colón');
      await expect(products(page, 'Milk')).toBeVisible();

      // The pick replaced the picker's entry, so back leaves the catalog's
      // narrowing rather than reopening the picker.
      await page.goBack();
      await expect(page).not.toHaveURL(/\/catalog\/supermarket/);
    });
  });
});

/**
 * Adding from the catalog and the product page (velista plan 0134), walked once:
 * the plus adds to the list the line above the tab bar names, the count opens what
 * the visit added, one product is taken back, and a product opens a page whose
 * back control returns to the list.
 */
test.describe('adding from the catalog', () => {
  test('adds a product to the named list, takes it back, and opens a product page', async ({
    page,
  }) => {
    const adding = page.locator('lib-adding-bar');

    await test.step('1. the line names a list before the first plus', async () => {
      await signIn(page, ALICE_EMAIL);
      await page
        .getByRole('navigation', { name: 'Main sections' })
        .getByRole('link', { name: 'Catalog' })
        .click();
      await expect(page).toHaveURL(/\/en\/catalog$/);
      await expect(adding).toContainText('Adding to');
      await expect(adding.locator('[data-adding="count"]')).toHaveCount(0);
    });

    await test.step('2. the plus adds one, and the line counts it', async () => {
      await products(page, 'Bread').locator('button.add').click();

      await expect(products(page, 'Bread').locator('button.add')).toHaveText(
        '1'
      );
      await expect(adding.locator('[data-adding="count"]')).toHaveText(
        '1 product added'
      );
    });

    await test.step('3. the name opens the sheet of lists, and Close keeps the choice', async () => {
      await adding.locator('[data-adding="list"]').click();
      await expect(page).toHaveURL(/\/en\/catalog\/sheet\/add-list$/);

      const lists = page.getByRole('dialog');
      await expect(
        lists.getByRole('heading', { name: 'Add to which list?' })
      ).toBeVisible();
      await expect(lists.getByRole('radio', { checked: true })).toHaveCount(1);
      await lists.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(page).toHaveURL(/\/en\/catalog$/);
    });

    await test.step('4. the count opens what was added, and the minus takes it back', async () => {
      await adding.locator('[data-adding="count"]').click();
      await expect(page).toHaveURL(/\/en\/catalog\/sheet\/added$/);

      const added = page.getByRole('dialog');
      await expect(added.getByText('Bread', { exact: true })).toBeVisible();
      await added.getByRole('button', { name: 'One fewer' }).click();

      // The last product taken back closes the sheet, and the plus is a plus again.
      await expect(page).toHaveURL(/\/en\/catalog$/);
      await expect(adding.locator('[data-adding="count"]')).toHaveCount(0);
      await expect(
        products(page, 'Bread').locator('button.add.has-count')
      ).toHaveCount(0);
    });

    await test.step('5. a product is a page, and back returns to the list', async () => {
      await products(page, 'Milk').locator('button.open').click();

      await expect(page).toHaveURL(/\/en\/catalog\/products\/[0-9a-f-]{36}$/);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Milk' })
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Price at your supermarkets' })
      ).toBeVisible();
      await expectCatalogLit(page);

      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(page).toHaveURL(/\/en\/catalog$/);
      await expect(products(page, 'Bread')).toBeVisible();
    });
  });
});

/** The Supermarket selector's body, which opens the supermarket picker. */
function supermarket(page: Page) {
  return page.locator('lib-catalog-selectors [data-selector="supermarket"]');
}

/** The Category selector's body, which opens the category picker. */
function category(page: Page) {
  return page.locator('lib-catalog-selectors [data-selector="category"]');
}

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
