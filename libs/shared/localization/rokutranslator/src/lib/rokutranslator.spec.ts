import { RokuTranslator } from './rokutranslator';

describe('RokuTranslator core', () => {
  describe('locale/namespace loader map', () => {
    it('stores a loader and returns it (inner map is created, not dropped)', () => {
      const loader = () => Promise.resolve({ greeting: 'hi' });

      RokuTranslator.setLocaleNamespaceLoader('en', 'ns-a', loader);

      // Before the fix the optional chain silently dropped the loader because the
      // per-locale map was never created, so this returned undefined.
      expect(RokuTranslator.getLocaleNamespaceLoader('en', 'ns-a')).toBe(loader);
    });

    it('keeps loaders for multiple namespaces under the same locale', () => {
      const a = () => Promise.resolve({ k: 'a' });
      const b = () => Promise.resolve({ k: 'b' });

      RokuTranslator.setLocaleNamespaceLoader('es', 'ns-a', a);
      RokuTranslator.setLocaleNamespaceLoader('es', 'ns-b', b);

      expect(RokuTranslator.getLocaleNamespaceLoader('es', 'ns-a')).toBe(a);
      expect(RokuTranslator.getLocaleNamespaceLoader('es', 'ns-b')).toBe(b);
    });
  });

  describe('onLocaleChange multicast', () => {
    it('notifies every registered listener on a locale change', async () => {
      const first = jest.fn();
      const second = jest.fn();

      const offFirst = RokuTranslator.onLocaleChange(first);
      const offSecond = RokuTranslator.onLocaleChange(second);

      await RokuTranslator.changeLocale('es');

      expect(first).toHaveBeenCalledWith('es');
      expect(second).toHaveBeenCalledWith('es');

      offFirst();
      offSecond();
    });

    it('stops notifying a listener after its unsubscribe runs', async () => {
      const listener = jest.fn();
      const off = RokuTranslator.onLocaleChange(listener);

      await RokuTranslator.changeLocale('en');
      expect(listener).toHaveBeenCalledTimes(1);

      off();
      await RokuTranslator.changeLocale('es');
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * These run last on purpose. The translator is a singleton, so `init()` here would
 * otherwise give the describes above an i18next instance they never had, and a
 * `changeLocale` in one of them would start hitting the backend for namespaces with
 * no loader registered.
 */
describe('registering a namespace', () => {
  beforeAll(async () => {
    await RokuTranslator.init({
      locale: 'en',
      supportedLocales: ['en'],
      languageOnly: true,
    });
  });

  /** Register one namespace's translations through the eager path and read a key back. */
  async function register(
    namespace: string,
    translations: () => Promise<unknown>
  ): Promise<void> {
    // Activating the namespace is what selects the eager path inside
    // addTranslations, which is the path that never had a test and the one every
    // app actually takes.
    await RokuTranslator.addNamespace(namespace);
    await RokuTranslator.addTranslations({
      locale: 'en',
      namespace,
      translations: translations as never,
    });
  }

  it('resolves every leaf of a nested file', async () => {
    await register('ns-nested', () =>
      Promise.resolve({
        'app-title': 'Velista',
        home: {
          hero: { headline: 'Plan the week, together' },
          action: { newList: 'New list' },
        },
        zone: { role: { owner: 'OWNER' } },
      })
    );

    // addResources dropped every object-valued top level key silently, so these
    // three used to come back as the key itself.
    expect(RokuTranslator.t('home.hero.headline', { ns: 'ns-nested' })).toBe(
      'Plan the week, together'
    );
    expect(RokuTranslator.t('home.action.newList', { ns: 'ns-nested' })).toBe(
      'New list'
    );
    expect(RokuTranslator.t('zone.role.owner', { ns: 'ns-nested' })).toBe(
      'OWNER'
    );
    // A string alongside the branches still resolves.
    expect(RokuTranslator.t('app-title', { ns: 'ns-nested' })).toBe('Velista');
  });

  it('unwraps the module namespace an import() of a JSON file resolves to', async () => {
    await register('ns-module', () =>
      Promise.resolve({
        default: { home: { hero: { headline: 'From the default export' } } },
        // Webpack emits a named export per top level key next to `default`.
        home: { hero: { headline: 'From the default export' } },
      })
    );

    expect(RokuTranslator.t('home.hero.headline', { ns: 'ns-module' })).toBe(
      'From the default export'
    );
  });

  it('still resolves a flat dotted-key file', async () => {
    // The regression gate for the four apps that ship this shape. addResourceBundle
    // stores "nav.home" as the one top level key it is written as; the lookup tries
    // the joined key as well as the split path, so it resolves either way.
    await register('ns-flat', () =>
      Promise.resolve({
        'app-title': "Damocle'Sword",
        'nav.home': 'Home',
        'section-projects.main-title': 'Relevant Projects',
      })
    );

    expect(RokuTranslator.t('nav.home', { ns: 'ns-flat' })).toBe('Home');
    expect(
      RokuTranslator.t('section-projects.main-title', { ns: 'ns-flat' })
    ).toBe('Relevant Projects');
    // Not a valid identifier, and the one most likely to break on a shape change.
    expect(RokuTranslator.t('app-title', { ns: 'ns-flat' })).toBe(
      "Damocle'Sword"
    );
  });

  it('keeps the two shapes in separate namespaces', async () => {
    // Same key, two namespaces, one flat and one nested: neither leaks into the
    // other, which is what makes a per-library namespace worth having.
    expect(RokuTranslator.t('app-title', { ns: 'ns-flat' })).toBe(
      "Damocle'Sword"
    );
    expect(RokuTranslator.t('app-title', { ns: 'ns-nested' })).toBe('Velista');
  });
});
