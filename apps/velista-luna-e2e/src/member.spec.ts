import { expect, test, type Page } from '@playwright/test';
import {
  DANA_ID,
  LIST_GROCERIES_ID,
  LIST_HARDWARE_ID,
} from '@portfolio/luna-shopper/test-fixtures';
import {
  addParticipant,
  ALICE_EMAIL,
  DANA_EMAIL,
  listLines,
  login,
  readBasketLines,
  resetAliceWorld,
  type Session,
} from './support/api';
import {
  expectBasketUrl,
  generateBasket,
  newVisitor,
  nudge,
  openSettleSheet,
  readShareLinkFromSheet,
  reel,
  row,
  signIn,
} from './support/app';

/**
 * A registered participant (velista plan 0080, section 5.3, which is plan 0068
 * test 8).
 *
 * Dana is the one seeded user who passes a shared basket's all or nothing rule:
 * a registered member of the same group, with the full set on both of the lists
 * the basket draws from. So where a guest sees lines and nothing else, she sees
 * the zone behind them: which list asked for what, on the settle sheet.
 *
 * **How she gets on the basket differs from the plan's wording, and on purpose.**
 * Section 5.3 has her open the share link while signed in. Today that attaches
 * her as a guest: `BasketApi.join` sends the join with the `anonymous` request
 * context, which tells the gateway interceptor to leave her token off, so the
 * gateway's optional JWT sees nobody and writes a `GUEST` row with no user id.
 * The join page's own contract says a signed in person "is attached as
 * themselves", and backend plan 0051 makes a registered participant exactly
 * that, so this is a defect in the join call rather than a rule. The plan
 * forbids changing application code here, so the owner adds her through the
 * API instead (backend plan 0114, the owner adding a person they share a group
 * with), which is the other way a registered participant comes to exist, and
 * the screens she then sees are the ones under test. When the join is fixed,
 * step 2 can go back to opening the link.
 *
 * The second half is the owner's, and it is the lists summary doing the thing
 * plan 0068 built it for: a line added in the aisle, bought, and then raised for
 * two households at once from the one sheet, which the API confirms landed on
 * both lists.
 */
test.describe('a registered participant', () => {
  let alice: Session;
  let dana: Page;

  test.beforeAll(async () => {
    alice = await login(ALICE_EMAIL);
    await resetAliceWorld(alice);
  });

  test.afterAll(async () => {
    await dana?.context().close();
    await alice.dispose();
  });

  test('sees the zone through a shared basket, and the owner raises an aisle line for both lists', async ({
    page,
    browser,
  }) => {
    let basketId = '';
    const aisleLine = `Torch ${Date.now()}`;

    await test.step('1. Alice generates a basket from Groceries and Hardware and shares it', async () => {
      await signIn(page, ALICE_EMAIL);
      basketId = await generateBasket(
        page,
        ['Groceries', 'Hardware'],
        `Member trip ${Date.now()}`
      );
      const link = await readShareLinkFromSheet(page, basketId);
      expect(link).toMatch(/\/s\/[A-Za-z0-9_-]+$/);
      await addParticipant(alice, basketId, DANA_ID);
    });

    await test.step('2. Dana, signed in, opens the basket and sees zone details', async () => {
      dana = await newVisitor(browser);
      await signIn(dana, DANA_EMAIL);
      await dana.goto(`/en/shopping-lists/${basketId}`);
      await expectBasketUrl(dana, basketId);
      await expect(row(dana, 'Milk')).toBeVisible();

      // What a guest never gets: the lists summary on the settle sheet, with
      // the list that asked for the line named.
      const dialog = await openSettleSheet(dana, 'Milk');
      const summary = dialog.locator('lib-line-lists-summary');
      await expect(
        summary.getByRole('heading', { name: 'Lists that asked for this' })
      ).toBeVisible();
      await expect(
        summary.locator('.row-name', { hasText: 'Groceries' })
      ).toBeVisible();
      await dana.keyboard.press('Escape');
      await expectBasketUrl(dana, basketId);
    });

    await test.step('3. Alice adds a line in the aisle, buys it, and raises it for both lists', async () => {
      // Dana's arrival reached this page as a burst of socket events, and the
      // basket store answers a burst with one coalesced re-read, a moment
      // after the last of them. A re-read still in flight when the line below
      // is added answers after the add does, from before it, and redraws the
      // basket without the new row. So the page is reloaded first: one fresh
      // read, and no timer pending when Alice types.
      await page.reload();
      await expect(row(page, 'Milk')).toBeVisible();

      const composer = page.locator('lib-line-composer');
      await composer
        .getByRole('textbox', { name: 'Add something' })
        .fill(aisleLine);
      await composer.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(row(page, aisleLine)).toBeVisible();

      await row(page, aisleLine)
        .getByRole('button', { name: `Mark ${aisleLine} as got` })
        .click();

      await expect(
        row(page, aisleLine).getByRole('button', {
          name: `${aisleLine} is got. Undo it`,
        })
      ).toBeVisible();
      // Bought, as the backend records it and not only as the row draws it.
      await expect
        .poll(async () => {
          const line = (await readBasketLines(alice, basketId)).find(
            (l) => l.content === aisleLine
          );
          return line ? line.settledQuantity >= line.quantity : false;
        })
        .toBe(true);

      // The lists summary: no list asked for this, so both sit behind the
      // disclosure. Raising a list's "asked for" reel from zero is how a line
      // added in the shop reaches that household.
      const dialog = await openSettleSheet(page, aisleLine);
      const summary = dialog.locator('lib-line-lists-summary');
      await summary.getByRole('button', { name: /more lists?$/ }).click();
      for (const list of ['Groceries', 'Hardware']) {
        await nudge(reel(summary, `${list}, asked for`), 1);
        await expect(reel(summary, `${list}, asked for`)).toHaveAttribute(
          'aria-valuenow',
          '1'
        );
      }

      // Both zone lists carry it now, read back through the API.
      for (const listId of [LIST_GROCERIES_ID, LIST_HARDWARE_ID]) {
        await expect
          .poll(async () =>
            (await listLines(alice, listId)).map((l) => l.content)
          )
          .toContain(aisleLine);
      }
    });
  });
});
