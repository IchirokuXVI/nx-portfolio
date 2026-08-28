import {
  inject,
  Injectable,
  InjectionToken,
  OnDestroy,
  Signal,
  signal,
} from '@angular/core';
import { TranslationTree } from '@portfolio/localization/rokutranslator';
import { Observable, ReplaySubject, switchMap } from 'rxjs';
import { RokuLocaleStore } from './roku-locale-store';
import { ROKU_TRANSLATOR } from './roku-translator-token';

export const ROKU_TRANSLATOR_LOCALES = new InjectionToken<string[]>(
  'Locales to use/add for RokuTranslator'
);
export const ROKU_TRANSLATOR_NAMESPACES = new InjectionToken<string[]>(
  'Namespaces to use/add for RokuTranslator'
);
export const ROKU_TRANSLATOR_DEFAULT_NAMESPACE = new InjectionToken<string>(
  'Default namespace for RokuTranslator'
);
export const ROKU_TRANSLATOR_LOADER = new InjectionToken<LoaderFunction>(
  'Loader function for RokuTranslator'
);

export type LoaderFunction<L = string> = (
  locale: L,
  namespace?: string
) => Promise<TranslationTree | { default: TranslationTree }>;

/**
 * One library's contribution to an app's translations: the namespace it owns, the
 * locales it ships, and the loader that reads its own asset folder.
 *
 * A type and a convention rather than a behaviour. `provideRokuTranslator` is
 * unchanged and an app that does not compose keeps calling it exactly as before;
 * an app assembled from several libraries collects their descriptors and derives
 * one dispatching loader from them, so each library states its own entry instead
 * of the composition site knowing everybody's asset folders.
 */
export interface TranslationSource<L extends string = string> {
  namespace: string;
  locales: readonly L[];
  loader: LoaderFunction<L>;
}

@Injectable()
export class RokuTranslatorService implements OnDestroy {
  private _locales: string[] = inject(ROKU_TRANSLATOR_LOCALES);
  private _namespaces: string[] = inject(ROKU_TRANSLATOR_NAMESPACES);
  private _defaultNamespace: string = inject(ROKU_TRANSLATOR_DEFAULT_NAMESPACE);
  private _loader: LoaderFunction = inject(ROKU_TRANSLATOR_LOADER);

  private _store = inject(RokuLocaleStore);

  /**
   * The app's own translator, from the token `provideRokuTranslator` binds, rather
   * than a module global. Everything below is unchanged in shape; it just talks to
   * an instance it was handed instead of one it imported (plan 0005 D4).
   */
  private _translator = inject(ROKU_TRANSLATOR);

  /** Every namespace this instance owns (default first), registered and torn down together. */
  private _ownedNamespaces: string[] = [
    ...(this._defaultNamespace ? [this._defaultNamespace] : []),
    ...this._namespaces,
  ];

  /**
   * Emits **exactly one** value and then completes, in every case including a
   * failed load, and never completes without emitting. A caller that wants to
   * *wait* for the strings (a route resolver, say) reads it with
   * `firstValueFrom`, which rejects with `EmptyError` on an observable that
   * completes empty, so the emission is the contract and not just the completion.
   *
   * The value is whether every loader actually succeeded. A caller that only asks
   * "is it safe to render now" ignores it.
   */
  loaded$ = new ReplaySubject<boolean>(1);

  /**
   * Flips to `true` once the loads settle, succeeded or not: a partially loaded
   * namespace still has strings worth painting.
   *
   * A signal rather than only the subject above, because the pipe reads it. One
   * write marks every OnPush view holding a `| rokuT` binding dirty exactly once,
   * at the moment there is something new to show. Without it such a view keeps the
   * keys it painted before the first `import()` resolved, since a promise settling
   * inside a service marks nothing.
   */
  readonly loaded = signal(false);

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
    // `init` belongs to the app now, and this is the app's only instance, so this
    // is where it runs (plan 0005 D8). It used to be an app initializer in the
    // shell's `app.config.ts`, which is the wrong hook twice over: it runs from the
    // root injector, and under the shell a remote is not bootstrapping at all.
    //
    // Awaiting it before registering translations matters: `addTranslations` only
    // takes the eager path once there is an i18next instance to add a bundle to.
    const ready = this._translator
      .init({
        supportedLocales: [...this._locales],
        namespaces: [...this._ownedNamespaces],
        lowercaseLocale: true,
      })
      .then(() => this.registerOwnedNamespaces());

    // The catch is load bearing, not defensive: `Promise.all` has no rejection
    // path of its own, so one loader that throws (a 404 on a chunk, malformed
    // JSON) used to leave `loaded$` pending forever and raise an unhandled
    // rejection. A caller that waits on it would hang on a blank screen.
    ready
      .then(() => true)
      .catch(() => false)
      .then((ok) => {
        this.loaded.set(true);
        this.loaded$.next(ok);
        this.loaded$.complete();
      });
  }

  private async registerOwnedNamespaces(): Promise<void> {
    const promises = [];

    // Register every namespace this instance owns (not just the default), so the
    // eager-load path activates for all of them and consumers no longer need to
    // call addNamespace(...) by hand.
    for (const namespace of this._ownedNamespaces) {
      await this._translator.addNamespace(namespace);
    }

    if (this._defaultNamespace) {
      for (const locale of this._locales) {
        promises.push(
          this._translator.addTranslations({
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
          this._translator.addTranslations({
            locale,
            namespace,
            translations: () => this._loader(locale, namespace),
          })
        );
      }
    }

    await Promise.all(promises);
  }

  ngOnDestroy() {
    this._translator.removeNamespace(...this._ownedNamespaces);
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
  /**
   * @param values interpolation values for a key containing `{{placeholders}}`, and
   *   the place to pass `count` so i18next selects the right plural form. The core
   *   `RokuTranslator#t` has always taken full i18next options; this wrapper simply
   *   did not pass any through, so a key like `"{{ready}} of {{total}} ready"`
   *   rendered its placeholders literally.
   */
  t(
    key: string,
    ns?: string,
    locale?: string,
    values?: Record<string, unknown>
  ) {
    return this._translator.t(key, {
      ns: ns || this._defaultNamespace || this._namespaces[0],
      lng: locale,
      ...values,
    });
  }

  /**
   * Build a stream keyed on the active locale: `project` runs on subscribe and
   * again on every locale change, with `switchMap` cancelling the previous
   * subscription. The current locale is passed to `project` (the data-access
   * services take it as an argument), so the call site never reads it by hand;
   * projects that do not need it (an animation to restart, an asset to reload)
   * can ignore the parameter. When a query also depends on other reactive inputs,
   * combine those with `locale$` at the call site instead.
   */
  withLocale<T>(project: (locale: string) => Observable<T>): Observable<T> {
    return this._store.locale$.pipe(switchMap((locale) => project(locale)));
  }
}
