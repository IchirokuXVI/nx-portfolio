import { expect, test } from './support/fixtures';
import { findRawKeys, settle, usableLocales } from './support/locale-helpers';

/**
 * Cross-language coverage for damoclesSword. These checks are locale-affected, so
 * they run for every usable locale (discovered live from the switcher). Checks
 * that are not language-specific live in the other specs and run once.
 *
 * Horizontal overflow per locale is not checked here: no-horizontal-scroll.spec
 * already crawls every route, at every viewport, in every locale.
 */

const PATH = '/damoclesSword';

async function discoverLocales(page: import('@playwright/test').Page) {
  await page.goto(`${PATH}/en`);
  await settle(page);
  return usableLocales(page);
}

test.describe('damoclesSword localization', () => {
  test('every locale renders translated (no raw keys) and distinct content', async ({
    page,
  }) => {
    const locales = await discoverLocales(page);
    expect(
      locales.length,
      'expected at least one usable locale'
    ).toBeGreaterThan(0);

    const signatures = new Map<string, string>();

    for (const locale of locales) {
      await test.step(`locale "${locale}"`, async () => {
        await page.goto(`${PATH}/${locale}`);
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

    // Each locale should render different copy (a switch that silently no-ops, or
    // a locale that falls back to another, would collide here).
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
