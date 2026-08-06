import { expect, test } from '@playwright/test';

/**
 * Verifies the damoclesSword Services page: all five sections render (through
 * the shell, the only place a remote mounts), and the shared contact form
 * validates before it accepts a submission.
 *
 * Navigates to `${baseURL}/services`; `baseURL` already points at the shell's
 * `/<locale>/damoclesSword` entry (see playwright.config.ts / BASE_URL).
 */

const SECTIONS = [
  'lib-damocles-sword-section-what-we-do',
  'lib-damocles-sword-section-how-we-work',
  'lib-damocles-sword-section-where-we-fit',
  'lib-damocles-sword-section-projects-detailed',
  'lib-damocles-sword-section-services-contact',
];

test.beforeEach(async ({ page, baseURL }) => {
  expect(
    baseURL,
    'baseURL must be configured in playwright.config.ts'
  ).toBeTruthy();
  await page.goto(`${baseURL}/services`);
  // The remote mounts lazily through the shell; wait for the first section.
  await page
    .locator(SECTIONS[0])
    .waitFor({ state: 'attached', timeout: 30000 });
});

test('renders all five services sections', async ({ page }) => {
  for (const selector of SECTIONS) {
    await expect(page.locator(selector)).toBeVisible();
  }
});

test('shows the detailed project cards with their tag chips', async ({
  page,
}) => {
  const projects = page.locator(
    'lib-damocles-sword-section-projects-detailed .detailed-project-card'
  );
  await expect(projects).toHaveCount(2);
  // Each card carries the four tag chips (platform / engine / sector / experience).
  await expect(
    page.locator(
      'lib-damocles-sword-section-projects-detailed .detailed-project-card .tag-chip'
    )
  ).toHaveCount(8);
});

test('the contact form validates before it accepts a submission', async ({
  page,
}) => {
  const form = page.locator(
    'lib-damocles-sword-section-services-contact lib-damocles-sword-contact-form'
  );
  await expect(form).toBeVisible();

  // Submitting empty surfaces the required-field errors and does not succeed.
  await form.getByRole('button').click();
  await expect(form.locator('.field-error').first()).toBeVisible();
  await expect(form.locator('.contact-form-success')).toHaveCount(0);

  // A valid email + message clears validation and shows the success message.
  await form.locator('#contact-email').fill('tester@example.com');
  await form.locator('#contact-message').fill('We would like a VR demo.');
  await form.getByRole('button').click();

  await expect(form.locator('.contact-form-success')).toBeVisible({
    timeout: 10000,
  });
});
