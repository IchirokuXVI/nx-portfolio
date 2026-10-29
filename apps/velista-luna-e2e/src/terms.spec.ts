import { expect, request, test, type Page } from '@playwright/test';
import { GATEWAY_URL } from '../playwright.config';
import {
  accountTerms,
  legalSettings,
  Session,
  type AccountTermsView,
} from './support/api';
import { newVisitor } from './support/app';

/**
 * Accepting the terms against the real backend (velista `0173`, section 4.2), with
 * acceptance on in the gate's compose (section 4.3).
 *
 * Every account the app makes carries the version the person accepted: an account
 * registered through the form with the box ticked, and the guest account a group
 * creates for somebody signed out. Each is read back over the gateway.
 */

/** A password the register form takes, for an account nobody else uses. */
const PASSWORD = 'terms-e2e-password';

/** `GET /v1/account/me` as whoever holds this access token. */
async function termsOf(
  accessToken: string,
  userId: string
): Promise<AccountTermsView> {
  const ctx = await request.newContext({
    baseURL: GATEWAY_URL,
    ignoreHTTPSErrors: true,
  });
  const session = new Session(ctx, userId, accessToken);
  try {
    return await accountTerms(session);
  } finally {
    await session.dispose();
  }
}

/** The pair this tab holds, read the way the app stores it. */
async function heldPair(
  page: Page
): Promise<{ userId: string; accessToken: string; kind: string }> {
  const raw = await page.evaluate(() =>
    window.localStorage.getItem('session:velista')
  );
  expect(raw, 'the app holds a session').not.toBeNull();
  return JSON.parse(raw as string) as {
    userId: string;
    accessToken: string;
    kind: string;
  };
}

test.describe('accepting the terms', () => {
  test('register with the box ticked makes an account that accepted them', async ({
    browser,
  }) => {
    const settings = await legalSettings();
    // A stack with no operator values publishes no terms, and nothing is accepted
    // there: the gate's own stack until the owner turns acceptance on (O1).
    // eslint-disable-next-line playwright/no-skipped-test -- skipped by the deployment, not by hand
    test.skip(
      !settings.published,
      'this deployment published no terms, so nothing is accepted'
    );

    const page = await newVisitor(browser);
    const email = `terms-${Date.now()}@example.org`;

    await page.goto('/en/auth/register');
    await page.locator('#register-email').fill(email);
    await page.locator('#register-password').fill(PASSWORD);
    await page.locator('#register-confirm-password').fill(PASSWORD);
    await page.locator('#register-terms').check();
    await page.getByRole('button', { name: 'Create account' }).click();

    // A new account goes on to the setup, which offers "Not now" (velista 0098).
    await expect(page).toHaveURL(/\/en\/(home|setup)\/?$/);

    const pair = await heldPair(page);
    expect(pair.kind).toBe('REGISTERED');
    const terms = await termsOf(pair.accessToken, pair.userId);
    expect(terms.acceptedVersion).toBe(settings.terms.version);
    expect(terms.acceptanceRequired).toBe(false);

    await page.context().close();
  });

  test('creating a group signed out says so, and the guest account accepted the terms', async ({
    browser,
  }) => {
    const settings = await legalSettings();
    // A stack with no operator values publishes no terms, and nothing is accepted
    // there: the gate's own stack until the owner turns acceptance on (O1).
    // eslint-disable-next-line playwright/no-skipped-test -- skipped by the deployment, not by hand
    test.skip(
      !settings.published,
      'this deployment published no terms, so nothing is accepted'
    );

    const page = await newVisitor(browser);
    await page.goto('/en');
    await page.getByRole('button', { name: 'Create a group' }).click();

    // The notice stands before the press (target 5).
    await expect(
      page.getByText(/we make an account for you on this phone/)
    ).toBeVisible();

    await page.locator('#create-zone-name').fill('Terms e2e');
    await page.getByRole('button', { name: 'Create group' }).click();
    await expect(page).toHaveURL(/\/en\/home\/?$/);
    await expect(page.getByText('Terms e2e').first()).toBeVisible();

    const pair = await heldPair(page);
    expect(pair.kind).toBe('TEMPORARY');
    const terms = await termsOf(pair.accessToken, pair.userId);
    expect(terms.acceptedVersion).toBe(settings.terms.version);
    expect(terms.acceptanceRequired).toBe(false);

    await page.context().close();
  });
});
