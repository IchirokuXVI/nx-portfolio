/**
 * Single source of truth for damoclesSword's locales. Used by the UI module's
 * `RokuTranslatorModule.withConfig`, the remote's route `data` (so the shell's
 * `localeCorrectionGuard` can validate before render), and the language switcher.
 */
export const DAMOCLES_APP_KEY = 'damoclesSword';
export const DAMOCLES_LOCALES: string[] = ['en', 'es', 'fr'];
export const DAMOCLES_DEFAULT_LOCALE = 'en';
