import i18next, { TOptions } from 'i18next';

interface RokuTranslatorConfig {
  locale: string | null;
  /**
   * List of namespaces to use. This makes translations
   * able to be overrided by priority (first one is the highest priority).
   */
  namespaces: string[];
}

type LoaderFunction = () => Promise<
  Record<string, string> | { default: Record<string, string> }
>;

type LoadersByLocaleAndNamespace = Map<string, Map<string, LoaderFunction>>;

class RokuTranslator {
  private config: RokuTranslatorConfig = { locale: null, namespaces: [] };
  private loadersByLocaleAndNamespace: LoadersByLocaleAndNamespace = new Map();

  constructor() {
    i18next
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
      .init({
        ns: [],
        defaultNS: this.config.namespaces,
        // From the docs:
        // Please make sure to at least pass in an empty resources object on init.
        // Else i18next will try to load translations and give you a warning that
        // you are not using a backend.
        resources: {},
        debug: true,
      });
  }

  setLocale(locale: string): void {
    if (!this.isLocaleValid(locale)) {
      throw new Error(`Invalid locale: ${locale}`);
    }

    this.config.locale = locale;
    i18next.changeLanguage(locale);
  }

  isLocaleValid(locale: string) {
    return /^[a-z]{2}(-[A-Z]{2})?$/.test(locale);
  }

  async addNamespace(...namespaces: string[]): Promise<void> {
    const filteredNamespaces = namespaces.filter(
      (ns) => !this.config.namespaces.includes(ns)
    );

    this.config.namespaces.unshift(...filteredNamespaces);

    const libNs = new Set(i18next.options.ns);

    i18next.options.ns = Array.from(
      new Set(namespaces.concat(Array.from(libNs)))
    );
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

        i18next.removeResourceBundle(locale, nsToFind);
      }
    }
  }

  getLocaleNamespaceLoader(locale: string, namespace: string) {
    const namespaceLoaders = this.loadersByLocaleAndNamespace.get(locale);

    return namespaceLoaders?.get(namespace);
  }

  setLocaleNamespaceLoader(
    locale: string,
    namespace: string,
    loader: LoaderFunction
  ): void {
    this.loadersByLocaleAndNamespace.get(locale)?.set(namespace, loader);
  }

  async addTranslations(
    locale: string,
    namespace: string,
    translations: LoaderFunction
  ): Promise<void> {
    if (locale !== this.config.locale && !this.isLocaleValid(locale)) {
      throw new Error(`Invalid locale: ${locale}`);
    }

    this.setLocaleNamespaceLoader(locale, namespace, translations);

    if (
      this.config.locale === locale &&
      this.config.namespaces.includes(namespace)
    ) {
      await this.loadTranslations(locale, namespace, translations);
    }
  }

  async loadTranslations(
    locale: string,
    namespace: string,
    translations: LoaderFunction
  ): Promise<void> {
    const loadedTranslations = await translations();

    i18next.addResources(locale, namespace, loadedTranslations);
  }

  t(key: string, options?: TOptions): string {
    return i18next.t(key, { ...options });
  }
}

const rokuTranslatorInstance = new RokuTranslator();

export { rokuTranslatorInstance as RokuTranslator };
