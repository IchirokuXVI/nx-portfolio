import { expect, test } from '@playwright/test';
import {
  demoWorld,
  ITEM_MILK_ID,
  LINE_MILK_ID,
  LIST_GROCERIES_ID,
  PRICE_SCOPE_MERCADONA_VALENCIA_ID,
} from '@portfolio/luna-shopper/test-fixtures';
import {
  addProductLine,
  adminLogin,
  ALICE_EMAIL,
  categoryIdBySlug,
  deleteLine,
  ensureItem,
  lineSettlements,
  login,
  readLine,
  resetAliceWorld,
  setAdminPrice,
  setQuantityStep,
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
  stepAmount,
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
 * down to 0.75 (a kilo figure, so 750 g, velista 0188 decision K). The line then
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
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/rows\/[^/]+\/demand$/.test(new URL(response.url()).pathname)
    );
    await field.fill('0.75');
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
 * A product with a step of its own (velista 0186, backend 0261).
 *
 * A second loose product, made the way the bananas are, that a curator gave a
 * step of 100 g through the admin update. A separate product, so the bananas'
 * numbers above never depend on a step an earlier run left. Its line is made at
 * a stated kilo through the API, so the test holds whatever a first add asks for.
 * The settle sheet's stepper presses by 100 g: three down to 700, one up to 800,
 * and "Got all" then records a buy of the 800 g asked for.
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

  test('steps by 100 g in the settle sheet, and buys what it asks for', async ({
    page,
  }) => {
    await signIn(page, ALICE_EMAIL);
    const basketId = await generateBasket(
      page,
      ['Groceries'],
      `Stepped ${Date.now()}`
    );

    const dialog = await openSettleSheet(page, NAME.en);
    const field = askAmount(dialog, 'Groceries');
    await expect(field).toHaveAttribute('aria-valuenow', '1000');
    const stepper = dialog
      .locator('lib-row-entries lib-quantity-stepper')
      .first();

    // One key at a time, each drawn before the next: a stepper steps from the
    // amount it draws, so a key pressed before the sheet draws the last one
    // repeats it. The run is sent once, after the quiet beat.
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/rows\/[^/]+\/demand$/.test(new URL(response.url()).pathname),
      { timeout: 10_000 }
    );
    await field.focus();
    for (const amount of ['900', '800', '700']) {
      await field.press('ArrowDown');
      await expect(field).toHaveAttribute('aria-valuenow', amount);
    }
    await field.blur();
    await saved;
    await expect(stepper).toHaveAttribute('data-value', '700');
    await expect(
      dialog.getByRole('button', { name: /^Add 100 g to / })
    ).toBeVisible();

    await stepAmount(field, 1);
    await expect(field).toHaveAttribute('aria-valuenow', '800');
    await expect
      .poll(
        async () => (await readLine(alice, LIST_GROCERIES_ID, lineId)).quantity
      )
      .toBe(800);

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
