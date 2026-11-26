import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  demoWorld,
  ITEM_MILK_ID,
  LIST_GROCERIES_ID,
  PRICE_SCOPE_MERCADONA_VALENCIA_ID,
  ZONE_WEEKLY_ID,
} from '@portfolio/luna-shopper/test-fixtures';
import {
  addProductLine,
  adminLogin,
  ALICE_EMAIL,
  categoryIdBySlug,
  deleteLine,
  ensureItem,
  login,
  resetAliceWorld,
  setAdminPrice,
  type Session,
} from './support/api';
import { generateBasket, sheet, signIn } from './support/app';

/**
 * Velista 0191, section 8, and velista 0202: the row of three facts is the default
 * view, and a view picker on the zone list and on the basket page turns the
 * compact view, the two line row, on and off.
 *
 * A loose product at 750 g, priced at 1,99 a kilo, so the row has every fact the
 * default row draws: no size, the price per kilo as its unit price, and what the
 * 750 g cost, marked as an estimate. A pack at two, priced at 0,99, draws its
 * price and the exact total of two (the owner's decision of 2026-11-12). The
 * geometry is measured in the browser at the phone width the plan states: 99
 * high, a 74 square picture, and the 0188 row stepper at 155 by 48; the compact
 * row is 68 high. The stepper's own steps are 0188's specs, not this one.
 *
 * The choice is kept on the device and is one setting for every page (velista
 * 0202): chosen on the zone list, the basket's tools row and its menu name it;
 * chosen from the basket's menu, the zone list follows.
 */

/** One pixel, for subpixel layout. */
const TOLERANCE = 1;

const NAME = { en: 'Loose bananas rows e2e', es: 'Plátanos filas e2e' };

/**
 * A product with a short brand and a name far longer than a phone's line 1. The
 * line is not named, so its label is that name: the label must crop and the brand
 * must not (section 3.3).
 */
const BRANDED = {
  en: 'Semi skimmed milk for the whole week and the office coffee rows e2e',
  es: 'Leche semidesnatada para toda la semana y el café de la oficina filas e2e',
};
const SHORT_BRAND = 'Pascual';
const LONG_LABEL = BRANDED.en;

function lineRow(page: Page, label: string = NAME.en): Locator {
  return page.locator('lib-line-row', { hasText: label }).locator('.row');
}

/**
 * Whether an element's text is cut: wider than the box it is drawn in. Measured in
 * fractions of a pixel, not with `scrollWidth` against `clientWidth`: both round to
 * whole pixels, and a brand that flex shrank by three hundredths of a pixel is
 * drawn with its ellipsis while the two still agree.
 */
async function isCropped(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const text = document.createRange();
    text.selectNodeContents(element);
    const drawn = element.getBoundingClientRect().width;
    return text.getBoundingClientRect().width > drawn + 0.001;
  });
}

/** The view button inside `scope`: the zone list's header or the basket's tools row. */
function viewButton(scope: Locator): Locator {
  return scope.getByRole('button', { name: 'View', exact: true });
}

/** A row of the open view picker. */
function viewChoice(page: Page, view: 'Default' | 'Compact'): Locator {
  return page.getByRole('menuitemradio', { name: new RegExp(`^${view}`) });
}

/** The default view's row of three facts, 99 high. */
async function expectDefaultRow(row: Locator): Promise<void> {
  await expect(row).toHaveClass(/\bfacts-row\b/);
  await expect(row).not.toHaveClass(/\bcompact\b/);
  const rowBox = await size(row);
  expect(Math.abs(rowBox.height - 99)).toBeLessThanOrEqual(TOLERANCE);
}

/** The compact view's two line row, 68 high. */
async function expectCompactRow(row: Locator): Promise<void> {
  await expect(row).toHaveClass(/\bcompact\b/);
  await expect(row).not.toHaveClass(/\bfacts-row\b/);
  const rowBox = await size(row);
  expect(Math.abs(rowBox.height - 68)).toBeLessThanOrEqual(TOLERANCE);
}

async function openList(page: Page): Promise<void> {
  await page.goto(`/en/zones/${ZONE_WEEKLY_ID}/lists/${LIST_GROCERIES_ID}`);
  await expect(lineRow(page)).toBeVisible();
}

async function size(
  locator: Locator
): Promise<{ width: number; height: number }> {
  // Polled: in the full suite a late realtime event can redraw the row between
  // the check of its class and this read, so the box the poll saw is the one kept.
  let box = null as { width: number; height: number } | null;
  await expect
    .poll(async () => (box = await locator.boundingBox()))
    .not.toBeNull();
  if (box === null) throw new Error('the element has no box');
  return box;
}

/** Where the text of a fact line starts, which its box alone does not say. */
async function startOfText(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().left;
  });
}

test.describe('the default and the compact view (velista 0191, 0202)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  let alice: Session;
  let admin: Session;
  let lineId = '';
  let brandedLineId = '';

  test.beforeAll(async () => {
    alice = await login(ALICE_EMAIL);
    admin = await adminLogin();
    await resetAliceWorld(alice);

    const milk = demoWorld.catalog.items.find((one) => one.id === ITEM_MILK_ID);
    const slug = milk?.categories[0];
    if (slug === undefined) throw new Error('the demo world files no milk');
    const itemId = await ensureItem(
      admin,
      NAME,
      [await categoryIdBySlug(alice, slug)],
      'KILOGRAM'
    );
    await setAdminPrice(admin, itemId, PRICE_SCOPE_MERCADONA_VALENCIA_ID, 1.99);

    const line = await addProductLine(alice, LIST_GROCERIES_ID, {
      content: NAME.en,
      itemId,
      quantity: 750,
      unit: 'GRAM',
    });
    lineId = line.id;

    const brandedId = await ensureItem(
      admin,
      BRANDED,
      [await categoryIdBySlug(alice, slug)],
      'UNIT',
      SHORT_BRAND
    );
    await setAdminPrice(
      admin,
      brandedId,
      PRICE_SCOPE_MERCADONA_VALENCIA_ID,
      0.99
    );
    const branded = await addProductLine(alice, LIST_GROCERIES_ID, {
      content: LONG_LABEL,
      itemId: brandedId,
      quantity: 2,
      unit: 'UNIT',
    });
    brandedLineId = branded.id;
  });

  test.afterAll(async () => {
    if (lineId !== '') await deleteLine(alice, lineId);
    if (brandedLineId !== '') await deleteLine(alice, brandedLineId);
    await alice?.dispose();
    await admin?.dispose();
  });

  test('the default view draws the facts row, and the picker turns the compact view on everywhere', async ({
    page,
  }) => {
    await signIn(page, ALICE_EMAIL);

    await test.step('with nothing chosen, the row is the default view', async () => {
      await openList(page);

      const row = lineRow(page);
      await expectDefaultRow(row);

      const picture = await size(row.locator(':scope > .picture'));
      expect(Math.round(picture.width)).toBe(74);
      expect(Math.round(picture.height)).toBe(74);

      const stepper = await size(
        row.locator('lib-quantity-stepper [role="group"]')
      );
      expect(Math.round(stepper.width)).toBe(155);
      expect(Math.round(stepper.height)).toBe(48);

      const facts = row.locator('.facts > .fact');
      await expect(facts.nth(1)).toContainText('1.99');
      await expect(facts.nth(1)).toContainText('/ kg');
      await expect(facts.nth(2)).toHaveText(/^≈/);
      await expect(facts.nth(2)).toContainText('1.49');

      // The total starts at the column's edge, under the price per kilo, as the
      // mock draws it: the row of today's `.price` must not push it to the end.
      const measureStart = await startOfText(facts.nth(1));
      const priceStart = await startOfText(facts.nth(2));
      expect(Math.abs(priceStart - measureStart)).toBeLessThanOrEqual(
        TOLERANCE
      );
    });

    await test.step('a long label crops first, a short brand never', async () => {
      const row = lineRow(page, LONG_LABEL);
      await expect(row).toHaveClass(/\bfacts-row\b/);
      const label = row.locator('.facts-line-1 > .label');
      const brand = row.locator('.facts-line-1 > .brand');
      await expect(brand).toHaveText(SHORT_BRAND);

      expect(await isCropped(label)).toBe(true);
      expect(await isCropped(brand)).toBe(false);
    });

    await test.step('a pack at two draws its price, then the exact total of two', async () => {
      const facts = lineRow(page, LONG_LABEL).locator('.facts > .fact');
      await expect(facts.nth(1)).toHaveText('€0.99 / u');
      await expect(facts.nth(2)).toHaveText('€1.98');
    });

    await test.step('a press hides the cost behind the saving mark until the write lands', async () => {
      // The owner's decision of 2026-11-12. The mark stands for the quiet beat of
      // 800 ms and the write after it, which Playwright's polling sees with room.
      const row = lineRow(page);
      const price = row.locator('.facts > .fact').nth(2);
      await row.locator('lib-quantity-stepper button.plus').click();

      await expect(price.locator('lib-spinner-icon')).toBeVisible();
      await expect(row.locator('.facts > .fact').nth(1)).toContainText('/ kg');
      const during = await size(row);
      expect(Math.abs(during.height - 99)).toBeLessThanOrEqual(TOLERANCE);

      // 775 g at 1.99 a kilo.
      await expect(price).toHaveText(/^≈/);
      await expect(price).toContainText('1.54');
      await expect(price.locator('lib-spinner-icon')).toHaveCount(0);
    });

    await test.step('the view button of the zone list opens the picker on Default', async () => {
      const button = viewButton(page.locator('lib-page-header'));
      await button.click();
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect(viewChoice(page, 'Default')).toHaveAttribute(
        'aria-checked',
        'true'
      );
      await expect(viewChoice(page, 'Compact')).toHaveAttribute(
        'aria-checked',
        'false'
      );
      await expect(viewChoice(page, 'Compact')).toContainText(
        'More rows on the screen'
      );
    });

    await test.step('choosing Compact draws the two line row, and closes the picker', async () => {
      await viewChoice(page, 'Compact').click();
      await expect(page.getByRole('menuitemradio')).toHaveCount(0);
      await expect(viewButton(page.locator('lib-page-header'))).toBeFocused();

      await expectCompactRow(lineRow(page));
      await expectCompactRow(lineRow(page, LONG_LABEL));
    });

    await test.step('a reload keeps it compact', async () => {
      await page.reload();
      await expect(lineRow(page)).toBeVisible();
      await expectCompactRow(lineRow(page));
    });

    await test.step('the compact view draws a reel of 52 by 44 on every row, in one column (velista 0203)', async () => {
      const rows = [lineRow(page), lineRow(page, LONG_LABEL)];
      const boxes = [];
      for (const row of rows) {
        await expect(row.locator('lib-quantity-stepper')).toHaveCount(0);
        const pill = await row.locator('lib-quantity-reel .pill').boundingBox();
        if (pill === null) throw new Error('the reel has no box');
        expect(Math.round(pill.width)).toBe(52);
        expect(Math.round(pill.height)).toBe(44);
        boxes.push(pill);
      }
      expect(Math.abs(boxes[0].x - boxes[1].x)).toBeLessThanOrEqual(TOLERANCE);
      // A weight over its unit, a count alone.
      await expect(lineRow(page).locator('lib-quantity-reel .pill')).toHaveText(
        /775\s*g/
      );
      await expect(
        lineRow(page, LONG_LABEL).locator('lib-quantity-reel .symbol')
      ).toHaveCount(0);
    });

    await test.step('a sideways drag on the reel steps the line, written when the reel closes', async () => {
      const reel = lineRow(page).locator('lib-quantity-reel');
      const box = await reel.boundingBox();
      if (box === null) throw new Error('the reel has no box');
      const y = box.y + box.height / 2;
      const x = box.x + box.width / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      // Two steps of 40 px, leftwards is more: 775 g, 800 g, 825 g.
      for (const dx of [10, 40, 80]) {
        await page.mouse.move(x - dx, y);
      }
      await page.mouse.up();
      await expect(reel.locator('.overlay .current')).toHaveText(/825\s*g/);
      await expect(reel.locator('.overlay')).toHaveCount(0);
      await expect(reel).toHaveAttribute('data-value', '825');
      await page.reload();
      await expect(lineRow(page).locator('lib-quantity-reel')).toHaveAttribute(
        'data-value',
        '825'
      );
    });

    await test.step("the basket's tools row picker says Compact", async () => {
      // From Hardware and not Groceries: a line in a basket being bought is drawn
      // under that basket on the zone list, not as a row, and the last step
      // measures this spec's rows again.
      await generateBasket(page, ['Hardware'], `View ${Date.now()}`);
      const button = viewButton(page.locator('lib-list-tools'));
      await button.click();
      await expect(viewChoice(page, 'Compact')).toHaveAttribute(
        'aria-checked',
        'true'
      );
      await viewChoice(page, 'Compact').press('Escape');
      await expect(page.getByRole('menuitemradio')).toHaveCount(0);
      await expect(button).toBeFocused();
    });

    await test.step("the basket's menu names Compact, chooses Default and closes", async () => {
      const more = page.getByRole('button', { name: 'More', exact: true });
      await more.click();
      await expect(page).toHaveURL(/\/sheet\/more(\?.*)?$/);
      const viewRow = sheet(page, 'More').getByRole('button', {
        name: /^View/,
      });
      await expect(viewRow).toContainText('Compact');

      await viewRow.click();
      await viewChoice(page, 'Default').click();
      await expect(page.getByRole('menuitemradio')).toHaveCount(0);
      // The menu closes after a choice, and focus is back on its button (velista
      // 0202, amended on 2026-11-23).
      await expect(page).not.toHaveURL(/\/sheet\/more(\?.*)?$/);
      await expect(sheet(page, 'More')).toHaveCount(0);
      await expect(more).toBeFocused();
    });

    await test.step('the zone list follows the choice made on the basket', async () => {
      await openList(page);
      await expectDefaultRow(lineRow(page));
      await expectDefaultRow(lineRow(page, LONG_LABEL));
    });
  });
});
