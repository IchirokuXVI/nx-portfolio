import { NgModule } from '@angular/core';
import { RokuTranslatorModule } from '@portfolio/localization/rokutranslator-angular';

/**
 * Re-exports the `| rokuT` pipe, and nothing else.
 *
 * It used to register the namespace providers too, on the reasoning that `AppLayout`
 * imports it and, as the parent route component, "passes them down to every page".
 * That is not how a standalone component's imported modules work: those providers go
 * into that component's own injector, and a page reached by `loadComponent` on a child
 * route is created against the **route's** injector instead, so it never saw them.
 * They now live in `VELISTA_TRANSLATION_PROVIDERS`, installed by the app injector,
 * which is the injector that really does sit above every page. Presentational
 * components are added to `components` as the page plans introduce them.
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

/**
 * Note the plain `RokuTranslatorModule` rather than `withConfig`. The namespace
 * **providers** moved to `VELISTA_TRANSLATION_PROVIDERS`, which the app injector
 * installs, because a module imported by a standalone component provides only that
 * component's own injector and not the lazily loaded pages below it. See
 * `translation-providers.ts` for the failure that caused. What is left here is the
 * `| rokuT` pipe, which is all a template actually needs from this import.
 */
@NgModule({
  imports: [RokuTranslatorModule, ...components],
  exports: [RokuTranslatorModule, ...components],
  declarations: [],
  providers: [],
})
export class AppUiModule {}
