import type { TranslationSource } from '@portfolio/localization/rokutranslator-angular';
import { ODONTOGRAM_AVAILABLE_LOCALES } from './odontogram-locales';

/**
 * This library's contribution to odontogram's translations.
 *
 * A **descriptor**, not a provider list. The loader has to live here, because it is a
 * relative dynamic `import()` of this library's own asset folder and a relative
 * `import()` resolves against the file it is written in. The
 * `provideRokuTranslator` call has to live in the app, because which namespaces the
 * app has is composition (plan 0005 D11), so the two cannot be the same file.
 */
export const ODONTOGRAM_UI_TRANSLATIONS: TranslationSource = {
  namespace: 'odontogram/ui',
  locales: ODONTOGRAM_AVAILABLE_LOCALES,
  loader: (locale) => import(`../../assets/i18n/${locale}.json`),
};

/**
 * The `odontogram/models` namespace, whose strings are the per domain translation
 * keys in `models-localization`.
 *
 * Its loader reads a module that exports one object per locale rather than one file
 * per locale, so it indexes instead of interpolating a path. That difference is
 * exactly why each library states its own loader: it is the sort of thing a central
 * dispatcher would have to know about every library it serves.
 *
 * It sits in `ui` rather than in `models-localization` because that library is a
 * plain JSON re-export with no dependency on the localization layer, and giving it
 * one to hold a three line descriptor would be the more expensive half of the trade.
 */
export const ODONTOGRAM_MODELS_TRANSLATIONS: TranslationSource = {
  namespace: 'odontogram/models',
  locales: ODONTOGRAM_AVAILABLE_LOCALES,
  loader: (locale) =>
    import('@portfolio/odontogram/models-localization').then(
      (m) => (m as Record<string, Record<string, string>>)[locale]
    ),
};
