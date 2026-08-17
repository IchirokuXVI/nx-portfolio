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
