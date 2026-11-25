import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  ITEM_BREAD_ID,
  LINE_BREAD_ID,
  LIST_GROCERIES_ID,
  ZONE_WEEKLY_ID,
} from '@portfolio/luna-shopper/test-fixtures';
import {
  ALICE_EMAIL,
  buyBasketRow,
  DANA_EMAIL,
  ensurePostalCode,
  finishOpenBaskets,
  login,
  readLine,
  resetAliceWorld,
  setLineQuantity,
  type Session,
} from './support/api';
import {
  composerField,
  openListsAndAmounts,
  openSettleSheet,
  signIn,
} from './support/app';

/**
 * The question about the extra already bought on the other controls that raise a
 * line (velista `0208` stages 2 to 4, backend `0276`): the line sheet's Save, the
 * line page's stepper, a catalog card, a row of the product page's table, the
 * zone list's "Add or find", and the basket's "Lists and amounts" and "Add or
 * find", each through the shared `ExtraAskHost`.
 *
 * As in `over-bought.spec.ts`, Groceries asks one Bread and Dana buys four in a
 * shopping list of her own: three above the ask, the line at 0. Each control
 * raises the line, the answer reports the extra it took in, and the control asks.
 */

/** The non breaking space the words join an amount to its unit with. */
const NB = ' ';

function question(page: Page): Locator {
  return page.locator('lib-extra-ask');
}

const isQuantity = (pathname: string) =>
  pathname === `/v1/lines/${LINE_BREAD_ID}/quantity`;
const isLine = (pathname: string) => pathname === `/v1/lines/${LINE_BREAD_ID}`;
const isCount = (pathname: string) =>
  pathname === `/v1/lines/${LINE_BREAD_ID}/extra`;

/** Holds the next request that `matches` until `release` is called. */
async function holdNext(
  page: Page,
  method: string,
  matches: (pathname: string) => boolean
): Promise<{ readonly release: () => void; readonly sent: Promise<void> }> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let seen: () => void = () => undefined;
  const sent = new Promise<void>((resolve) => (seen = resolve));
  await page.route(
    (url) => matches(url.pathname),
    async (route) => {
      if (route.request().method() !== method) {
        await route.continue();
        return;
      }
      seen();
      await gate;
      await route.continue();
    },
    { times: 1 }
  );
  return { release, sent };
}

/** The answer of the next write that `matches`, as JSON, once it lands. */
function answerOf(
  page: Page,
  method: string,
  matches: (pathname: string) => boolean
): Promise<{ status: number; body: Record<string, unknown> }> {
  return page
    .waitForResponse(
      (response) =>
        response.request().method() === method &&
        matches(new URL(response.url()).pathname),
      { timeout: 15_000 }
    )
    .then(async (response) => ({
      status: response.status(),
      body: (await response.json()) as Record<string, unknown>,
    }));
}

/**
 * Groceries, once, so it is the list the catalog adds to (the last list opened),
 * then wherever the spec goes.
 */
async function visitGroceries(page: Page): Promise<void> {
  await page.goto(`/en/zones/${ZONE_WEEKLY_ID}/lists/${LIST_GROCERIES_ID}`);
  await expect(composerField(page)).toBeVisible();
}

test.describe('every control that raises a line asks about the extra (velista 0208, stage 2)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  let alice: Session;
  let dana: Session;
  let danaName = '';

  test.beforeAll(async () => {
    alice = await login(ALICE_EMAIL);
    dana = await login(DANA_EMAIL);
    await ensurePostalCode(alice, '46004');
    const members = await alice.get<{
      items: { userId: string; username: string }[];
    }>(`/v1/zones/${ZONE_WEEKLY_ID}/members?limit=100`);
    danaName =
      members.items.find((member) => member.userId === dana.userId)?.username ??
      '';
    expect(danaName).not.toBe('');
  });

  test.afterAll(async () => {
    await finishOpenBaskets(dana);
    await resetAliceWorld(alice);
    await alice?.dispose();
    await dana?.dispose();
  });

  test.beforeEach(async () => {
    await finishOpenBaskets(dana);
    await resetAliceWorld(alice);
    const run = await dana.post<{ basket: { id: string } }>('/v1/baskets', {
      sources: [{ zoneId: ZONE_WEEKLY_ID, listId: LIST_GROCERIES_ID }],
      name: `Over bought controls ${Date.now()}`,
    });
    await buyBasketRow(dana, run.basket.id, [LINE_BREAD_ID], {
      quantity: 4,
      from: 1,
    });
    expect(
      (await readLine(alice, LIST_GROCERIES_ID, LINE_BREAD_ID)).quantity
    ).toBe(0);
  });

  test("the line sheet's Save asks on its stepper, and Count the extra lowers the line", async ({
    page,
  }) => {
    await signIn(page, ALICE_EMAIL);
    await page.goto(
      `/en/zones/${ZONE_WEEKLY_ID}/lists/${LIST_GROCERIES_ID}/sheet/lines/${LINE_BREAD_ID}/detail`
    );
    const dialog = page.getByRole('dialog').first();
    const stepper = dialog.locator('.amount lib-quantity-stepper');
    await expect(stepper).toHaveAttribute('data-value', '0');
    for (let press = 0; press < 4; press += 1) {
      await stepper.locator('.step.plus').click();
    }
    const saved = answerOf(page, 'PATCH', isLine);
    await dialog.getByRole('button', { name: 'Save' }).click();
    const answer = await saved;
    expect(answer.status).toBe(200);
    expect(answer.body['extra']).toEqual(
      expect.objectContaining({ above: 3, countable: 3 })
    );

    await expect(question(page).locator('.question')).toHaveText(
      `${danaName} already bought 3 extra. Do you still need 4, or just${NB}1?`
    );
    await expect(
      question(page).getByRole('button', { name: /Still need/ })
    ).toBeFocused();

    const counted = answerOf(page, 'POST', isCount);
    await question(page)
      .getByRole('button', { name: /Count the extra/ })
      .click();
    expect((await counted).status).toBe(201);
    await expect(question(page)).toHaveCount(0);
    await expect(stepper).toHaveAttribute('data-value', '1');
    expect(
      (await readLine(alice, LIST_GROCERIES_ID, LINE_BREAD_ID)).quantity
    ).toBe(1);
  });

  test('a sheet gone before a delayed Save answer asks nothing, and the line keeps the amount saved', async ({
    page,
  }) => {
    await signIn(page, ALICE_EMAIL);
    await visitGroceries(page);
    // Opened from its row, in the same document, so going back is the app's own
    // navigation and not a new page load that would drop the request.
    await composerField(page).fill('Bread');
    await page
      .locator(`li.line[data-line-id="${LINE_BREAD_ID}"] [data-line-row]`)
      .getByText('Bread', { exact: true })
      .click();
    const dialog = page.getByRole('dialog').first();
    const stepper = dialog.locator('.amount lib-quantity-stepper');
    await expect(stepper).toHaveAttribute('data-value', '0');
    for (let press = 0; press < 3; press += 1) {
      await stepper.locator('.step.plus').click();
    }
    const held = await holdNext(page, 'PATCH', isLine);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await held.sent;

    // The person leaves the sheet while the Save is out.
    await page.goBack();
    await expect(page.locator('lib-line-detail-sheet')).toHaveCount(0);
    const landed = answerOf(page, 'PATCH', isLine);
    held.release();
    expect((await landed).body['extra']).toEqual(
      expect.objectContaining({ countable: 3 })
    );

    await page.waitForTimeout(1500);
    await expect(question(page)).toHaveCount(0);
    expect(
      (await readLine(alice, LIST_GROCERIES_ID, LINE_BREAD_ID)).quantity
    ).toBe(3);
  });

  test("the line page's stepper asks below it, and Still need keeps the amount", async ({
    page,
  }) => {
    const counts: string[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        isCount(new URL(request.url()).pathname)
      ) {
        counts.push(request.postData() ?? '');
      }
    });
    await signIn(page, ALICE_EMAIL);
    await page.goto(
      `/en/zones/${ZONE_WEEKLY_ID}/lists/${LIST_GROCERIES_ID}/lines/${LINE_BREAD_ID}`
    );
    const stepper = page.locator('.amount lib-quantity-stepper');
    await expect(stepper).toHaveAttribute('data-value', '0');

    const raised = answerOf(page, 'POST', isQuantity);
    await stepper.locator('.step.plus').click();
    await stepper.locator('.step.plus').click();
    const answer = await raised;
    expect(answer.body['extra']).toEqual(
      expect.objectContaining({ above: 3, countable: 2 })
    );
    await expect(question(page).locator('.question')).toHaveText(
      `${danaName} already bought 3 extra. Do you still need 2, or is that enough?`
    );

    await question(page)
      .getByRole('button', { name: /Still need/ })
      .click();
    await expect(question(page)).toHaveCount(0);
    await expect(stepper).toHaveAttribute('data-value', '2');
    expect(counts).toEqual([]);
    expect(
      (await readLine(alice, LIST_GROCERIES_ID, LINE_BREAD_ID)).quantity
    ).toBe(2);
  });

  test('a catalog card scrolled out of sight before a delayed answer is scrolled back and asks', async ({
    page,
  }) => {
    await signIn(page, ALICE_EMAIL);
    await visitGroceries(page);
    await page
      .getByRole('navigation', { name: 'Main sections' })
      .getByRole('link', { name: 'Catalog' })
      .click();
    await expect(page).toHaveURL(/\/en\/catalog$/);
    const card = page
      .locator('lib-product-row')
      .filter({ has: page.getByText('Bread', { exact: true }) });
    const stepper = card.locator(
      `li[data-line="${LINE_BREAD_ID}"] > lib-quantity-stepper`
    );
    await expect(stepper).toHaveAttribute('data-value', '0');

    const held = await holdNext(page, 'POST', isQuantity);
    await stepper.locator('.step.plus').click();
    await held.sent;
    // The person scrolls on, and the card leaves the screen, wholly or in part: the
    // demo catalog holds two cards, so on a short screen the container the page
    // scrolls in goes to whichever end shows the least of this one.
    await page.setViewportSize({ width: 390, height: 420 });
    await card.evaluate((element) => {
      let area: Element | null = element.parentElement;
      while (
        area !== null &&
        !(
          /auto|scroll/.test(getComputedStyle(area).overflowY) &&
          area.scrollHeight > area.clientHeight
        )
      ) {
        area = area.parentElement;
      }
      const scroller = area ?? document.documentElement;
      const shown = () => {
        const box = element.getBoundingClientRect();
        const band = scroller.getBoundingClientRect();
        return (
          Math.max(
            0,
            Math.min(box.bottom, band.bottom) - Math.max(box.top, band.top)
          ) / box.height
        );
      };
      scroller.scrollTop = 0;
      const atTop = shown();
      scroller.scrollTop = scroller.scrollHeight;
      if (shown() > atTop) {
        scroller.scrollTop = 0;
      }
    });
    await expect(card).not.toBeInViewport({ ratio: 0.9 });

    const landed = answerOf(page, 'POST', isQuantity);
    held.release();
    expect((await landed).body['extra']).toEqual(
      expect.objectContaining({ countable: 1 })
    );
    await expect(question(page).locator('.question')).toHaveText(
      `${danaName} already bought 3 extra. Do you still need 1, or is that enough?`
    );
    // Brought back into view: on this short screen the card is taller than what
    // the page shows, so its stepper is what comes back whole.
    await expect(stepper).toBeInViewport({ ratio: 1 });
    await expect(stepper).toHaveAttribute('data-value', '1');

    const counted = answerOf(page, 'POST', isCount);
    await question(page)
      .getByRole('button', { name: /That's enough/ })
      .click();
    expect((await counted).status).toBe(201);
    await expect(stepper).toHaveAttribute('data-value', '0');
  });

  test("the product page's table asks on the list's row", async ({ page }) => {
    await signIn(page, ALICE_EMAIL);
    await page.goto(`/en/catalog/products/${ITEM_BREAD_ID}`);
    const row = page.locator(
      `lib-lists-table li[data-list="${LIST_GROCERIES_ID}"]`
    );
    // The Bread line is under its own words, so it has a row of its own.
    const stepper = row.locator(
      `.other[data-line="${LINE_BREAD_ID}"] > lib-quantity-stepper, .row > lib-quantity-stepper`
    );
    await expect(stepper.first()).toHaveAttribute('data-value', '0');

    const raised = answerOf(page, 'POST', isQuantity);
    await stepper.first().locator('.step.plus').click();
    expect((await raised).body['extra']).toEqual(
      expect.objectContaining({ countable: 1 })
    );
    await expect(question(page).locator('.question')).toHaveText(
      `${danaName} already bought 3 extra. Do you still need 1, or is that enough?`
    );
    await question(page)
      .getByRole('button', { name: /Still need/ })
      .click();
    await expect(stepper.first()).toHaveAttribute('data-value', '1');
  });

  // Stage 3 (target state 16): the zone list's "Add or find" field and its cards.
  test("an add through the zone list's field raises the line at 0, brings its row into view and asks there, and the count lowers it", async ({
    page,
  }) => {
    await signIn(page, ALICE_EMAIL);
    await visitGroceries(page);
    const field = composerField(page);
    await field.fill('Bread');
    const added = answerOf(
      page,
      'POST',
      (pathname) => pathname === `/v1/lists/${LIST_GROCERIES_ID}/lines`
    );
    await page
      .locator('lib-line-composer')
      .getByRole('button', { name: 'Add', exact: true })
      .click();
    const answer = await added;
    expect(answer.body['outcome']).toBe('RAISED');
    expect(answer.body['extra']).toEqual(
      expect.objectContaining({ above: 3, countable: 1 })
    );

    const row = page.locator(`li.line[data-line-id="${LINE_BREAD_ID}"]`);
    await expect(row).toBeInViewport();
    await expect(question(page).locator('.question')).toHaveText(
      `${danaName} already bought 3 extra. Do you still need 1, or is that enough?`
    );
    // The field keeps its focus: the question is said, not focused.
    await expect(field).toBeFocused();
    await expect(row.locator('lib-quantity-stepper')).toHaveAttribute(
      'data-value',
      '1'
    );

    const counted = answerOf(page, 'POST', isCount);
    await question(page)
      .getByRole('button', { name: /That's enough/ })
      .click();
    expect((await counted).status).toBe(201);
    await expect(question(page)).toHaveCount(0);
    expect(
      (await readLine(alice, LIST_GROCERIES_ID, LINE_BREAD_ID)).quantity
    ).toBe(0);
  });

  test("a catalog card's stepper in the zone list's results asks on that card, and Still need keeps the amount", async ({
    page,
  }) => {
    const counts: string[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        isCount(new URL(request.url()).pathname)
      ) {
        counts.push(request.postData() ?? '');
      }
    });
    await signIn(page, ALICE_EMAIL);
    await visitGroceries(page);
    const field = composerField(page);
    await field.fill('Bread');
    const card = page
      .locator('.catalog lib-product-row')
      .filter({ has: page.getByText('Bread', { exact: true }) });
    const stepper = card.locator(
      `li[data-line="${LINE_BREAD_ID}"] > lib-quantity-stepper`
    );
    await expect(stepper).toHaveAttribute('data-value', '0');

    const raised = answerOf(page, 'POST', isQuantity);
    await stepper.locator('.step.plus').click();
    const answer = await raised;
    expect(answer.body['extra']).toEqual(
      expect.objectContaining({ above: 3, countable: 1 })
    );
    await expect(question(page).locator('.question')).toHaveText(
      `${danaName} already bought 3 extra. Do you still need 1, or is that enough?`
    );
    // Pointed at the card's own stepper, below the card.
    const anchored = await page.evaluate(() => {
      const ask = document.querySelector('lib-extra-ask');
      return ask?.closest('li[data-line]')?.getAttribute('data-line') ?? null;
    });
    expect(anchored).toBe(LINE_BREAD_ID);
    await expect(field).toBeFocused();

    await question(page)
      .getByRole('button', { name: /Still need/ })
      .click();
    await expect(question(page)).toHaveCount(0);
    await expect(stepper).toHaveAttribute('data-value', '1');
    expect(counts).toEqual([]);
    expect(
      (await readLine(alice, LIST_GROCERIES_ID, LINE_BREAD_ID)).quantity
    ).toBe(1);
  });
});

/**
 * Stage 4 (target states 17 to 19): the basket. "Lists and amounts" asks about the
 * extra on the ask stepper of the list it raised, this shopping list's own extra
 * included, with Y the answered ask; the basket's "Add or find" hands its question
 * to that view. Each test builds its own world: no shopping list of Dana's by
 * default, so only the extra a test makes is above the ask.
 */
test.describe('the basket asks about the extra (velista 0208, stage 4)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  let alice: Session;
  let dana: Session;
  let danaName = '';

  const isDemand = (pathname: string) =>
    pathname.endsWith(`/rows/${LINE_BREAD_ID}/demand`);
  const isBasketCount = (pathname: string) =>
    pathname.endsWith(`/rows/${LINE_BREAD_ID}/extra`);

  test.beforeAll(async () => {
    alice = await login(ALICE_EMAIL);
    dana = await login(DANA_EMAIL);
    await ensurePostalCode(alice, '46004');
    const members = await alice.get<{
      items: { userId: string; username: string }[];
    }>(`/v1/zones/${ZONE_WEEKLY_ID}/members?limit=100`);
    danaName =
      members.items.find((member) => member.userId === dana.userId)?.username ??
      '';
    expect(danaName).not.toBe('');
  });

  test.afterAll(async () => {
    await finishOpenBaskets(dana);
    await resetAliceWorld(alice);
    await alice?.dispose();
    await dana?.dispose();
  });

  test.beforeEach(async () => {
    await finishOpenBaskets(dana);
    await resetAliceWorld(alice);
  });

  /** A shopping list over Groceries, for `who`. */
  async function basketOf(who: Session, name: string): Promise<string> {
    const run = await who.post<{ basket: { id: string } }>('/v1/baskets', {
      sources: [{ zoneId: ZONE_WEEKLY_ID, listId: LIST_GROCERIES_ID }],
      name: `${name} ${Date.now()}`,
    });
    return run.basket.id;
  }

  /** "Lists and amounts" of the Bread row of Alice's shopping list. */
  async function breadLists(page: Page, basketId: string): Promise<Locator> {
    await page.goto(`/en/shopping-lists/${basketId}`);
    const dialog = await openSettleSheet(page, 'Bread');
    return openListsAndAmounts(page, dialog);
  }

  const groceriesOf = (view: Locator) =>
    view.locator('li.row').filter({ hasText: 'Groceries' });

  /**
   * The owner's example (frame 12): Groceries asks 3 and Alice's own shopping list
   * bought 5, so 2 are above the ask.
   */
  async function ownExtra(page: Page): Promise<{
    readonly view: Locator;
    readonly stepper: Locator;
    readonly bought: Locator;
  }> {
    await setLineQuantity(alice, LINE_BREAD_ID, 3);
    const basketId = await basketOf(alice, 'Own extra');
    await buyBasketRow(alice, basketId, [LINE_BREAD_ID], {
      quantity: 5,
      from: 3,
    });
    await signIn(page, ALICE_EMAIL);
    const view = await breadLists(page, basketId);
    const stepper = groceriesOf(view).locator('lib-quantity-stepper');
    const bought = groceriesOf(view).locator('.row-bought');
    await expect(stepper).toHaveAttribute('data-value', '3');
    await expect(bought).toHaveText('Bought 5 of 3');
    return { view, stepper, bought };
  }

  /** Two presses of the plus, and the one demand they send. */
  async function plusTwice(page: Page, stepper: Locator) {
    const raised = answerOf(page, 'POST', isDemand);
    await stepper.locator('.step.plus').click();
    await stepper.locator('.step.plus').click();
    return raised;
  }

  test("asks about the shopping list's own extra with the larger ask, and Count the extra leaves 5 (frame 12)", async ({
    page,
  }) => {
    const { stepper, bought } = await ownExtra(page);
    const answer = await plusTwice(page, stepper);
    expect(answer.status).toBe(201);
    expect(answer.body['extra']).toEqual(
      expect.objectContaining({ above: 2, countable: 2 })
    );

    await expect(question(page).locator('.question')).toHaveText(
      /^You already bought 2 extra\. Do you still need 7, or just\s5\?$/
    );
    await expect(stepper).toHaveAttribute('data-value', '7');
    await expect(bought).toHaveText('Bought 5 of 7');
    await expect(
      question(page).getByRole('button', { name: /Still need/ })
    ).toBeFocused();

    const counted = answerOf(page, 'POST', isBasketCount);
    await question(page)
      .getByRole('button', { name: /Count the extra/ })
      .click();
    expect((await counted).status).toBe(201);
    await expect(question(page)).toHaveCount(0);
    await expect(stepper).toHaveAttribute('data-value', '5');
    await expect(bought).toHaveText('Bought 5 of 5');
    expect(
      (await readLine(alice, LIST_GROCERIES_ID, LINE_BREAD_ID)).quantity
    ).toBe(0);
  });

  test('Still need sends nothing and the ask stays 7', async ({ page }) => {
    const counts: string[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        isBasketCount(new URL(request.url()).pathname)
      ) {
        counts.push(request.postData() ?? '');
      }
    });
    const { stepper, bought } = await ownExtra(page);
    await plusTwice(page, stepper);
    await question(page)
      .getByRole('button', { name: /Still need/ })
      .click();

    await expect(question(page)).toHaveCount(0);
    await expect(stepper).toHaveAttribute('data-value', '7');
    await expect(bought).toHaveText('Bought 5 of 7');
    expect(counts).toEqual([]);
    expect(
      (await readLine(alice, LIST_GROCERIES_ID, LINE_BREAD_ID)).quantity
    ).toBe(2);
  });

  test('a count after the line moved says nothing was counted, and the line keeps its new amount', async ({
    page,
  }) => {
    const { stepper } = await ownExtra(page);
    await plusTwice(page, stepper);
    await expect(question(page).locator('.question')).toBeVisible();

    // Somebody changes the line while the question is open.
    await setLineQuantity(alice, LINE_BREAD_ID, 4);
    const counted = answerOf(page, 'POST', isBasketCount);
    await question(page)
      .getByRole('button', { name: /Count the extra/ })
      .click();
    const refusal = await counted;
    expect(refusal.status).toBe(409);
    expect(refusal.body['code']).toBe('stale_quantity');

    await expect(page.locator('lib-extra-ask-notice')).toHaveText(
      'The amount changed in the meantime, so nothing was counted.'
    );
    expect(
      (await readLine(alice, LIST_GROCERIES_ID, LINE_BREAD_ID)).quantity
    ).toBe(4);
  });

  test("asks about another shopping list's extra with 3, or just 2, and counts (frame 6)", async ({
    page,
  }) => {
    // Groceries asks 2. Alice's shopping list buys 1, then Dana's buys 2: one
    // meets the ask and one is above it, in Dana's shopping list.
    await setLineQuantity(alice, LINE_BREAD_ID, 2);
    const danaBasket = await basketOf(dana, 'Frame 6');
    const basketId = await basketOf(alice, 'Frame 6');
    await buyBasketRow(alice, basketId, [LINE_BREAD_ID], {
      quantity: 1,
      from: 2,
    });
    await buyBasketRow(dana, danaBasket, [LINE_BREAD_ID], {
      quantity: 2,
      from: 1,
    });
    await signIn(page, ALICE_EMAIL);
    // Bought through another shopping list, the row is drawn crossed out and not
    // as a button, so the view is opened by its address.
    await page.goto(
      `/en/shopping-lists/${basketId}/sheet/rows/${LINE_BREAD_ID}/lists`
    );
    const view = page.locator('lib-row-lists-sheet');
    const stepper = groceriesOf(view).locator('lib-quantity-stepper');
    await expect(stepper).toHaveAttribute('data-value', '1');

    const answer = await plusTwice(page, stepper);
    expect(answer.body['extra']).toEqual(
      expect.objectContaining({ above: 1, countable: 1 })
    );
    await expect(question(page).locator('.question')).toHaveText(
      new RegExp(
        `^${danaName} already bought 1 extra\\. Do you still need 3, or just\\s2\\?$`
      )
    );
    await expect(stepper).toHaveAttribute('data-value', '3');

    const counted = answerOf(page, 'POST', isBasketCount);
    await question(page)
      .getByRole('button', { name: /Count the extra/ })
      .click();
    expect((await counted).status).toBe(201);
    await expect(stepper).toHaveAttribute('data-value', '2');
    expect(
      (await readLine(alice, LIST_GROCERIES_ID, LINE_BREAD_ID)).quantity
    ).toBe(1);
  });

  test('an add through the basket\'s field over a line at 0 opens "Lists and amounts" and asks there, with That\'s enough', async ({
    page,
  }) => {
    // Dana's shopping list bought 4 of the 1 asked: the line is at 0, 3 above.
    const danaBasket = await basketOf(dana, 'Add or find');
    await buyBasketRow(dana, danaBasket, [LINE_BREAD_ID], {
      quantity: 4,
      from: 1,
    });
    const basketId = await basketOf(alice, 'Add or find');
    await signIn(page, ALICE_EMAIL);
    await page.goto(`/en/shopping-lists/${basketId}`);
    await expect(composerField(page)).toBeVisible();

    await composerField(page).fill('Bread');
    await page
      .locator('lib-line-composer')
      .getByRole('button', { name: 'Add', exact: true })
      .click();
    const added = answerOf(
      page,
      'POST',
      (pathname) => pathname === `/v1/baskets/${basketId}/lines`
    );
    await page
      .locator('.picker button.option')
      .filter({
        has: page.locator('.name').getByText('Groceries', { exact: true }),
      })
      .click();
    const answer = await added;
    expect(answer.body['addOutcome']).toBe('RAISED');
    expect(answer.body['extra']).toEqual(
      expect.objectContaining({ above: 3, countable: 1 })
    );

    await expect(page).toHaveURL(/\/sheet\/rows\/[^/]+\/lists(\?.*)?$/);
    const view = page.locator('lib-row-lists-sheet');
    const stepper = groceriesOf(view).locator('lib-quantity-stepper');
    await expect(question(page).locator('.question')).toHaveText(
      `${danaName} already bought 3 extra. Do you still need 1, or is that enough?`
    );
    await expect(stepper).toHaveAttribute('data-value', '1');

    const counted = answerOf(page, 'POST', isBasketCount);
    await question(page)
      .getByRole('button', { name: /That's enough/ })
      .click();
    expect((await counted).status).toBe(201);
    await expect(question(page)).toHaveCount(0);
    // The line is back at 0 with nothing bought of it here, so its row leaves this
    // shopping list and the view with it.
    expect(
      (await readLine(alice, LIST_GROCERIES_ID, LINE_BREAD_ID)).quantity
    ).toBe(0);
  });
});
