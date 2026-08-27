import { InjectionToken } from '@angular/core';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';

let legacyShared: RokuTranslator | undefined;

/**
 * The one `RokuTranslator` an app owns.
 *
 * `provideRokuTranslator` binds it on the app's injector, so every app holds its own
 * active locale and its own namespaces, and the shell holds none (plan 0005 D4).
 * `RokuTranslatorService` and `RokuLocaleStore` read it from here rather than
 * importing a module global, which is the whole of what "the singleton retires"
 * means in the consumer layer.
 */
export const ROKU_TRANSLATOR = new InjectionToken<RokuTranslator>(
  'ROKU_TRANSLATOR',
  {
    providedIn: 'root',
    /**
     * **Transitional, removed by the cleanup step of `apps/shell/plans/0003`.**
     *
     * The migration lands one app per commit, and an app that has not moved yet
     * still installs its translations through `RokuTranslatorModule.withConfig` on
     * a UI module, which sits *below* the route its locale guard runs on. Without a
     * root fallback that guard would have nothing to resolve and the app would be
     * broken between its own commit and the library's.
     *
     * So until every app provides its own, resolving this token from an injector
     * with no `provideRokuTranslator` above it yields one shared instance, which is
     * exactly today's behaviour. Deleting this factory is what makes acceptance
     * criterion 4 true: after it, that resolution is an error rather than a silent
     * second app sharing the first one's locale.
     */
    factory: () => (legacyShared ??= new RokuTranslator()),
  }
);
