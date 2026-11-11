import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  LIST_GROCERIES_ID,
  ZONE_WEEKLY_ID,
} from '@portfolio/luna-shopper/test-fixtures';
import { ALICE_EMAIL } from './support/api';
import { signIn } from './support/app';

/**
 * Velista 0188, S3 and S10: the longest amount and a four letter symbol always fit.
 *
 * The owner asked for this test by name. The stepper's cells were measured for the
 * longest figures in the mock, and a unit symbol may have up to four letters
 * ("uds."), so this writes the worst case into a real stepper on a real page and
 * measures it in the browser: no figure and no symbol may leave its cell, and the
 * control keeps its size (155 by 48 in a row, 191 by 48 in the list's line sheet).
 *
 * The row is given "999,99" and "125,25", the longest short forms (S4: a row never
 * reads more than three whole digits and two decimals, so it can never draw
 * "999,999"), with the one step smaller size a six character figure takes. The
 * sheet is given "999,999" and "125,25", the longest exact forms (S5). Velista 0190
 * adds the shopping list sheet's `sheet-narrow` variant here.
 */

/** Half a pixel, for subpixel layout. */
const EPSILON = 0.5;

const SYMBOL = 'uds.';

interface Fit {
  readonly width: number;
  readonly height: number;
  readonly problems: readonly string[];
}

/**
 * Writes `figure` and `symbol` into the stepper and measures it. The text is
 * written the way the component draws it: the row's number span (and the long size
 * a six character short figure takes), or the sheet field's value and its sizing
 * copy.
 */
function writeAndMeasure(
  stepper: Locator,
  figure: string,
  symbol: string
): Promise<Fit> {
  return stepper.evaluate(
    (host, { figure, symbol, epsilon }) => {
      const cell = host.querySelector('.cell') as HTMLElement;
      const input = cell.querySelector('input');
      if (input !== null) {
        input.value = figure;
        (cell.querySelector('.field') as HTMLElement).dataset['text'] = figure;
      } else {
        const amount = cell.querySelector('lib-amount-figure') as HTMLElement;
        (amount.querySelector('.number') as HTMLElement).textContent = figure;
        amount.classList.toggle('is-long', figure.length >= 6);
        amount.classList.remove('is-bare');
      }
      let symbolEl = cell.querySelector('.symbol') as HTMLElement | null;
      if (symbolEl === null) {
        symbolEl = document.createElement('span');
        symbolEl.className = 'symbol';
        // The scoped style attribute of a drawn symbol, so the copy takes its rules.
        const drawnFrom = input ?? cell.querySelector('.number');
        for (const attr of Array.from(drawnFrom?.attributes ?? [])) {
          if (attr.name.startsWith('_ngcontent')) {
            symbolEl.setAttribute(attr.name, '');
          }
        }
        (
          input?.closest('.cell') ?? cell.querySelector('lib-amount-figure')
        )?.appendChild(symbolEl);
      }
      symbolEl.textContent = symbol;

      const box = cell.getBoundingClientRect();
      const problems: string[] = [];
      const inside = (label: string, element: Element) => {
        const rect = element.getBoundingClientRect();
        if (
          rect.left < box.left - epsilon ||
          rect.right > box.right + epsilon
        ) {
          problems.push(
            `${label} "${element.textContent ?? (element as HTMLInputElement).value}" is ${rect.width.toFixed(1)}px in a ${box.width.toFixed(1)}px cell`
          );
        }
      };
      const number =
        input !== null
          ? (cell.querySelector('.field') as HTMLElement)
          : (cell.querySelector('.number') as HTMLElement);
      inside('figure', number);
      inside('symbol', symbolEl);
      if (input !== null && input.scrollWidth > input.clientWidth + epsilon) {
        problems.push(
          `the field scrolls: ${input.scrollWidth}px of text in ${input.clientWidth}px`
        );
      }
      const host2 = host.getBoundingClientRect();
      return { width: host2.width, height: host2.height, problems };
    },
    { figure, symbol, epsilon: EPSILON }
  );
}

async function openList(page: Page): Promise<void> {
  await signIn(page, ALICE_EMAIL);
  await page.goto(`/en/zones/${ZONE_WEEKLY_ID}/lists/${LIST_GROCERIES_ID}`);
  await expect(
    page.locator('lib-line-row lib-quantity-stepper.variant-row').first()
  ).toBeVisible();
}

test.describe('the stepper fits its longest amount (velista 0188)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a row stepper holds "999,99", "125,25" and a four letter symbol', async ({
    page,
  }) => {
    await openList(page);
    const stepper = page
      .locator('lib-line-row lib-quantity-stepper.variant-row')
      .first();

    for (const figure of ['999,99', '125,25', '0']) {
      await test.step(`row ${figure} ${SYMBOL}`, async () => {
        const fit = await writeAndMeasure(stepper, figure, SYMBOL);
        expect.soft(fit.problems).toEqual([]);
        expect.soft(Math.round(fit.width)).toBe(155);
        expect.soft(Math.round(fit.height)).toBe(48);
      });
    }
  });

  test('the line sheet stepper holds "999,999", "125,25" and a four letter symbol', async ({
    page,
  }) => {
    await openList(page);
    await page.locator('lib-line-row .row').first().click();
    const stepper = page
      .getByRole('dialog')
      .locator('lib-quantity-stepper.variant-sheet')
      .first();
    await expect(stepper).toBeVisible();

    for (const figure of ['999,999', '125,25', '0']) {
      await test.step(`sheet ${figure} ${SYMBOL}`, async () => {
        const fit = await writeAndMeasure(stepper, figure, SYMBOL);
        expect.soft(fit.problems).toEqual([]);
        expect.soft(Math.round(fit.width)).toBe(191);
        expect.soft(Math.round(fit.height)).toBe(48);
      });
    }
  });
});
