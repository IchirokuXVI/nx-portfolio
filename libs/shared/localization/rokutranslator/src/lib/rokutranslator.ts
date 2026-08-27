import i18next, { i18n, TOptions } from 'i18next';

interface RokuTranslatorConfig {
  locale: string | undefined;
  /**
   * Hardcoded locales to know which languages are supported.
   * If not set, any locale will be considered valid.
   * If the user doesn't have a locale from this array, the first one will be used.
   */
  supportedLocales: string[];
  /**
   * List of namespaces to use. This makes translations
   * able to be overrided by priority (first one is the highest priority).
   */
  namespaces: string[];
  lowercaseLocale: boolean;
  languageOnly: boolean;
}

/**
 * The shape a translation file may take. A leaf is a string (or an array of them,
 * which i18next reads as an indexed key), and a branch is another tree, so both
 * conventions in this workspace are the same type: a flat file writing
 * `"nav.home": "Home"` as a literal top-level key, and a nested file writing
 * `{ nav: { home: "Home" } }`.
 */
type TranslationTree = {
  [key: string]: string | string[] | TranslationTree;
};

type LoaderFunction = () => Promise<
  TranslationTree | { default: TranslationTree }
>;

type LoadersByLocaleAndNamespace = Map<string, Map<string, LoaderFunction>>;

/**
 * The canonical form of a locale as this workspace writes it in a URL: language
 * only, lowercase. `en-US` and `EN` are both `en`.
 *
 * A free function rather than only the instance method below, because the routing
 * layer needs it and, once the translator is per app (plan 0005), the routing layer
 * runs where no instance is in scope yet: the guard that decides which locale an app
 * should adopt is exactly the code that runs before anybody has adopted one. The
 * instance method stays, because an instance may be configured to keep the region or
 * the case; the URL never is.
 */
export function canonicalLocale(locale: string): string {
  return locale.split('-')[0].toLowerCase();
}

/**
 * `import('./en.json')` resolves to a module namespace object, not to the JSON,
 * so the bundle a loader hands back is `{ default: {...}, ...one export per top
 * level key }`. Unwrap it to the actual translations.
 *
 * Shared by both load paths on purpose. They used to carry their own copy of this
 * check, and the two disagreeing about the shape of a loader's return value is how
 * one of them stayed wrong for as long as it did.
 */
function unwrapDefault(
  loaded: TranslationTree | { default: TranslationTree }
): TranslationTree {
  if (
    'default' in loaded &&
    typeof loaded.default === 'object' &&
    loaded.default !== null
  ) {
    return loaded.default as TranslationTree;
  }

  return loaded as TranslationTree;
}

class RokuTranslator {
  private config: RokuTranslatorConfig = {
    locale: undefined,
    namespaces: [],
    lowercaseLocale: true,
    supportedLocales: [],
    languageOnly: true,
  };
  private loadersByLocaleAndNamespace: LoadersByLocaleAndNamespace = new Map();

  private i18nextInstance?: i18n;

  private localeListeners = new Set<(locale: string) => void>();

  /**
   * Register a listener notified after every locale change. Returns an
   * unsubscribe function. Multicast on purpose: an app's store, its pipe and any
   * data pipeline all observe the same instance without clobbering each other (the
   * old single mutable callback let the last assignor win).
   */
  public onLocaleChange(listener: (locale: string) => void): () => void {
    this.localeListeners.add(listener);
    return () => this.localeListeners.delete(listener);
  }

  private emitLocaleChange(locale: string): void {
    for (const listener of this.localeListeners) {
      listener(locale);
    }
  }

  /**
   * Resolves when `init` has finished, so callers that can arrive before it does
   * are not racing it. With one instance per app the window is real: the app's
   * environment initializer starts `init`, and the locale guard on the app's own
   * parent route can call `changeLocale` while it is still in flight.
   */
  private initialized?: Promise<void>;

  async init(config: Partial<RokuTranslatorConfig> = {}): Promise<void> {
    if (this.initialized) {
      // A second init **merges** rather than rebuilding, because rebuilding would
      // swap the i18next instance out from under everything already holding this
      // translator and drop every namespace registered so far.
      //
      // In the finished shape each app owns an instance and inits it once, so this
      // branch is only reached while the migration is in flight and several apps
      // still share the transitional root instance (see `ROKU_TRANSLATOR`).
      this.initialized = this.initialized.then(() => this.mergeConfig(config));
      return this.initialized;
    }

    this.initialized = this.doInit(config);
    return this.initialized;
  }

  private async mergeConfig(
    config: Partial<RokuTranslatorConfig>
  ): Promise<void> {
    if (config.supportedLocales?.length) {
      this.config.supportedLocales = Array.from(
        new Set([...this.config.supportedLocales, ...config.supportedLocales])
      );
    }

    if (config.namespaces?.length) {
      await this.addNamespace(...config.namespaces);
    }
  }

  private async doInit(config: Partial<RokuTranslatorConfig>): Promise<void> {
    this.config = {
      ...this.config,
      ...config,
    };

    if (!this.config.locale || !this.isLocaleValid(this.config.locale)) {
      // The locale is normally settled by the Angular routing layer (the URL
      // locale plus per-app persistence, see the locale routing refactor). Here
      // we only need a reasonable starting value for i18next before the shell's
      // guards correct it, so fall back to the browser locale.
      this.config.locale = this.getBrowserLocale();
    }

    // `createInstance()` first, then `use()` on what it returned. Written the other
    // way round (`i18next.use(...).createInstance(...)`) the backend is assigned to
    // the **module level default instance** and the created one is constructed with
    // a fresh, empty module registry, so it never sees the backend at all. That was
    // plan 0005 D3: the lazy `read` path below had never run, and with one instance
    // per app the same line would have had every app writing its loaders into one
    // shared registry, last app wins.
    const instance = i18next.createInstance();

    instance.use({
      type: 'backend',
      read: (
        language: string,
        namespace: string,
        callback: (
          err: Error | null,
          translations: TranslationTree | false
        ) => void
      ) => {
        const loader = this.getLocaleNamespaceLoader(language, namespace);

        if (!loader) {
          return callback(new Error('No loader found'), false);
        }

        loader()
          .then((translations) => {
            callback(null, unwrapDefault(translations));
          })
          .catch((err) => {
            callback(err, false);
          });
      },
    });

    await new Promise<void>((res, rej) => {
      instance.init(
        {
          lng: this.config.locale,
          fallbackLng: 'en-US',
          ns: [],
          defaultNS: this.config.namespaces,
          // The `ns` option passed to t() is authoritative for scoping a lookup to
          // a single namespace. Disabling nsSeparator stops i18next from treating a
          // ':' inside a key as a namespace override, so a key can never leak into
          // another namespace. Keys in this workspace use '.' as their separator.
          nsSeparator: false,
          load: 'languageOnly',
          // An empty bundle so i18next does not warn about starting with no
          // resources and no backend.
          resources: {},
          // The second half of D3, and the one the docs make easy to miss: passing
          // `resources` at all tells i18next the languages are bundled, which turns
          // the backend off even when one is registered. This library uses **both**
          // paths, eager `addResourceBundle` for everything registered up front and
          // the lazy `read` above for anything registered after init, and this flag
          // is what makes the two coexist. Measured, not assumed: without it the
          // read callback is never invoked.
          partialBundledLanguages: true,
          // debug: true,
        },
        (err) => {
          if (err) {
            return rej(err);
          }

          this.i18nextInstance = instance;
          res();
        }
      );
    });
  }

  getBrowserLocale(): string | undefined {
    const navigatorLocales =
      navigator.languages && navigator.languages.length
        ? navigator.languages
        : [navigator.language];

    let selectedLocale: string | undefined = undefined;

    for (const locale of navigatorLocales) {
      if (this.isLocaleSupported(locale)) {
        selectedLocale = this.formatLocale(locale);
        break;
      }
    }

    return selectedLocale;
  }

  public getSupportedLocales(): string[] {
    return this.config.supportedLocales;
  }

  formatLocale(locale: string): string {
    if (this.config.languageOnly) {
      locale = locale.split('-')[0];
    }

    if (this.config.lowercaseLocale) {
      locale = locale.toLowerCase();
    }

    return locale;
  }

  isLocaleSupported(locale: string, strict = false) {
    if (!this.config.supportedLocales.length) {
      return true;
    }

    locale = this.formatLocale(locale);

    if (strict) {
      return this.config.supportedLocales.includes(locale);
    }

    return this.config.supportedLocales.some((supportedLocale) =>
      supportedLocale
        .toLowerCase()
        .startsWith(locale.toLowerCase().split('-')[0])
    );
  }

  public getLocale() {
    if (!this.config.locale) {
      throw new Error('No locale set. Did you call init() ?');
    }

    return this.formatLocale(this.config.locale);
  }

  async changeLocale(locale: string): Promise<void> {
    // See `initialized`: a guard can reach this while init is still in flight, and
    // init reads `config.locale` before its own await, so without this the locale
    // set here would be overwritten by the browser fallback.
    await this.initialized;

    locale = this.formatLocale(locale);

    if (!this.isLocaleValid(locale)) {
      throw new Error(`Invalid locale: ${locale}`);
    }

    this.config.locale = locale;

    if (this.i18nextInstance) {
      // changeLanguage resolves once i18next has loaded the active namespaces for
      // the new locale (via the backend `read` loader), so listeners never see a
      // locale whose strings are not ready yet.
      await this.i18nextInstance.changeLanguage(locale);
    }

    // Persistence is per app and owned by the Angular routing layer
    // (roku-locale:{appKey}); the core no longer keeps a single global key.
    this.emitLocaleChange(locale);
  }

  isLocaleValid(locale: string) {
    return /^[a-z]{2}(-[A-Z]{2})?$/i.test(this.formatLocale(locale));
  }

  async addNamespace(...namespaces: string[]): Promise<void> {
    const filteredNamespaces = namespaces.filter(
      (ns) => !this.config.namespaces.includes(ns)
    );

    this.config.namespaces.unshift(...filteredNamespaces);

    if (!this.i18nextInstance) {
      return;
    }

    const libNs = new Set(this.i18nextInstance.options.ns);

    this.i18nextInstance.options.ns = Array.from(
      new Set(namespaces.concat(Array.from(libNs)))
    );

    // The lazy path, which D3 left dead. A namespace registered **after** init is
    // not in any bundle, so it is loaded through the backend `read` above.
    //
    // Only the ones with a loader for the active locale: asking i18next for a
    // namespace nothing can serve makes `read` call back with an error and logs a
    // failed load, and the ordinary case (the service registering a namespace
    // before its translations) would hit that on every startup.
    const loadable = namespaces.filter(
      (ns) => !!this.getLocaleNamespaceLoader(this.getLocale(), ns)
    );

    if (loadable.length) {
      await this.i18nextInstance.loadNamespaces(loadable);
    }
  }

  removeNamespace(...namespaces: string[]): void {
    for (const nsToFind of namespaces) {
      for (const locale of Array.from(
        this.loadersByLocaleAndNamespace.keys()
      )) {
        const index = this.config.namespaces.findIndex((ns) => ns === nsToFind);
        if (index !== -1) {
          this.config.namespaces.splice(index, 1);
        }

        if (this.i18nextInstance) {
          this.i18nextInstance.removeResourceBundle(locale, nsToFind);
        }
      }
    }
  }

  getLocaleNamespaceLoader(locale: string, namespace: string) {
    const namespaceLoaders = this.loadersByLocaleAndNamespace.get(
      this.formatLocale(locale)
    );

    return namespaceLoaders?.get(namespace);
  }

  setLocaleNamespaceLoader(
    locale: string,
    namespace: string,
    loader: LoaderFunction
  ): void {
    const key = this.formatLocale(locale);
    let namespaceLoaders = this.loadersByLocaleAndNamespace.get(key);

    if (!namespaceLoaders) {
      // The per-locale map has to be created here; without it the optional chain
      // silently dropped every loader, leaving the i18next backend unable to load
      // any namespace on a locale switch.
      namespaceLoaders = new Map();
      this.loadersByLocaleAndNamespace.set(key, namespaceLoaders);
    }

    namespaceLoaders.set(namespace, loader);
  }

  async addTranslations({
    locale,
    namespace = 'translation',
    translations,
  }: {
    locale: string;
    namespace: string;
    translations: LoaderFunction;
  }): Promise<void> {
    locale = this.formatLocale(locale);

    if (locale !== this.config.locale && !this.isLocaleValid(locale)) {
      throw new Error(`Invalid locale: ${locale}`);
    }

    this.setLocaleNamespaceLoader(locale, namespace, translations);

    if (this.i18nextInstance) {
      this.i18nextInstance.options.supportedLngs = Array.from(
        this.loadersByLocaleAndNamespace.keys()
      );

      // Eager-load every registered locale (not just the current one) as long as
      // the namespace is active, so a runtime locale switch is instant and never
      // flashes missing keys. Anything registered after init goes through the lazy
      // backend `read` path instead, which `addNamespace` drives and which only
      // started working with the D3 fix in `init`.
      if (this.config.namespaces.includes(namespace)) {
        await this.loadTranslations(locale, namespace, translations);
      }
    }
  }

  async loadTranslations(
    locale: string,
    namespace: string,
    translations: LoaderFunction
  ): Promise<void> {
    if (!this.i18nextInstance) {
      throw new Error('RokuTranslator not initialized. Call init() first.');
    }

    const loadedTranslations = unwrapDefault(await translations());

    // `addResources` is documented for flat maps: it iterates the top level and
    // keeps only string (or string array) values, so every object-valued branch of
    // a nested file was dropped silently and `t('zone.role.owner')` returned the
    // key. `addResourceBundle` with `deep` merges the tree as given.
    //
    // Flat files are unaffected: the bundle stores `"nav.home"` as the one top
    // level key it is written as, and a lookup tries the joined key as well as the
    // split path, so both shapes resolve through the same call.
    this.i18nextInstance.addResourceBundle(
      this.formatLocale(locale),
      namespace,
      loadedTranslations,
      /* deep */ true,
      /* overwrite */ true
    );
  }

  t(key: string, options?: TOptions): string {
    if (!this.i18nextInstance) {
      throw new Error('RokuTranslator not initialized. Call init() first.');
    }

    return this.i18nextInstance.t(
      key,
      options as Omit<TOptions, 'context'> & { context?: string }
    );
  }
}

export { RokuTranslator };
export type { LoaderFunction, RokuTranslatorConfig, TranslationTree };
