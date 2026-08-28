import { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { fontsReady } from './support/locale-helpers';

/**
 * Contact page (damoclesSword) checks:
 *
 *  1. All three bands render — publishing, hiring, general contact.
 *  2. Both contact forms validate (required fields block submit) and surface the
 *     mocked success message once filled in and submitted.
 *  3. The Meta / Steam platform icons show on the publishing game card.
 *  4. The vacancies table never forces a horizontal page scroll, even on a
 *     narrow mobile viewport (it scrolls inside its own wrapper instead).
 */

const PUBLISHING = 'lib-damocles-sword-section-publishing';
const HIRING = 'lib-damocles-sword-section-hiring';
const GENERAL = 'lib-damocles-sword-section-general-contact';
const FORM = 'lib-damocles-sword-contact-form';

const TOLERANCE_PX = 1;

function contactUrl(baseURL: string | undefined): string {
  return `${(baseURL as string).replace(/\/$/, '')}/contact`;
}

/** Wait for the lazily mounted remote's contact sections to attach. */
async function gotoContact(page: Page, baseURL: string | undefined) {
  await page.goto(contactUrl(baseURL));
  await page.locator(PUBLISHING).waitFor({ state: 'attached', timeout: 30000 });
  await fontsReady(page);
}

test('renders the three contact sections', async ({ page, baseURL }) => {
  await gotoContact(page, baseURL);

  await expect(page.locator(PUBLISHING)).toBeVisible();
  await expect(page.locator(HIRING)).toBeVisible();
  await expect(page.locator(GENERAL)).toBeVisible();
});

test('publishing card shows the Meta and Steam icons', async ({
  page,
  baseURL,
}) => {
  await gotoContact(page, baseURL);

  await expect(page.locator(`${PUBLISHING} lib-meta-icon`)).toHaveCount(1);
  await expect(page.locator(`${PUBLISHING} lib-steam-icon`)).toHaveCount(1);
});

test('publishing form validates and shows the success message', async ({
  page,
  baseURL,
}) => {
  await gotoContact(page, baseURL);

  const form = page.locator(`${PUBLISHING} ${FORM}`);
  const success = form.locator('.contact-form-success');

  // Submitting empty keeps the success hidden (required fields block it).
  await form.getByRole('button').click();
  await expect(success).toHaveCount(0);

  await form.locator('input[type="email"]').fill('publisher@example.com');
  await form.locator('textarea').fill('We would like to publish your game.');
  await form.getByRole('button').click();

  await expect(success).toBeVisible();
});

test('general form validates and shows the success message', async ({
  page,
  baseURL,
}) => {
  await gotoContact(page, baseURL);

  const form = page.locator(`${GENERAL} ${FORM}`);
  const success = form.locator('.contact-form-success');

  await form.getByRole('button').click();
  await expect(success).toHaveCount(0);

  await form.locator('input[type="email"]').fill('hello@example.com');
  await form.locator('textarea').fill('Just saying hello.');
  await form.getByRole('button').click();

  await expect(success).toBeVisible();
});

test('vacancies table does not cause horizontal page scroll on mobile', async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await gotoContact(page, baseURL);

  await expect(page.locator(`${HIRING} table`)).toBeVisible();

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  expect(
    scrollWidth,
    `Page scrolls horizontally: scrollWidth=${scrollWidth} clientWidth=${clientWidth}`
  ).toBeLessThanOrEqual(clientWidth + TOLERANCE_PX);
});
