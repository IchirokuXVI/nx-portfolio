import { expect, test } from '@playwright/test';
import {
  ITEM_BREAD_ID,
  ITEM_MILK_ID,
  LINE_MILK_ID,
  LIST_GROCERIES_ID,
} from '@portfolio/luna-shopper/test-fixtures';
import {
  ALICE_EMAIL,
  lineSettlements,
  login,
  readLine,
  resetAliceWorld,
  type Session,
} from './support/api';
import {
  addInTheAisle,
  chip,
  chooseProduct,
  closeSettleSheet,
  expectBasketUrl,
  filterTool,
  generateBasket,
  gotReel,
  nudge,
  openFilterSheet,
  openSettleSheet,
  reel,
  row,
  rows,
  sheet,
  signIn,
} from './support/app';

/**
 * One trip, by the owner (velista plan 0080, section 5.1).
 *
 * Every step below is one of the basket plans' e2e asks, in the order a person
 * would meet them on a single shop: generate (0045), search (0074), filter and
 * group (0075, 0077), prices from one shop (0078), the row's status control
 * (0052), the settle sheet (0044), the reel that settles and then reverts
 * (0073 test 13), two products bought as two settles (0092, which replaced the
 * split of 0069 test 9), the composer in the aisle (0053, 0110), finishing
 * (0057), and what the next basket remembers (0076).
 *
 * The world is set up through the API as absolute values, so the trip starts
 * from the same place on a fresh database and on the run after it. Everything
 * from the first tap on is the browser.
 */
test.describe('one trip, by the owner', () => {
  let alice: Session;

  test.beforeAll(async () => {
    alice = await login(ALICE_EMAIL);
    await resetAliceWorld(alice);
  });

  test.afterAll(async () => {
    await alice?.dispose();
  });

  test('shops the basket from generate to finish', async ({ page }) => {
    const tripName = `Owner trip ${Date.now()}`;
    let basketId = '';

    // The Milk zone line keeps every settlement ever made on it, including the
    // ones the other specs in this suite make on the same seeded line, so what
    // this trip asserts about its history is what this trip added to it.
    const earlier = new Set(
      (await lineSettlements(alice, LINE_MILK_ID)).map((s) => s.id)
    );
    const liveSettlementsOfThisTrip = async () =>
      (await lineSettlements(alice, LINE_MILK_ID)).filter(
        (s) => !earlier.has(s.id) && !s.revertedAt
      );

    await test.step('1. generate a basket from Groceries and Hardware', async () => {
      await signIn(page, ALICE_EMAIL);
      basketId = await generateBasket(
        page,
        ['Groceries', 'Hardware'],
        tripName
      );

      // Milk (2), Bread (approved, 1), Eggs (12) and Nails (100). Apples is
      // rejected and stays behind.
      await expect(rows(page)).toHaveCount(4);
      for (const name of ['Milk', 'Bread', 'Eggs', 'Nails']) {
        await expect(row(page, name)).toBeVisible();
      }
      await expect(page.locator('.tools-bar .progress')).toHaveText(
        /0 of 4 got/
      );
    });

    await test.step('2. search for "egg": one line, and the count is announced', async () => {
      await page.getByRole('button', { name: 'Search this list' }).click();
      await page.locator('#basket-search').fill('egg');

      await expect(rows(page)).toHaveCount(1);
      await expect(row(page, 'Eggs')).toBeVisible();
      await expect(page.locator('.search-count')).toHaveText(/1 of 4 lines/);

      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(rows(page)).toHaveCount(4);
    });

    await test.step('3. order A to Z, group by category, only Hardware, then Reset', async () => {
      let dialog = await openFilterSheet(page);
      await dialog.getByRole('radio', { name: 'A to Z' }).check();
      await dialog
        .getByRole('radio', { name: 'Category', exact: true })
        .check();
      await dialog.getByRole('checkbox', { name: /^Groceries/ }).uncheck();
      await dialog.getByRole('button', { name: /^Show 1 line$/ }).click();
      await expectBasketUrl(page, basketId);

      // The chips say what the sheet did, and the rows agree with them.
      await expect(chip(page, 'A to Z')).toBeVisible();
      await expect(chip(page, 'By category')).toBeVisible();
      await expect(chip(page, 'Only Hardware')).toBeVisible();
      await expect(rows(page)).toHaveCount(1);
      await expect(row(page, 'Nails')).toBeVisible();
      await expect(filterTool(page)).toHaveAccessibleName(
        /Filter and order, 3 on/
      );

      dialog = await openFilterSheet(page);
      await dialog.getByRole('button', { name: 'Reset' }).click();
      await dialog.getByRole('button', { name: /^Show 4 lines$/ }).click();
      await expectBasketUrl(page, basketId);

      await expect(page.locator('lib-chip-row button.chip')).toHaveCount(0);
      await expect(rows(page)).toHaveCount(4);

      // What the rest of the trip runs with, and what step 11 expects the next
      // basket to remember: the order and the grouping, with no list hidden.
      dialog = await openFilterSheet(page);
      await dialog.getByRole('radio', { name: 'A to Z' }).check();
      await dialog
        .getByRole('radio', { name: 'Category', exact: true })
        .check();
      await dialog.getByRole('button', { name: /^Show 4 lines$/ }).click();
      await expectBasketUrl(page, basketId);
      await expect(chip(page, 'A to Z')).toBeVisible();
      await expect(chip(page, 'By category')).toBeVisible();
      await expect(
        page.locator('section.group h2.group-title').first()
      ).toBeVisible();
    });

    await test.step('4. buying at one shop: Mercadona Colón', async () => {
      const dialog = await openFilterSheet(page);
      await dialog
        .getByRole('button', { name: /Choose the shop you are buying at/ })
        .click();
      await expect(page).toHaveURL(/\/sheet\/filter\/shop$/);

      // The shops of a chain are drawn once its button is pressed.
      const picker = sheet(page, 'Buying at');
      await picker
        .locator('lib-franchise-buttons button', { hasText: 'Mercadona' })
        .click();
      await picker.locator('label.row', { hasText: 'Colón' }).click();
      // The pick dismisses the picker back onto the filter sheet, which draws
      // it and is where the choice is confirmed.
      await expect(page).toHaveURL(/\/sheet\/filter$/);
      await sheet(page, 'Filter and order')
        .getByRole('button', { name: /^Show \d+ lines?$/ })
        .click();
      await expectBasketUrl(page, basketId);

      await expect(chip(page, 'Mercadona')).toBeVisible();
      // Bread names one product, so the row prices it at the shop. Milk names
      // two and nobody has said which was got, so it quotes no price at all
      // (velista `0092`, section 5): the first option's number would name a
      // product nobody picked up.
      await expect(row(page, 'Bread').locator('.product')).toContainText(
        '€0.95'
      );
      await expect(row(page, 'Milk').locator('.product')).toHaveText(
        'No product chosen'
      );
    });

    await test.step('5. settle Eggs from its row status control', async () => {
      await row(page, 'Eggs')
        .getByRole('button', { name: 'Mark Eggs as got' })
        .click();

      await expect(
        row(page, 'Eggs').getByRole('button', { name: 'Eggs is got. Undo it' })
      ).toBeVisible();
      await expect(page.locator('.tools-bar .progress')).toHaveText(
        /1 of 4 got/
      );
    });

    await test.step('6. on the settle sheet, say Milk was the Milk product and buy one for Groceries', async () => {
      const dialog = await openSettleSheet(page, 'Milk');
      await expect(dialog.locator('.outstanding')).toHaveText(/2 outstanding/);

      // The choice prices the product at the shop, as the row in step 4 could
      // not, on the card that stands for it on the sheet.
      await chooseProduct(dialog, 'Milk');
      await expect(dialog.locator('lib-settle-product')).toContainText('€1.15');

      // "Got some" is gone (velista `0092`). Part of a row is bought on the
      // lists behind it, one household at a time, and the sheet stays open.
      await nudge(gotReel(dialog, 'Groceries'), 1);
      await expect(gotReel(dialog, 'Groceries')).toHaveAttribute(
        'aria-valuenow',
        '1'
      );
      await expect(dialog.locator('.outstanding')).toHaveText(/1 outstanding/);
      await closeSettleSheet(page, dialog, basketId);

      await expect(
        reel(row(page, 'Milk'), 'Milk, still to get')
      ).toHaveAttribute('aria-valuenow', '1');
      await expect(
        row(page, 'Milk').getByRole('button', {
          name: 'Mark the rest of Milk as got',
        })
      ).toBeVisible();
    });

    await test.step('7. settle Milk to zero with the reel, raise it to two, and the zone line asks for the rest again', async () => {
      const milk = reel(row(page, 'Milk'), 'Milk, still to get');

      await nudge(milk, -1);
      await expect(milk).toHaveAttribute('aria-valuenow', '0');
      await expect(
        row(page, 'Milk').getByRole('button', { name: 'Milk is got. Undo it' })
      ).toBeVisible();
      await expect
        .poll(
          async () =>
            (await readLine(alice, LIST_GROCERIES_ID, LINE_MILK_ID)).quantity
        )
        .toBe(0);

      await nudge(milk, 2);
      await expect(milk).toHaveAttribute('aria-valuenow', '2');

      // Plan 0073 test 13: raising the reel walks the settlements back, so the
      // household's own line asks for both again rather than for extra.
      await expect
        .poll(
          async () =>
            (await readLine(alice, LIST_GROCERIES_ID, LINE_MILK_ID)).quantity
        )
        .toBe(2);
      await expect
        .poll(async () => (await liveSettlementsOfThisTrip()).length)
        .toBe(0);
    });

    await test.step('8. buy Milk as two products, one settle each, and the zone line names both', async () => {
      // Two products on one row are two settles, which is what replaced the
      // split (velista `0092`, section 5): one unit as the Milk product, then
      // the other as Bread, each from the sheet that holds the choice.
      const dialog = await openSettleSheet(page, 'Milk');
      await chooseProduct(dialog, 'Milk');
      await nudge(gotReel(dialog, 'Groceries'), 1);
      await expect(dialog.locator('.outstanding')).toHaveText(/1 outstanding/);

      await chooseProduct(dialog, 'Bread');
      await nudge(gotReel(dialog, 'Groceries'), 1);
      await expect(gotReel(dialog, 'Groceries')).toHaveAttribute(
        'aria-valuenow',
        '2'
      );
      await closeSettleSheet(page, dialog, basketId);

      await expect(
        row(page, 'Milk').getByRole('button', { name: 'Milk is got. Undo it' })
      ).toBeVisible();

      // Plan 0069 test 9, still true of the new shape: two settlements on the
      // one zone line, naming two different products.
      await expect
        .poll(async () =>
          (await liveSettlementsOfThisTrip()).map((s) => s.itemId).sort()
        )
        .toEqual([ITEM_MILK_ID, ITEM_BREAD_ID].sort());
    });

    await test.step('9. add a line in the aisle with the composer', async () => {
      await addInTheAisle(page, basketId, 'Hardware', 'Batteries');
      await expect(
        row(page, 'Batteries').getByRole('button', {
          name: 'Mark Batteries as got',
        })
      ).toBeVisible();
    });

    await test.step('10. finish the trip, and the history page shows it finished', async () => {
      // A list filter and a search, applied right before finishing, so that
      // step 11 can show they are the two things a new basket does not inherit.
      const dialog = await openFilterSheet(page);
      await dialog.getByRole('checkbox', { name: /^Groceries/ }).uncheck();
      await dialog.getByRole('button', { name: /^Show \d+ lines?$/ }).click();
      await expectBasketUrl(page, basketId);
      // Four properties are on by now, and the chip row is one line inside a 480
      // wide column, so the last of them is drawn as a chip or folded into the
      // `+N` that opens the sheet depending on how wide the words happen to
      // render. Both are the row working as `0075` designed it, so what this
      // asserts is the filter itself: the tool counts it, and the lines from the
      // list that was unchecked are gone.
      await expect(filterTool(page)).toHaveAccessibleName(
        /Filter and order, 4 on/
      );
      await expect(row(page, 'Milk')).toHaveCount(0);
      await page.getByRole('button', { name: 'Search this list' }).click();
      await page.locator('#basket-search').fill('nail');
      await expect(rows(page)).toHaveCount(1);

      await page
        .getByRole('button', { name: 'Finish shopping' })
        .first()
        .click();
      await expect(page).toHaveURL(/\/sheet\/finish(\?.*)?$/);
      const finish = sheet(page, 'Finish shopping?');
      await finish.getByRole('button', { name: 'Finish shopping' }).click();
      await expectBasketUrl(page, basketId);
      await expect(page.locator('.finished[role="status"]')).toContainText(
        'This trip is finished.'
      );

      await page.goto('/en/shopping-lists');
      await expect(
        page.getByRole('heading', { name: 'Your shopping lists' })
      ).toBeVisible();
      const entry = page.locator('lib-shopping-list-row', {
        hasText: tripName,
      });
      await expect(entry).toBeVisible();
      await expect(entry.locator('.badge')).toHaveText('Finished');
    });

    await test.step('11. a second basket remembers the order and grouping, not the list filter or the search', async () => {
      await generateBasket(
        page,
        ['Groceries', 'Hardware'],
        `${tripName} again`
      );

      await expect(rows(page).first()).toBeVisible();
      await expect(chip(page, 'A to Z')).toBeVisible();
      await expect(chip(page, 'By category')).toBeVisible();
      await expect(chip(page, 'Only Hardware')).toHaveCount(0);
      await expect(chip(page, 'Only Groceries')).toHaveCount(0);
      await expect(page.locator('#basket-search')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Search this list' })
      ).toBeVisible();
    });
  });
});
