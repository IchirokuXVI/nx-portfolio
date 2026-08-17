/**
 * The locales damoclesSword's UI can load (it ships translation assets for each).
 * The UI module registers these with `RokuTranslatorModule.withConfig`.
 *
 * Which of these are actually *usable* is decided by the app layer, not here: the
 * feature-shell picks the enabled subset (`DAMOCLES_USABLE_LOCALES`) that drives
 * the route-data guard and the language switcher. See
 * `libs/damoclesSword/feature-shell`.
 */
export const DAMOCLES_APP_KEY = 'damoclesSword';
export const DAMOCLES_AVAILABLE_LOCALES: string[] = ['en', 'es', 'fr'];
export const DAMOCLES_DEFAULT_LOCALE = 'en';
