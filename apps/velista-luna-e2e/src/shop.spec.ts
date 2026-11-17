import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  demoWorld,
  ITEM_MILK_ID,
  LINE_MILK_ID,
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
  finishOpenBaskets,
  lineSettlements,
  listLines,
  login,
  readLine,
  resetAliceWorld,
  setAdminPrice,
  setLineQuantity,
  setQuantityStep,
  type LineView,
  type Session,
} from './support/api';
import {
  addInTheAisle,
  amountCell,
  askAmount,
  chip,
  clearBasketSearch,
  closeSettleSheet,
  composerField,
  expectBasketUrl,
  filterTool,
  generateBasket,
  openFilterSheet,
  openSettleSheet,
  pressBasketMenuRow,
  row,
  rows,
  searchBasket,
  sheet,
  signIn,
} from './support/app';

/**
 * One trip, by the owner (velista plan 0080, section 5.1).
 *
 * Every step below is one of the basket plans' e2e asks, in the order a person
 * would meet them on a single shop: generate (0045), search (0074), filter and
 * group (0075, 0077), prices from one shop (0078), the row's status control
 * (0052), the settle sheet (0044, as velista 0139 drew it around the lists
 * that ask), the amount cell that opens it (0190), a settle and its undo, a row
 * bought whole as its product (0139), the composer in the aisle (0053, 0110),
 * finishing (0057), and what the next basket remembers (0076).
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
      // The composer's field is the basket's one search (velista 0117).
      await searchBasket(page, 'egg');

      await expect(rows(page)).toHaveCount(1);
      await expect(row(page, 'Eggs')).toBeVisible();
      await expect(page.locator('#basket-results-heading')).toHaveText(
        /On your lists\s*·\s*1/
      );

      await clearBasketSearch(page);
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

      // The Milk row means the seeded milk, so it sits under the parent of that
      // product's first category, headed by the parent's own name (velista 0118,
      // 0138). Both halves come from the seed: the leaf the demo world files milk
      // under, and the name the catalog seeded its parent with. No translation key
      // is involved.
      const milkAisle = await seededParentName(alice, ITEM_MILK_ID, 'en');
      await expect(
        page
          .locator('section.group', { has: row(page, 'Milk') })
          .locator('h2.group-title > span')
          .first()
      ).toHaveText(milkAisle);
    });

    await test.step('4. buying at one shop: Mercadona Colón', async () => {
      const dialog = await openFilterSheet(page);
      await dialog
        .getByRole('button', {
          name: /^(Choose|Change) the shop you are buying at$/,
        })
        .click();
      await expect(page).toHaveURL(/\/sheet\/filter\/shop$/);

      // The shops of a chain are drawn once its button is pressed. A shop
      // somebody bought at earlier is also under "Recent" (velista `0103`), so
      // Colón can be drawn twice, and either row picks the same shop.
      const picker = sheet(page, 'Buying at');
      await picker
        .locator('lib-franchise-buttons button', { hasText: 'Mercadona' })
        .click();
      await picker.locator('label.row', { hasText: 'Colón' }).first().click();
      // The pick dismisses the picker back onto the filter sheet, which draws
      // it and is where the choice is confirmed.
      await expect(page).toHaveURL(/\/sheet\/filter$/);
      await sheet(page, 'Filter and order')
        .getByRole('button', { name: /^Show \d+ lines?$/ })
        .click();
      await expectBasketUrl(page, basketId);

      await expect(chip(page, 'Mercadona')).toBeVisible();
      // A row is one product (velista `0139`), so each row is priced at the shop,
      // then names the list that asks for it. Milk holds Bread too, and counts as
      // Milk because Milk is its favourite.
      await expect(row(page, 'Bread').locator('.caption-price')).toHaveText(
        '€0.95'
      );
      // The demo world's Milk is a litre with no size, so it is sold by the
      // litre and its price says so (velista `0179`).
      await expect(row(page, 'Milk').locator('.caption-price')).toHaveText(
        '€1.15/ L'
      );
      await expect(row(page, 'Milk').locator('.caption-lists')).toHaveText(
        'Groceries'
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

    await test.step('6. the settle sheet names the product, its price and the list that asks, and the amount cell opens it', async () => {
      const dialog = await openSettleSheet(page, 'Milk');
      // Under the product: the price of one at the shop, and what is left
      // (velista `0139`, section 3).
      await expect(dialog.locator('.subtitle')).toHaveText(
        /€1\.15 each\s*·\s*2 to get/
      );
      // One list asks, with its amount in a stepper the owner may change.
      const entries = dialog.locator('lib-row-entries');
      await expect(
        entries.getByRole('heading', { name: 'Asked for on 1 list' })
      ).toBeVisible();
      await expect(askAmount(dialog, 'Groceries')).toHaveAttribute(
        'aria-valuenow',
        '2'
      );
      await expect(
        dialog.getByRole('button', { name: 'Got all 2', exact: true })
      ).toBeVisible();
      await closeSettleSheet(page, dialog, basketId);

      // The row shows only its amount, and a press on it opens the same sheet
      // (velista 0190). The amount is changed in the sheet, not on the row.
      const cell = amountCell(row(page, 'Milk'));
      await expect(cell).toHaveAccessibleName('Amount of Milk: 2');
      await expect(cell.locator('.number')).toHaveText('2');
      await cell.click();
      await expect(page).toHaveURL(/\/sheet\/rows\/[0-9a-f-]{36}\/settle$/);
      await closeSettleSheet(page, sheet(page, 'Milk'), basketId);
    });

    await test.step('7. settle Milk with its status control, undo it, and the zone line asks for two again', async () => {
      await row(page, 'Milk')
        .getByRole('button', { name: 'Mark Milk as got' })
        .click();
      await expect(
        row(page, 'Milk').getByRole('button', { name: 'Milk is got. Undo it' })
      ).toBeVisible();
      await expect
        .poll(
          async () =>
            (await readLine(alice, LIST_GROCERIES_ID, LINE_MILK_ID)).quantity
        )
        .toBe(0);

      await row(page, 'Milk')
        .getByRole('button', { name: 'Milk is got. Undo it' })
        .click();
      await expect(amountCell(row(page, 'Milk'))).toHaveAccessibleName(
        'Amount of Milk: 2'
      );

      // The undo takes the buy back, so the household's own line asks for both
      // again. Plan 0073 test 13 (raising the reel walks the settlements back)
      // has no gesture left since velista 0190 took the reel off the row.
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

    await test.step('8. buy all of Milk from the sheet, and the settlement names the Milk product', async () => {
      // The sheet's primary button buys what the lines still ask for, as the
      // row's product (velista `0139`, section 4). Another product for this
      // trip is plan `0140`'s Change.
      const dialog = await openSettleSheet(page, 'Milk');
      await dialog
        .getByRole('button', { name: 'Got all 2', exact: true })
        .click();
      await expectBasketUrl(page, basketId);

      await expect(
        row(page, 'Milk').getByRole('button', { name: 'Milk is got. Undo it' })
      ).toBeVisible();

      await expect
        .poll(async () =>
          (await liveSettlementsOfThisTrip()).map((s) => [s.itemId, s.quantity])
        )
        .toEqual([[ITEM_MILK_ID, 2]]);
    });

    await test.step('9. add a line in the aisle with the composer', async () => {
      // The settle sheet of step 8 leaves after its fall, and the first character
      // typed pushes `?search=1`, which lands on the sheet's URL while it falls.
      // Step 10 waits out the filter sheet for the same reason.
      await expect(page.locator('lib-settle-sheet')).toHaveCount(0);
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
      // The sheet leaves after its fall, and the first character pushes
      // `?search=1`. A push that lands during the fall leaves the sheet's scrim
      // over the page, so the search waits for the sheet to be gone.
      await expect(page.locator('lib-filter-sheet')).toHaveCount(0);
      await searchBasket(page, 'nail');
      await expect(rows(page)).toHaveCount(1);

      // A row of the basket's menu since velista 0130, and no longer a button in
      // its header.
      await pressBasketMenuRow(page, 'Finish');
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
      await expect(composerField(page)).toHaveValue('');
      await expect(page.locator('#basket-results')).toHaveCount(0);
    });
  });
});

/**
 * A loose product is asked for by weight (velista plan 0182, section 4).
 *
 * One product sold by the kilo, with a price, on the Groceries list: added at
 * 1000 g, its row's amount cell reads 1 over kg, and the sheet's field is typed
 * "750", which three whole digits under kilos turn into 750 g (velista 0188
 * decision K as the owner ruled it on 2026-11-17), after it is typed key by key
 * the owner's way:
 * "1000" turns into 1 kg, two more zeros turn back into 100 g, and Escape drops
 * it. The line then
 * asks for 750 g and nothing was bought (velista 0190). `aria-valuenow` stays
 * the integer in grams. "Got all" then records one buy of 750 in grams.
 *
 * The product is made through the back office and kept across runs, as
 * `aisles.spec.ts` makes its own; the line is made per run and deleted after,
 * so the owner's trip above meets the four lines it counts.
 */
test.describe('a loose product, by weight (velista 0182)', () => {
  const NAME = { en: 'Loose bananas e2e', es: 'Plátanos a granel e2e' };
  let alice: Session;
  let admin: Session;
  let lineId = '';

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
      quantity: 1000,
      unit: 'GRAM',
    });
    expect(line).toMatchObject({ quantity: 1000, unit: 'GRAM' });
    lineId = line.id;
  });

  test.afterAll(async () => {
    if (lineId !== '') await deleteLine(alice, lineId);
    await alice?.dispose();
    await admin?.dispose();
  });

  test('is added at a kilo, typed down to 750 g in the sheet, and bought at 750 g', async ({
    page,
  }) => {
    await signIn(page, ALICE_EMAIL);
    const basketId = await generateBasket(
      page,
      ['Groceries'],
      `Weighed ${Date.now()}`
    );

    const cell = amountCell(row(page, NAME.en));
    await expect(cell.locator('.number')).toHaveText('1');
    await expect(cell.locator('.symbol')).toHaveText('kg');

    const dialog = await openSettleSheet(page, NAME.en);
    const field = askAmount(dialog, 'Groceries');
    await expect(field).toHaveAttribute('aria-valuenow', '1000');

    // The owner's second ruling of 2026-11-17: under kg a whole number over 99
    // turns into grams at once, and the field then waits in grams until the edit
    // ends. A sixth digit is not accepted. Escape saves nothing.
    const symbol = field
      .locator('xpath=ancestor::lib-quantity-stepper')
      .locator('.field-cell .symbol');
    await field.click();
    await field.press('ControlOrMeta+a');
    await field.pressSequentially('10');
    await expect(field).toHaveValue('10');
    await expect(symbol).toHaveText('kg');
    await field.pressSequentially('0');
    await expect(field).toHaveValue('100');
    await expect(symbol).toHaveText('g');
    await field.pressSequentially('000');
    // The third zero would be a sixth digit, and is put back, and a popover says
    // why (the owner, 2026-11-17). Escape takes the popover away first.
    await expect(field).toHaveValue('10000');
    await expect(symbol).toHaveText('g');
    const refusal = page.locator('.refusal');
    await expect(refusal).toHaveText('At most 99,999 g');
    await field.press('Escape');
    await expect(refusal).toHaveCount(0);
    await expect(field).toHaveValue('10000');
    await field.press('Escape');
    await expect(field).toHaveValue('1');
    await expect(symbol).toHaveText('kg');

    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/rows\/[^/]+\/demand$/.test(new URL(response.url()).pathname)
    );
    // "750" under kg turns into 750 g as it is typed (decision K), so the
    // plan's "750" is what a person types (velista 0190, section 8).
    await field.fill('750');
    await field.press('Enter');
    await saved;
    await expect(field).toHaveAttribute('aria-valuenow', '750');
    await closeSettleSheet(page, dialog, basketId);

    await expect(cell.locator('.number')).toHaveText('750');
    await expect(cell.locator('.symbol')).toHaveText('g');

    // Asked for, as the backend records it: 750 in grams, and nothing bought.
    expect(await readLine(alice, LIST_GROCERIES_ID, lineId)).toMatchObject({
      quantity: 750,
      unit: 'GRAM',
    });
    expect(
      (await lineSettlements(alice, lineId)).filter((s) => !s.revertedAt)
    ).toEqual([]);

    // Bought from the sheet: one settlement of 750, recorded in grams.
    const again = await openSettleSheet(page, NAME.en);
    await again.getByRole('button', { name: /^Got all\b/ }).click();
    await expectBasketUrl(page, basketId);
    await expect
      .poll(async () =>
        (await lineSettlements(alice, lineId))
          .filter((s) => !s.revertedAt)
          .map((s) => [s.outcome, s.quantity, s.unit])
      )
      .toEqual([['BOUGHT', 750, 'GRAM']]);
  });
});

/**
 * A typed name already on the list adds nothing (velista plan 0185, A1).
 *
 * The loose product of the describe above, on a line of its own at a kilo. The
 * composer types its name and presses add: the line still asks for 1000 g, no row
 * of that name is drawn beside it, and the list holds one line of it, in grams, at
 * 1000. The line is made per run and deleted after.
 */
test.describe('a typed name already on the list (velista 0185)', () => {
  const NAME = { en: 'Loose bananas e2e', es: 'Plátanos a granel e2e' };
  let alice: Session;
  let admin: Session;
  let lineId = '';

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
    const line = await addProductLine(alice, LIST_GROCERIES_ID, {
      content: NAME.en,
      itemId,
      quantity: 1000,
      unit: 'GRAM',
    });
    expect(line).toMatchObject({ quantity: 1000, unit: 'GRAM' });
    lineId = line.id;
  });

  test.afterAll(async () => {
    if (lineId !== '') await deleteLine(alice, lineId);
    await alice?.dispose();
    await admin?.dispose();
  });

  test('leaves the line at 1000 g, draws no second row, and says it is on the list', async ({
    page,
  }) => {
    await signIn(page, ALICE_EMAIL);
    await page.goto(`/en/zones/${ZONE_WEEKLY_ID}/lists/${LIST_GROCERIES_ID}`);
    const amount = page.locator(
      `lib-line-list [data-line-id="${lineId}"] lib-quantity-stepper`
    );
    await expect(amount).toHaveAttribute('data-value', '1000');

    await composerField(page).fill(NAME.en);
    await page
      .locator('lib-line-composer')
      .getByRole('button', { name: 'Add', exact: true })
      .click();

    await expect(composerField(page)).toHaveValue('');
    // Said in the page's live region, not drawn under the field: the row is drawn.
    await expect(
      page.getByText(`${NAME.en} is already on the list.`).first()
    ).toBeAttached();
    await expect(page.locator('lib-line-composer .notice')).toHaveCount(0);
    await expect(amount).toHaveAttribute('data-value', '1000');
    await expect(amount).toHaveClass(/is-took/);
    await expect(
      page.locator('lib-line-list lib-line-row').filter({ hasText: NAME.en })
    ).toHaveCount(1);

    const held = (await listLines(alice, LIST_GROCERIES_ID)).filter(
      (one) => one.content === NAME.en
    );
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ id: lineId, quantity: 1000, unit: 'GRAM' });
  });
});

/**
 * A typed name two lines meet asks which (velista 0185, the owner's ruling of
 * 2026-11-16; backend 0260, rule 4).
 *
 * The loose product on a line of its own, kept at 0, and a free text line of the
 * same name asking for one. The composer types the name and presses add: nothing
 * is written, and the question names both lines, the one above 0 as already on the
 * list, and offers a new line because the add is typed. Choosing the line at 0
 * raises it by one step of its unit, 25 g. The two lines are made per run and
 * deleted after.
 */
test.describe('a typed name two lines meet (velista 0185, 2026-11-16)', () => {
  const NAME = { en: 'Loose bananas e2e', es: 'Plátanos a granel e2e' };
  let alice: Session;
  let admin: Session;
  let productLine = '';
  let textLine = '';

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
    const kept = await addProductLine(alice, LIST_GROCERIES_ID, {
      content: NAME.en,
      itemId,
      quantity: 1000,
      unit: 'GRAM',
    });
    productLine = kept.id;
    await setLineQuantity(alice, productLine, 0);
    const typed = await alice.post<{ line: LineView }>(
      `/v1/lists/${LIST_GROCERIES_ID}/lines`,
      { content: NAME.en, newLine: true }
    );
    textLine = typed.line.id;
    expect(textLine).not.toBe(productLine);
  });

  test.afterAll(async () => {
    for (const id of [productLine, textLine]) {
      if (id !== '') await deleteLine(alice, id);
    }
    await alice?.dispose();
    await admin?.dispose();
  });

  test('asks which line, shows the one already on the list, and raises the one at 0', async ({
    page,
  }) => {
    await signIn(page, ALICE_EMAIL);
    await page.goto(`/en/zones/${ZONE_WEEKLY_ID}/lists/${LIST_GROCERIES_ID}`);

    await composerField(page).fill(NAME.en);
    await page
      .locator('lib-line-composer')
      .getByRole('button', { name: 'Add', exact: true })
      .click();

    const question = page.locator('lib-add-choice');
    await expect(question).toBeVisible();
    const choices = question.locator('button.row');
    // Both lines and a new line, for typed words.
    await expect(choices).toHaveCount(3);
    await expect(question.locator('button.row.new')).toHaveCount(1);
    await expect(
      question.getByRole('button', {
        name: new RegExp(`already on the list with 1\\. Choose it to see it`),
      })
    ).toHaveCount(1);
    await expect(question.locator('.state')).toHaveText([
      'Already on the list. Choose it to see it.',
    ]);
    // The words wait in the field, and nothing was written.
    await expect(composerField(page)).toHaveValue(NAME.en);
    expect(
      (await listLines(alice, LIST_GROCERIES_ID)).filter(
        (one) => one.content === NAME.en
      )
    ).toHaveLength(2);

    // The line at 0: raised by one step of its unit.
    await question.getByRole('button', { name: /0 g to 25 g/ }).click();
    await expect(question).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await readLine(alice, LIST_GROCERIES_ID, productLine)).quantity
      )
      .toBe(25);
    expect(await readLine(alice, LIST_GROCERIES_ID, textLine)).toMatchObject({
      quantity: 1,
    });
  });
});

/**
 * The search field at the top of a list (velista 0189, section 8).
 *
 * On both pages the field sits above the first row, the bottom bar stays while
 * somebody types, and the first touch drag of the results takes the focus off the
 * field while the words, the results and `?search=1` stay. Desktop Chrome has no
 * on screen keyboard, so this proves the blur, not the keyboard.
 *
 * The drag goes through the DevTools protocol with touch emulation on, because a
 * synthetic DOM event is not what the browser scrolls with: this is the touch a
 * finger makes, with the pointer cancelled once the browser takes it for a scroll.
 * The two lines are made per run and deleted after.
 */
test.describe('the search field at the top of a list (velista 0189)', () => {
  const RUN = `${Date.now()}`;
  const WORD = 'Topsearch';
  let alice: Session;
  const made: LineView[] = [];

  test.beforeAll(async () => {
    alice = await login(ALICE_EMAIL);
    await resetAliceWorld(alice);
    for (const what of ['soap', 'sponge']) {
      const answer = await alice.post<{ line: LineView }>(
        `/v1/lists/${LIST_GROCERIES_ID}/lines`,
        { content: `${WORD} ${RUN} ${what}`, quantity: 1 }
      );
      made.push(answer.line);
    }
  });

  test.afterAll(async () => {
    // The basket step leaves a live basket holding the two lines.
    await finishOpenBaskets(alice);
    for (const line of made) await deleteLine(alice, line.id);
    await alice?.dispose();
  });

  /** A finger on `target` that moves 120 px up in three steps and lifts. */
  async function touchDrag(page: Page, target: Locator): Promise<void> {
    const box = await target.boundingBox();
    if (box === null) throw new Error('nothing to drag');
    const x = box.x + box.width / 2;
    const y = box.y + Math.min(box.height - 10, 200);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 1,
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    });
    for (const step of [1, 2, 3]) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y - step * 40 }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await cdp.detach();
  }

  test('sits above the rows, keeps the bar, and lets a drag take the keyboard down', async ({
    page,
  }) => {
    await signIn(page, ALICE_EMAIL);

    await test.step('1. the zone list', async () => {
      await page.goto(`/en/zones/${ZONE_WEEKLY_ID}/lists/${LIST_GROCERIES_ID}`);
      const field = composerField(page);
      const firstRow = page.locator('lib-line-list .line').first();
      await expect(firstRow).toBeVisible();

      const fieldBox = await field.boundingBox();
      const rowBox = await firstRow.boundingBox();
      expect(fieldBox).not.toBeNull();
      expect(rowBox).not.toBeNull();
      expect((fieldBox?.y ?? 0) + (fieldBox?.height ?? 0)).toBeLessThanOrEqual(
        rowBox?.y ?? 0
      );

      await field.fill(WORD);
      const results = page.locator('#list-results');
      await expect(results).toBeVisible();
      await expect(page).toHaveURL(/[?&]search=1/);
      await expect(
        page.getByRole('navigation', { name: 'Main sections' })
      ).toBeVisible();
      await expect(field).toBeFocused();

      await touchDrag(page, results);

      await expect(field).not.toBeFocused();
      await expect(field).toHaveValue(WORD);
      await expect(results).toBeVisible();
      await expect(page).toHaveURL(/[?&]search=1/);
    });

    await test.step('2. the shopping list', async () => {
      const basketId = await generateBasket(
        page,
        ['Groceries'],
        `Top search ${RUN}`
      );
      await expectBasketUrl(page, basketId);
      const field = composerField(page);
      await expect(rows(page).first()).toBeVisible();
      const fieldBox = await field.boundingBox();
      const rowBox = await rows(page).first().boundingBox();
      expect((fieldBox?.y ?? 0) + (fieldBox?.height ?? 0)).toBeLessThanOrEqual(
        rowBox?.y ?? 0
      );

      await field.fill(WORD);
      const results = page.locator('#basket-results');
      await expect(results).toBeVisible();
      await expect(page).toHaveURL(/[?&]search=1/);
      await expect(page.locator('.tools-bar')).toBeVisible();
      await expect(
        page.getByRole('navigation', { name: 'Main sections' })
      ).toBeVisible();
      await expect(field).toBeFocused();

      await touchDrag(page, results);

      await expect(field).not.toBeFocused();
      await expect(field).toHaveValue(WORD);
      await expect(results).toBeVisible();
      await expect(page.locator('.tools-bar')).toBeVisible();
      await expect(page).toHaveURL(/[?&]search=1/);
    });
  });
});

/**
 * A product with a step of its own (velista 0186, backend 0261).
 *
 * A second loose product, made the way the bananas are, that a curator gave a
 * step of 100 g through the admin update. A separate product, so the bananas'
 * numbers above never depend on a step an earlier run left. Its line is made at
 * a stated kilo through the API, so the test holds whatever a first add asks for.
 * The zone list row's stepper presses by 100 g (velista 0186, section 4): three
 * down to 700, one up to 800, and "Got all" then records a buy of the 800 g
 * asked for, since no part of a row is bought from the shopping list.
 */
test.describe('a product with a step of its own (velista 0186)', () => {
  const NAME = { en: 'Whole chicken e2e', es: 'Pollo entero e2e' };
  let alice: Session;
  let admin: Session;
  let lineId = '';

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
    await setQuantityStep(admin, itemId, 100);
    await setAdminPrice(admin, itemId, PRICE_SCOPE_MERCADONA_VALENCIA_ID, 5.49);

    const line = await addProductLine(alice, LIST_GROCERIES_ID, {
      content: NAME.en,
      itemId,
      quantity: 1000,
      unit: 'GRAM',
    });
    expect(line).toMatchObject({ quantity: 1000, unit: 'GRAM' });
    lineId = line.id;
  });

  test.afterAll(async () => {
    if (lineId !== '') await deleteLine(alice, lineId);
    await alice?.dispose();
    await admin?.dispose();
  });

  test('steps by 100 g on the list row, and buys what it asks for', async ({
    page,
  }) => {
    await signIn(page, ALICE_EMAIL);
    await page.goto(`/en/zones/${ZONE_WEEKLY_ID}/lists/${LIST_GROCERIES_ID}`);
    const listRow = page
      .locator('lib-line-row', { hasText: NAME.en })
      .locator('.row');
    const stepper = listRow.locator('lib-quantity-stepper');
    await expect(stepper).toHaveAttribute('data-value', '1000');
    // The line steps by the default until its product's record is read (velista
    // 0186, decision B); the plus names the step once it is.
    await expect(stepper.locator('button.plus')).toHaveAccessibleName(
      /^Add 100 g to /
    );

    // One press at a time, each drawn before the next. The run is written once,
    // after the quiet beat (velista 0188).
    for (const amount of ['900', '800', '700']) {
      await stepper.locator('button.minus').click();
      await expect(stepper).toHaveAttribute('data-value', amount);
    }
    await expect
      .poll(
        async () => (await readLine(alice, LIST_GROCERIES_ID, lineId)).quantity
      )
      .toBe(700);
    await expect(stepper.locator('button.plus')).toHaveAccessibleName(
      /^Add 100 g to /
    );

    await stepper.locator('button.plus').click();
    await expect(stepper).toHaveAttribute('data-value', '800');
    await expect
      .poll(
        async () => (await readLine(alice, LIST_GROCERIES_ID, lineId)).quantity
      )
      .toBe(800);

    // No part of a row is bought from the shopping list since velista 0190
    // (the owner, 2026-11-11), so "Got all" buys the 800 g the line asks for.
    const basketId = await generateBasket(
      page,
      ['Groceries'],
      `Stepped ${Date.now()}`
    );
    const dialog = await openSettleSheet(page, NAME.en);
    await expect(askAmount(dialog, 'Groceries')).toHaveAttribute(
      'aria-valuenow',
      '800'
    );
    await dialog.getByRole('button', { name: /^Got all / }).click();
    await expectBasketUrl(page, basketId);
    await expect
      .poll(async () =>
        (await lineSettlements(alice, lineId))
          .filter((s) => !s.revertedAt)
          .map((s) => s.quantity)
      )
      .toEqual([800]);
  });
});

/**
 * A first add at the product's own step (velista 0186, the owner's ruling 43 of
 * 2026-11-16).
 *
 * A third loose product, given a step of 1000 g, on no line of the Groceries list.
 * The zone list's composer finds it and its card's plus adds it: the line asks for
 * 1 kg, not 25 g, and one plus on its row then asks for 2 kg. The line is deleted
 * after, so the next run adds it again.
 */
test.describe("a first add at the product's step (velista 0186, ruling 43)", () => {
  const NAME = { en: 'Whole turkey e2e', es: 'Pavo entero e2e' };
  let alice: Session;
  let admin: Session;

  const linesOfIt = async () =>
    (await listLines(alice, LIST_GROCERIES_ID)).filter(
      (one) => one.content === NAME.en
    );

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
    await setQuantityStep(admin, itemId, 1000);
    await setAdminPrice(admin, itemId, PRICE_SCOPE_MERCADONA_VALENCIA_ID, 3.95);
    for (const held of await linesOfIt()) await deleteLine(alice, held.id);
  });

  test.afterAll(async () => {
    for (const held of await linesOfIt()) await deleteLine(alice, held.id);
    await alice?.dispose();
    await admin?.dispose();
  });

  test('is added at 1 kg from the zone list, and plus then asks for 2 kg', async ({
    page,
  }) => {
    await signIn(page, ALICE_EMAIL);
    await page.goto(`/en/zones/${ZONE_WEEKLY_ID}/lists/${LIST_GROCERIES_ID}`);

    await composerField(page).fill(NAME.en);
    const card = page
      .locator('#list-results lib-product-row')
      .filter({ hasText: NAME.en })
      .first();
    await expect(card).toBeVisible();
    await card.locator('button.add').click();

    await expect.poll(async () => (await linesOfIt()).length).toBe(1);
    const [made] = await linesOfIt();
    expect(made).toMatchObject({ quantity: 1000, unit: 'GRAM' });

    await composerField(page).fill('');
    const amount = page.locator(
      `lib-line-list [data-line-id="${made.id}"] lib-quantity-stepper`
    );
    await expect(amount).toHaveAttribute('data-value', '1000');
    await amount.locator('button.plus').click();
    await expect(amount).toHaveAttribute('data-value', '2000');
    await expect
      .poll(
        async () =>
          (await readLine(alice, LIST_GROCERIES_ID, made.id)).quantity,
        { timeout: 10_000 }
      )
      .toBe(2000);
  });
});

/**
 * The name the seed gave the parent of a seeded product's first category, in one
 * language: the basket heads its category groups with the parent (velista 0138).
 *
 * The demo world files each product under leaf slugs (backend plan 0166), and the
 * catalog seed writes the tree those slugs name. The name is read back from the
 * tree the gateway serves, by the slug the demo world names, so a change to the
 * seeded taxonomy moves this expectation with it rather than breaking it.
 */
async function seededParentName(
  s: Session,
  itemId: string,
  locale: 'en' | 'es'
): Promise<string> {
  const item = demoWorld.catalog.items.find((one) => one.id === itemId);
  const slug = item?.categories[0];
  if (slug === undefined) {
    throw new Error(`the demo world files no category for ${itemId}`);
  }

  const tree = await s.get<{
    categories: {
      id: string;
      parentId: string | null;
      slug: string;
      name: { en?: string; es?: string };
    }[];
  }>('/v1/catalog/categories');
  const leaf = tree.categories.find((one) => one.slug === slug);
  const name = tree.categories.find((one) => one.id === leaf?.parentId)?.name[
    locale
  ];
  if (name === undefined || name === '') {
    throw new Error(`the catalog names no ${locale} category ${slug}`);
  }
  return name;
}
