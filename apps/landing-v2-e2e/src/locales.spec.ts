import { expect, Page, test } from '@playwright/test';
import { findRawKeys, settle, usableLocales } from './support/locale-helpers';

/**
 * Cross-language coverage for the landingV2 landing page. These checks are
 * locale-affected, so they run for every usable locale (discovered live from the
 * switcher). Language-agnostic checks live in the other specs and run once.
 *
 * Horizontal overflow per locale is not checked here: no-horizontal-scroll.spec
 * already crawls every route, at every viewport, in every locale.
 */

async function discoverLocales(page: Page) {
  await page.goto('/en');
  await settle(page);
  return usableLocales(page);
}

test.describe('landingV2 localization', () => {
  test('every locale renders translated (no raw keys) and distinct content', async ({
    page,
  }) => {
    const locales = await discoverLocales(page);
    expect(locales.length, 'expected at least one usable locale').toBeGreaterThan(
      0
    );

    const signatures = new Map<string, string>();

    for (const locale of locales) {
      await test.step(`locale "${locale}"`, async () => {
        await page.goto(`/${locale}`);
        await settle(page);

        const rawKeys = await findRawKeys(page);
        expect
          .soft(
            rawKeys,
            `Untranslated i18n keys visible in "${locale}": ${rawKeys.join(', ')}`
          )
          .toEqual([]);

        signatures.set(
          locale,
          await page.evaluate(() => document.body.innerText)
        );
      });
    }

    const seen = new Map<string, string>();
    for (const [locale, text] of signatures) {
      const clash = [...seen.entries()].find(([, t]) => t === text);
      expect
        .soft(clash, `"${locale}" renders identical content to "${clash?.[0]}"`)
        .toBeUndefined();
      seen.set(locale, text);
    }
  });
});
