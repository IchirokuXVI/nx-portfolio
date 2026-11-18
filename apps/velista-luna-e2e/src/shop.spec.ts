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
  login,
  readLine,
  resetAliceWorld,
  setAdminPrice,
  type LineView,
  type Session,
} from './support/api';
import {
  addInTheAisle,
  askReel,
  chip,
  clearBasketSearch,
  closeSettleSheet,
  composerField,
  expectBasketUrl,
  filterTool,
  generateBasket,
  nudge,
  openFilterSheet,
  openSettleSheet,
  pressBasketMenuRow,
  reel,
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
 * that ask), the reel that settles and then reverts (0073 test 13), a row
 * bought whole as its product (0139), the composer in the aisle (0053, 0110),
 * finishing
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

    await test.step('6. the settle sheet names the product, its price and the list that asks, and the reel buys one', async () => {
      const dialog = await openSettleSheet(page, 'Milk');
      // Under the product: the price of one at the shop, and what is left
      // (velista `0139`, section 3).
      await expect(dialog.locator('.subtitle')).toHaveText(
        /€1\.15 each\s*·\s*2 to get/
      );
      // One list asks, with its quantity as a reel the owner may move.
      const entries = dialog.locator('lib-row-entries');
      await expect(
        entries.getByRole('heading', { name: 'Asked for on 1 list' })
      ).toBeVisible();
      await expect(askReel(dialog, 'Groceries')).toHaveAttribute(
        'aria-valuenow',
        '2'
      );
      await expect(
        dialog.getByRole('button', { name: 'Got all 2', exact: true })
      ).toBeVisible();
      await closeSettleSheet(page, dialog, basketId);

      // Part of a row is bought with the row's own reel.
      await nudge(reel(row(page, 'Milk'), 'Milk, still to get'), -1);
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
 * 1000 g, the row's reel nudged from 1000 to 750, which buys 250 g, and what was
 * bought reads 250 g. `aria-valuenow` stays the integer in grams, as every reel
 * of this suite asserts, and `aria-valuetext` carries the words.
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

  test('is added at a kilo, nudged to 750 g, and 250 g is what was bought', async ({
    page,
  }) => {
    await signIn(page, ALICE_EMAIL);
    await generateBasket(page, ['Groceries'], `Weighed ${Date.now()}`);

    const bananas = reel(row(page, NAME.en), `${NAME.en}, still to get`);
    await expect(bananas).toHaveAttribute('aria-valuenow', '1000');
    await expect(bananas).toHaveAttribute('aria-valuetext', '1 kg');

    // Ten steps of 25 g down from a kilo: 975, 950, ... 750. Down is bought.
    await nudge(bananas, -10);
    await expect(bananas).toHaveAttribute('aria-valuenow', '750');
    await expect(bananas).toHaveAttribute('aria-valuetext', '750 g');
    await expect(row(page, NAME.en).locator('.progress')).toHaveText(
      '250 g of 1 kg'
    );

    // Bought, as the backend records it: 250 in grams, not 250 of something.
    await expect
      .poll(async () =>
        (await lineSettlements(alice, lineId))
          .filter((s) => s.outcome === 'BOUGHT' && !s.revertedAt)
          .map((s) => ({ quantity: s.quantity, unit: s.unit }))
      )
      .toEqual([{ quantity: 250, unit: 'GRAM' }]);
    expect(await readLine(alice, LIST_GROCERIES_ID, lineId)).toMatchObject({
      quantity: 750,
      unit: 'GRAM',
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
