import { inject, Injectable, InjectionToken, OnDestroy } from '@angular/core';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { ReplaySubject } from 'rxjs';

export const ROKU_TRANSLATOR_LOCALES = new InjectionToken<string[]>(
  'Locales to use/add for RokuTranslator'
);
export const ROKU_TRANSLATOR_NAMESPACES = new InjectionToken<string[]>(
  'Namespaces to use/add for RokuTranslator'
);
export const ROKU_TRANSLATOR_DEFAULT_NAMESPACE = new InjectionToken<string>(
  'Default namespace for RokuTranslator'
);
export const ROKU_TRANSLATOR_LOADER = new InjectionToken<
  (locale: string, namespace?: string) => Promise<Record<string, string>>
>('Loader function for RokuTranslator');

export type LoaderFunction<L = string> = (
  locale: L,
  namespace?: string
) => Promise<Record<string, string> | { default: Record<string, string> }>;

@Injectable()
export class RokuTranslatorService implements OnDestroy {
  private _locales: string[] = inject(ROKU_TRANSLATOR_LOCALES);
  private _namespaces: string[] = inject(ROKU_TRANSLATOR_NAMESPACES);
  private _defaultNamespace: string = inject(ROKU_TRANSLATOR_DEFAULT_NAMESPACE);
  private _loader: (
    locale: string,
    namespace?: string
  ) => Promise<Record<string, string>> = inject(ROKU_TRANSLATOR_LOADER);

  loaded$ = new ReplaySubject<boolean>(1);

  constructor() {
    const promises = [];

    if (this._defaultNamespace) {
      RokuTranslator.addNamespace(this._defaultNamespace);

      for (const locale of this._locales) {
        promises.push(
          RokuTranslator.addTranslations({
            locale,
            namespace: this._defaultNamespace,
            translations: () => this._loader(locale),
          })
        );
      }
    }

    for (const locale of this._locales) {
      for (const namespace of this._namespaces) {
        promises.push(
          RokuTranslator.addTranslations({
            locale,
            namespace,
            translations: () => this._loader(locale, namespace),
          })
        );
      }
    }

    Promise.all(promises).then(() => {
      this.loaded$.next(true);
      this.loaded$.complete();

      console.log(
        `RokuTranslatorService: Loaded translations for locales ${this._locales.join(', ')} with default namespace ${this._defaultNamespace} and namespaces ${this._namespaces.join(', ')}`
      );
    });
  }

  ngOnDestroy() {
    RokuTranslator.removeNamespace(this._defaultNamespace);
  }

  /**
   * Translate a key, scoped to this library's namespace so keys cannot leak
   * between libraries that happen to share a key name.
   *
   * @param key The translation key.
   * @param ns Optional namespace override. Defaults to the library's
   *   `defaultNamespace` (or its first declared namespace). Pass an explicit
   *   namespace to read a key that lives in one of the library's other
   *   namespaces (for example odontogram reading its `odontogram/models` keys).
   */
  t(key: string, ns?: string) {
    return RokuTranslator.t(key, {
      ns: ns || this._defaultNamespace || this._namespaces[0],
    });
  }
}
