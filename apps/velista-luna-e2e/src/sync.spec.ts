import { expect, test, type Request } from '@playwright/test';
import {
  LINE_EGGS_ID,
  LINE_MILK_ID,
} from '@portfolio/luna-shopper/test-fixtures';
import {
  ALICE_EMAIL,
  buyBasketRow,
  login,
  resetAliceWorld,
  type Session,
} from './support/api';
import { generateBasket, reel, row, signIn } from './support/app';

/** A read of the shopping list: the full read or the rows read (backend `0205`). */
function readsTheList(request: Request, basketId: string): boolean {
  const path = new URL(request.url()).pathname;
  return (
    request.method() === 'GET' &&
    (path === `/v1/baskets/${basketId}` ||
      path === `/v1/baskets/${basketId}/rows`)
  );
}

/**
 * A buy reaches the other phone at once (velista plan 0143).
 *
 * Two sessions on one shopping list. One buys over the gateway, as a second
 * phone in the shop would, and the page shows the row as bought within one
 * second, with no request for the shopping list: the event carries the state of
 * the line (backend `0204`), and the page applies it.
 *
 * The world is set up through the API as absolute values, as in every spec here.
 */
test.describe('a buy on another phone', () => {
  let alice: Session;

  test.beforeAll(async () => {
    alice = await login(ALICE_EMAIL);
    await resetAliceWorld(alice);
  });

  test.afterAll(async () => {
    await alice?.dispose();
  });

  test('is drawn within a second, with no read of the shopping list', async ({
    page,
  }) => {
    let basketId = '';
    const reads: string[] = [];

    await test.step('1. open a shopping list, live', async () => {
      await signIn(page, ALICE_EMAIL);
      basketId = await generateBasket(page, ['Groceries', 'Hardware']);
      await expect(row(page, 'Milk')).toBeVisible();
      // The socket is up: the page no longer says it is not updating.
      await expect(page.getByText('Not updating right now')).toHaveCount(0);

      // A first buy, untimed, so the room is joined before the one that is timed.
      await buyBasketRow(alice, basketId, [LINE_EGGS_ID], {
        quantity: 1,
        from: 12,
      });
      await expect(
        reel(row(page, 'Eggs'), 'Eggs, still to get')
      ).toHaveAttribute('aria-valuenow', '11');
    });

    await test.step('2. the other phone buys the Milk, and the row is bought here at once', async () => {
      page.on('request', (request) => {
        if (readsTheList(request, basketId)) {
          reads.push(request.url());
        }
      });

      // Watched from inside the page, every frame, from before the buy.
      const drawn = page.waitForFunction(
        () => {
          const rows = [...document.querySelectorAll('lib-basket-row')];
          const milk = rows.find(
            (held) =>
              held.querySelector('.content')?.textContent?.trim() === 'Milk'
          );
          return milk?.querySelector('.row.is-done') ? Date.now() : false;
        },
        undefined,
        { polling: 'raf', timeout: 5_000 }
      );

      const tapped = Date.now();
      await buyBasketRow(alice, basketId, [LINE_MILK_ID], {
        quantity: 2,
        from: 2,
      });
      const at = (await (await drawn).jsonValue()) as number;

      expect(at - tapped).toBeLessThan(1_000);
      await expect(page.locator('.tools-bar .progress')).toHaveText(
        /1 of 4 got/
      );
    });

    await test.step('3. nothing read the shopping list for it', async () => {
      // An absence has no event to wait for. This is long enough for the old
      // wait of 1500 ms and the read after it to have happened.
      // eslint-disable-next-line playwright/no-wait-for-timeout
      await page.waitForTimeout(2_500);
      expect(reads).toEqual([]);
    });
  });
});
