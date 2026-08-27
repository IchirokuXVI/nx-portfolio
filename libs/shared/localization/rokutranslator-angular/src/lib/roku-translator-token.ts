import { InjectionToken } from '@angular/core';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';

/**
 * The one `RokuTranslator` an app owns.
 *
 * `provideRokuTranslator` binds it on the app's injector, so every app holds its own
 * active locale and its own namespaces, and the shell holds none (plan 0005 D4).
 * `RokuTranslatorService` and `RokuLocaleStore` read it from here rather than
 * importing a module global, which is the whole of what "the singleton retires"
 * means in the consumer layer.
 *
 * **No default factory, deliberately.** While the migration was in flight this token
 * fell back to one shared root instance so an app that had not moved yet still
 * worked. Every app owns its own now, so resolving this from an injector with no
 * `provideRokuTranslator` above it is an error rather than a silent second app
 * quietly sharing the first one's locale (plan 0005, acceptance criterion 4). That
 * error is the point: it names the missing provider at the moment the mistake is
 * made, instead of showing up later as one app changing another's language.
 */
export const ROKU_TRANSLATOR = new InjectionToken<RokuTranslator>(
  'ROKU_TRANSLATOR'
);
