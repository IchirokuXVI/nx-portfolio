import { expect, test, type Page } from '@playwright/test';
import {
  LIST_GROCERIES_ID,
  LIST_HARDWARE_ID,
} from '@portfolio/luna-shopper/test-fixtures';
import {
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
  sheet,
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
 * **How she gets on the basket is the share link**, opened while she is signed
 * in, which is the same act a guest performs in `guest.spec.ts` and the same
 * link. The join page never asks her anything: somebody already signed in is
 * attached as themselves, so the request carries her bearer, the gateway's
 * optional JWT resolves her, and core writes a `REGISTERED` row against her
 * account. That is the whole difference between the two specs, and the people
 * sheet is where it shows: her row carries no guest mark.
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
    let link = '';
    const aisleLine = `Torch ${Date.now()}`;

    await test.step('1. Alice generates a basket from Groceries and Hardware and shares it', async () => {
      await signIn(page, ALICE_EMAIL);
      basketId = await generateBasket(
        page,
        ['Groceries', 'Hardware'],
        `Member trip ${Date.now()}`
      );
      link = await readShareLinkFromSheet(page, basketId);
      expect(link).toMatch(/\/s\/[A-Za-z0-9_-]+$/);
    });

    await test.step('2. Dana, signed in, opens the share link and sees zone details', async () => {
      dana = await newVisitor(browser);
      await signIn(dana, DANA_EMAIL);
      // The path, for `guest.spec.ts` step 2's reason: the link names velista's
      // compiled in standalone origin, and what is under test is what the path
      // does for somebody who is already signed in.
      await dana.goto(new URL(link).pathname);

      // Straight to the basket, with nothing asked of her: the offer screen is
      // for a stranger, and she is a member of the group this list belongs to.
      await expectBasketUrl(dana, basketId);
      await expect(
        dana.getByRole('heading', { name: 'You’ve been invited to shop' })
      ).toHaveCount(0);
      await expect(row(dana, 'Milk')).toBeVisible();

      // Who the server decided she is, in the one place the screen says it: her
      // own row, under her account's name and with no guest mark on it. The name
      // is the username the session already holds, because she typed none on the
      // way in and core keeps no display name for a participant who did not. The
      // guest mark is the part that says which kind of participant she is, and
      // the absence of it is what the join fix bought.
      await dana
        .getByRole('button', { name: 'See who is on this list' })
        .click();
      const people = sheet(dana, 'On this list');
      const her = people.locator('li.person', {
        has: dana.locator('.you-tag'),
      });
      await expect(her.locator('.person-name')).toHaveText('Calm Harbour');
      await expect(her.locator('.guest-tag')).toHaveCount(0);
      await people.getByRole('button', { name: 'Close', exact: true }).click();
      await expectBasketUrl(dana, basketId);

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
      // Typed straight after Dana's arrival, with no reload in between, which is
      // the timing the store's read guard exists for: her arrival reached this
      // page as a burst of socket events and the coalesced re-read they schedule
      // is still out when the line below is added (velista `0086`).
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
