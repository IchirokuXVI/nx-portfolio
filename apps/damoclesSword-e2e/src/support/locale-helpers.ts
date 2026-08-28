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
      let observer: MutationObserver | undefined;

      const quietDom = new Promise<void>((resolve) => {
        let quiet = setTimeout(resolve, 400);
        observer = new MutationObserver(() => {
          clearTimeout(quiet);
          quiet = setTimeout(resolve, 400);
        });
        observer.observe(document.body, { childList: true, subtree: true });
      });

      // One budget covers the whole wait, fonts included. `document.fonts.ready`
      // has no timeout of its own and never rejects, so a font request that goes
      // out and never comes back (a host the runner cannot reach, most likely)
      // parks this evaluate until the *test* timeout fires. The cap used to sit
      // on the quiet window alone, which left the fonts await ahead of it
      // completely unbounded, and a suite stuck that way reads as a hang rather
      // than as a slow page.
      const budget = new Promise<void>((resolve) => setTimeout(resolve, 8000));

      await Promise.race([budget, document.fonts.ready.then(() => quietDom)]);
      observer?.disconnect();
    })
    .catch(() => undefined);
}

/**
 * `document.fonts.ready`, bounded, for the specs that want the webfonts applied
 * but not the DOM quiet window that `settle` adds. The bound is the point: see
 * the note in `settle`.
 */
export async function fontsReady(page: Page): Promise<void> {
  await page
    .evaluate(async () => {
      await Promise.race([
        document.fonts.ready.then(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
    })
    .catch(() => undefined);
}

/** Where this app is mounted, and so how many segments precede its locale. */
export const MOUNT = '/damoclesSword';

/**
 * The locale segment of the current URL, which sits directly **after** the
 * mount: `/damoclesSword/en`, not `/en/damoclesSword`.
 *
 * Reading segment 0 was correct until plan 0003 swapped that order, after which
 * it returned `damoclesSword` and every caller compared a locale against the
 * mount name. `language-switch.spec.ts` then picked `en` as the locale to switch
 * *to* while already on `en`, "switched" the page to the language it was
 * showing, and failed on the content having not changed, which looked like an
 * app defect and was not.
 *
 * The identical helper in apps/landing-v2-e2e is right as written: landingV2
 * mounts at the empty path, so segment 0 genuinely is its locale.
 */
export function currentUrlLocale(page: Page, mount: string = MOUNT): string {
  const segments = new URL(page.url()).pathname.split('/').filter(Boolean);
  const depth = mount.split('/').filter(Boolean).length;
  return segments[depth] ?? '';
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
