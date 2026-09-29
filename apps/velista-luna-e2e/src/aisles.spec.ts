import { expect, test } from '@playwright/test';
import {
  LINE_EGGS_ID,
  SUPERMARKET_MERCADONA_ID,
} from '@portfolio/luna-shopper/test-fixtures';
import {
  adminLogin,
  ALICE_EMAIL,
  categoryIdBySlug,
  chainSections,
  createSection,
  deleteSection,
  ensureItem,
  login,
  resetAliceWorld,
  setLineProducts,
  type Session,
} from './support/api';
import {
  chip,
  expectBasketUrl,
  generateBasket,
  openFilterSheet,
  row,
  sheet,
  signIn,
} from './support/app';

/** What every section this spec writes is slugged with, so a rerun can find its own. */
const SLUG_PREFIX = 'e2e-aisles-';

/**
 * The aisles of the shop you are in (velista plan 0120, target 6).
 *
 * Mercadona gets two sections through the back office, walked bakery first and
 * fridge second, which is the reverse of the order the basket lists Milk and
 * Bread in. Eggs gets a product of its own that no section covers. Grouped by
 * category at Mercadona Colón, the page draws the two aisles in the shop's order,
 * then the band, then Eggs under its own category, then the line with no product.
 *
 * The sections are the chain's, so they would regroup every later spec that buys
 * at this shop. They are taken down after the run, and before it, by slug.
 */
test.describe('the aisles of the shop you are in', () => {
  let alice: Session;
  let admin: Session;
  let eggsCategory = '';

  async function clearSections(): Promise<void> {
    for (const held of await chainSections(admin, SUPERMARKET_MERCADONA_ID)) {
      if (held.slug.startsWith(SLUG_PREFIX)) {
        await deleteSection(admin, held.id);
      }
    }
  }

  test.beforeAll(async () => {
    alice = await login(ALICE_EMAIL);
    admin = await adminLogin();
    await resetAliceWorld(alice);
    await clearSections();

    await createSection(admin, SUPERMARKET_MERCADONA_ID, {
      slug: `${SLUG_PREFIX}bakery`,
      name: { en: 'Fresh bakery', es: 'Horno' },
      categoryIds: [await categoryIdBySlug(alice, 'bread')],
      position: 0,
    });
    await createSection(admin, SUPERMARKET_MERCADONA_ID, {
      slug: `${SLUG_PREFIX}fridge`,
      name: { en: 'Fridge', es: 'Refrigerados' },
      categoryIds: [await categoryIdBySlug(alice, 'milk')],
      position: 1,
    });

    // The third product: eggs, under a leaf neither section covers.
    const tree = await alice.get<{
      categories: { id: string; slug: string; name: { en: string } }[];
    }>('/v1/catalog/categories');
    const eggs = tree.categories.find((one) => one.slug === 'eggs');
    if (eggs === undefined) throw new Error('the catalog has no eggs leaf');
    eggsCategory = eggs.name.en;
    const eggsItem = await ensureItem(
      admin,
      { en: 'E2E aisle eggs', es: 'Huevos del pasillo E2E' },
      [eggs.id]
    );
    await setLineProducts(alice, LINE_EGGS_ID, [eggsItem]);
  });

  test.afterAll(async () => {
    if (admin) await clearSections();
    if (alice) await setLineProducts(alice, LINE_EGGS_ID, []);
    await admin?.dispose();
    await alice?.dispose();
  });

  test('draws the shop’s aisles in its order, then the band, then the rest by category', async ({
    page,
  }) => {
    await signIn(page, ALICE_EMAIL);
    const basketId = await generateBasket(
      page,
      ['Groceries', 'Hardware'],
      `Aisles ${Date.now()}`
    );
    await expect(row(page, 'Eggs')).toBeVisible();

    await test.step('group by category and buy at Mercadona Colón', async () => {
      const dialog = await openFilterSheet(page);
      await dialog
        .getByRole('radio', { name: 'Category', exact: true })
        .check();
      await dialog
        .getByRole('button', {
          name: /^(Choose|Change) the shop you are buying at$/,
        })
        .click();
      const picker = sheet(page, 'Buying at');
      await picker
        .locator('lib-franchise-buttons button', { hasText: 'Mercadona' })
        .click();
      await picker.locator('label.row', { hasText: 'Colón' }).first().click();
      await expect(page).toHaveURL(/\/sheet\/filter$/);

      // One radio with two names: it reads Aisle once the shop's sections are in.
      const filter = sheet(page, 'Filter and order');
      await expect(filter.getByRole('radio', { name: /^Aisle/ })).toBeChecked();
      await expect(filter).toContainText('this shop’s order');

      await filter.getByRole('button', { name: /^Show \d+ lines?$/ }).click();
      await expectBasketUrl(page, basketId);
    });

    await test.step('the headings are the shop’s, in its order, and the rest follows the band', async () => {
      await expect(chip(page, 'By aisle')).toBeVisible();

      const headings = page.locator(
        'section.group h2.group-title > span:first-child'
      );
      await expect(headings).toHaveText([
        'Fresh bakery',
        'Fridge',
        eggsCategory,
        'No category',
      ]);
      await expect(
        page
          .locator('section.group', { has: row(page, 'Bread') })
          .locator('h2.group-title > span')
          .first()
      ).toHaveText('Fresh bakery');
      await expect(
        page
          .locator('section.group', { has: row(page, 'Milk') })
          .locator('h2.group-title > span')
          .first()
      ).toHaveText('Fridge');

      // The band sits right before the first category, and is not a heading.
      const band = page.locator('.uncovered-band');
      await expect(band).toHaveCount(1);
      await expect(band).toContainText(
        'Categories we could not find in this shop'
      );
      await expect(
        page
          .locator('.uncovered-band + section.group h2.group-title > span')
          .first()
      ).toHaveText(eggsCategory);
      await expect(
        page
          .locator('section.group', { has: row(page, 'Eggs') })
          .locator('h2.group-title > span')
          .first()
      ).toHaveText(eggsCategory);
    });

    await test.step('the info control explains the band', async () => {
      const info = page.getByRole('button', { name: 'About these categories' });
      await info.click();
      const explanation = page.getByRole('dialog', {
        name: 'Categories we could not find in this shop',
      });
      await expect(explanation).toContainText(
        'These products are grouped by their category.'
      );
      await expect(explanation).toContainText(
        'but we have no information about where they are'
      );

      await page.keyboard.press('Escape');
      await expect(explanation).toHaveCount(0);
      await expect(info).toBeFocused();
    });
  });
});
