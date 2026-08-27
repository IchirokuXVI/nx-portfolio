import type { TranslationSource } from '@portfolio/localization/rokutranslator-angular';
import { LANDING_V2_AVAILABLE_LOCALES } from './landing-v2-locales';

/**
 * This library's contribution to landingV2's translations.
 *
 * A **descriptor**, not a provider list. The loader has to live here, because it is a
 * relative dynamic `import()` of this library's own asset folder and a relative
 * `import()` resolves against the file it is written in. The `provideRokuTranslator`
 * call has to live in the app, because which namespaces the app has is composition
 * (plan 0005 D11), so the two cannot be the same file.
 *
 * The namespace is `landingV2`, the Nx project name.
 */
export const LANDING_V2_UI_TRANSLATIONS: TranslationSource = {
  namespace: 'landingV2',
  locales: LANDING_V2_AVAILABLE_LOCALES,
  loader: (locale) => import(`../../assets/i18n/${locale}.json`),
};
