import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  ITEM_BREAD_ID,
  LINE_BREAD_ID,
  LIST_HARDWARE_ID,
} from '@portfolio/luna-shopper/test-fixtures';
import {
  addProductLine,
  ALICE_EMAIL,
  deleteLine,
  lineSettlements,
  login,
  resetAliceWorld,
  type Session,
} from './support/api';
import {
  askOf,
  boughtAmount,
  generateBasket,
  openSettleSheet,
  signIn,
} from './support/app';

/**
 * Each list of a basket row steps what was bought (velista `0201`), against the
 * real backend.
 *
 * The Bread row asks on two lists: Groceries, whose seeded Bread line is the row's
 * key, and Hardware, whose Bread line this spec adds asking 2. Hardware's stepper
 * is the one stepped, so every write names a line that is not the row's key: the
 * one line target `{ rowKey: lineId, lineIds: [lineId] }` that the specs of the
 * store only read off core. Up to the ask is green with the label still the ask,
 * one above is amber with the label unchanged, and one back down is green again.
 * A reload reads the same numbers from the server.
 */

/** The stepper around one list's bought field, which carries the colour classes. */
function stepperOf(dialog: Locator, list: string): Locator {
  // The inner locator is matched inside each stepper, so it starts at the page.
  return dialog.locator('lib-row-entries lib-quantity-stepper', {
    has: dialog
      .page()
      .getByRole('spinbutton', { name: new RegExp(`^${list}, bought$`) }),
  });
}

/**
 * Step a buy stepper by keyboard and wait for its one write: a settle up, a
 * revert down. Answers the write's request, for the line it names.
 */
async function stepBuy(
  page: Page,
  field: Locator,
  delta: number
): Promise<{ pathKey: string; lineIds: string[] }> {
  const kind = delta > 0 ? 'settle' : 'revert';
  const written = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new RegExp(`/rows/[^/]+/${kind}$`).test(new URL(response.url()).pathname),
    { timeout: 10_000 }
  );
  await field.focus();
  for (let i = 0; i < Math.abs(delta); i++) {
    await field.press(delta > 0 ? 'ArrowUp' : 'ArrowDown');
  }
  await field.blur();
  const response = await written;
  expect(response.ok()).toBe(true);
  const pathKey =
    new URL(response.url()).pathname.split('/rows/')[1]?.split('/')[0] ?? '';
  const body = response.request().postDataJSON() as { lineIds: string[] };
  return { pathKey, lineIds: body.lineIds };
}

test.describe('the buy steppers of a row sheet (velista 0201)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  let alice: Session;
  let hardwareLineId = '';

  test.beforeAll(async () => {
    alice = await login(ALICE_EMAIL);
    await resetAliceWorld(alice);
    const line = await addProductLine(alice, LIST_HARDWARE_ID, {
      content: 'Bread',
      itemId: ITEM_BREAD_ID,
      quantity: 2,
      unit: 'UNIT',
    });
    hardwareLineId = line.id;
  });

  test.afterAll(async () => {
    // The trip ends with the next reset; the added line goes now.
    if (hardwareLineId !== '') await deleteLine(alice, hardwareLineId);
    await alice?.dispose();
  });

  test('steps one list to its ask, above it and back, on a line that is not the row key', async ({
    page,
  }) => {
    await signIn(page, ALICE_EMAIL);
    const basketId = await generateBasket(
      page,
      ['Groceries', 'Hardware'],
      `Buy steppers ${Date.now()}`
    );

    let dialog = await openSettleSheet(page, 'Bread');
    const field = () => boughtAmount(dialog, 'Hardware');
    await expect(askOf(dialog, 'Hardware')).toHaveText('· 2');
    await expect(askOf(dialog, 'Groceries')).toHaveText('· 1');
    await expect(field()).toHaveAttribute('aria-valuenow', '0');

    await test.step('up to the ask: green, and the label keeps the ask', async () => {
      const write = await stepBuy(page, field(), 2);
      expect(write.pathKey).toBe(hardwareLineId);
      expect(write.pathKey).not.toBe(LINE_BREAD_ID);
      expect(write.lineIds).toEqual([hardwareLineId]);
      await expect(field()).toHaveAttribute('aria-valuenow', '2');
      await expect(stepperOf(dialog, 'Hardware')).toHaveClass(/\bis-reached\b/);
      await expect(askOf(dialog, 'Hardware')).toHaveText('· 2');
    });

    await test.step('one above: amber, the label still the ask', async () => {
      const write = await stepBuy(page, field(), 1);
      expect(write.lineIds).toEqual([hardwareLineId]);
      await expect(field()).toHaveAttribute('aria-valuenow', '3');
      await expect(stepperOf(dialog, 'Hardware')).toHaveClass(/\bis-over\b/);
      await expect(askOf(dialog, 'Hardware')).toHaveText('· 2');
    });

    await test.step('back down one: a revert of that line, green again', async () => {
      const write = await stepBuy(page, field(), -1);
      expect(write.pathKey).toBe(hardwareLineId);
      expect(write.lineIds).toEqual([hardwareLineId]);
      await expect(field()).toHaveAttribute('aria-valuenow', '2');
      await expect(stepperOf(dialog, 'Hardware')).toHaveClass(/\bis-reached\b/);
    });

    await test.step('a reload reads the same numbers from the server', async () => {
      await page.reload();
      await expect(page).toHaveURL(new RegExp(basketId));
      dialog = page.getByRole('dialog').filter({
        has: page.getByRole('heading', { name: 'Bread' }),
      });
      await expect(field()).toHaveAttribute('aria-valuenow', '2');
      await expect(boughtAmount(dialog, 'Groceries')).toHaveAttribute(
        'aria-valuenow',
        '0'
      );
      await expect(askOf(dialog, 'Hardware')).toHaveText('· 2');
      await expect(stepperOf(dialog, 'Hardware')).toHaveClass(/\bis-reached\b/);

      // What core holds of the Hardware line: 2 and 1 bought, the 1 taken back.
      const standing = (await lineSettlements(alice, hardwareLineId))
        .filter((s) => s.outcome === 'BOUGHT' && s.revertedAt === null)
        .reduce((sum, s) => sum + s.quantity, 0);
      expect(standing).toBe(2);
    });
  });
});
