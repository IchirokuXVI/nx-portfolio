/**
 * Single source of truth for odontogram's locales. Used by the UI module's
 * `RokuTranslatorModule.withConfig` and the remote's route `data` (so the shell's
 * `localeCorrectionGuard` can validate before render).
 */
export const ODONTOGRAM_APP_KEY = 'odontogram';
export const ODONTOGRAM_LOCALES: string[] = ['en', 'es'];
export const ODONTOGRAM_DEFAULT_LOCALE = 'en';
