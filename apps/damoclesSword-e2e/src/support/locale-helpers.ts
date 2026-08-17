import { Page } from '@playwright/test';

/** A well-formed locale segment, matching the shell's locale-route regex. */
export const LOCALE_SEGMENT = /^[a-z]{2}(-[a-z]{2})?$/i;

/**
 * Wait for the lazy-loaded remote and web fonts to settle before asserting.
 * Same render-idle signal the other damoclesSword specs use: fonts ready plus a
 * quiet window with no structural DOM mutations.
 */
export async function settle(page: Page): Promise<void> {
  await page
    .evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => {
        let quiet = setTimeout(resolve, 400);
        const observer = new MutationObserver(() => {
          clearTimeout(quiet);
          quiet = setTimeout(resolve, 400);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
          observer.disconnect();
          resolve();
        }, 8000);
      });
    })
    .catch(() => undefined);
}

/** The locale in the first path segment of the current URL. */
export function currentUrlLocale(page: Page): string {
  return new URL(page.url()).pathname.split('/').filter(Boolean)[0] ?? '';
}

/**
 * The locales the damoclesSword language switcher offers — read live from the
 * rendered options (they exist in the DOM even while the dropdown is closed), so
 * the tests cover exactly the app's enabled set and never need editing when a
 * language is added or removed. The header renders breakpoint variants, so the
 * list is de-duplicated.
 */
export async function usableLocales(page: Page): Promise<string[]> {
  const texts = await page
    .locator(
      'lib-damocles-sword-language-selector .selectable-languages button'
    )
    .allInnerTexts();

  return [
    ...new Set(
      texts.map((t) => t.trim()).filter((t) => LOCALE_SEGMENT.test(t))
    ),
  ];
}

/**
 * Visible text that looks like an untranslated i18n key (a dotted lowercase
 * identifier such as `nav.home`), which is what i18next renders on a missing
 * key. URLs, file names, numbers and code are excluded to avoid false positives.
 */
export async function findRawKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const keyLike = /^[a-z][a-z0-9]*([_-][a-z0-9]+)*(\.[a-z0-9]+([_-][a-z0-9]+)*)+$/i;
    const fileExt = /\.(html?|json|svg|png|jpe?g|webp|pdf|css|m?js|ts|ico|woff2?)$/i;
    const offenders = new Set<string>();
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT
    );

    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = (node.textContent || '').trim();
      if (!text || text.includes(' ')) continue;

      const parent = node.parentElement;
      if (!parent || parent.closest('a, code, pre, script, style')) continue;

      if (fileExt.test(text)) continue; // asset file name
      if (/^\d/.test(text)) continue; // number / version
      if (/[/@:]/.test(text)) continue; // url / email / time

      if (keyLike.test(text)) offenders.add(text);
    }

    return Array.from(offenders);
  });
}

/** scrollWidth vs clientWidth of the document, for a horizontal-overflow check. */
export function documentWidths(
  page: Page
): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
}
