import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  LIST_GROCERIES_ID,
  ZONE_WEEKLY_ID,
} from '@portfolio/luna-shopper/test-fixtures';
import {
  ALICE_EMAIL,
  deleteLine,
  login,
  readLine,
  resetAliceWorld,
  type LineView,
  type Session,
} from './support/api';
import { signIn } from './support/app';

/**
 * The owner's rulings of 2026-11-17 on a real slot (velista `0188`, decision K and
 * S6; backend `0262` as amended).
 *
 * - A free text line the server keeps in grams draws its amount in grams on the
 *   list and steps by 25 g. velista itself still makes a free text line in pieces,
 *   so the line is made over the API.
 * - A typed amount waits for the end of the edit: 2, 5, 0, 0, 0 typed key by key
 *   into the line sheet's emptied field shows "25000" under g while it is typed and
 *   rests as "25 kg" once the edit ends, and the line holds 25 000 g.
 */

const NAME = 'Free text grams e2e';

/** The list row of {@link NAME}. */
const row = (page: Page) => page.locator('lib-line-row', { hasText: NAME });

const rowStepper = (page: Page) =>
  row(page).locator('lib-quantity-stepper.variant-row');

async function openList(page: Page): Promise<void> {
  await signIn(page, ALICE_EMAIL);
  await page.goto(`/en/zones/${ZONE_WEEKLY_ID}/lists/${LIST_GROCERIES_ID}`);
  await expect(rowStepper(page)).toBeVisible();
}

/** The number and the symbol a figure draws, as one string: "500 g". */
async function drawn(stepper: Locator): Promise<string> {
  const number = (await stepper.locator('.number').first().textContent()) ?? '';
  const symbol = (await stepper.locator('.symbol').first().textContent()) ?? '';
  return `${number.trim()} ${symbol.trim()}`;
}

test.describe('a typed amount and a free text line in grams (2026-11-17)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  let alice: Session;
  let lineId = '';

  test.beforeAll(async () => {
    alice = await login(ALICE_EMAIL);
    await resetAliceWorld(alice);
    const answer = await alice.post<{ line: LineView }>(
      `/v1/lists/${LIST_GROCERIES_ID}/lines`,
      { content: NAME, named: true, quantity: 500, unit: 'GRAM' }
    );
    lineId = answer.line.id;
    expect(answer.line).toMatchObject({ itemIds: [], unit: 'GRAM' });
  });

  test.afterAll(async () => {
    if (lineId !== '') await deleteLine(alice, lineId);
    await alice?.dispose();
  });

  test('a free text line made in grams draws and steps in grams on the list', async ({
    page,
  }) => {
    await openList(page);
    const stepper = rowStepper(page);

    await expect(stepper).toHaveAttribute('data-value', '500');
    expect(await drawn(stepper)).toBe('500 g');
    await stepper.getByRole('button', { name: `Add 25 g to ${NAME}` }).click();
    await expect(stepper).toHaveAttribute('data-value', '525');
    await expect
      .poll(
        async () => (await readLine(alice, LIST_GROCERIES_ID, lineId)).quantity
      )
      .toBe(525);
  });

  test('25000 typed key by key under g waits for the end of the edit and rests as 25 kg', async ({
    page,
  }) => {
    await openList(page);
    await row(page).locator('.row').click();
    const dialog = page.getByRole('dialog');
    const stepper = dialog
      .locator('lib-quantity-stepper.variant-sheet')
      .first();
    const field = stepper.getByRole('spinbutton', {
      name: `Amount of ${NAME}`,
    });
    const symbol = stepper.locator('.field-cell .symbol');
    await expect(field).toBeVisible();

    await field.click();
    await field.press('Backspace');
    await expect(field).toHaveValue('');
    await expect(symbol).toHaveText('g');
    for (const [key, shown] of [
      ['2', '2'],
      ['5', '25'],
      ['0', '250'],
      ['0', '2500'],
      ['0', '25000'],
    ]) {
      await field.press(key);
      await expect(field).toHaveValue(shown);
      await expect(symbol).toHaveText('g');
    }

    await field.press('Enter');
    await expect(field).toHaveValue('25');
    await expect(symbol).toHaveText('kg');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect
      .poll(
        async () => (await readLine(alice, LIST_GROCERIES_ID, lineId)).quantity
      )
      .toBe(25_000);
    await expect(rowStepper(page)).toHaveAttribute('data-value', '25000');
    expect(await drawn(rowStepper(page))).toBe('25 kg');
  });
});
