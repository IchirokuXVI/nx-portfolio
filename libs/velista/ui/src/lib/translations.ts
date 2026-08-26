import type { TranslationSource } from '@portfolio/localization/rokutranslator-angular';
import { APP_AVAILABLE_LOCALES } from './app-locales';

/**
 * This library's contribution to the app's translations (plan 0006, section 3).
 *
 * A **descriptor**, not a provider list. The two used to be one thing here, and
 * splitting them is the whole point of that plan: the loader has to live in this
 * library and the `provideRokuTranslator` call has to live in the app's composition
 * layer, so they cannot be the same file.
 *
 * ## Why the loader stays here
 *
 * It is a relative dynamic import of this library's own asset folder. A relative
 * `import()` resolves against the file it is written in, and `CLAUDE.md` forbids a
 * relative path across a library boundary, so this genuinely cannot be moved. Which
 * is also why it is worth stating as data: `feature-shell` composes the app's
 * translations without knowing where anybody's assets are.
 *
 * ## Why the call moved out
 *
 * There is exactly one `provideRokuTranslator` per app injector and it names the
 * default namespace, so it is a statement about the whole app rather than about this
 * library. A second library that ships its own `assets/i18n` exports its own
 * descriptor and `feature-shell` adds it to the list; nothing here changes, and no
 * library learns about another library's asset folder.
 *
 * The namespace is `velista`, the Nx project name, matching the `titleNs` the shell's
 * route data hands to its title strategy.
 */
export const VELISTA_UI_TRANSLATIONS: TranslationSource = {
  namespace: 'velista',
  locales: APP_AVAILABLE_LOCALES,
  loader: (locale) => import(`../../assets/i18n/${locale}.json`),
};
