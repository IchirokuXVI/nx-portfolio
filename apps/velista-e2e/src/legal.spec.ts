import { expect, test } from '@playwright/test';
import { STUB_LEGAL_SETTINGS, stubBackendReady } from './support/gateway';

/**
 * The privacy policy and the terms (velista `0172`, target 10), opened by somebody with
 * no session, which is how Google's review opens them.
 *
 * The gateway is stubbed: the health route and backend `0231`'s settings route answer
 * an invented deployment. What this proves that no unit test can is the real route
 * table (no guard sends a signed out reader to a sign in screen), the real lazy chunk of
 * one document in one language, and the real startup gate letting the page through.
 */
test.describe('the legal pages', () => {
  test('the English privacy policy opens signed out, filled with the operator', async ({
    page,
  }) => {
    await stubBackendReady(page);
    await page.goto('/en/privacy');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Privacy Policy' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Who we are' })
    ).toBeVisible();
    await expect(page.getByText('Example Controller').first()).toBeVisible();
    await expect(page).toHaveURL(/\/en\/privacy$/);
    await expect(page.locator('#sign-in-email')).toHaveCount(0);
  });

  test('the Spanish terms open signed out, in Spanish', async ({ page }) => {
    await stubBackendReady(page);
    await page.goto('/es/terms');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Condiciones del servicio' })
    ).toBeVisible();
    await expect(page.getByText('Example Controller').first()).toBeVisible();
    await expect(page).toHaveURL(/\/es\/terms$/);
    await expect(page.locator('#sign-in-email')).toHaveCount(0);
  });

  test('a deployment with no transcriber says nothing about voice', async ({
    page,
  }) => {
    await stubBackendReady(page, {
      ...STUB_LEGAL_SETTINGS,
      features: { ...STUB_LEGAL_SETTINGS.features, transcription: false },
    });
    await page.goto('/en/privacy');

    await expect(
      page.getByRole('heading', { level: 2, name: 'Who we are' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Voice', exact: true })
    ).toHaveCount(0);
  });

  test('the front door links both, signed out', async ({ page }) => {
    await stubBackendReady(page);
    await page.goto('/en');

    // At the foot, beside the version, under the ways in: on a short phone the
    // reader scrolls to it, as to the version.
    const privacy = page.getByRole('link', { name: 'Privacy', exact: true });
    await privacy.scrollIntoViewIfNeeded();
    await expect(privacy).toBeInViewport();
    await expect(
      page.getByRole('link', { name: 'Terms', exact: true })
    ).toBeVisible();

    await privacy.click();
    await expect(page).toHaveURL(/\/en\/privacy$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Privacy Policy' })
    ).toBeVisible();
  });
});
