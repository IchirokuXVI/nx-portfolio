import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { readAppLocale } from './app-locale-storage';

/** Last-resort locale when nothing else resolves. */
const FALLBACK_LOCALE = 'en';

function fmt(locale: string | null | undefined): string {
  return locale ? RokuTranslator.formatLocale(locale) : '';
}

/** First browser locale, formatted, without any supported-list filtering. */
function detectBrowserLocale(): string {
  if (typeof navigator === 'undefined') {
    return '';
  }

  const langs =
    navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language];

  return fmt(langs[0]);
}

/**
 * Phase 2 (post-load): pick the locale for an app given its real supported set.
 * Order: a valid URL locale wins; otherwise prefer the app's last-used locale,
 * then the browser locale, then the default. This keeps a user's explicit URL
 * choice while respecting their prior selection over any fallback (see 0002 O4).
 */
export function resolveDesiredLocale(params: {
  urlLocale: string | null | undefined;
  appKey: string;
  supportedLocales: readonly string[];
  defaultLocale?: string;
}): string {
  const supported = params.supportedLocales.map((l) => fmt(l));
  const isSupported = (locale: string) => !!locale && supported.includes(locale);

  const url = fmt(params.urlLocale);
  if (isSupported(url)) {
    return url;
  }

  const stored = fmt(readAppLocale(params.appKey));
  if (isSupported(stored)) {
    return stored;
  }

  const browser = detectBrowserLocale();
  if (isSupported(browser)) {
    return browser;
  }

  return fmt(params.defaultLocale) || supported[0] || FALLBACK_LOCALE;
}

/**
 * Phase 1 (pre-load): best-guess locale to add to a locale-less URL before the
 * target app is loaded. Unvalidated (the app's locales are not known yet); the
 * correction guard validates it once the app loads.
 */
export function resolveGuessLocale(appKey: string): string {
  const stored = fmt(readAppLocale(appKey));
  if (stored) {
    return stored;
  }

  const browser = detectBrowserLocale();
  if (browser) {
    return browser;
  }

  return FALLBACK_LOCALE;
}
