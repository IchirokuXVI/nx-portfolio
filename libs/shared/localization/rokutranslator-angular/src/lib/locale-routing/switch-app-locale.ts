import { writeAppLocale } from './app-locale-storage';

/**
 * Post-render locale switch, triggered by a user from a language switcher.
 *
 * Persists the choice for the app, then navigates to the same URL with the
 * locale segment replaced, doing a **full page reload**. The reload is
 * intentional (see 0002): localized data (in-memory / backend tables keyed on
 * `RokuTranslator.getLocale()`) must be re-fetched, and it is only ever used
 * after the page has rendered, never during pre-render correction.
 */
export function switchAppLocale(appKey: string, locale: string): void {
  writeAppLocale(appKey, locale);

  if (typeof window === 'undefined') {
    return;
  }

  const url = new URL(window.location.href);
  const segments = url.pathname.split('/').filter(Boolean);

  if (segments.length > 0) {
    segments[0] = locale;
  } else {
    segments.push(locale);
  }

  url.pathname = '/' + segments.join('/');
  window.location.href = url.toString();
}
