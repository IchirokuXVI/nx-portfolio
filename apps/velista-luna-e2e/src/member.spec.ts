import { expect, test, type Page } from '@playwright/test';
import { LIST_HARDWARE_ID } from '@portfolio/luna-shopper/test-fixtures';
import {
  ALICE_EMAIL,
  DANA_EMAIL,
  listLines,
  login,
  readBasketRows,
  resetAliceWorld,
  type Session,
} from './support/api';
import {
  addInTheAisle,
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
 * The second half is the owner's, and it is the lists behind a row doing what
 * velista 0092 built them for: a line added in the aisle to one list, bought,
 * and then asked for again from the settle sheet, which the API confirms
 * reached the household's list.
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
    await alice?.dispose();
  });

  test('sees the zone through a shared basket, and the owner asks for an aisle line again', async ({
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

      // What a guest never gets: the lists behind the row on the settle sheet,
      // with the list that asks for the line named (velista `0090`, 9.2).
      const dialog = await openSettleSheet(dana, 'Milk');
      const entries = dialog.locator('lib-row-entries');
      await expect(
        entries.getByRole('heading', { name: 'Lists that ask for this' })
      ).toBeVisible();
      await expect(
        entries.locator('.row-name', { hasText: 'Groceries' })
      ).toBeVisible();
      await dana.keyboard.press('Escape');
      await expectBasketUrl(dana, basketId);
    });

    await test.step('3. Alice adds a line in the aisle to Hardware, buys it, and asks for it again', async () => {
      // Typed straight after Dana's arrival, with no reload in between, which is
      // the timing the store's read guard exists for: her arrival reached this
      // page as a burst of socket events and the coalesced re-read they schedule
      // is still out when the line below is added (velista `0086`).
      await expect(row(page, 'Milk')).toBeVisible();

      // A line added in the shop lands on one list, chosen beside the field
      // (velista `0092` section 7, `0110`).
      await addInTheAisle(page, basketId, 'Hardware', aisleLine);
      await expect
        .poll(async () =>
          (await listLines(alice, LIST_HARDWARE_ID)).map((l) => l.content)
        )
        .toContain(aisleLine);

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
          const bought = (await readBasketRows(alice, basketId)).find(
            (r) => r.content === aisleLine
          );
          return bought ? bought.left === 0 && bought.bought >= 1 : false;
        })
        .toBe(true);

      // The lists behind the row: Hardware, with what it asks for as a reel the
      // owner may move (velista `0092`, section 6). Raising it from zero is how
      // the household's list asks for one more after the shop.
      const dialog = await openSettleSheet(page, aisleLine);
      const entries = dialog.locator('lib-row-entries');
      await expect(
        entries.locator('.row-name', { hasText: 'Hardware' })
      ).toBeVisible();
      const asks = reel(entries, /^Hardware.*, asks for$/);
      await nudge(asks, 1);
      await expect(asks).toHaveAttribute('aria-valuenow', '1');

      // The zone list asks for it again, read back through the API.
      await expect
        .poll(
          async () =>
            (await listLines(alice, LIST_HARDWARE_ID)).find(
              (l) => l.content === aisleLine
            )?.quantity
        )
        .toBe(1);
    });
  });
});
