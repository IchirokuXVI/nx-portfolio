import { expect, test, type Page } from '@playwright/test';
import {
  STUB_LEGAL_SETTINGS,
  stubBackendReady,
  stubBackendUnreachable,
} from './support/gateway';

/**
 * Velista 0176: no language overflows the front door.
 *
 * The landing is exactly one screen (velista 0175): it never scrolls, the foot is
 * always on screen, nothing is cut, and the card under the headline gives way row by
 * row with a count that matches the rows it draws. This loads it in every locale the
 * language control offers, at five phone sizes, in the two states that change its
 * height, and measures it in the browser.
 *
 * **Locales are read from the control, not listed** (D1), so a locale added to
 * `APP_USABLE_LOCALES` is covered with no change here. Playwright names its tests
 * before any browser starts, so the locales cannot name tests: each test is one size
 * and one state, and each locale is a step named like `es 360x640 ready`. The checks
 * are soft, so one run reports every case that fails, each under its step.
 */

/** D2: the common phone heights from 844 down to the smallest the app supports. */
const SIZES = [
  { width: 390, height: 844 },
  { width: 375, height: 812 },
  { width: 360, height: 800 },
  { width: 375, height: 667 },
  { width: 360, height: 640 },
] as const;

type State = 'ready' | 'held';
const STATES: readonly State[] = ['ready', 'held'];

/** The fewest card rows each state may draw. */
const MIN_ROWS: Record<State, number> = { ready: 2, held: 0 };

/** Room the first way in keeps under the card (0176, target 6). */
const CARD_CLEARANCE = 12;

/** Half a pixel, for subpixel layout. */
const EPSILON = 0.5;

interface Measured {
  readonly problems: readonly string[];
  readonly rows: number;
  readonly cardDrawn: boolean;
}

/**
 * Everything 0176 checks, measured in one pass in the page. Each problem names the
 * element (its class or role and text) and by how many pixels it overflowed.
 */
function measure(page: Page): Promise<Measured> {
  return page.evaluate(
    ({ clearance, epsilon }) => {
      const problems: string[] = [];
      const width = window.innerWidth;
      const height = window.innerHeight;

      const name = (element: Element): string => {
        const role = element.getAttribute('role');
        const classes =
          typeof element.className === 'string' && element.className.trim()
            ? `.${element.className.trim().split(/\s+/).join('.')}`
            : '';
        const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ');
        return `<${element.tagName.toLowerCase()}${classes}${
          role ? ` role=${role}` : ''
        }> "${text.slice(0, 40)}"`;
      };

      const visible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          return false;
        }
        const style = getComputedStyle(element);
        return style.visibility !== 'hidden' && style.display !== 'none';
      };

      const px = (value: number) => `${Math.ceil(value)} px`;

      // The page scrolls nowhere: not in the slot that is the scroller, not the document.
      const scrollers: [string, Element | null][] = [
        ['.app-page', document.querySelector('.app-page')],
        ['the document', document.scrollingElement],
      ];
      for (const [label, scroller] of scrollers) {
        if (scroller && scroller.scrollHeight > scroller.clientHeight) {
          problems.push(
            `${label} scrolls by ${px(
              scroller.scrollHeight - scroller.clientHeight
            )}`
          );
        }
      }

      const page = document.querySelector('lib-landing-page .page');
      if (!page) {
        return { problems: ['no landing page'], rows: 0, cardDrawn: false };
      }

      // The foot, and each of its items, wholly on screen.
      const foot = page.querySelector('.foot');
      const footItems = [
        foot,
        ...Array.from(page.querySelectorAll('.foot a, .foot lib-app-version')),
      ];
      if (footItems.length < 4) {
        problems.push(
          `the foot has ${footItems.length - 1} items, not privacy, terms and the version`
        );
      }
      for (const element of footItems) {
        if (!element) {
          problems.push('no foot');
          continue;
        }
        const rect = element.getBoundingClientRect();
        if (rect.bottom > height + epsilon) {
          problems.push(
            `${name(element)} ends ${px(rect.bottom - height)} below the screen`
          );
        }
        if (rect.top < -epsilon) {
          problems.push(
            `${name(element)} starts ${px(-rect.top)} above the screen`
          );
        }
      }

      // Nothing visible lies outside the screen sideways.
      for (const element of Array.from(page.querySelectorAll('*'))) {
        if (!visible(element)) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        if (rect.left < -epsilon) {
          problems.push(
            `${name(element)} starts ${px(-rect.left)} left of the screen`
          );
        } else if (rect.right > width + epsilon) {
          problems.push(
            `${name(element)} ends ${px(rect.right - width)} right of the screen`
          );
        }
      }

      // Nothing that is read is cut. The card's names and second lines are left out:
      // they end in an ellipsis on purpose.
      const read = page.querySelectorAll(
        [
          'button',
          'a',
          'h1 > *',
          '.terms-line',
          '.held-message',
          '.explainer',
          '.foot lib-app-version',
        ].join(', ')
      );
      for (const element of Array.from(read)) {
        if (!visible(element) || element.clientWidth === 0) {
          continue;
        }
        if (element.scrollWidth > element.clientWidth + epsilon) {
          problems.push(
            `${name(element)} is cut by ${px(
              element.scrollWidth - element.clientWidth
            )}`
          );
        }
      }

      // The card, when it is drawn.
      const card = page.querySelector('lib-list-preview-card .card');
      const cardDrawn = card !== null && visible(card);
      const rows = Array.from(
        page.querySelectorAll('[data-preview-row]')
      ).filter(visible);

      if (cardDrawn && card) {
        const firstWay = page.querySelector('lib-auth-actions button');
        if (firstWay) {
          const gap =
            firstWay.getBoundingClientRect().top -
            card.getBoundingClientRect().bottom;
          if (gap < clearance - epsilon) {
            problems.push(
              `the first way in is ${px(gap)} under the card, not ${clearance} px`
            );
          }
        }
      }

      // Every row drawn is wholly inside the card's slot, so none is half cut.
      const slot = page.querySelector('lib-list-preview-card');
      if (slot) {
        const bottom = slot.getBoundingClientRect().bottom;
        for (const row of rows) {
          const over = row.getBoundingClientRect().bottom - bottom;
          if (over > epsilon) {
            problems.push(
              `${name(row)} is cut by the card's slot by ${px(over)}`
            );
          }
        }
      }

      // The count describes the rows drawn, never the hidden ones (0175, target 6).
      const tallies = Array.from(page.querySelectorAll('[data-rows]')).filter(
        visible
      );
      if (rows.length > 0) {
        if (tallies.length !== 1) {
          problems.push(`${tallies.length} counts are visible, not one`);
        } else {
          const tally = tallies[0] as HTMLElement;
          const pending = rows.filter(
            (row) => !row.hasAttribute('data-settled')
          ).length;
          const saysRows = Number(tally.dataset['rows']);
          const saysPending = Number(tally.dataset['pending']);
          const text = tally.textContent ?? '';
          if (saysRows !== rows.length || saysPending !== pending) {
            problems.push(
              `the count says ${saysPending} of ${saysRows}, the card draws ${pending} of ${rows.length}`
            );
          }
          if (
            !text.includes(String(saysRows)) ||
            !text.includes(String(saysPending))
          ) {
            problems.push(
              `the count "${text.trim()}" does not say its numbers`
            );
          }
        }
      }

      return { problems, rows: rows.length, cardDrawn };
    },
    { clearance: CARD_CLEARANCE, epsilon: EPSILON }
  );
}

/** The locales a person can pick, read from the language control on `/en`. */
async function offeredLocales(page: Page): Promise<string[]> {
  await page.goto('/en');
  await page.locator('.locale').click();

  const items = page.locator('.menu [role="menuitem"]');
  await expect(items.first()).toBeVisible();

  const codes = (await items.allInnerTexts()).map((text) =>
    text.trim().toLowerCase()
  );
  await page.keyboard.press('Escape');

  return codes;
}

/**
 * Waits for what changes the page's height and nothing else: the headline, the fonts,
 * the pictures of the card (a photo loaded or failed, or the glyph drawn), and the
 * state's own sentence or terms line. No fixed sleeps.
 */
async function settle(page: Page, state: State): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  if (state === 'ready') {
    // Google and the terms line are what make this the tallest normal state.
    await expect(page.locator('lib-auth-actions .google')).toBeVisible();
    await expect(page.locator('lib-auth-actions .terms-line')).toBeVisible();
    await expect(
      page.locator('lib-auth-actions button').first()
    ).not.toHaveAttribute('aria-disabled', 'true');
  } else {
    // The connecting sentence first, then the slow one after the wall clock delay of
    // plan 0071 D8. The installed clock moves past it rather than waiting for it, in
    // small steps: a jump past the probe's own deadline would leave this screen.
    const sentence = page.locator('lib-auth-actions .held-message');
    await expect(sentence).toBeVisible();
    const connecting = (await sentence.innerText()).trim();
    await expect
      .poll(async () => {
        await page.clock.runFor(250);
        return (await sentence.innerText()).trim();
      })
      .not.toBe(connecting);
  }

  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect
    .poll(() =>
      page.evaluate(() =>
        Array.from(
          document.querySelectorAll('lib-list-preview-card lib-product-picture')
        ).every((picture) => {
          const image = picture.querySelector('img');
          return image ? image.complete : picture.querySelector('svg') !== null;
        })
      )
    )
    .toBe(true);
}

test.describe('landing-fit: the front door is one screen in every language', () => {
  // eslint-disable-next-line playwright/no-skipped-test -- the desktop projects have no phone to check
  test.skip(
    ({ isMobile }) => !isMobile,
    'Phone sizes only: the desktop projects have no phone to check, and landscape and desktop are outside 0176.'
  );

  for (const state of STATES) {
    for (const size of SIZES) {
      const label = `${size.width}x${size.height} ${state}`;

      test(label, async ({ page }) => {
        if (state === 'ready') {
          await stubBackendReady(page, STUB_LEGAL_SETTINGS);
        } else {
          await stubBackendUnreachable(page);
          await page.clock.install();
        }
        await page.setViewportSize(size);

        const locales = await offeredLocales(page);
        expect(
          locales.length,
          'the language control offers a locale'
        ).toBeGreaterThan(0);
        console.log(
          `landing-fit ${label}: ${locales.length} locale(s), ${locales.join(', ')}`
        );

        for (const locale of locales) {
          await test.step(`${locale} ${label}`, async () => {
            await page.goto(`/${locale}`);
            await settle(page, state);

            const measured = await measure(page);

            expect
              .soft(measured.problems, `${locale} ${label}: what overflowed`)
              .toEqual([]);

            // At least two rows in the normal state. The held state may give the whole
            // card up to its sentence (0175, target 7).
            expect
              .soft(measured.rows, `${locale} ${label}: rows drawn`)
              .toBeGreaterThanOrEqual(MIN_ROWS[state]);
          });
        }
      });
    }
  }
});
