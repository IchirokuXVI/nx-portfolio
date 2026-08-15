/**
 * Single source of truth for landingV2's locales. landingV2 is the root landing
 * app, so its per-app storage key is `landing` (see 0002 O1). Used by the UI
 * module's `RokuTranslatorModule.withConfig`, the remote's route `data`, and the
 * language switcher.
 */
export const LANDING_V2_APP_KEY = 'landing';
export const LANDING_V2_LOCALES: string[] = ['en', 'es'];
export const LANDING_V2_DEFAULT_LOCALE = 'en';
