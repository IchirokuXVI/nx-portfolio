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
import { composerField, signIn } from './support/app';

/**
 * A raise on the zone list asks whether the extra already bought counts (velista
 * `0207`, backend `0275`), against the real backend.
 *
 * Groceries asks one Bread. Dana buys two in a shopping list of her own, so one is
 * above the ask and the line is at 0. Alice raises the line to 2 over the API with
 * no flag, as the line page would, which counts nothing: one unit is still above
 * the ask. Then she presses the plus of the Bread row on the zone list. The raise
 * carries `countExtra`, the server counts the one unit and leaves the line at 2,
 * and the page asks, naming Dana by the name the group knows her by. "Count the
 * extra" keeps the 2; "Still need" puts the line at the 3 she set. A reload reads
 * the server's number either way.
 */

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

/**
 * Groceries, searched for Bread. Dana's open trip holds the line, so the list
 * draws it under her trip and not in To buy; the search draws every matching line
 * with its stepper, and those rows are the zone list's own.
 */
async function openGroceries(page: Page): Promise<void> {
  await page.goto(`/en/zones/${ZONE_WEEKLY_ID}/lists/${LIST_GROCERIES_ID}`);
  await composerField(page).fill('Bread');
  await expect(breadAmount(page)).toBeVisible();
}

/** The plus of the Bread row, and the raise it writes after the quiet beat. */
async function raiseBread(page: Page): Promise<Record<string, unknown>> {
  const written = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/v1/lines/${LINE_BREAD_ID}/quantity`,
    { timeout: 10_000 }
  );
  await breadAmount(page).locator('.step.plus').click();
  const response = await written;
  expect(response.ok()).toBe(true);
  return response.request().postDataJSON() as Record<string, unknown>;
}

test.describe('a raise asks whether the extra already bought counts (velista 0207)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  let alice: Session;
  let dana: Session;
  /** Dana's name in the group, as the page names a member: her username. */
  let danaName = '';

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

  /**
   * Bread asks 1, Dana buys 2 in a basket of her own, and the line is raised to 2
   * with no flag: the line at 2, one unit above the ask.
   */
  test.beforeEach(async () => {
    await finishOpenBaskets(dana);
    await resetAliceWorld(alice);
    const run = await dana.post<{ basket: { id: string } }>('/v1/baskets', {
      sources: [{ zoneId: ZONE_WEEKLY_ID, listId: LIST_GROCERIES_ID }],
      name: `Over bought ${Date.now()}`,
    });
    // `from` is what the row asks before the buy, which the server checks.
    await buyBasketRow(dana, run.basket.id, [LINE_BREAD_ID], {
      quantity: 2,
      from: 1,
    });
    expect(
      (await readLine(alice, LIST_GROCERIES_ID, LINE_BREAD_ID)).quantity
    ).toBe(0);
    await alice.post(`/v1/lines/${LINE_BREAD_ID}/quantity`, {
      delta: 2,
      unit: 'UNIT',
    });
    expect(
      (await readLine(alice, LIST_GROCERIES_ID, LINE_BREAD_ID)).quantity
    ).toBe(2);
  });

  test('"Count the extra" keeps the smaller amount', async ({ page }) => {
    await signIn(page, ALICE_EMAIL);
    await openGroceries(page);

    const sent = await raiseBread(page);
    expect(sent).toEqual({ delta: 1, unit: 'UNIT', countExtra: true });

    await expect(question(page).locator('.question')).toHaveText(
      `${danaName} already bought 1 extra. Do you still need 3, or just${NB}2?`
    );
    const [stillNeed, count] = await question(page).locator('.answer').all();
    await expect(stillNeed).toHaveText(new RegExp(`Still need\\s*3${NB}units`));
    await expect(count).toHaveText(
      new RegExp(`Count the extra\\s*2${NB}units`)
    );
    // The search field keeps focus, since the stepper's press takes none: the
    // question is said in the page's polite region, and a key typed goes on into
    // the field.
    await expect(composerField(page)).toBeFocused();
    await expect(page.locator('p.live')).toHaveText(
      `${danaName} already bought 1 extra. Do you still need 3, or just${NB}2? ` +
        `Two answers are next to the line's amount: Still need 3${NB}units, ` +
        `or Count the extra 2${NB}units.`
    );
    // The row draws what the line holds while the question is open, so a press on
    // it steps from there.
    await expect(breadAmount(page)).toHaveAttribute('data-value', '2');

    await count.click();
    await expect(question(page)).toHaveCount(0);
    await expect(breadAmount(page)).toHaveAttribute('data-value', '2');

    expect(
      (await readLine(alice, LIST_GROCERIES_ID, LINE_BREAD_ID)).quantity
    ).toBe(2);
    await openGroceries(page);
    await expect(breadAmount(page)).toHaveAttribute('data-value', '2');
  });

  test('"Still need" puts the line at the amount set, and the line asks no more', async ({
    page,
  }) => {
    await signIn(page, ALICE_EMAIL);
    await openGroceries(page);

    await raiseBread(page);
    await expect(question(page)).toBeVisible();

    const plain = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname ===
          `/v1/lines/${LINE_BREAD_ID}/quantity`
    );
    await question(page)
      .getByRole('button', { name: /Still need/ })
      .click();
    const answer = await plain;
    expect(answer.request().postDataJSON()).toEqual({ delta: 1, unit: 'UNIT' });
    await expect(question(page)).toHaveCount(0);
    await expect(breadAmount(page)).toHaveAttribute('data-value', '3');

    // A later raise on the same visit sends no flag and asks nothing.
    const later = await raiseBread(page);
    expect(later).toEqual({ delta: 1, unit: 'UNIT' });
    await expect(breadAmount(page)).toHaveAttribute('data-value', '4');
    await expect(question(page)).toHaveCount(0);

    expect(
      (await readLine(alice, LIST_GROCERIES_ID, LINE_BREAD_ID)).quantity
    ).toBe(4);
    await openGroceries(page);
    await expect(breadAmount(page)).toHaveAttribute('data-value', '4');
  });
});
