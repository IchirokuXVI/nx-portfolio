/**
 * The locales this app's UI can load (it ships translation assets for each). The
 * UI module registers these with `RokuTranslatorModule.withConfig`.
 *
 * Which are actually *usable* is the app layer's call: the feature-shell picks the
 * enabled subset (`APP_USABLE_LOCALES`), which drives the route-data guard and the
 * language switcher.
 *
 * `APP_KEY` namespaces the persisted locale (`roku-locale:{appKey}`). Its value is
 * the Nx project name — a technical identifier, stable across a rename (plan 0001,
 * section 2) — not the product name, which lives only in `AppBrand`.
 *
 * These constants are deliberately unprefixed: rule N1 keeps the product name out
 * of code symbols, and the `@portfolio/velista/ui` import path already scopes them.
 */
export const APP_KEY = 'velista';
export const APP_AVAILABLE_LOCALES: string[] = ['en', 'es'];
export const APP_DEFAULT_LOCALE = 'en';
