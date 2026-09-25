import { expect, test, type Page } from '@playwright/test';
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

      await guest
        .getByRole('button', { name: 'See who is on this list' })
        .click();
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

    await test.step('5. the guest sees no list names, no lists behind a row and no line history', async () => {
      await expect(guest.locator('lib-basket-row .from')).toHaveCount(0);
      await expect(
        guest.locator('lib-basket-row .content').first()
      ).toBeVisible();

      const dialog = await openSettleSheet(guest, 'Eggs');
      await expect(dialog.locator('lib-row-entries')).toHaveCount(0);
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
      await page
        .getByRole('button', { name: 'See who is on this list' })
        .click();
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
      await revoke.getByRole('button', { name: 'Revoke the link' }).click();
      await expectBasketUrl(page, basketId);

      // The guest's next action: refused, in words, on the screen they are on.
      await guest.getByRole('button', { name: 'Mark Eggs as got' }).click();
      await expect(
        guest.getByText('You are no longer on this list').first()
      ).toBeVisible();
      await expectBasketUrl(guest, basketId);
    });
  });
});
