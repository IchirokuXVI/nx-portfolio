import { InjectionToken, makeEnvironmentProviders } from '@angular/core';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';

const TRANSLATIONS_LOADER = new InjectionToken(
  'Factory to dynamically load translations'
);

type LoaderFunction = (
  locale: string,
  namespace: string
) => Promise<Record<string, string>>;

export function provideTranslationsLoader({
  locales = [],
  namespaces = [],
  loader,
}: {
  locales?: string | string[];
  namespaces?: string | string[];
  loader: LoaderFunction;
}) {
  return makeEnvironmentProviders([
    {
      provide: TRANSLATIONS_LOADER,
      useFactory: () => {
        console.log('Providing translations loader');
        const localesArr = Array.isArray(locales) ? locales : [locales];
        const namespacesArr = Array.isArray(namespaces)
          ? namespaces
          : [namespaces];

        for (const locale of localesArr) {
          for (const namespace of namespacesArr) {
            RokuTranslator.addTranslations(locale, namespace, () =>
              loader(locale, namespace)
            ).then(() =>
              console.log(`Loaded translations for ${locale}/${namespace}`)
            );
          }
        }
      },
    },
  ]);
}
