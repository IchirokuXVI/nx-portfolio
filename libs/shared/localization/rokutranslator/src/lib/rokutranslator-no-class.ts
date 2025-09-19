import i18next, { i18n, TOptions } from 'i18next';

interface RokuTranslatorConfig {
  locale: string | undefined;
  /**
   * List of namespaces to use. makes translations
   * able to be overrided by priority (first one is the highest priority).
   */
  namespaces: string[];
  lowercaseLocale: boolean;
}

type LoaderFunction = () => Promise<
  Record<string, string> | { default: Record<string, string> }
>;

type LoadersByLocaleAndNamespace = Map<string, Map<string, LoaderFunction>>;

const config: RokuTranslatorConfig = {
  locale: undefined,
  namespaces: [],
  lowercaseLocale: true,
};
const loadersByLocaleAndNamespace: LoadersByLocaleAndNamespace = new Map();

let i18nextInstance: i18n;

async function init(config: Partial<RokuTranslatorConfig> = {}): Promise<void> {
  config = {
    ...config,
    ...config,
  };

  if (!config.locale || !isLocaleValid(config.locale)) {
    const savedLocale = localStorage.getItem('roku-locale');

    if (savedLocale && isLocaleValid(savedLocale)) {
      config.locale = savedLocale;
    } else {
      config.locale = 'en';
    }
  }

  await new Promise<void>((res, rej) => {
    i18nextInstance = i18next
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
          const loader = getLocaleNamespaceLoader(language, namespace);

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
          lng: config.locale,
          fallbackLng: 'en-US',
          ns: [],
          defaultNS: config.namespaces,
          // From the docs:
          // Please make sure to at least pass in an empty resources object on init.
          // Else i18next will try to load translations and give you a warning that
          // you are not using a backend.
          resources: {},
          debug: true,
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

function _formatLocale(locale: string): string {
  return config.lowercaseLocale ? locale.toLowerCase() : locale;
}

function getLocale() {
  if (!config.locale) {
    throw new Error('No locale set. Did you call init() ?');
  }

  return _formatLocale(config.locale);
}

async function changeLocale(locale: string): Promise<void> {
  if (!isLocaleValid(locale)) {
    throw new Error(`Invalid locale: ${locale}`);
  }

  config.locale = locale;

  if (i18nextInstance) {
    await i18nextInstance.changeLanguage(locale);
  }

  localStorage.setItem('roku-locale', locale);
}

function isLocaleValid(locale: string) {
  return /^[a-z]{2}(-[A-Z]{2})?$/.test(locale);
}

async function addNamespace(...namespaces: string[]): Promise<void> {
  const filteredNamespaces = namespaces.filter(
    (ns) => !config.namespaces.includes(ns)
  );

  config.namespaces.unshift(...filteredNamespaces);

  if (i18nextInstance) {
    const libNs = new Set(i18nextInstance.options.ns);

    i18nextInstance.options.ns = Array.from(
      new Set(namespaces.concat(Array.from(libNs)))
    );
  }
}

function removeNamespace(...namespaces: string[]): void {
  for (const nsToFind of namespaces) {
    for (const locale of Array.from(loadersByLocaleAndNamespace.keys())) {
      const index = config.namespaces.findIndex((ns) => ns === nsToFind);
      if (index !== -1) {
        config.namespaces.splice(index, 1);
      }

      if (i18nextInstance) {
        i18nextInstance.removeResourceBundle(locale, nsToFind);
      }
    }
  }
}

function getLocaleNamespaceLoader(locale: string, namespace: string) {
  const namespaceLoaders = loadersByLocaleAndNamespace.get(locale);

  return namespaceLoaders?.get(namespace);
}

function setLocaleNamespaceLoader(
  locale: string,
  namespace: string,
  loader: LoaderFunction
): void {
  loadersByLocaleAndNamespace.get(locale)?.set(namespace, loader);
}

async function addTranslations(
  locale: string,
  namespace: string,
  translations: LoaderFunction
): Promise<void> {
  if (locale !== config.locale && !isLocaleValid(locale)) {
    throw new Error(`Invalid locale: ${locale}`);
  }

  setLocaleNamespaceLoader(locale, namespace, translations);

  if (i18nextInstance) {
    i18nextInstance.options.supportedLngs = Array.from(
      loadersByLocaleAndNamespace.keys()
    );

    if (config.locale === locale && config.namespaces.includes(namespace)) {
      await loadTranslations(locale, namespace, translations);
    }
  }
}

async function loadTranslations(
  locale: string,
  namespace: string,
  translations: LoaderFunction
): Promise<void> {
  if (!i18nextInstance) {
    throw new Error('RokuTranslator not initialized. Call init() first.');
  }

  const loadedTranslations = await translations();

  i18nextInstance.addResources(locale, namespace, loadedTranslations);
}

function t(key: string, options?: TOptions): string {
  if (!i18nextInstance) {
    throw new Error('RokuTranslator not initialized. Call init() first.');
  }

  return i18nextInstance.t(key, { ...options });
}

export const RokuTranslator = {
  init,
  getLocale,
  changeLocale,
  addNamespace,
  removeNamespace,
  addTranslations,
  t,
};
