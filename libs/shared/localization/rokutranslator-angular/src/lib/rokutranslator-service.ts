import {
  inject,
  Injectable,
  InjectionToken,
  OnDestroy,
  Signal,
} from '@angular/core';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { Observable, ReplaySubject, switchMap } from 'rxjs';
import { RokuLocaleStore } from './roku-locale-store';

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

  private _store = inject(RokuLocaleStore);

  /** Every namespace this instance owns (default first), registered and torn down together. */
  private _ownedNamespaces: string[] = [
    ...(this._defaultNamespace ? [this._defaultNamespace] : []),
    ...this._namespaces,
  ];

  loaded$ = new ReplaySubject<boolean>(1);

  /** Active locale as a signal, delegated to the app-wide store. */
  get locale(): Signal<string> {
    return this._store.locale;
  }

  /** Active locale as an observable, delegated to the app-wide store. */
  get locale$(): Observable<string> {
    return this._store.locale$;
  }

  getLocale(): string {
    return this._store.getLocale();
  }

  constructor() {
    const promises = [];

    // Register every namespace this instance owns (not just the default), so the
    // eager-load path activates for all of them and consumers no longer need to
    // call RokuTranslator.addNamespace(...) by hand.
    for (const namespace of this._ownedNamespaces) {
      RokuTranslator.addNamespace(namespace);
    }

    if (this._defaultNamespace) {
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
    });
  }

  ngOnDestroy() {
    RokuTranslator.removeNamespace(...this._ownedNamespaces);
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
   * @param locale Optional locale override. Defaults to the active locale held by
   *   the store. Pass it only to force a key into a specific language.
   */
  t(key: string, ns?: string, locale?: string) {
    return RokuTranslator.t(key, {
      ns: ns || this._defaultNamespace || this._namespaces[0],
      lng: locale,
    });
  }

  /**
   * Build a stream keyed on the active locale: `project` runs on subscribe and
   * again on every locale change, with `switchMap` cancelling the in-flight
   * previous-locale request. The caller passes only the query; the locale is read
   * from the store, never threaded by hand. When a query also depends on other
   * reactive inputs, combine those with `locale$` at the call site instead.
   */
  withLocale<T>(project: () => Observable<T>): Observable<T> {
    return this._store.locale$.pipe(switchMap(project));
  }
}
