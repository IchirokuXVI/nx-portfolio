import { Provider } from '@angular/core';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { RokuLocaleStore } from './roku-locale-store';
import { ROKU_TRANSLATOR } from './roku-translator-token';
import {
  LoaderFunction,
  ROKU_TRANSLATOR_DEFAULT_NAMESPACE,
  ROKU_TRANSLATOR_LOADER,
  ROKU_TRANSLATOR_LOCALES,
  ROKU_TRANSLATOR_NAMESPACES,
  RokuTranslatorService,
  TranslationSource,
} from './rokutranslator-service';

// Re-exported from the module that declares the provider, because a composing app
// imports the descriptor and this function together.
export type { TranslationSource } from './rokutranslator-service';

/**
 * Turns a list of `TranslationSource` descriptors into the one loader
 * `provideRokuTranslator` takes.
 *
 * The library accepts a single loader for every namespace and passes the one it
 * wants as the second argument, so composing several libraries means dispatching on
 * it. Every app in this workspace needs that dispatch, and odontogram used to hand
 * roll it inline, so it lives here rather than being copied into four composition
 * sites (plan 0005 D11).
 *
 * An unknown namespace falls back to the first source rather than throwing. The
 * library only ever asks for namespaces it was configured with, and those come from
 * this same list, so the fallback is unreachable in practice. It exists because the
 * alternative is a rejected promise, and a rejected loader is the one thing an app's
 * `translationsReady` resolver would rather never see.
 *
 * Exported separately from the provider so an app's composition can be tested with
 * fake sources rather than by loading its real asset files, which is what makes
 * "adding a library is one entry" an assertion instead of a claim.
 */
export function composeTranslationLoader(
  from: readonly TranslationSource[]
): LoaderFunction {
  return (locale, namespace) =>
    (from.find((source) => source.namespace === namespace) ?? from[0]).loader(
      locale,
      namespace
    );
}

/**
 * Everything an app needs to own its translations, on the injector that installs it.
 *
 * Since plan 0005 this also creates the app's **own** `RokuTranslator` and the
 * `RokuLocaleStore` bound to it, so no call site changes shape: the array simply
 * carries more. That is what "the singleton retires" amounts to at a composition
 * site, and it is why two apps in one page hold two locales.
 *
 * `useFactory` rather than a shared value, so each injector that installs this gets
 * an instance of its own. The service below drives `init` on it.
 */
export function provideRokuTranslator<L extends string>({
  locales = [],
  namespaces = [],
  defaultNamespace,
  loader,
}: {
  locales?: L | L[];
  namespaces?: string | string[];
  defaultNamespace?: string;
  loader: LoaderFunction<L>;
}): Provider[] {
  return [
    {
      provide: ROKU_TRANSLATOR_LOCALES,
      useValue: Array.isArray(locales) ? locales : [locales],
    },
    {
      provide: ROKU_TRANSLATOR_NAMESPACES,
      useValue: Array.isArray(namespaces) ? namespaces : [namespaces],
    },
    { provide: ROKU_TRANSLATOR_DEFAULT_NAMESPACE, useValue: defaultNamespace },
    { provide: ROKU_TRANSLATOR_LOADER, useValue: loader },
    { provide: ROKU_TRANSLATOR, useFactory: () => new RokuTranslator() },
    RokuLocaleStore,
    RokuTranslatorService,
  ];
}
