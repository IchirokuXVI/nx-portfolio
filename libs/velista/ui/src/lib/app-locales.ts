/**
 * The locales this app's UI can load (it ships translation assets for each). The
 * UI module registers these with `RokuTranslatorModule.withConfig`.
 *
 * Which are actually *usable* is the app layer's call: the feature-shell picks the
 * enabled subset (`APP_USABLE_LOCALES`), which drives the route-data guard and the
 * language switcher.
 *
 * These constants are deliberately unprefixed: rule N1 keeps the product name out
 * of code symbols, and the `@portfolio/velista/ui` import path already scopes them.
 *
 * `APP_KEY` namespaces the persisted locale (`roku-locale:{appKey}`), the theme choice
 * (plan 0002) and the session tokens (plan 0004). It now lives in `models` so the
 * layers below the presentation layer can namespace their own storage without
 * depending on it, and is re-exported here so this import site keeps working.
 */
export { APP_KEY } from '@portfolio/velista/models';

export const APP_AVAILABLE_LOCALES: string[] = ['en', 'es'];
export const APP_DEFAULT_LOCALE = 'en';

/**
 * Each locale's name written in that language: "Español" whatever language the app
 * is in right now. These are endonyms and not translation keys on purpose. Somebody
 * who opened the app in a language they cannot read has to be able to find their own
 * among the choices, and only its own name is sure to be readable to them.
 */
export const APP_LOCALE_NAMES: Readonly<Record<string, string>> = {
  en: 'English',
  es: 'Español',
};

/** The name of `locale` in its own language, or the code itself when unknown. */
export function localeName(locale: string): string {
  return APP_LOCALE_NAMES[locale] ?? locale;
}
