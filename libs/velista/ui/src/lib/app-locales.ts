/**
 * The locales this app's UI can load (it ships translation assets for each). The
 * UI module registers these with `RokuTranslatorModule.withConfig`.
 *
 * Which are actually *usable* is the app layer's call: the feature-shell picks the
 * enabled subset (`APP_USABLE_LOCALES`), which drives the route-data guard and the
 * language switcher.
 *
 * `APP_KEY` namespaces the persisted locale (`roku-locale:{appKey}`) and, since
 * plan 0002, the persisted theme choice too. It now lives in `models`, so that
 * `data-access` can namespace its own storage keys without depending on the
 * presentation layer, and is re-exported here so this import site keeps working.
 *
 * These constants are deliberately unprefixed: rule N1 keeps the product name out
 * of code symbols, and the `@portfolio/velista/ui` import path already scopes them.
 */
export { APP_KEY } from '@portfolio/velista/models';

export const APP_AVAILABLE_LOCALES: string[] = ['en', 'es'];
export const APP_DEFAULT_LOCALE = 'en';
