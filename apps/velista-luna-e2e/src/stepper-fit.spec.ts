import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  LIST_GROCERIES_ID,
  ZONE_WEEKLY_ID,
} from '@portfolio/luna-shopper/test-fixtures';
import { ALICE_EMAIL } from './support/api';
import { generateBasket, openSettleSheet, signIn } from './support/app';

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
 * adds the shopping list sheet's `sheet-narrow` variant, 168 by 48, with the same
 * exact forms, on a settle sheet of a generated basket.
 *
 * A sheet's "999,999" always carries a symbol: 999 999 g reads "999,999 kg" and a
 * count of 999 999 reads "999,999 K", so it is drawn at the 17 px figure and never
 * at the 18 px a bare count takes (0188, section 3.2). The sheet cases therefore
 * measure a field in that state, not the bare count the seed's lines start in.
 */

/** Half a pixel, for subpixel layout. */
const EPSILON = 0.5;

const SYMBOL = 'uds.';

interface Fit {
  readonly width: number;
  readonly height: number;
  readonly problems: readonly string[];
  /** The figure's font size, its width and its cell's width, for the report. */
  readonly measured: string;
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
      const measured = `"${figure}" ${symbol}: figure ${getComputedStyle(number).fontSize}, ${number.getBoundingClientRect().width.toFixed(1)}px in a ${box.width.toFixed(1)}px cell`;
      return { width: host2.width, height: host2.height, problems, measured };
    },
    { figure, symbol, epsilon: EPSILON }
  );
}

/**
 * Puts a sheet's stepper in the state a real "999,999" is drawn in: a field with a
 * symbol, at the 17 px figure. Text with a separator is read in the top name, so
 * "1,5" draws a symbol whatever the line's unit, and nothing is saved until Enter
 * or a blur. {@link dropDraft} takes it back.
 */
async function withSymbol(stepper: Locator): Promise<void> {
  await stepper.getByRole('spinbutton').fill('1,5');
  await expect(stepper.locator('.field-cell')).not.toHaveClass(/is-bare/);
  await expect(stepper.locator('.field-cell .symbol')).not.toBeEmpty();
}

/** Escape drops the typed text, so the measuring saves nothing. */
async function dropDraft(stepper: Locator): Promise<void> {
  await stepper.getByRole('spinbutton').press('Escape');
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

    await withSymbol(stepper);
    for (const figure of ['999,999', '125,25', '0']) {
      await test.step(`sheet ${figure} ${SYMBOL}`, async () => {
        const fit = await writeAndMeasure(stepper, figure, SYMBOL);
        console.log(`sheet: ${fit.measured}`);
        expect.soft(fit.problems).toEqual([]);
        expect.soft(Math.round(fit.width)).toBe(191);
        expect.soft(Math.round(fit.height)).toBe(48);
      });
    }
    await dropDraft(stepper);
  });

  test('the settle sheet stepper holds "999,999", "125,25" and a four letter symbol', async ({
    page,
  }) => {
    await signIn(page, ALICE_EMAIL);
    await generateBasket(page, ['Groceries'], `Fit ${Date.now()}`);
    const dialog = await openSettleSheet(page, 'Milk');
    const stepper = dialog
      .locator('lib-row-entries lib-quantity-stepper.variant-sheet-narrow')
      .first();
    await expect(stepper).toBeVisible();

    await withSymbol(stepper);
    for (const figure of ['999,999', '125,25', '0']) {
      await test.step(`settle sheet ${figure} ${SYMBOL}`, async () => {
        const fit = await writeAndMeasure(stepper, figure, SYMBOL);
        console.log(`settle sheet: ${fit.measured}`);
        expect.soft(fit.problems).toEqual([]);
        expect.soft(Math.round(fit.width)).toBe(168);
        expect.soft(Math.round(fit.height)).toBe(48);
      });
    }
    await dropDraft(stepper);
  });
});
