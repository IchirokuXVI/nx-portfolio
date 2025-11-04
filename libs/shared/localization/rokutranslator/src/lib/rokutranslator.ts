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

type LoaderFunction = () => Promise<
  Record<string, string> | { default: Record<string, string> }
>;

type LoadersByLocaleAndNamespace = Map<string, Map<string, LoaderFunction>>;

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

  async init(config: Partial<RokuTranslatorConfig> = {}): Promise<void> {
    this.config = {
      ...this.config,
      ...config,
    };

    if (!this.config.locale || !this.isLocaleValid(this.config.locale)) {
      const savedLocale = localStorage.getItem('roku-locale');

      if (savedLocale && this.isLocaleValid(savedLocale)) {
        this.config.locale = savedLocale;
      } else {
        this.config.locale = this.getBrowserLocale();
      }
    }

    await new Promise<void>((res, rej) => {
      this.i18nextInstance = i18next
        .use({
          type: 'backend',
          read: (
            language: string,
            namespace: string,
            callback: (
              err: Error | null,
              translations: Record<string, string> | false
            ) => void
          ) => {
            const loader = this.getLocaleNamespaceLoader(language, namespace);

            if (!loader) {
              return callback(new Error('No loader found'), false);
            }

            loader()
              .then((translations) => {
                let finalTranslations = translations;

                if (
                  'default' in translations &&
                  typeof translations.default === 'object'
                ) {
                  finalTranslations = translations.default;
                }

                callback(null, finalTranslations as Record<string, string>);
              })
              .catch((err) => {
                callback(err, false);
              });
          },
        })
        .createInstance(
          {
            lng: this.config.locale,
            fallbackLng: 'en-US',
            ns: [],
            defaultNS: this.config.namespaces,
            load: 'languageOnly',
            // From the docs:
            // Please make sure to at least pass in an empty resources object on init.
            // Else i18next will try to load translations and give you a warning that
            // you are not using a backend.
            resources: {},
            // debug: true,
          },
          (err, t) => {
            if (err) {
              return rej(err);
            }

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

  getSupportedLocales(): string[] {
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

  isLocaleSupported(locale: string, strict: boolean = false) {
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

  getLocale() {
    if (!this.config.locale) {
      throw new Error('No locale set. Did you call init() ?');
    }

    return this.formatLocale(this.config.locale);
  }

  async changeLocale(locale: string): Promise<void> {
    locale = this.formatLocale(locale);

    if (!this.isLocaleValid(locale)) {
      throw new Error(`Invalid locale: ${locale}`);
    }

    this.config.locale = locale;

    if (this.i18nextInstance) {
      await this.i18nextInstance.changeLanguage(locale);
    }

    localStorage.setItem('roku-locale', locale);
  }

  isLocaleValid(locale: string) {
    return /^[a-z]{2}(-[A-Z]{2})?$/i.test(this.formatLocale(locale));
  }

  async addNamespace(...namespaces: string[]): Promise<void> {
    const filteredNamespaces = namespaces.filter(
      (ns) => !this.config.namespaces.includes(ns)
    );

    this.config.namespaces.unshift(...filteredNamespaces);

    if (this.i18nextInstance) {
      const libNs = new Set(this.i18nextInstance.options.ns);

      this.i18nextInstance.options.ns = Array.from(
        new Set(namespaces.concat(Array.from(libNs)))
      );
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
    this.loadersByLocaleAndNamespace
      .get(this.formatLocale(this.formatLocale(locale)))
      ?.set(namespace, loader);
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

      if (
        this.config.locale === locale &&
        this.config.namespaces.includes(namespace)
      ) {
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

    const loadedTranslations = await translations();

    this.i18nextInstance.addResources(
      this.formatLocale(locale),
      namespace,
      loadedTranslations
    );
  }

  t(key: string, options?: TOptions): string {
    if (!this.i18nextInstance) {
      throw new Error('RokuTranslator not initialized. Call init() first.');
    }

    return this.i18nextInstance.t(key, { ...options });
  }
}

const rokuTranslatorInstance = new RokuTranslator();

export { rokuTranslatorInstance as RokuTranslator };
