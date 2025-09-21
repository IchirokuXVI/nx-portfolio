import { Provider } from '@angular/core';
import {
  LoaderFunction,
  ROKU_TRANSLATOR_DEFAULT_NAMESPACE,
  ROKU_TRANSLATOR_LOADER,
  ROKU_TRANSLATOR_LOCALES,
  ROKU_TRANSLATOR_NAMESPACES,
  RokuTranslatorService,
} from './rokutranslator-service';

export function provideRokuTranslator<L extends string>({
  locales = [],
  namespaces = [],
  defaultNamespace,
  loader,
}: {
  locales?: string | string[];
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
    RokuTranslatorService,
  ];
}
