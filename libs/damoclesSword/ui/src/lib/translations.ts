import type { TranslationSource } from '@portfolio/localization/rokutranslator-angular';
import { DAMOCLES_AVAILABLE_LOCALES } from './damocles-locales';

/**
 * This library's contribution to damoclesSword's translations.
 *
 * A **descriptor**, not a provider list. The loader has to live here, because it is a
 * relative dynamic `import()` of this library's own asset folder and a relative
 * `import()` resolves against the file it is written in. The `provideRokuTranslator`
 * call has to live in the app, because which namespaces the app has is composition
 * (plan 0005 D11), so the two cannot be the same file.
 */
export const DAMOCLES_UI_TRANSLATIONS: TranslationSource = {
  namespace: 'damoclesSword',
  locales: DAMOCLES_AVAILABLE_LOCALES,
  loader: (locale) => import(`../../assets/i18n/${locale}.json`),
};
