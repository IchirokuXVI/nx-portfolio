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
import { signIn } from './support/app';

/**
 * Velista 0191, section 8: the compact row, chosen on the account page.
 *
 * A loose product at 750 g, priced at 1,99 a kilo, so the row has every fact a
 * compact row draws: no size, the price per kilo, and what the 750 g cost, marked
 * as an estimate. The geometry is measured in the browser at the phone width the
 * plan states: 99 high, a 74 square picture, and the 0188 row stepper at 155 by
 * 48. The stepper's own steps are 0188's specs, not this one.
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

function compactSwitch(page: Page): Locator {
  return page.getByRole('switch', { name: 'Compact rows' });
}

async function openList(page: Page): Promise<void> {
  await page.goto(`/en/zones/${ZONE_WEEKLY_ID}/lists/${LIST_GROCERIES_ID}`);
  await expect(lineRow(page)).toBeVisible();
}

async function size(
  locator: Locator
): Promise<{ width: number; height: number }> {
  // Polled: in the full suite a late realtime event can redraw the row between
  // the check of its class and this read.
  await expect.poll(() => locator.boundingBox()).not.toBeNull();
  const box = await locator.boundingBox();
  if (box === null) throw new Error('the element has no box');
  return { width: box.width, height: box.height };
}

/** Where the text of a fact line starts, which its box alone does not say. */
async function startOfText(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().left;
  });
}

test.describe('compact rows (velista 0191)', () => {
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
    const branded = await addProductLine(alice, LIST_GROCERIES_ID, {
      content: LONG_LABEL,
      itemId: brandedId,
      quantity: 1,
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

  test('the account switch draws every row compact, and survives a reload', async ({
    page,
  }) => {
    await signIn(page, ALICE_EMAIL);

    await test.step('the switch is on the account page, off', async () => {
      await page.goto('/en/account');
      await expect(compactSwitch(page)).toBeVisible();
      await expect(compactSwitch(page)).not.toBeChecked();
    });

    await test.step('turned on, the row is compact', async () => {
      await compactSwitch(page).click();
      await expect(compactSwitch(page)).toBeChecked();
      await openList(page);

      const row = lineRow(page);
      await expect(row).toHaveClass(/\bcompact\b/);
      const rowBox = await size(row);
      expect(Math.abs(rowBox.height - 99)).toBeLessThanOrEqual(TOLERANCE);

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

      // The price starts at the column's edge, under the price per kilo, as the
      // mock draws it: the row of today's `.price` must not push it to the end.
      const measureStart = await startOfText(facts.nth(1));
      const priceStart = await startOfText(facts.nth(2));
      expect(Math.abs(priceStart - measureStart)).toBeLessThanOrEqual(
        TOLERANCE
      );
    });

    await test.step('a long label crops first, a short brand never', async () => {
      const row = lineRow(page, LONG_LABEL);
      await expect(row).toHaveClass(/\bcompact\b/);
      const label = row.locator('.compact-line-1 > .label');
      const brand = row.locator('.compact-line-1 > .brand');
      await expect(brand).toHaveText(SHORT_BRAND);

      expect(await isCropped(label)).toBe(true);
      expect(await isCropped(brand)).toBe(false);
    });

    await test.step('a reload keeps it compact', async () => {
      await page.reload();
      await expect(lineRow(page)).toHaveClass(/\bcompact\b/);
    });

    await test.step('turned off, the row of today is back', async () => {
      await page.goto('/en/account');
      await compactSwitch(page).click();
      await expect(compactSwitch(page)).not.toBeChecked();
      await openList(page);

      const row = lineRow(page);
      await expect(row).not.toHaveClass(/\bcompact\b/);
      const rowBox = await size(row);
      expect(Math.abs(rowBox.height - 68)).toBeLessThanOrEqual(TOLERANCE);
    });
  });
});
