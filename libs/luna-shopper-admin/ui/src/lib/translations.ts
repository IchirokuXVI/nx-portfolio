import type { TranslationSource } from '@portfolio/localization/rokutranslator-angular';
import { APP_AVAILABLE_LOCALES } from './app-locales';

/**
 * This library's contribution to the app's translations.
 *
 * A **descriptor**, not a provider list, exactly as velista's is. The loader has to
 * live in this library, because a relative dynamic `import()` resolves against the
 * file it is written in and `CLAUDE.md` forbids a relative path across a library
 * boundary. The `provideRokuTranslator` call has to live in the app's composition
 * layer, because there is one per app injector and it names the default namespace,
 * which is a statement about the whole app rather than about this library.
 *
 * A second library that ships its own `assets/i18n` exports its own descriptor and
 * `apps/luna-shopper-admin/src/app/translation-providers.ts` adds it to the list.
 * Nothing here changes, and no library learns about another's asset folder.
 *
 * The namespace is the Nx project name.
 */
export const LUNA_SHOPPER_ADMIN_UI_TRANSLATIONS: TranslationSource = {
  namespace: 'luna-shopper-admin',
  locales: APP_AVAILABLE_LOCALES,
  loader: (locale) => import(`../../assets/i18n/${locale}.json`),
};
