/**
 * The locales landingV2's UI can load (it ships translation assets for each). The
 * UI module registers these with `RokuTranslatorModule.withConfig`. landingV2 is
 * the root landing app, so its per-app storage key is `landing` (see 0002 O1).
 *
 * Which are actually *usable* is the app layer's call: the feature-shell picks the
 * enabled subset (`LANDING_V2_USABLE_LOCALES`) that drives the route-data guard
 * and the language switcher (the switcher reads it from route data).
 */
export const LANDING_V2_APP_KEY = 'landing';
export const LANDING_V2_AVAILABLE_LOCALES: string[] = ['en', 'es'];
export const LANDING_V2_DEFAULT_LOCALE = 'en';
