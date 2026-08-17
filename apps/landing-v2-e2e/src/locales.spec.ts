import { expect, Page, test } from '@playwright/test';
import {
  documentWidths,
  findRawKeys,
  settle,
  usableLocales,
} from './support/locale-helpers';

/**
 * Cross-language coverage for the landingV2 landing page. These checks are
 * locale-affected, so they run for every usable locale (discovered live from the
 * switcher). Language-agnostic checks live in the other specs and run once.
 */

const OVERFLOW_TOLERANCE_PX = 1;

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

  test('no horizontal overflow in any locale (mobile + desktop)', async ({
    page,
  }) => {
    const locales = await discoverLocales(page);
    const viewports = [
      { name: 'mobile', width: 360, height: 780 },
      { name: 'desktop', width: 1440, height: 900 },
    ];

    for (const locale of locales) {
      for (const vp of viewports) {
        await test.step(`"${locale}" @ ${vp.name}`, async () => {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await page.goto(`/${locale}`);
          await settle(page);

          const { scrollWidth, clientWidth } = await documentWidths(page);
          expect
            .soft(
              scrollWidth,
              `Content wider than viewport in "${locale}" @ ${vp.name} ` +
                `(scrollWidth=${scrollWidth} clientWidth=${clientWidth})`
            )
            .toBeLessThanOrEqual(clientWidth + OVERFLOW_TOLERANCE_PX);
        });
      }
    }
  });
});
