/**
 * The locales odontogram's UI can load (it ships translation assets for each).
 * The UI module registers these with `RokuTranslatorModule.withConfig`.
 *
 * Which are actually *usable* is the app layer's call: the feature-shell picks the
 * enabled subset (`ODONTOGRAM_USABLE_LOCALES`) that drives the route-data guard.
 */
export const ODONTOGRAM_APP_KEY = 'odontogram';
export const ODONTOGRAM_AVAILABLE_LOCALES: string[] = ['en', 'es'];
export const ODONTOGRAM_DEFAULT_LOCALE = 'en';
