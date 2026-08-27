import { canonicalLocale, RokuTranslator } from './rokutranslator';

describe('RokuTranslator core', () => {
  describe('locale/namespace loader map', () => {
    it('stores a loader and returns it (inner map is created, not dropped)', () => {
      const translator = new RokuTranslator();
      const loader = () => Promise.resolve({ greeting: 'hi' });

      translator.setLocaleNamespaceLoader('en', 'ns-a', loader);

      // Before the fix the optional chain silently dropped the loader because the
      // per-locale map was never created, so this returned undefined.
      expect(translator.getLocaleNamespaceLoader('en', 'ns-a')).toBe(loader);
    });

    it('keeps loaders for multiple namespaces under the same locale', () => {
      const translator = new RokuTranslator();
      const a = () => Promise.resolve({ k: 'a' });
      const b = () => Promise.resolve({ k: 'b' });

      translator.setLocaleNamespaceLoader('es', 'ns-a', a);
      translator.setLocaleNamespaceLoader('es', 'ns-b', b);

      expect(translator.getLocaleNamespaceLoader('es', 'ns-a')).toBe(a);
      expect(translator.getLocaleNamespaceLoader('es', 'ns-b')).toBe(b);
    });
  });

  describe('onLocaleChange multicast', () => {
    it('notifies every registered listener on a locale change', async () => {
      const translator = new RokuTranslator();
      const first = jest.fn();
      const second = jest.fn();

      translator.onLocaleChange(first);
      translator.onLocaleChange(second);

      await translator.changeLocale('es');

      expect(first).toHaveBeenCalledWith('es');
      expect(second).toHaveBeenCalledWith('es');
    });

    it('stops notifying a listener after its unsubscribe runs', async () => {
      const translator = new RokuTranslator();
      const listener = jest.fn();
      const off = translator.onLocaleChange(listener);

      await translator.changeLocale('en');
      expect(listener).toHaveBeenCalledTimes(1);

      off();
      await translator.changeLocale('es');
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('canonicalLocale', () => {
    it.each([
      ['en', 'en'],
      ['en-US', 'en'],
      ['EN', 'en'],
      ['es-ES', 'es'],
    ])('%s becomes %s', (input, expected) => {
      expect(canonicalLocale(input)).toBe(expected);
    });
  });
});

/** Register one namespace's translations through the eager path. */
async function register(
  translator: RokuTranslator,
  locale: string,
  namespace: string,
  translations: () => Promise<unknown>
): Promise<void> {
  // Activating the namespace is what selects the eager path inside
  // addTranslations, which is the path that never had a test and the one every
  // app actually takes.
  await translator.addNamespace(namespace);
  await translator.addTranslations({
    locale,
    namespace,
    translations: translations as never,
  });
}

describe('registering a namespace', () => {
  let translator: RokuTranslator;

  beforeEach(async () => {
    translator = new RokuTranslator();
    await translator.init({
      locale: 'en',
      supportedLocales: ['en'],
      languageOnly: true,
    });
  });

  it('resolves every leaf of a nested file', async () => {
    await register(translator, 'en', 'ns-nested', () =>
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
    expect(translator.t('home.hero.headline', { ns: 'ns-nested' })).toBe(
      'Plan the week, together'
    );
    expect(translator.t('home.action.newList', { ns: 'ns-nested' })).toBe(
      'New list'
    );
    expect(translator.t('zone.role.owner', { ns: 'ns-nested' })).toBe('OWNER');
    // A string alongside the branches still resolves.
    expect(translator.t('app-title', { ns: 'ns-nested' })).toBe('Velista');
  });

  it('unwraps the module namespace an import() of a JSON file resolves to', async () => {
    await register(translator, 'en', 'ns-module', () =>
      Promise.resolve({
        default: { home: { hero: { headline: 'From the default export' } } },
        // Webpack emits a named export per top level key next to `default`.
        home: { hero: { headline: 'From the default export' } },
      })
    );

    expect(translator.t('home.hero.headline', { ns: 'ns-module' })).toBe(
      'From the default export'
    );
  });

  it('still resolves a flat dotted-key file', async () => {
    // The regression gate for the four apps that ship this shape. addResourceBundle
    // stores "nav.home" as the one top level key it is written as; the lookup tries
    // the joined key as well as the split path, so it resolves either way.
    await register(translator, 'en', 'ns-flat', () =>
      Promise.resolve({
        'app-title': "Damocle'Sword",
        'nav.home': 'Home',
        'section-projects.main-title': 'Relevant Projects',
      })
    );

    expect(translator.t('nav.home', { ns: 'ns-flat' })).toBe('Home');
    expect(translator.t('section-projects.main-title', { ns: 'ns-flat' })).toBe(
      'Relevant Projects'
    );
    // Not a valid identifier, and the one most likely to break on a shape change.
    expect(translator.t('app-title', { ns: 'ns-flat' })).toBe("Damocle'Sword");
  });

  it('keeps the two shapes in separate namespaces', async () => {
    // Same key, two namespaces, one flat and one nested: neither leaks into the
    // other, which is what makes a per-library namespace worth having.
    await register(translator, 'en', 'ns-flat', () =>
      Promise.resolve({ 'app-title': "Damocle'Sword" })
    );
    await register(translator, 'en', 'ns-nested', () =>
      Promise.resolve({ 'app-title': 'Velista' })
    );

    expect(translator.t('app-title', { ns: 'ns-flat' })).toBe("Damocle'Sword");
    expect(translator.t('app-title', { ns: 'ns-nested' })).toBe('Velista');
  });

  /**
   * Plan 0005 D3, and the only test that tells the two load paths apart.
   *
   * Everything above goes through the eager `addResourceBundle` path, which worked
   * whether or not the backend was attached. A namespace whose loader is registered
   * **after** init and never eager loaded can only resolve through the backend
   * `read`, so this fails on the old `i18next.use(...).createInstance(...)` and it
   * fails again if `partialBundledLanguages` is dropped.
   */
  it('loads a namespace registered after init, through the backend read path', async () => {
    const loader = jest.fn(() =>
      Promise.resolve({ late: { key: 'loaded lazily' } })
    );

    translator.setLocaleNamespaceLoader('en', 'ns-late', loader as never);
    await translator.addNamespace('ns-late');

    expect(loader).toHaveBeenCalled();
    expect(translator.t('late.key', { ns: 'ns-late' })).toBe('loaded lazily');
  });
});

/**
 * Plan 0005 acceptance criterion 2, and the test that would have caught D3: with the
 * backend on the module level default instance, two translators shared one loader
 * registry and the second to init won it for both.
 */
describe('two instances in one process', () => {
  it('hold two different locales at once and do not see each other', async () => {
    const a = new RokuTranslator();
    const b = new RokuTranslator();

    await a.init({ locale: 'en', supportedLocales: ['en', 'es'] });
    await b.init({ locale: 'es', supportedLocales: ['en', 'es'] });

    await register(a, 'en', 'ns-a', () => Promise.resolve({ who: 'app A' }));
    await register(b, 'es', 'ns-b', () => Promise.resolve({ who: 'app B' }));

    expect(a.getLocale()).toBe('en');
    expect(b.getLocale()).toBe('es');

    expect(a.t('who', { ns: 'ns-a' })).toBe('app A');
    expect(b.t('who', { ns: 'ns-b' })).toBe('app B');

    // Neither namespace exists on the other instance, so the key comes back.
    expect(a.t('who', { ns: 'ns-b' })).toBe('who');
    expect(b.t('who', { ns: 'ns-a' })).toBe('who');

    // And a switch on one leaves the other where it was.
    await a.changeLocale('es');
    expect(a.getLocale()).toBe('es');
    expect(b.getLocale()).toBe('es');

    await b.changeLocale('en');
    expect(a.getLocale()).toBe('es');
    expect(b.getLocale()).toBe('en');
  });
});
