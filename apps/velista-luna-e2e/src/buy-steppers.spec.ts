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

/**
 * The same row sheet in the compact view (velista `0204`): each list's buy is the
 * reel of velista `0203`, with the list's ask as its target. A drag from 0 past the
 * ask shows the ask green and the number above it amber on the tape before the
 * thumb lets go, and the reel's one step is one settle of the total.
 */
test.describe('the buy reels of a row sheet in the compact view (velista 0204)', () => {
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
    if (hardwareLineId !== '') await deleteLine(alice, hardwareLineId);
    await alice?.dispose();
  });

  test('a drag from 0 past the ask is green at it, amber above it, and one settle', async ({
    page,
  }) => {
    await signIn(page, ALICE_EMAIL);
    await generateBasket(
      page,
      ['Groceries', 'Hardware'],
      `Buy reels ${Date.now()}`
    );

    // The view picker of the basket's tools row (velista 0202).
    await page
      .locator('lib-list-tools')
      .getByRole('button', { name: 'View', exact: true })
      .click();
    await page.getByRole('menuitemradio', { name: /^Compact/ }).click();
    await expect(page.getByRole('menuitemradio')).toHaveCount(0);

    const dialog = await openSettleSheet(page, 'Bread');
    const field = boughtAmount(dialog, 'Hardware');
    await expect(field).toHaveAttribute('aria-valuenow', '0');
    await expect(
      dialog.locator('lib-row-entries lib-quantity-stepper')
    ).toHaveCount(0);

    const settles: { lineIds: string[]; quantity: number }[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        /\/rows\/[^/]+\/settle$/.test(new URL(request.url()).pathname)
      ) {
        settles.push(
          request.postDataJSON() as { lineIds: string[]; quantity: number }
        );
      }
    });

    // The sheet rises into place: measure the reel once nothing moves.
    await page.waitForFunction(() => document.getAnimations().length === 0);
    const box = await field.boundingBox();
    if (box === null) throw new Error('the reel has no box');
    const y = box.y + box.height / 2;
    const x = box.x + box.width / 2;
    // 40 px a step, leftwards is more.
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (const dx of [10, 40, 80]) {
      await page.mouse.move(x - dx, y);
    }

    await test.step('on the ask the selected number is green', async () => {
      await expect(field.locator('.overlay .current')).toHaveText('2');
      await expect(field.locator('.overlay .current')).toHaveClass(
        /\breached\b/
      );
      await expect(field.locator('.overlay .neighbour').last()).toHaveClass(
        /\bover\b/
      );
    });

    await page.mouse.move(x - 120, y);

    await test.step('one above it the selected number is amber, and the ask beside it green', async () => {
      await expect(field.locator('.overlay .current')).toHaveText('3');
      await expect(field.locator('.overlay .current')).toHaveClass(/\bover\b/);
      await expect(field.locator('.overlay .neighbour').first()).toHaveClass(
        /\breached\b/
      );
    });

    await test.step('let go: one settle of 3 for that line, and the pill amber', async () => {
      const written = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          /\/rows\/[^/]+\/settle$/.test(new URL(response.url()).pathname),
        { timeout: 10_000 }
      );
      await page.mouse.up();
      expect((await written).ok()).toBe(true);
      await expect(field).toHaveAttribute('aria-valuenow', '3');
      await expect(field.locator('.pill')).toHaveClass(/\bover\b/);
      // Nothing more is sent after the reel's beat and the quiet beat of a press.
      await page.waitForTimeout(2_500);
      expect(settles).toHaveLength(1);
      expect(settles[0].lineIds).toEqual([hardwareLineId]);
      expect(settles[0].quantity).toBe(3);

      const standing = (await lineSettlements(alice, hardwareLineId))
        .filter((s) => s.outcome === 'BOUGHT' && s.revertedAt === null)
        .reduce((sum, s) => sum + s.quantity, 0);
      expect(standing).toBe(3);
    });
  });
});
