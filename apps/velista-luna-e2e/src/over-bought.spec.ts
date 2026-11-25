import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  LINE_BREAD_ID,
  LIST_GROCERIES_ID,
  ZONE_WEEKLY_ID,
} from '@portfolio/luna-shopper/test-fixtures';
import {
  ALICE_EMAIL,
  buyBasketRow,
  DANA_EMAIL,
  finishOpenBaskets,
  login,
  readLine,
  resetAliceWorld,
  type Session,
} from './support/api';
import { composerField, newVisitor, signIn } from './support/app';

/**
 * A raise on the zone list takes the extra already bought into the ask and asks
 * whether it counts (velista `0208` stage 1, backend `0276`), against the real
 * backend. The owner's example on a list page.
 *
 * Groceries asks one Bread. Dana buys four in a shopping list of her own, so three
 * are above the ask and the line is at 0. Alice steps the Bread row of the zone list
 * from 0 to 4. The raise carries `reportExtra`; the server raises the line to the
 * 4 she set, takes the three into Dana's ask, and answers what "Count the extra"
 * would take off: three. The page asks "Dana already bought 3 extra. Do you still
 * need 4, or just 1?". "Still need" sends nothing and the line stays at 4, as it
 * does with no answer; "Count the extra" is the one answer that writes, and leaves
 * 1. Either way the extra is inside the ask, so the next raise asks nothing, until
 * somebody buys above the ask again.
 */

/** The non breaking space the words join an amount to its unit with. */
const NB = ' ';

function breadRow(page: Page): Locator {
  return page.locator(`li.line[data-line-id="${LINE_BREAD_ID}"]`);
}

function breadAmount(page: Page): Locator {
  return breadRow(page).locator('lib-quantity-stepper');
}

function question(page: Page): Locator {
  return page.locator('lib-extra-ask');
}

function notice(page: Page): Locator {
  return page.locator('lib-extra-ask-notice');
}

const isRaise = (pathname: string) =>
  pathname === `/v1/lines/${LINE_BREAD_ID}/quantity`;
const isCount = (pathname: string) =>
  pathname === `/v1/lines/${LINE_BREAD_ID}/extra`;

/**
 * Groceries, searched for Bread. Dana's open trip holds the line, so the list
 * draws it under her trip and not in To buy; the search draws every matching line
 * with its stepper, at 0 too, and those rows are the zone list's own.
 */
async function openGroceries(page: Page): Promise<void> {
  await page.goto(`/en/zones/${ZONE_WEEKLY_ID}/lists/${LIST_GROCERIES_ID}`);
  await composerField(page).fill('Bread');
  await expect(breadAmount(page)).toBeVisible();
}

/**
 * `presses` of the Bread row's plus, inside one quiet beat, and the one raise they
 * write after it.
 */
async function raiseBread(
  page: Page,
  presses = 1
): Promise<Record<string, unknown>> {
  const written = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      isRaise(new URL(response.url()).pathname),
    { timeout: 10_000 }
  );
  const plus = breadAmount(page).locator('.step.plus');
  for (let press = 0; press < presses; press += 1) {
    await plus.click();
  }
  const response = await written;
  expect(response.ok()).toBe(true);
  return response.request().postDataJSON() as Record<string, unknown>;
}

/** Every count the page sends, so a spec can say none went. */
function countsOf(page: Page): string[] {
  const sent: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      isCount(new URL(request.url()).pathname)
    ) {
      sent.push(request.postData() ?? '');
    }
  });
  return sent;
}

test.describe('a raise takes the extra into the ask and asks whether it counts (velista 0208)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  let alice: Session;
  let dana: Session;
  /** Dana's name in the group, as the page names a member: her username. */
  let danaName = '';
  /** Dana's open shopping list, which holds the extra. */
  let basketId = '';

  test.beforeAll(async () => {
    alice = await login(ALICE_EMAIL);
    dana = await login(DANA_EMAIL);
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

  /** Bread asks 1 and Dana buys 4 in a basket of her own: the line at 0, 3 above. */
  test.beforeEach(async () => {
    await finishOpenBaskets(dana);
    await resetAliceWorld(alice);
    const run = await dana.post<{ basket: { id: string } }>('/v1/baskets', {
      sources: [{ zoneId: ZONE_WEEKLY_ID, listId: LIST_GROCERIES_ID }],
      name: `Over bought ${Date.now()}`,
    });
    basketId = run.basket.id;
    // `from` is what the row asks before the buy, which the server checks.
    await buyBasketRow(dana, basketId, [LINE_BREAD_ID], {
      quantity: 4,
      from: 1,
    });
    expect(
      (await readLine(alice, LIST_GROCERIES_ID, LINE_BREAD_ID)).quantity
    ).toBe(0);
  });

  /** The owner's example: the line set to 4 over 3 extra, and the question on it. */
  async function askedAtFour(page: Page): Promise<void> {
    await signIn(page, ALICE_EMAIL);
    await openGroceries(page);
    await expect(breadAmount(page)).toHaveAttribute('data-value', '0');

    const sent = await raiseBread(page, 4);
    expect(sent).toEqual({ delta: 4, unit: 'UNIT', reportExtra: true });
    await expect(question(page).locator('.question')).toHaveText(
      `${danaName} already bought 3 extra. Do you still need 4, or just${NB}1?`
    );
  }

  test('the question opens with the line at the amount set, and a reload before answering keeps it', async ({
    page,
  }) => {
    const counts = countsOf(page);
    await askedAtFour(page);

    const [stillNeed, count] = await question(page).locator('.answer').all();
    await expect(stillNeed).toHaveText(new RegExp(`Still need\\s*4${NB}units`));
    await expect(count).toHaveText(new RegExp(`Count the extra\\s*1${NB}unit`));
    // The search field keeps focus, since the stepper's press takes none: the
    // question is said in the page's polite region.
    await expect(composerField(page)).toBeFocused();
    await expect(page.locator('p.live')).toHaveText(
      `${danaName} already bought 3 extra. Do you still need 4, or just${NB}1? ` +
        `Two answers are next to the line's amount: Still need 4${NB}units, ` +
        `or Count the extra 1${NB}unit.`
    );
    // The control shows the amount set while the question is open: no jump.
    await expect(breadAmount(page)).toHaveAttribute('data-value', '4');
    expect(
      (await readLine(alice, LIST_GROCERIES_ID, LINE_BREAD_ID)).quantity
    ).toBe(4);

    // Leaving with no answer: the amount set stands, and nothing was counted.
    await openGroceries(page);
    await expect(breadAmount(page)).toHaveAttribute('data-value', '4');
    expect(counts).toEqual([]);

    // The extra is inside the ask now, so the next raise asks nothing.
    const later = await raiseBread(page);
    expect(later).toEqual({ delta: 1, unit: 'UNIT', reportExtra: true });
    await expect(breadAmount(page)).toHaveAttribute('data-value', '5');
    await expect(question(page)).toHaveCount(0);
  });

  test('"Count the extra" lowers the line to what is left, and a reload reads it', async ({
    page,
  }) => {
    await askedAtFour(page);

    const counted = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        isCount(new URL(response.url()).pathname)
    );
    await question(page)
      .getByRole('button', { name: /Count the extra/ })
      .click();
    const answer = await counted;
    expect(answer.status()).toBe(201);
    expect(answer.request().postDataJSON()).toEqual({
      unit: 'UNIT',
      amount: 3,
      expect: 4,
    });
    await expect(question(page)).toHaveCount(0);
    await expect(breadAmount(page)).toHaveAttribute('data-value', '1');

    expect(
      (await readLine(alice, LIST_GROCERIES_ID, LINE_BREAD_ID)).quantity
    ).toBe(1);
    await openGroceries(page);
    await expect(breadAmount(page)).toHaveAttribute('data-value', '1');

    // Nothing is above the ask any more: a raise asks nothing.
    await raiseBread(page);
    await expect(breadAmount(page)).toHaveAttribute('data-value', '2');
    await expect(question(page)).toHaveCount(0);
  });

  test('"Still need" sends nothing and keeps the amount; nobody is asked again until somebody buys above the ask', async ({
    page,
    browser,
  }) => {
    const counts = countsOf(page);
    await askedAtFour(page);

    const quantityWrites: string[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        isRaise(new URL(request.url()).pathname)
      ) {
        quantityWrites.push(request.postData() ?? '');
      }
    });
    await question(page)
      .getByRole('button', { name: /Still need/ })
      .click();
    await expect(question(page)).toHaveCount(0);
    await expect(breadAmount(page)).toHaveAttribute('data-value', '4');
    expect(quantityWrites).toEqual([]);
    expect(counts).toEqual([]);

    // After a reload, a raise asks nothing.
    await openGroceries(page);
    await raiseBread(page);
    await expect(breadAmount(page)).toHaveAttribute('data-value', '5');
    await expect(question(page)).toHaveCount(0);

    // Nor for another member, in a browser of her own.
    const danaPage = await newVisitor(browser);
    try {
      await danaPage.setViewportSize({ width: 390, height: 844 });
      await signIn(danaPage, DANA_EMAIL);
      await openGroceries(danaPage);
      await raiseBread(danaPage);
      await expect(breadAmount(danaPage)).toHaveAttribute('data-value', '6');
      await expect(question(danaPage)).toHaveCount(0);
    } finally {
      await danaPage.context().close();
    }

    // Dana buys above her ask again: the line holds 6, so her row has 6 left, and
    // she buys 8. The line goes to 0 with 2 above, and the next raise asks about
    // those.
    const line = await readLine(alice, LIST_GROCERIES_ID, LINE_BREAD_ID);
    expect(line.quantity).toBe(6);
    await buyBasketRow(dana, basketId, [LINE_BREAD_ID], {
      quantity: 8,
      from: 6,
    });
    expect(
      (await readLine(alice, LIST_GROCERIES_ID, LINE_BREAD_ID)).quantity
    ).toBe(0);
    await openGroceries(page);
    await expect(breadAmount(page)).toHaveAttribute('data-value', '0');
    await raiseBread(page);
    await expect(question(page).locator('.question')).toHaveText(
      `${danaName} already bought 2 extra. Do you still need 1, or is that enough?`
    );
    await expect(
      question(page).getByRole('button', { name: /That's enough/ })
    ).toBeVisible();
  });

  test('a count after another member lowered the line says so and shows the current amount', async ({
    page,
  }) => {
    await askedAtFour(page);

    // Dana lowers the line to 3 while the question is open.
    await dana.post(`/v1/lines/${LINE_BREAD_ID}/quantity`, {
      delta: -1,
      unit: 'UNIT',
    });

    const counted = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        isCount(new URL(response.url()).pathname)
    );
    await question(page)
      .getByRole('button', { name: /Count the extra/ })
      .click();
    expect((await counted).status()).toBe(409);
    await expect(notice(page)).toHaveText(
      'The amount changed in the meantime, so nothing was counted.'
    );
    await expect(breadAmount(page)).toHaveAttribute('data-value', '3');
    expect(
      (await readLine(alice, LIST_GROCERIES_ID, LINE_BREAD_ID)).quantity
    ).toBe(3);

    // A touch on the notice closes it, as one anywhere else does.
    await notice(page).click();
    await expect(notice(page)).toHaveCount(0);
  });

  test('Dana taking back the extra after the raise raises the line by what she took back (backend 0276, case 14)', async ({
    page,
  }) => {
    await askedAtFour(page);
    await question(page)
      .getByRole('button', { name: /Still need/ })
      .click();
    await expect(breadAmount(page)).toHaveAttribute('data-value', '4');

    // The three units were inside the ask, so taking them back puts them back on
    // the line: they are needed again.
    await dana.post(`/v1/baskets/${basketId}/rows/${LINE_BREAD_ID}/revert`, {
      lineIds: [LINE_BREAD_ID],
      target: 'UNITS',
      units: 3,
      from: 4,
    });
    expect(
      (await readLine(alice, LIST_GROCERIES_ID, LINE_BREAD_ID)).quantity
    ).toBe(7);
    await expect(breadAmount(page)).toHaveAttribute('data-value', '7');
  });
});
