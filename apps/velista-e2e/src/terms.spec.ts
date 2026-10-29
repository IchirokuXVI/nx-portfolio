import { expect, test, type Page, type Route } from '@playwright/test';
import { STUB_LEGAL_SETTINGS, stubBackendReady } from './support/gateway';

/**
 * Accepting the terms (velista `0173`, section 4.2), against a stubbed gateway.
 *
 * What this proves that no unit test can: the prompt really stands in place of the
 * page for a signed in account that owes the current version, the terms page opens
 * under it and the prompt stands down there, one press posts the version and takes the
 * prompt away, and the register form refuses a clear box without sending anything.
 */

const VERSION = STUB_LEGAL_SETTINGS.terms.version;

/** A token the app reads as valid for an hour, so nothing is refreshed. */
function token(): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${encode({ alg: 'RS256' })}.${encode({ exp, sub: 'u-e2e' })}.sig`;
}

/** Signed in as a registered account, before the app starts. */
async function signedIn(page: Page): Promise<void> {
  const pair = {
    userId: 'u-e2e',
    kind: 'REGISTERED',
    username: 'Marta',
    accessToken: token(),
    refreshToken: 'refresh-e2e',
  };
  await page.addInitScript((value) => {
    window.localStorage.setItem('session:velista', value);
  }, JSON.stringify(pair));
}

/**
 * Answer a gateway route, preflight included: the gateway is another origin, and a
 * request with a bearer is preflighted.
 */
function answer(route: Route, status: number, body: unknown): Promise<void> {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE',
  };
  if (route.request().method() === 'OPTIONS') {
    return route.fulfill({ status: 204, headers: cors });
  }
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: cors,
    body: JSON.stringify(body),
  });
}

/** Every other gateway route answers an empty page, so nothing reads as offline. */
async function quietGateway(page: Page): Promise<void> {
  await page.route('**/v1/**', (route: Route) =>
    answer(route, 200, { items: [], nextCursor: null })
  );
}

/** `GET /v1/account/me`, owing the terms until `accepted` says otherwise. */
async function stubProfile(page: Page, accepted: () => boolean): Promise<void> {
  await page.route('**/v1/account/me', (route: Route) =>
    answer(route, 200, {
      userId: 'u-e2e',
      kind: 'REGISTERED',
      username: 'Marta',
      email: 'marta@example.org',
      emailVerified: true,
      displayName: null,
      appState: {
        setupCompletedAt: '2026-10-01T10:00:00.000Z',
        tourSeenAt: '2026-10-01T10:00:00.000Z',
      },
      permissions: [],
      terms: {
        currentVersion: VERSION,
        acceptedVersion: accepted() ? VERSION : null,
        acceptanceRequired: !accepted(),
      },
    })
  );
}

test.describe('accepting the terms', () => {
  test('the prompt stands in place of home until the account accepts', async ({
    page,
  }) => {
    let accepted = false;
    const posted: unknown[] = [];

    await quietGateway(page);
    await stubBackendReady(page, {
      ...STUB_LEGAL_SETTINGS,
      terms: { ...STUB_LEGAL_SETTINGS.terms, acceptanceRequired: true },
    });
    await stubProfile(page, () => accepted);
    await page.route('**/v1/account/terms-acceptances', (route: Route) => {
      if (route.request().method() === 'POST') {
        posted.push(route.request().postDataJSON());
        accepted = true;
      }
      return answer(route, 201, {
        version: VERSION,
        acceptedAt: new Date().toISOString(),
      });
    });
    await signedIn(page);

    await page.goto('/en/home');

    const prompt = page.locator('lib-terms-prompt');
    await expect(
      prompt.getByRole('heading', { name: 'Before you go on' })
    ).toBeVisible();
    await expect(page.locator('lib-app-nav')).toHaveCount(0);

    // The terms open as their page, under the prompt, which stands down there.
    await prompt.getByRole('link', { name: 'Terms of Service' }).click();
    await expect(page).toHaveURL(/\/en\/terms$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Terms of Service' })
    ).toBeVisible();
    await expect(prompt).toHaveCount(0);

    await page.goBack();
    await expect(
      prompt.getByRole('button', { name: 'Accept and continue' })
    ).toBeVisible();

    await prompt.getByRole('button', { name: 'Accept and continue' }).click();

    await expect(prompt).toHaveCount(0);
    expect(posted).toEqual([{ version: VERSION }]);
  });

  test('register with the box clear says so and sends nothing', async ({
    page,
  }) => {
    const sent: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/v1/auth/register')) {
        sent.push(request.method());
      }
    });

    await quietGateway(page);
    await stubBackendReady(page);
    await page.goto('/en/auth/register');

    await page.locator('#register-email').fill('marta@example.org');
    await page.locator('#register-password').fill('password123');
    await page.locator('#register-confirm-password').fill('password123');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(
      page.getByText('Tick the box to accept the Terms')
    ).toBeVisible();
    await expect(page.locator('#register-terms')).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    await expect(page.locator('#register-terms')).toBeFocused();
    expect(sent).toEqual([]);
  });
});
