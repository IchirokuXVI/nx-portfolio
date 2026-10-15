import { expect, test, type Page, type Response } from '@playwright/test';
import {
  ALICE_EMAIL,
  login,
  resetAliceWorld,
  type Session,
} from './support/api';
import {
  expectBasketUrl,
  generateBasket,
  newVisitor,
  nudge,
  openSettleSheet,
  pressBasketMenuRow,
  readShareLinkFromSheet,
  reel,
  row,
  sheet,
  signIn,
} from './support/app';

/**
 * The owner and a guest (velista plan 0080, section 5.2, which is plan 0050
 * section 6 brought up to date: the swap it asked for was retired by 0069 and
 * the split that replaced it by 0092, so the guest skips a line instead, as
 * velista 0096 section 3.3 has it).
 *
 * Two browser contexts on one basket. Alice owns it and shares it; a person
 * signed in to nothing opens the link, skips the name, and shops beside her.
 * What the guest does reaches Alice's screen through the socket, without a
 * reload, and what the guest is not shown (list names, the lists behind a row,
 * line history) is asserted as absent rather than assumed.
 */
test.describe('the owner and a guest', () => {
  let alice: Session;
  let guest: Page;

  test.beforeAll(async () => {
    alice = await login(ALICE_EMAIL);
    await resetAliceWorld(alice);
  });

  test.afterAll(async () => {
    await guest?.context().close();
    await alice?.dispose();
  });

  test('shop one basket together, until the link is revoked', async ({
    page,
    browser,
  }) => {
    let basketId = '';
    let link = '';

    await test.step('1. Alice generates a basket and reads the share link', async () => {
      await signIn(page, ALICE_EMAIL);
      basketId = await generateBasket(
        page,
        ['Groceries', 'Hardware'],
        `Shared trip ${Date.now()}`
      );
      link = await readShareLinkFromSheet(page, basketId);
      expect(link).toMatch(/\/s\/[A-Za-z0-9_-]+$/);
    });

    await test.step('2. a guest opens the link, skips the name, and lands in the basket as Guest 1', async () => {
      guest = await newVisitor(browser);
      // The link names velista's standalone origin, compiled into the build, so
      // that a link copied under the shell still lands on velista's own domain.
      // Against the staging image that is this suite's origin; on a dev slot
      // other than 0 it is slot 0's port. The path is the part under test.
      await guest.goto(new URL(link).pathname);

      await expect(
        guest.getByRole('heading', { name: 'You’ve been invited to shop' })
      ).toBeVisible();
      // No name typed: the primary action is the skip.
      await guest.getByRole('button', { name: 'Continue as guest' }).click();
      await expectBasketUrl(guest, basketId);
      await expect(row(guest, 'Milk')).toBeVisible();

      await pressBasketMenuRow(guest, 'People');
      const people = sheet(guest, 'On this list');
      const me = people.locator('li.person', {
        has: guest.locator('.you-tag'),
      });
      await expect(me.locator('.person-name')).toHaveText('Guest 1');
      await people.getByRole('button', { name: 'Close', exact: true }).click();
      await expectBasketUrl(guest, basketId);
    });

    await test.step('3. the guest buys some of Milk from the row, and Alice sees the remainder without a reload', async () => {
      // The row's reel is how part of a row is bought: the settle sheet has no
      // "Got some" any more (velista `0092`), only the ways of not buying it.
      await nudge(reel(row(guest, 'Milk'), 'Milk, still to get'), -1);
      await expect(
        reel(row(guest, 'Milk'), 'Milk, still to get')
      ).toHaveAttribute('aria-valuenow', '1');

      await expect(
        reel(row(page, 'Milk'), 'Milk, still to get')
      ).toHaveAttribute('aria-valuenow', '1');
      await expect(row(page, 'Milk').locator('.touched')).toContainText(
        'Guest 1 got 1'
      );
    });

    await test.step('4. the guest skips Nails, and Alice sees it skipped', async () => {
      // A skip belongs to the basket, not to the person who pressed it (backend
      // `0130` section 11 point 3), so the owner's screen says it too. It
      // replaced the split by product, which velista `0092` retired.
      const dialog = await openSettleSheet(guest, 'Nails');
      await dialog
        .getByRole('button', { name: 'Not today', exact: true })
        .click();
      await expectBasketUrl(guest, basketId);

      await expect(row(page, 'Nails').locator('.skipped')).toHaveText(
        'Skipped for now'
      );
    });

    await test.step('5. the guest sees no list names, no other lists to add to and no line history', async () => {
      // The caption counts the lists that ask and names none of them: a guest
      // is served no list (velista `0139`, section 1).
      await expect(row(guest, 'Milk').locator('.caption-lists')).toHaveText(
        'Another list'
      );
      await expect(
        guest.locator('lib-basket-row .caption', { hasText: 'Groceries' })
      ).toHaveCount(0);

      // The lists behind the row with their quantities, unnamed, and nothing to
      // add the product to (velista `0139`, section 3).
      const dialog = await openSettleSheet(guest, 'Eggs');
      const entries = dialog.locator('lib-row-entries');
      await expect(
        entries.locator('.row-name', { hasText: 'Another list' })
      ).toBeVisible();
      await expect(entries).not.toContainText('Groceries');
      await expect(
        dialog.getByRole('button', { name: 'Add it to another list' })
      ).toHaveCount(0);
      await expect(
        dialog.getByRole('button', { name: 'Show line history' })
      ).toHaveCount(0);
      await expect(
        dialog.getByRole('button', { name: 'They had none', exact: true })
      ).toBeVisible();
      await guest.keyboard.press('Escape');
      await expectBasketUrl(guest, basketId);
    });

    await test.step('6. Alice opens the people sheet and sees Guest 1', async () => {
      await pressBasketMenuRow(page, 'People');
      const people = sheet(page, 'On this list');
      const guestRow = people.locator('li.person', { hasText: 'Guest 1' });
      await expect(guestRow).toBeVisible();
      await expect(guestRow.locator('.guest-tag')).toHaveText('Guest');
      await people.getByRole('button', { name: 'Close', exact: true }).click();
      await expectBasketUrl(page, basketId);
    });

    await test.step('7. Alice revokes the link with the cascade, and the guest is refused on screen', async () => {
      await page.getByRole('button', { name: 'Share this list' }).click();
      const share = sheet(page, 'Share this list');
      await share.getByRole('button', { name: 'Revoke the link' }).click();

      const revoke = sheet(page, 'Revoke the link?');
      await revoke
        .getByRole('checkbox', {
          name: /Also remove the \d+ guests? who joined with it/,
        })
        .check();
      // The read of the rows that the cascade's event asks for, refused. Watched
      // from before the revoke, because it can land before the tap or after it.
      const rowsReadRefused = guest
        .waitForResponse(refusedRowsRead(basketId), { timeout: 30_000 })
        .then(() => undefined)
        .catch(() => undefined);
      await revoke.getByRole('button', { name: 'Revoke the link' }).click();
      await expectBasketUrl(page, basketId);

      // The guest learns it one of two ways, and both are the app working. Their
      // next tap is refused; or the cascade's own event reaches their socket
      // first, the read it asks for is refused, and the basket goes, the row's
      // button with it. So the tap is tried and may find no button: a tap that
      // failed for any other reason leaves no refusal, and the line below fails.
      const refused = guest.getByText('You are no longer on this list').first();
      const tap = guest.getByRole('button', { name: 'Mark Eggs as got' });
      await expect(tap.or(refused)).toBeVisible();
      await tap.click({ timeout: 2_000 }).catch(() => undefined);
      // Refused, in words, on the screen they are on. Whichever refusal comes
      // second must not turn it into the join screen, so the check waits for
      // the event's read to be refused (a guest whose tap came first may never
      // make it, hence the bound) and then holds over a short window, rather
      // than passing on the first frame after the first refusal.
      await expect(refused).toBeVisible();
      let bound: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        rowsReadRefused,
        new Promise<void>((resolve) => {
          bound = setTimeout(resolve, 5_000);
        }),
      ]);
      clearTimeout(bound);
      const join = guest.getByText('This link is no longer accepting people');
      for (let check = 0; check < 10; check++) {
        await expect(join).toHaveCount(0, { timeout: 100 });
        await expect(refused).toBeVisible({ timeout: 100 });
        await guest.waitForTimeout(150);
      }
      await expectBasketUrl(guest, basketId);
    });
  });
});

/** A refused `GET` of the basket's rows, which a cascade's event asks for. */
function refusedRowsRead(basketId: string): (response: Response) => boolean {
  return (response) =>
    response.status() === 401 &&
    response.request().method() === 'GET' &&
    new URL(response.url()).pathname.endsWith(`/baskets/${basketId}/rows`);
}
