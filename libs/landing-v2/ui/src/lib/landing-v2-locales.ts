/**
 * The locales landingV2's UI can load (it ships translation assets for each). The
 * app registers them in `apps/landing-v2/src/app/translation-providers.ts`.
 *
 * Which are actually *usable* is the app layer's call: the feature-shell picks the
 * enabled subset (`LANDING_V2_USABLE_LOCALES`) that drives the route-data guard
 * and the language switcher (the switcher reads it from route data).
 *
 * The key is `landingV2`, matching `ROOT_APP_KEY` in the locale guard, which is the
 * value the shell guesses with before this app's bundle has loaded. The two names have to
 * agree or the guess and the app read different `roku-locale:` entries. Both said
 * `landing` until the original landing remote was retired (shell plan 0002), which
 * left the name pointing at an app that no longer exists.
 */
export const LANDING_V2_APP_KEY = 'landingV2';
export const LANDING_V2_AVAILABLE_LOCALES: string[] = ['en', 'es'];
export const LANDING_V2_DEFAULT_LOCALE = 'en';
