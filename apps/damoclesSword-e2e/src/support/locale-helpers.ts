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

/** This app's mount, which every URL here carries ahead of the locale. */
const MOUNT = 'damoclesSword';

/**
 * The locale of the current URL, which is the segment **after** the mount
 * (`/damoclesSword/en`) rather than the leading one.
 *
 * Reading segment 0 is what this did before, and it survived the plan 0003
 * reorder unnoticed because nothing here asserts the locale directly: it
 * returned `damoclesSword`, which matches no locale, so the caller picked the
 * locale it was already on and switched `en` to `en`. The URL assertion then
 * passed trivially and the spec failed on the content comparison instead,
 * reporting a page that had genuinely not changed.
 *
 * The identical helper in `landing-v2-e2e` still reads segment 0 and is right
 * to: landingV2 mounts at the empty path, so there the locale really does lead.
 */
export function currentUrlLocale(page: Page): string {
  const segments = new URL(page.url()).pathname.split('/').filter(Boolean);

  return (segments[0] === MOUNT ? segments[1] : segments[0]) ?? '';
}

/**
 * The locales the damoclesSword language switcher offers — read live from the
 * rendered options (they exist in the DOM even while the dropdown is closed), so
 * the tests cover exactly the app's enabled set and never need editing when a
 * language is added or removed. The header renders breakpoint variants, so the
 * list is de-duplicated.
 */
export async function usableLocales(page: Page): Promise<string[]> {
  const options = page.locator(
    'lib-damocles-sword-language-selector .selectable-languages button'
  );

  // The switcher belongs to the lazily mounted remote, and `settle`'s quiet
  // window can close before that remote attaches. Reading the options right
  // then yields an empty list, which callers report as "no usable locales"
  // rather than as the slow load it actually is. Wait for the first option to
  // exist. A page that genuinely has no switcher still resolves to [] once the
  // wait elapses, so this only removes the race, not a real assertion.
  await options
    .first()
    .waitFor({ state: 'attached' })
    .catch(() => undefined);

  const texts = await options.allInnerTexts();

  // Lowercase the codes: the options can render uppercase via CSS text-transform
  // (which `innerText` reflects when they are visible), but locale codes are
  // canonically lowercase (as is the URL segment), so callers can compare them
  // directly against the URL locale.
  return [
    ...new Set(
      texts
        .map((t) => t.trim().toLowerCase())
        .filter((t) => LOCALE_SEGMENT.test(t))
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
    const keyLike =
      /^[a-z][a-z0-9]*([_-][a-z0-9]+)*(\.[a-z0-9]+([_-][a-z0-9]+)*)+$/i;
    const fileExt =
      /\.(html?|json|svg|png|jpe?g|webp|pdf|css|m?js|ts|ico|woff2?)$/i;
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
