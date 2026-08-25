import { NgModule } from '@angular/core';
import { RokuTranslatorModule } from '@portfolio/localization/rokutranslator-angular';
import { APP_AVAILABLE_LOCALES } from './app-locales';

/**
 * Registers this app's translation namespace and re-exports the `| rokuT` pipe.
 *
 * Importing this module is what puts the namespace providers in a component's
 * injector, which is why `AppLayout` imports it: as the parent route component it
 * passes them down to every page. Presentational components are added to
 * `components` as the page plans introduce them.
 *
 * The namespace is `velista` — the Nx project name, matching the `titleNs` the
 * shell's route data hands to its title strategy.
 *
 * **Keys are namespace-relative and carry no prefix**: `app-title`, `home.title`.
 * That is a deliberate departure from landingV2, whose keys are prefixed
 * (`landingV2.resume`). Rule N1 and plan 0002 section 5.2 keep the product name out
 * of translation keys, and the prefix buys nothing anyway: `t()` takes the
 * namespace as an argument and `nsSeparator` is disabled, so a lookup is already
 * scoped to this namespace and cannot leak into another.
 *
 * Rule N2 (plan 0001): a Zone is called a **group** in English and a **grupo** in
 * Spanish, and that word lives only in the JSON files this loader pulls in. No code
 * symbol is renamed to match, and no user-facing phrase is assembled by gluing this
 * noun to a prefix — phrases like "your groups" are whole keys, because gender and
 * agreement differ between the two languages.
 */
const components: never[] = [];

@NgModule({
  imports: [
    RokuTranslatorModule.withConfig({
      locales: APP_AVAILABLE_LOCALES,
      defaultNamespace: 'velista',
      loader: (locale) => import(`../../assets/i18n/${locale}.json`),
    }),
    ...components,
  ],
  exports: [RokuTranslatorModule, ...components],
  declarations: [],
  providers: [],
})
export class AppUiModule {}
